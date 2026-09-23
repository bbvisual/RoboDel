import os
import sys
import json
import time
import io
import base64
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from typing import Union

# Add sibling Thor3D directory to path to import thor3d correctly
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Thor3D'))
from thor3d import ThorRenderer

renderer_instance = None
r = None
# Enforce sequential access to the Unity process
thor_lock = threading.Lock()

TRIAL_CONFIGS = {
    "Trial_1_FP1_Island": {
        "scene": "FloorPlan1",
        "teleport": dict(x=-1.25, y=0.901, z=0, rotation=dict(x=0, y=90, z=0), horizon=0, standing=True)
    },
    "Trial_2_FP2_Table": {
        "scene": "FloorPlan2",
        "teleport": dict(x=-0.75, y=0.901, z=0.5, rotation=dict(x=0, y=90, z=0), horizon=30, standing=True)
    },
    "Trial_3_FP201_Table": {
        "scene": "FloorPlan201",
        "teleport": dict(x=-2.25, y=0.9027, z=2.5, rotation=dict(x=0, y=180, z=0), horizon=30, standing=True)
    }

}

@asynccontextmanager
async def lifespan(app: FastAPI):
    global renderer_instance, r
    print("Initializing ThorRenderer for CPU-only execution...")
    renderer_instance = ThorRenderer(
        width=1024, 
        height=576, 
        gpu_device=0, 
        quality="High"
    )
    r = renderer_instance.__enter__()
    yield
    if renderer_instance:
        renderer_instance.__exit__(None, None, None)
app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TrialRequest(BaseModel):
    trial_id: str

# Keep track of active object IDs mapped by index per trial
ACTIVE_OBJECT_IDS = []

class ActionRequest(BaseModel):
    action: str
    objectId: Union[str, int]

def encode_frame_to_base64(frame):
    img = Image.fromarray(frame)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=85)
    return f"data:image/jpeg;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}"

@app.post("/start_trial")
def start_trial(req: TrialRequest):
    global r, ACTIVE_OBJECT_IDS
    config = TRIAL_CONFIGS.get(req.trial_id)
    if not config:
        raise HTTPException(status_code=404, detail="Trial configuration missing")
    
    with thor_lock:
        r.controller.reset(scene=config["scene"], snapToGrid=False, renderInstanceSegmentation=True)
        event = r.controller.step(action="TeleportFull", **config["teleport"])
        
        # Capture the exact AI2-THOR object IDs for mapping
        ACTIVE_OBJECT_IDS = [obj["objectId"] for obj in event.metadata["objects"] if obj["visible"]]
        
        print(f"\n--- VISIBLE OBJECTS FOR {req.trial_id} ---")
        for idx, obj_id in enumerate(ACTIVE_OBJECT_IDS):
            print(f"Index {idx + 1}: {obj_id}")
        print("---------------------------------------\n")
        
        return {"image": encode_frame_to_base64(event.frame)}

@app.post("/action")
def execute_action(req: ActionRequest):
    global r, ACTIVE_OBJECT_IDS
    
    target_id = req.objectId
    # If a numeric ID/index is passed, map it to the corresponding AI2-THOR string
    if isinstance(target_id, int) or (isinstance(target_id, str) and target_id.isdigit()):
        idx = int(target_id) - 1
        if 0 <= idx < len(ACTIVE_OBJECT_IDS):
            target_id = ACTIVE_OBJECT_IDS[idx]
        else:
            raise HTTPException(status_code=400, detail=f"Object index {target_id} out of bounds")

    with thor_lock:
        event = r.controller.step(action=req.action, objectId=target_id)
        if not event.metadata.get("lastActionSuccess"):
            raise HTTPException(status_code=400, detail=event.metadata.get("errorMessage"))
        return {"image": encode_frame_to_base64(event.frame)}

# ---------------------------------------------------------
# ANALYTICAL SAVING LOGIC
# ---------------------------------------------------------
class SessionData(BaseModel):
    removed_objects: list
    removed_labels: list
    base_scene_name: str
    # final_image_path removed completely

OUTPUT_DIR = "output"
JSON_DIR = os.path.join(OUTPUT_DIR, "Output_JSON")
IMG_DIR = os.path.join(OUTPUT_DIR, "Output_Images")
MASTER_JSON_PATH = os.path.join(JSON_DIR, "master_dataset.json")

@app.post("/save_session")
def save_session(data: SessionData):
    global r
    try:
        os.makedirs(JSON_DIR, exist_ok=True)
        os.makedirs(IMG_DIR, exist_ok=True)
        
        timestamp = int(time.time())
        session_id = f"session_{timestamp}"
        
        if not os.path.exists(MASTER_JSON_PATH):
            master_data = {"dataset_version": "1.0", "sessions": []}
        else:
            try:
                with open(MASTER_JSON_PATH, "r") as f:
                    master_data = json.load(f)
            except (json.JSONDecodeError, FileNotFoundError):
                master_data = {"dataset_version": "1.0", "sessions": []}
                
        dest_img_filename = f"{session_id}_{data.base_scene_name}.jpg"
        dest_img_path = os.path.join(IMG_DIR, dest_img_filename)
        
        try:
            with thor_lock:
                if r and r.controller.last_event:
                    img = Image.fromarray(r.controller.last_event.frame)
                    img.save(dest_img_path, format="JPEG", quality=85)
                else:
                    dest_img_path = "No live frame available"
        except Exception as e:
            print(f"Warning: Could not save live image: {e}")
            dest_img_path = "Image extraction failed"

        # Use model_dump() for Pydantic v2 and record clean path
        session_record = data.model_dump()
        session_record["session_id"] = session_id
        session_record["saved_image_path"] = dest_img_path
        
        master_data["sessions"].append(session_record)
        
        with open(MASTER_JSON_PATH, "w") as f:
            json.dump(master_data, f, indent=4)
            
        print(f"Successfully saved {session_id} to {MASTER_JSON_PATH}")
        return {"status": "success", "session_id": session_id}
    except Exception as e:
        print(f"Error saving session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)