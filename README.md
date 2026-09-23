
# Version 1 
#### How this app works
- The experiment is split into multiple trials and each trial is categorised into 3 phases 
    - Phase 1 - Fixation : The observer sees a black screen with a red cross . The purpose of this phase is to centre the gaze of the observer. This phase lasts for 5s 
    - Phase 2 - Observation : The observer sees an image of the scene , they free view it . This phase lasts for 10s 
    - Phase 3 - Interaction : The observer is presented with two images that are the same as observed image, left image (the control) with select number of objects highlighted with a green bounding and the right image (the current render). The observer is encouraged to click on the objects they remember not being present in the original image and once they click, the current render updates to show the scene without that object. The observer can undo this choice. 
- Once they are sure that the current render matches their perception of the scene, they click save and move on to the next trial where the whole process repeats.

#### How to run this- create a conda environment and install requirements:
```bash
conda create -n robodel_env python=3.10 -y
conda activate robodel_env
pip install -r requirements.txt
```
- Configure the display and environment variables
```bash
export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1

```
DISPLAY=:99: Directs AI2-THOR and Unity to use the virtual Xvfb frame buffer display server.

LIBGL_ALWAYS_SOFTWARE=1: Forces software-based Mesa rendering via the CPU (recommended if physical GPU nodes are occupied or unavailable).
- start the local server to ensure save functionality and rendering work
```
python local_server.py
```
- To run everything else
```
npm start
```


#### How to add more trials and other modifications



- Say you wanted to add a trial for  FloorPlan 3 
- To find the exact location you want to display , use the web_explorer.py to explore FloorPlan3
```bash
python scripts/web_explorer.py --scene FloorPlan3
```
- Once your location is fixed, record the x,y,z coordinates, rotation value and horizon value . For example x = 1, y = 2 , z = 3 , rotation = 30 , horizon = 30 . You then decide the trial number lets say its 3 

```bash
python scripts/batch_pregenerate.py --scene FloorPlan3 --trial Trial_3_FP3_Table --x 1 --y 2 --z 3 --rotation 30 --horizon 30
```
Trial_3_FP3_Table means its the the 3rd trial using FloorPlan3 and the last word denotes the general area where the objects are in this table

This command generates a json file that specifies the bounding boxes for the target objects listed in the batch_pregenerate.py file (will update this to accept custom object arguments) and a base.png for the scene itself

- Go to local_server.py and add the following  to TRIAL_CONFIGS :
```python
    "Trial_3_FP3_Table": {
        "scene": "FloorPlan3",
        "teleport": dict(x=-1, y=2, z=3, rotation=dict(x=0, y=30, z=0), horizon=30, standing=True)
    }
```
- Go to App.js and add "Trial_3_FP3_Table" to TRIAL_SEQUENCE. 
- The order of the trial in the lists in both matters , it defines the order in which it appears when you run the app





#### Remarks