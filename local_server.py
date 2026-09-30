import os
import json
import time
import shutil
from urllib.parse import unquote
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SessionData(BaseModel):
    participant_id: str      # Added to receive the ID from the Setup Phase
    target_object: str       # Added to receive the specific trial target
    removed_objects: list
    removed_labels: list
    base_scene_name: str
    final_image_path: str
    mouse_telemetry: dict  

# 1. Use absolute paths based on this file's location so it works from any terminal context
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
JSON_DIR = os.path.join(OUTPUT_DIR, "Output_JSON")
IMG_DIR = os.path.join(OUTPUT_DIR, "Output_Images")
MASTER_JSON_PATH = os.path.join(JSON_DIR, "master_dataset.json")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

@app.post("/save_session")
def save_session(data: SessionData):
    try:
        os.makedirs(JSON_DIR, exist_ok=True)
        os.makedirs(IMG_DIR, exist_ok=True)
        
        timestamp = int(time.time())
        session_id = f"session_{timestamp}"
        
        if not os.path.exists(MASTER_JSON_PATH):
            master_data = {
                "dataset_version": "1.0",
                "sessions": []
            }
        else:
            try:
                with open(MASTER_JSON_PATH, "r") as f:
                    master_data = json.load(f)
            except (json.JSONDecodeError, FileNotFoundError):
                master_data = {"dataset_version": "1.0", "sessions": []}
                
        # 2. Decode URL entities (e.g., %20) so the OS can read the real file path
        clean_image_path = unquote(data.final_image_path)
        relative_img_path = clean_image_path.lstrip("/")
        source_img_path = os.path.join(PUBLIC_DIR, relative_img_path)
        
        # 3. Dynamically grab the correct extension (.jpg) instead of hardcoding .png
        ext = os.path.splitext(clean_image_path)[1] or ".jpg"
        dest_img_filename = f"{session_id}_{data.base_scene_name}{ext}"
        dest_img_path = os.path.join(IMG_DIR, dest_img_filename)
        
        if os.path.exists(source_img_path):
            shutil.copy2(source_img_path, dest_img_path)
            # Store a clean relative path in the JSON for readability
            saved_record_path = os.path.join("output", "Output_Images", dest_img_filename)
        else:
            print(f"Warning: Could not find image to copy at {source_img_path}")
            saved_record_path = "Image not found locally"

        session_record = data.dict()
        session_record["session_id"] = session_id
        session_record["saved_image_path"] = saved_record_path
        
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