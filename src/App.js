import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

// Using your remote server's IP
 const API_URL = 'http://127.0.0.1:8000';

const PHASES = {
  FIXATION: -1,
  OBSERVATION: 0,
  TRANSITION: 1,
  INTERACTIVE: 2,
  COMPLETED: 3
};

const FIXATION_DURATION_SECONDS = 5;
const OBSERVATION_DURATION_SECONDS = 10;

const TRIAL_SEQUENCE = [
  "Trial_1_FP1_Island",
  "Trial_2_FP2_Table",
  "Trial_3_FP201_Table",
];

function App() {
  const [currentTrialIndex, setCurrentTrialIndex] = useState(0);
  const activeFolder = TRIAL_SEQUENCE[currentTrialIndex] || TRIAL_SEQUENCE[0];

  const [phase, setPhase] = useState(PHASES.FIXATION);
  const [fixationTimeLeft, setFixationTimeLeft] = useState(FIXATION_DURATION_SECONDS);
  const [timeLeft, setTimeLeft] = useState(OBSERVATION_DURATION_SECONDS);
  const [isProcessing, setIsProcessing] = useState(false);

  // Left Panel (Static)
  const [liveBaseImage, setLiveBaseImage] = useState(null);
  // Right Panel (Live)
  const [displayImage, setDisplayImage] = useState(null);
  
  const workingImageRef = useRef(null);
  const [imageHistory, setImageHistory] = useState([]);
  const [removedObjects, setRemovedObjects] = useState([]);
  const [removedLabels, setRemovedLabels] = useState([]);
  const [boundingboxes, setBoundingBoxes] = useState([]);
  const [naturalDims, setNaturalDims] = useState(null);

  // Hybrid Initialization: Local Static Left, Live Render Right
  useEffect(() => {
    if (currentTrialIndex >= TRIAL_SEQUENCE.length) return;

    setRemovedObjects([]);
    setImageHistory([]);
    setRemovedLabels([]);
    setTimeLeft(OBSERVATION_DURATION_SECONDS);
    setFixationTimeLeft(FIXATION_DURATION_SECONDS);
    setPhase(PHASES.FIXATION);
    setIsProcessing(true);

    const basePath = `/Prerendered_Scenes/${activeFolder}`;
    
    // 1. Fetch Local Bounding Boxes (for Left Panel clicks)
    fetch(`${basePath}/bounding_boxes.json`)
      .then(response => response.json())
      .then(data => setBoundingBoxes(data))
      .catch(error => console.error("Failed to load local bounding boxes:", error));

    // 2. Set Local Base Image (strictly for Left Panel)
    const initialImageUrl = `${basePath}/base.jpg`;
    setLiveBaseImage(initialImageUrl);

    const ref = new Image();
    ref.onload = () => {
      setNaturalDims({ width: ref.naturalWidth, height: ref.naturalHeight });
      workingImageRef.current = ref;
    };
    ref.src = initialImageUrl;

    // 3. Fetch Initial Live Render (strictly for Right Panel)
    axios.post(`${API_URL}/start_trial`, { trial_id: activeFolder })
      .then(response => {
        setDisplayImage(response.data.image);
        setIsProcessing(false); // Unblocks UI only when backend connects
      })
      .catch(error => {
        console.error("Backend connection failed. Port 8000 might be blocked:", error);
      });

  }, [activeFolder, currentTrialIndex]);

  useEffect(() => {
    // Let fixation countdown run immediately, even if backend is still spinning up
    if (phase === PHASES.FIXATION) {
      if (fixationTimeLeft > 0) {
        const timerId = setTimeout(() => setFixationTimeLeft(fixationTimeLeft - 1), 1000);
        return () => clearTimeout(timerId);
      } else {
        setPhase(PHASES.OBSERVATION);
      }
    }
  }, [fixationTimeLeft, phase]);

  useEffect(() => {
    if (phase === PHASES.OBSERVATION) {
      if (timeLeft > 0) {
        const timerId = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
        return () => clearTimeout(timerId);
      } else {
        setPhase(PHASES.TRANSITION);
        setTimeout(() => setPhase(PHASES.INTERACTIVE), 500);
      }
    }
  }, [timeLeft, phase]);

  const handleUndo = async () => {
    if (imageHistory.length === 0 || isProcessing) return;
    
    const previous = imageHistory[imageHistory.length - 1];
    setIsProcessing(true);

    try {
      const response = await axios.post(`${API_URL}/action`, {
        action: "EnableObject",
        objectId: previous.objectId
      });

      // Update Right Panel with live render
      setDisplayImage(response.data.image);
      setRemovedLabels(previous.labelsState);
      setImageHistory(imageHistory.slice(0, -1));
      setRemovedObjects(prev => prev.slice(0, -1));

      // Reset Left Panel bounding box color
      setBoundingBoxes(prev => prev.map((box, index) => {
        if (index === previous.boxIndex) return { ...box, isClicked: false };
        return box;
      }));
    } catch (error) {
      console.error("Failed to re-enable object on backend:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImageClick = async (event) => {
    if (isProcessing || !naturalDims || !workingImageRef.current) return;

    const imgElement = document.getElementById('interactive-scene-img');
    if (!imgElement) return;

    const rect = imgElement.getBoundingClientRect();
    const scaleX = naturalDims.width / rect.width;
    const scaleY = naturalDims.height / rect.height;
    const x = Math.round((event.clientX - rect.left) * scaleX);
    const y = Math.round((event.clientY - rect.top) * scaleY);

    const clickedBoxIndex = boundingboxes.findIndex(box =>
      !box.isClicked &&
      x >= box.x && x <= box.x + box.width &&
      y >= box.y && y <= box.y + box.height
    );

    if (clickedBoxIndex === -1) return;

    const targetBox = boundingboxes[clickedBoxIndex];
    setIsProcessing(true);

    try {
      // Send live command to Python
      const response = await axios.post(`${API_URL}/action`, {
        action: "DisableObject",
        objectId: targetBox.id
      });

      setImageHistory(prev => [
        ...prev,
        {
          display: displayImage,
          labelsState: [...removedLabels, targetBox.label.toLowerCase()],
          boxIndex: clickedBoxIndex,
          objectId: targetBox.id
        }
      ]);

      // Update Right Panel with the live render returned from Python
      setDisplayImage(response.data.image);
      
      // Mark bounding box on Left Panel as clicked
      setRemovedLabels(prev => [...prev, targetBox.label.toLowerCase()]);
      setBoundingBoxes(prev => prev.map((box, index) =>
        index === clickedBoxIndex ? { ...box, isClicked: true } : box
      ));

      setRemovedObjects(prev => [...prev, {
        object_id: targetBox.id,
        label: targetBox.label,
        bounding_box: { x: targetBox.x, y: targetBox.y, width: targetBox.width, height: targetBox.height },
        click_position: { x, y }
      }]);
    } catch (error) {
      console.error("Failed to disable object on backend:", error);
      const serverMsg = error.response?.data || error.message;
      alert(`Backend Error: ${JSON.stringify(serverMsg)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReviewAndSave = async () => {
    setIsProcessing(true);
    try {
      await axios.post(`${API_URL}/save_session`, {
        removed_objects: removedObjects,
        removed_labels: removedLabels,
        base_scene_name: activeFolder,
        final_image_path: displayImage
      });

      if (currentTrialIndex + 1 < TRIAL_SEQUENCE.length) {
        setCurrentTrialIndex(prev => prev + 1);
      } else {
        setPhase(PHASES.COMPLETED);
      }
    } catch (error) {
      console.error("Error saving session to backend:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="app-container">
      {phase === PHASES.FIXATION && (
        <div className="fixation-screen">
          <div className="fixation-cross" />
        </div>
      )}

      {phase === PHASES.OBSERVATION && (
        <div className="observable-screen">
          <img src={liveBaseImage} alt="Observation View" className="observable-image" />
        </div>
      )}

      {phase === PHASES.TRANSITION && (
        <div className="centered-view">
          <h2>Transitioning to Interactive Mode...</h2>
        </div>
      )}

      {phase === PHASES.INTERACTIVE && (
        <div className="interactive-layout">
          <div className="interactive-toolbar">
            <h2>Interactive Modification (Trial {currentTrialIndex + 1}/{TRIAL_SEQUENCE.length})</h2>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleUndo} disabled={imageHistory.length === 0 || isProcessing} className="btn-secondary">
                Undo Last Action
              </button>
              <button onClick={handleReviewAndSave} disabled={isProcessing} className="btn-primary">
                {isProcessing ? 'Processing...' : (currentTrialIndex + 1 < TRIAL_SEQUENCE.length ? 'Save & Next Trial' : 'Save & Finish')}
              </button>
            </div>
          </div>

          <div className="interactive-windows-grid">
            <div className="interactive-card">
              <div className="interactive-card-title">Click on objects you remember not being in the prior scene to remove them</div>
              <div className="interactive-viewport-wrapper">
                <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0, maxHeight: '100%', maxWidth: '100%' }}>
                  <img
                    id="interactive-scene-img"
                    src={liveBaseImage}
                    onClick={handleImageClick}
                    alt="Interactive Target"
                    className="interactive-viewport-img"
                    style={{ cursor: isProcessing ? 'wait' : 'crosshair' }}
                  />
                  {naturalDims && boundingboxes.map((box) => {
                    const leftPercent = (box.x / naturalDims.width) * 100;
                    const topPercent = (box.y / naturalDims.height) * 100;
                    const widthPercent = (box.width / naturalDims.width) * 100;
                    const heightPercent = (box.height / naturalDims.height) * 100;

                    return (
                      <div
                        key={box.id}
                        style={{
                          position: 'absolute', left: `${leftPercent}%`, top: `${topPercent}%`, width: `${widthPercent}%`, height: `${heightPercent}%`,
                          border: `2px solid ${box.isClicked ? '#ef4444' : '#22c55e'}`,
                          backgroundColor: box.isClicked ? 'rgba(239, 68, 68, 0.25)' : 'rgba(34, 197, 94, 0.15)',
                          pointerEvents: 'none'
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="interactive-card">
              <div className="interactive-card-title">Current Live Render</div>
              <div className="interactive-viewport-wrapper">
                <img src={displayImage} alt="Current State" className="interactive-viewport-img" />
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === PHASES.COMPLETED && (
        <div className="centered-view">
          <h2>Experiment Complete</h2>
          <p style={{ marginTop: '12px', color: '#9ca3af' }}>All session data has been successfully saved to the server.</p>
        </div>
      )}
    </div>
  );
}

export default App;