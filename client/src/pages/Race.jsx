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
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeydown = (e) => {
      // Only apply shortcuts when not typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // TAB - Start new race with different excerpt (only in practice mode)
      if (e.key === 'Tab' && raceState.type === 'practice') {
        e.preventDefault();
        
        // Completely bypass normal flow to create a new practice mode session
        resetRace();
        
        // Join a new practice mode but don't rely on server countdown
        setTimeout(() => {
          // Emit practice join
          socket.emit('practice:join');
          
          // Listen for the race:joined event once
          const handlePracticeJoined = (data) => {
            console.log('Practice mode joined after Tab key:', data);
            
            // Immediately set up the race with the received data
            setRaceState({
              ...data,
              type: 'practice',
              inProgress: false,
              completed: false,
              startTime: null
            });
            
            // Remove the one-time listener
            socket.off('race:joined', handlePracticeJoined);
          };
          
          // Add the one-time listener for joining
          socket.once('race:joined', handlePracticeJoined);
        }, 100);
      }
      
      // ESC - Restart current race with same excerpt (only in practice mode)
      if (e.key === 'Escape' && raceState.type === 'practice') {
        e.preventDefault();
        // Reset typing state but keep the same snippet
        const currentSnippet = raceState.snippet;
        resetRace();
        setRaceState(prev => ({
          ...prev,
          type: 'practice',
          snippet: currentSnippet,
          inProgress: true,
          startTime: Date.now()
        }));
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [raceState.type, raceState.snippet, resetRace, joinPracticeMode, setRaceState]);
  
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