import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRace } from '../context/RaceContext';
import { useSocket } from '../context/SocketContext';
import Typing from '../components/Typing';
import Results from '../components/Results';
import PlayerStatusBar from '../components/PlayerStatusBar';
import Modal from '../components/Modal';
import TestConfigurator from '../components/TestConfigurator';
import Leaderboard from '../components/Leaderboard';
import './Race.css';

function Race() {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { 
    raceState, 
    typingState,
    inactivityState,
    setPlayerReady,
    resetRace,
    dismissInactivityWarning,
    dismissInactivityKick,
    setRaceState,
    loadNewSnippet
  } = useRace();
  
  // Test configuration states
  const [testMode, setTestMode] = useState('snippet');
  const [testDuration, setTestDuration] = useState(15);
  const [snippetDifficulty, setSnippetDifficulty] = useState('');
  const [snippetType, setSnippetType] = useState('');
  const [snippetDepartment, setSnippetDepartment] = useState('all');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  
  // Handle back button
  const handleBack = () => {
    resetRace();
    navigate('/home');
  };
  
  // Handle ready button when there's an inactivity warning
  const handleReadyFromWarning = () => {
    dismissInactivityWarning();
    setPlayerReady();
  };

  // Toggle leaderboard modal
  const toggleLeaderboard = () => {
    setShowLeaderboard(prev => !prev);
  };

  return (
    <div className="race-page">
      {/* Inactivity Warning Modal */}
      <Modal
        isOpen={inactivityState.warning}
        title="Ready Up Required"
        message={inactivityState.warningMessage || "Please ready up to continue in this lobby."}
        buttonText="Ready Up Now"
        onClose={handleReadyFromWarning}
      />
      
      {/* Kicked for Inactivity Modal */}
      <Modal
        isOpen={inactivityState.kicked}
        title="Removed for Inactivity"
        message={inactivityState.kickMessage || "You have been removed from the lobby due to inactivity."}
        buttonText="I Understand"
        onClose={dismissInactivityKick}
      />
      
      {/* Leaderboard Modal */}
      <Modal
        isOpen={showLeaderboard}
        onClose={toggleLeaderboard}
        showCloseButton={true}
        isLarge={true}
      >
        <Leaderboard 
           defaultDuration={testDuration}
        />
      </Modal>
      
      <div className="race-container">
        <div className="race-header-wrapper">
          <h1 className="race-title">{raceState.type === 'practice' ? 'Practice Mode' : 'Race'}</h1>
          <button className="back-button" onClick={handleBack}>
            <span>⟵</span> Back
          </button>
          {raceState.type !== 'practice' && raceState.code && (
            <div className="lobby-code">Lobby Code: {raceState.code}</div>
          )}
        </div>
        
        {/* TestConfigurator - render only in practice mode */}
        {raceState.type === 'practice' && (
          <TestConfigurator 
            testMode={testMode}
            testDuration={testDuration}
            snippetDifficulty={snippetDifficulty}
            snippetType={snippetType}
            snippetDepartment={snippetDepartment}
            setTestMode={setTestMode}
            setTestDuration={setTestDuration}
            setSnippetDifficulty={setSnippetDifficulty}
            setSnippetType={setSnippetType}
            setSnippetDepartment={setSnippetDepartment}
            setRaceState={setRaceState}
            loadNewSnippet={loadNewSnippet}
            onShowLeaderboard={toggleLeaderboard}
          />
        )}
        
        <div className="race-content">
          <div className="race-info">
            <div className="race-content-container">
              {/* Conditionally render Typing */}
              {/* Show Typing if:
                  - It's practice mode OR
                  - It's multiplayer AND not completed */}
              {(raceState.type === 'practice' || !raceState.completed) && (
                <Typing 
                  testMode={raceState.type === 'practice' ? testMode : null}
                  testDuration={raceState.type === 'practice' ? testDuration : null}
                  snippetDifficulty={raceState.type === 'practice' ? snippetDifficulty : null}
                  snippetType={raceState.type === 'practice' ? snippetType : null}
                  snippetDepartment={raceState.type === 'practice' ? snippetDepartment : null}
                />
              )}

              {/* Conditionally render Results */}
              {/* Show Results if race is completed */}
              {raceState.completed && (
                <Results 
                  onShowLeaderboard={raceState.type === 'practice' ? toggleLeaderboard : null}
                />
              )}
            </div>
            
            <div className="player-status-container">
              {/* Player Status Bar (Only relevant for multiplayer and when race is not completed) */}
              {raceState.players && raceState.players.length > 0 && raceState.type !== 'practice' && !raceState.completed && (
                <PlayerStatusBar
                  players={raceState.players}
                  isRaceInProgress={raceState.inProgress}
                  currentUser={window.user}
                  onReadyClick={setPlayerReady} 
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Race;