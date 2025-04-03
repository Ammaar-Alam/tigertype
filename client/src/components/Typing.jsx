import { useState, useEffect, useRef } from 'react';
import { useRace } from '../context/RaceContext';
import './Typing.css';

function Typing() {
  const { raceState, typingState, updateProgress, setRaceState } = useRace();
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
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

  // Focus input when race starts or in practice mode
  useEffect(() => {
    if ((raceState.inProgress || raceState.type === 'practice') && inputRef.current) {
      inputRef.current.focus();
    }
  }, [raceState.inProgress, raceState.type]);

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
  
  // Handle typing input
  const handleInput = (e) => {
    const newInput = e.target.value;
    
    // For multiplayer races, require 100% accuracy
    if (raceState.type !== 'practice' && raceState.inProgress) {
      const text = raceState.snippet.text;
      // Only allow input if it matches the text exactly up to the current position
      if (newInput.length > input.length) {
        // Check if the new character matches
        const newChar = newInput[newInput.length - 1];
        const expectedChar = text[newInput.length - 1];
        if (newChar !== expectedChar) {
          // If it doesn't match, don't update the input
          return;
        }
      }
    }
    
    // If this is the first keystroke in practice mode and race hasn't started yet,
    // start the race immediately
    if (raceState.type === 'practice' && !raceState.inProgress && !raceState.completed && input === '') {
      setRaceState(prev => ({
        ...prev,
        inProgress: true,
        startTime: Date.now()
      }));
    }
    
    setInput(newInput);
    
    if (raceState.inProgress) {
      updateProgress(newInput);
    }
  };
  
  // Prevent paste
  const handlePaste = (e) => {
    e.preventDefault();
    return false;
  };
  
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
    <div className="typing-area">
      {raceState.inProgress && getStats()}
      
      <div className="snippet-display" >
        {getHighlightedText()}
      </div>
      
      <div className="typing-input-container">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleInput}
          onPaste={handlePaste}
          disabled={!raceState.inProgress || typingState.completed}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
      </div>
      
      <div className="progress-container">
        {getProgressBars()}
      </div>
    </div>
  );
}

export default Typing;