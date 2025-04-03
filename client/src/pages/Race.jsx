import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRace } from '../context/RaceContext';
import { useSocket } from '../context/SocketContext';
import Typing from '../components/Typing';
import Results from '../components/Results';
import './Race.css';

function Race() {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { 
    raceState, 
    typingState,
    setPlayerReady, 
    resetRace,
    setRaceState,
    joinPracticeMode
  } = useRace();
  
  const [countdown, setCountdown] = useState(null);
  const countdownRef = useRef(null);
  
  // Handle race countdown
  useEffect(() => {
    if (!socket) return;
    
    const handleCountdown = (data) => {
      console.log('Countdown received:', data);
      if (raceState.type === 'practice') {
        console.log('Ignoring countdown because current type is practice.');
        setCountdown(null);
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
        return;
      }
      
      setCountdown(data.seconds);
      
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
      
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    };
    
    socket.on('race:countdown', handleCountdown);
    
    // For practice mode, skip countdown and set it directly to null
    // This will allow typing to begin immediately
    if (raceState.type === 'practice' && !raceState.inProgress && !raceState.completed) {
      console.log('Practice mode - skipping countdown');
      setCountdown(null);
      
      // If there was a countdown in progress, clear it
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
    
    return () => {
      socket.off('race:countdown', handleCountdown);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [socket, raceState.type, raceState.inProgress, raceState.completed]);
  
  // Handle keyboard shortcuts more reliably
  useEffect(() => {
    const handleKeydownCapture = (e) => {
      // Check if the race page is active and it's practice mode
      if (raceState.type !== 'practice') return;

      // TAB - Always intercept for practice mode
      if (e.key === 'Tab') {
        e.preventDefault(); // Prevent default focus change
        console.log('TAB pressed (Capture): Resetting and joining new practice mode');
        // Ensure socket exists before calling context functions
        if (socket && joinPracticeMode) {
          resetRace();
          joinPracticeMode();
        } else {
          console.warn('Socket or joinPracticeMode not ready for TAB action');
        }
      }
      // ESC - Intercept only if input is not focused, or handle globally?
      // Let's handle ESC globally in practice mode for simplicity
      else if (e.key === 'Escape') {
        e.preventDefault(); // Prevent potential browser default actions
        console.log('ESC pressed (Capture): Resetting for current snippet restart');
        
        // Ensure socket exists before calling context functions
        if (socket && resetRace && setRaceState && raceState.snippet) {
          const currentSnippet = raceState.snippet;
          resetRace(); 
          setRaceState(prev => ({
            ...prev, 
            type: 'practice',
            snippet: currentSnippet,
          }));
  
          setCountdown(null);
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          
          const inputElement = document.querySelector('.typing-area input');
          if (inputElement) {
            inputElement.value = ''; 
            inputElement.focus();
          }
        } else {
           console.warn('Socket or context functions not ready for ESC action');
        }
      }
    };

    // Add listener in capture phase to intercept TAB/ESC early
    window.addEventListener('keydown', handleKeydownCapture, true); 

    return () => {
      // Remove the capture phase listener
      window.removeEventListener('keydown', handleKeydownCapture, true);
    };
    // Add socket and necessary functions to dependency array
  }, [raceState.type, raceState.snippet, resetRace, joinPracticeMode, setRaceState, socket, setCountdown]);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, []);
  
  // Handle back button
  const handleBack = () => {
    resetRace();
    navigate('/home');
  };
  
  return (
    <div className="race-page">
      <div className="race-container">
        <div className="back-button-container">
          <button className="back-button" onClick={handleBack}>
            <span>⟵</span> Back
          </button>
        </div>
        
        <div className="race-content">
          <div className="race-info">
            <h2>{raceState.type === 'practice' ? 'Practice Mode' : 'Race'}</h2>
            
            {raceState.type !== 'practice' && raceState.code && (
              <div className="lobby-code">Lobby Code: {raceState.code}</div>
            )}
            
            {raceState.players && raceState.players.length > 0 && (
              <div className="players-list">
                <h3>Players:</h3>
                <div className="players-grid">
                  {raceState.players.map((player, index) => (
                    <div 
                      key={index} 
                      className={`player-item ${player.ready ? 'player-ready' : ''}`}
                    >
                      {player.netid} {player.ready ? '(Ready)' : ''}
                    </div>
                  ))}
                </div>
                
                {!raceState.inProgress && !raceState.completed && raceState.type !== 'practice' && (
                  <button 
                    className="ready-button" 
                    onClick={setPlayerReady}
                    disabled={raceState.players.some(p => p.netid === (window.user?.netid) && p.ready)}
                  >
                    Ready
                  </button>
                )}
              </div>
            )}
            
            {countdown !== null && !raceState.completed && !raceState.inProgress && (
              <div className="countdown">{countdown}</div>
            )}
          </div>
          
          {!raceState.completed ? (
            <Typing />
          ) : (
            <Results />
          )}
          
          {/* Keybinds display for practice mode */}
          {raceState.type === 'practice' && (
            <div className="keybinds-container">
              <div className="keybind">
                <span className="keybind-key">Tab</span>
                <span className="keybind-desc">New excerpt</span>
              </div>
              <div className="keybind">
                <span className="keybind-key">Esc</span>
                <span className="keybind-desc">Restart current excerpt</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Race;