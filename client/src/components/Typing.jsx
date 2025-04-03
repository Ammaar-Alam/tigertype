import { useState, useEffect, useRef } from 'react';
import { useRace } from '../context/RaceContext';
import './Typing.css';

function Typing() {
  const { raceState, typingState, updateProgress, setRaceState } = useRace();
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const typingAreaRef = useRef(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Gets latest typingState.position
  const positionRef = useRef(typingState.position);
  useEffect(() => {
    positionRef.current = typingState.position;
  }, [typingState.position]);

  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Fira+Code&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }, []);

  // Focus the typing area container when race starts or in practice mode
  useEffect(() => {
    if ((raceState.inProgress || raceState.type === 'practice') && typingAreaRef.current) {
      // We focus the container now, which needs to be focusable (tabIndex="0")
      typingAreaRef.current.focus(); 
    }
    // Clear input when snippet changes (e.g., new race via TAB)
    setInput(''); 
  }, [raceState.inProgress, raceState.type, raceState.snippet]);

  const getElapsedTime = () =>
    raceState.startTime ? (Date.now() - raceState.startTime) / 1000 : 0;

  // Update elapsed time every ms
  useEffect(() => {
    let interval;
    if (raceState.inProgress && raceState.startTime) {
      interval = setInterval(() => {
        setElapsedTime(getElapsedTime());
      }, 1);
    } else {
      setElapsedTime(0);
    }
  
    return () => {
      clearInterval(interval);
    };
  }, [raceState.inProgress, raceState.startTime]);
  
  // Main input handler (now called manually from keydown listener)
  const processInput = (newInput) => {
    // If this is the first keystroke in practice mode and race hasn't started yet,
    // start the race immediately
    if (raceState.type === 'practice' && !raceState.inProgress && !raceState.completed && input === '' && newInput.length > 0) {
      setRaceState(prev => ({
        ...prev,
        inProgress: true,
        startTime: Date.now()
      }));
    }
    
    setInput(newInput);
    
    // Update progress only if the race has actually started
    // Need to check raceState.inProgress directly *after* potential update above
    // Use a temporary variable or check the potentially updated state
    const isCurrentlyInProgress = (raceState.type === 'practice' && input === '' && newInput.length > 0) || raceState.inProgress;
    if (isCurrentlyInProgress) {
      updateProgress(newInput);
    }
  };
  
  // Global keyboard listener on the typing area
  useEffect(() => {
    const handleContainerKeyDown = (e) => {
      // Prevent default browser actions for keys we handle
      e.preventDefault();

      let currentInput = input;
      if (e.key === 'Backspace') {
        currentInput = currentInput.slice(0, -1);
      } else if (e.key.length === 1) { // Handle printable characters
        // Simple check, might need refinement for special keys/modifiers
        currentInput += e.key;
      }
      
      // Process the potentially updated input
      processInput(currentInput);
    };

    const area = typingAreaRef.current;
    if (area) {
      // Use keydown for better handling of backspace etc.
      area.addEventListener('keydown', handleContainerKeyDown);
    }

    return () => {
      if (area) {
        area.removeEventListener('keydown', handleContainerKeyDown);
      }
    };
    // Rerun if the input state changes to correctly capture the current value
  }, [input, raceState.type, raceState.inProgress, raceState.completed, setRaceState, updateProgress]);
  
  // Prevent paste - might need to be on the container now?
  // Let's attach it to the container as well
  useEffect(() => {
    const handleContainerPaste = (e) => {
      e.preventDefault();
      return false;
    };
    const area = typingAreaRef.current;
    if (area) {
      area.addEventListener('paste', handleContainerPaste);
    }
    return () => {
      if (area) {
        area.removeEventListener('paste', handleContainerPaste);
      }
    };
  }, []);
  
  // Generate highlighted text
  const getHighlightedText = () => {
    if (!raceState.snippet) return null;
    
    const text = raceState.snippet.text;
    const components = [];
    
    for (let i = 0; i < text.length; i++) {
      if (i < input.length) {
        if (input[i] === text[i]) {
          components.push(<span key={i} className="correct">{text[i]}</span>);
        } else {
          components.push(<span key={i} className="incorrect">{text[i]}</span>);
        }
      } else if (i === input.length) {
        components.push(<span key={i} className="current">{text[i]}</span>);
      } else {
        components.push(<span key={i}>{text[i]}</span>);
      }
    }
    
    return components;
  };
  
  // Get progress bars
  const getProgressBars = () => {
    if (!raceState.players) return null;
    
    return raceState.players.map((player, index) => {
      const progress = player.progress || 0;
      
      return (
        <div key={index} className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          <div className="progress-label">
            {player.netid}: {progress}%
          </div>
        </div>
      );
    });
  };
  
  // Get real-time statistics
  const getStats = () => {
    if (!raceState.startTime) return null;
    
    return (
      <div className="stats">
        <div className="stat-item">
          <span className="stat-label">WPM:</span>
          <span className="stat-value">{Math.round(typingState.wpm)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Accuracy:</span>
          <span className="stat-value">{Math.round(typingState.accuracy)}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Time:</span>
          <span className="stat-value">{elapsedTime.toFixed(2)}s</span>
        </div>
      </div>
    );
  };
  
  return (
    <div 
      className="typing-area" 
      ref={typingAreaRef} 
      tabIndex="0" 
    >
      {raceState.inProgress && getStats()}
      
      <div className="snippet-display" >
        {getHighlightedText()}
      </div>
      
      <div className="typing-input-container hidden-input-container">
        <input
          ref={inputRef}
          type="text"
          value={input}
          readOnly
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          style={{ opacity: 0, position: 'absolute', top: '-9999px', left: '-9999px' }}
        />
      </div>
      
      <div className="progress-container">
        {getProgressBars()}
      </div>
    </div>
  );
}

export default Typing;