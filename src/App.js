import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = "http://localhost:8000";
const PHASES = {
  ID_ENTRY: -4,      // Phase 1: Ask for Participant ID (only on first trial)
  TARGET_PROMPT: -3, // Phase 2: Show the target object to find
  BLANK_SCREEN: -2,  // Phase 3: 500ms pure black screen
  FIXATION: -1,      // Phase 4: 500ms red cross
  OBSERVATION: 0,
  TRANSITION: 1,
  INTERACTIVE: 2,
  COMPLETED: 3
};

// Sequences map 1:1. Trial index 0 gets Target index 0.
const TRIAL_SEQUENCE = [
  "Trial_1_FP1_Island",
  "Trial_2_FP207_LivingRoom",
  "Trial_x_FP7_Counter"
];

const TARGET_SEQUENCE = [
  "Pan",
  "Bottle",
  "Plant"
];

function App() {
  const [currentTrialIndex, setCurrentTrialIndex] = useState(0);
  const activeFolder = TRIAL_SEQUENCE[currentTrialIndex] || TRIAL_SEQUENCE[0];
  const activeTarget = TARGET_SEQUENCE[currentTrialIndex] || TARGET_SEQUENCE[0];

  // Dynamic paths based on active trial folder
  const modifiedImage = `/Prerendered_Scenes/${activeFolder}/base.jpg`;
  const originalImage = modifiedImage;

  // New state for Participant ID
  const [participantId, setParticipantId] = useState("");
  
  // Start the application in the ID_ENTRY phase
  const [phase, setPhase] = useState(PHASES.ID_ENTRY);
  const [isProcessing, setIsProcessing] = useState(false);

  const [displayImage, setDisplayImage] = useState(modifiedImage);
  const workingImageRef = useRef(null);
  
  // Canvas, Telemetry, and Testing Refs
  const canvasRef = useRef(null);
  const blurredCanvasRef = useRef(document.createElement('canvas'));
  const telemetryRef = useRef([]);
  const renderFrameRef = useRef();
  const currentMouseRef = useRef({ x: 0, y: 0 });
  
  const [numStops, setNumStops] = useState(100); 
  const numStopsRef = useRef(100);

  useEffect(() => {
    numStopsRef.current = numStops;
  }, [numStops]);

  const [removedObjects, setRemovedObjects] = useState([]);
  const [removedLabels, setRemovedLabels] = useState([]);
  const [boundingboxes, setBoundingBoxes] = useState([]);
  const [naturalDims, setNaturalDims] = useState(null);

  useEffect(() => {
    setDisplayImage(modifiedImage);
    setRemovedObjects([]);
    setRemovedLabels([]);
    
    // If it's the first trial, ask for ID. Otherwise, skip straight to the Target Prompt.
    setPhase(currentTrialIndex === 0 ? PHASES.ID_ENTRY : PHASES.TARGET_PROMPT); 
    
    telemetryRef.current = []; 
    currentMouseRef.current = { x: 0, y: 0 }; 

    const ref = new Image();
    ref.crossOrigin = "anonymous";
    ref.onload = () => {
      setNaturalDims({ width: ref.naturalWidth, height: ref.naturalHeight });
      workingImageRef.current = ref;
    };
    ref.src = modifiedImage;
  }, [currentTrialIndex, modifiedImage]);

  useEffect(() => {
    if (currentTrialIndex >= TRIAL_SEQUENCE.length) return;

    fetch(`/Prerendered_Scenes/${activeFolder}/bounding_boxes.json`)
      .then(response => response.json())
      .then(data => {
        setBoundingBoxes(data);
      })
      .catch(error => console.error(`Failed to load bounding boxes for ${activeFolder}:`, error));
  }, [activeFolder, currentTrialIndex]);

  // Handle the sequence: 500ms Blank Screen -> 500ms Fixation Cross -> Observation
  useEffect(() => {
    let timerId;
    if (phase === PHASES.BLANK_SCREEN) {
      timerId = setTimeout(() => setPhase(PHASES.FIXATION), 500);
    } else if (phase === PHASES.FIXATION) {
      timerId = setTimeout(() => setPhase(PHASES.OBSERVATION), 500);
    }
    return () => clearTimeout(timerId);
  }, [phase]);

  useEffect(() => {
    if (phase === PHASES.OBSERVATION && naturalDims && workingImageRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      const img = workingImageRef.current;

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const bCanvas = blurredCanvasRef.current;
      bCanvas.width = img.naturalWidth;
      bCanvas.height = img.naturalHeight;
      const bCtx = bCanvas.getContext('2d');
      bCtx.filter = 'blur(15px)'; 
      bCtx.drawImage(img, 0, 0);

      const P_PX_PER_DEG = 29.719; 
      const ALPHA_DEG = 2.5;       
      const CURSOR_DEG = 2.0;      

      const alpha_px = P_PX_PER_DEG * ALPHA_DEG;          
      const cursor_radius_px = P_PX_PER_DEG * CURSOR_DEG; 

      const MAX_BLEND_RADIUS = Math.max(canvas.width, canvas.height); 

      const handleMouseMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        currentMouseRef.current = { x, y };

        if (renderFrameRef.current) cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = requestAnimationFrame(() => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(bCanvas, 0, 0);

          ctx.globalCompositeOperation = 'destination-out';
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, MAX_BLEND_RADIUS);
          
          const currentStops = numStopsRef.current; 
          for (let i = 0; i <= currentStops; i++) {
              const fraction = Math.pow(i / currentStops, 2); 
              const r = fraction * MAX_BLEND_RADIUS;
              
              const R_val = alpha_px / (alpha_px + r); 
              gradient.addColorStop(fraction, `rgba(0, 0, 0, ${R_val})`);
          }

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.rect(0, 0, canvas.width, canvas.height);
          ctx.fill();

          ctx.globalCompositeOperation = 'destination-over';
          ctx.drawImage(img, 0, 0);

          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.65)';
          ctx.lineWidth = 2 * scaleX; 
          ctx.beginPath();
          ctx.arc(x, y, cursor_radius_px, 0, 2 * Math.PI);
          ctx.stroke();
        });
      };

      // Changed from handleKeyDown to handleMouseDown
      const handleMouseDown = (e) => {
        if (e.button === 0) { // e.button === 0 ensures it specifically responds to a left-click
          setPhase(PHASES.TRANSITION);
          setTimeout(() => setPhase(PHASES.INTERACTIVE), 500);
        }
      };

      canvas.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mousedown', handleMouseDown); // Changed 'keydown' to 'mousedown'
      
      const telemetryIntervalId = setInterval(() => {
        const { x, y } = currentMouseRef.current;
        if (x !== 0 || y !== 0) {
          telemetryRef.current.push({ t: performance.now(), x: Math.round(x), y: Math.round(y) });
        }
      }, 300);

      return () => {
        canvas.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mousedown', handleMouseDown); // Changed 'keydown' to 'mousedown'
        clearInterval(telemetryIntervalId);
        if (renderFrameRef.current) cancelAnimationFrame(renderFrameRef.current);
      };
    }
  }, [phase, naturalDims]);

  const handleImageClick = (event) => {
    if (isProcessing || !naturalDims || !workingImageRef.current) return;

    const imgElement = document.getElementById('interactive-scene-img');
    if (!imgElement) return;

    const rect = imgElement.getBoundingClientRect();
    const scaleX = naturalDims.width / rect.width;
    const scaleY = naturalDims.height / rect.height;
    const x = Math.round((event.clientX - rect.left) * scaleX);
    const y = Math.round((event.clientY - rect.top) * scaleY);

    const clickedBoxIndex = boundingboxes.findIndex(box =>
      x >= box.x && x <= box.x + box.width &&
      y >= box.y && y <= box.y + box.height
    );

    if (clickedBoxIndex === -1) return;

    const targetBox = boundingboxes[clickedBoxIndex];
    const clickedLabel = targetBox.label.toLowerCase();
    const isCurrentlyClicked = targetBox.isClicked;

    let newRemovedLabels;
    let newRemovedObjects;

    if (isCurrentlyClicked) {
      newRemovedLabels = removedLabels.filter(label => label !== clickedLabel);
      newRemovedObjects = removedObjects.filter(obj => obj.object_id !== targetBox.id);
    } else {
      newRemovedLabels = [...removedLabels, clickedLabel];
      newRemovedObjects = [...removedObjects, {
        object_id: targetBox.id,
        label: targetBox.label,
        bounding_box: { x: targetBox.x, y: targetBox.y, width: targetBox.width, height: targetBox.height },
        click_position: { x, y }
      }];
    }

    setRemovedLabels(newRemovedLabels);
    setRemovedObjects(newRemovedObjects);

    const sortedLabels = [...newRemovedLabels].sort();
    const filename = sortedLabels.length === 0 
      ? "base.jpg" 
      : `removed_${sortedLabels.join('_')}.jpg`;

    const newImageSrc = `/Prerendered_Scenes/${activeFolder}/${filename}`;
    setDisplayImage(newImageSrc);

    setBoundingBoxes(prev => prev.map((box, index) =>
      index === clickedBoxIndex ? { ...box, isClicked: !isCurrentlyClicked } : box
    ));
  };

  const handleReviewAndSave = async () => {
    setIsProcessing(true);
    try {
      const rawTelemetry = telemetryRef.current;
      
      const formattedTelemetry = {
        X: rawTelemetry.map(p => Number(p.x.toFixed(1))),
        Y: rawTelemetry.map(p => Number(p.y.toFixed(1))),
        T: rawTelemetry.map(p => Math.round(p.t - (rawTelemetry.length > 0 ? rawTelemetry[0].t : 0))),
        length: rawTelemetry.length
      };

      await axios.post(`${API_URL}/save_session`, {
        participant_id: participantId,
        target_object: activeTarget,
        removed_objects: removedObjects,
        removed_labels: removedLabels,
        base_scene_name: activeFolder,
        final_image_path: displayImage,
        mouse_telemetry: formattedTelemetry 
      }, {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });

      if (currentTrialIndex + 1 < TRIAL_SEQUENCE.length) {
        setCurrentTrialIndex(prev => prev + 1);
      } else {
        setPhase(PHASES.COMPLETED);
      }
    } catch (error) {
      console.error("Error saving session:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="app-container">
      {/* -4. ID Entry Screen (Only on first trial) */}
      {phase === PHASES.ID_ENTRY && (
        <div className="centered-view" style={{ textAlign: 'center', fontFamily: 'sans-serif', color: 'white' }}>
          <h2 style={{ fontSize: '36px', marginBottom: '40px' }}>Trial Setup</h2>
          <div style={{ marginBottom: '30px' }}>
            <label style={{ fontSize: '20px', fontWeight: 'bold', marginRight: '15px' }}>
              Participant ID:
            </label>
            <input 
              type="text" 
              value={participantId} 
              onChange={(e) => setParticipantId(e.target.value)} 
              placeholder="Enter ID..."
              style={{ 
                padding: '12px 18px', 
                fontSize: '20px', 
                borderRadius: '6px', 
                border: 'none',
                outline: 'none',
                color: 'black'
              }}
            />
          </div>
          <button 
            onClick={() => {
              if (!participantId.trim()) {
                alert("Please enter a Participant ID to continue.");
                return;
              }
              setPhase(PHASES.TARGET_PROMPT);
            }}
            style={{ 
              padding: '12px 30px', 
              fontSize: '20px', 
              backgroundColor: '#3b82f6', 
              color: 'white', 
              border: 'none', 
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              marginTop: '20px'
            }}
          >
            Next
          </button>
        </div>
      )}

      {/* -3. Target Prompt Screen */}
      {phase === PHASES.TARGET_PROMPT && (
        <div className="centered-view" style={{ textAlign: 'center', fontFamily: 'sans-serif' }}>
          <div style={{ 
            margin: '0 auto 40px auto', 
            fontSize: '28px', 
            backgroundColor: '#f3f4f6', 
            padding: '40px 60px', 
            borderRadius: '12px',
            color: '#374151',
            display: 'inline-block'
          }}>
            Your target to find is: <br />
            <strong style={{ fontSize: '64px', color: '#3b82f6', display: 'block', marginTop: '20px' }}>
              {activeTarget}
            </strong>
          </div>
          <br/>
          <button 
            onClick={() => setPhase(PHASES.BLANK_SCREEN)}
            style={{ 
              padding: '15px 40px', 
              fontSize: '22px', 
              backgroundColor: '#22c55e', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
          >
            Start Trial
          </button>
        </div>
      )}

      {/* -2. Blank Screen Phase */}
      {phase === PHASES.BLANK_SCREEN && (
        <div className="fixation-screen">
          {/* Renders a completely blank black screen */}
        </div>
      )}

      {/* -1. Fixation Screen Phase */}
      {phase === PHASES.FIXATION && (
        <div className="fixation-screen">
          <div className="fixation-cross" />
        </div>
      )}

      {/* 0. Observation Phase */}
      {phase === PHASES.OBSERVATION && (
        <div className="observable-screen">
          <canvas
            ref={canvasRef}
            className="observable-image"
            style={{ pointerEvents: 'auto', cursor: 'none' }}
          />
        </div>
      )}

      {/* 1. Transition Screen */}
      {phase === PHASES.TRANSITION && (
        <div className="centered-view">
          <h2>Transitioning to Interactive Mode...</h2>
        </div>
      )}

      {/* 2. Interactive Workspace */}
      {phase === PHASES.INTERACTIVE && (
        <div className="interactive-layout">
          <div className="interactive-toolbar">
            <h2>Target: {activeTarget}</h2>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleReviewAndSave}
                disabled={isProcessing}
                className="btn-primary"
              >
                {isProcessing ? 'Saving to Server...' : (currentTrialIndex + 1 < TRIAL_SEQUENCE.length ? 'Save & Next Trial' : 'Save & Finish')}
              </button>
            </div>
          </div>

          <div className="interactive-windows-grid">
            <div className="interactive-card">
              <div className="interactive-card-title">Interactive Image (Remove objects that were not in original image)</div>
              <div className="interactive-viewport-wrapper">
                <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0, maxHeight: '100%', maxWidth: '100%' }}>
                  <img
                    id="interactive-scene-img"
                    src={modifiedImage}
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
                          position: 'absolute',
                          left: `${leftPercent}%`,
                          top: `${topPercent}%`,
                          width: `${widthPercent}%`,
                          height: `${heightPercent}%`,
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
              <div className="interactive-card-title">Current Render</div>
              <div className="interactive-viewport-wrapper">
                <img
                  src={displayImage}
                  alt="Inpainted State"
                  className="interactive-viewport-img"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Completed Phase */}
      {phase === PHASES.COMPLETED && (
        <div className="centered-view">
          <h2>Experiment Complete</h2>
          <p style={{ marginTop: '12px', color: '#9ca3af' }}>
            All session data has been successfully saved to the server.
          </p>
        </div>
      )}
    </div>
  );
}

export default App;