import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRace } from '../context/RaceContext';
import { useTutorial } from '../context/TutorialContext';
import { tutorialSteps } from '../tutorial/tutorialSteps';
import { useSocket } from '../context/SocketContext';
import Typing from '../components/Typing';
import Results from '../components/Results';
import PlayerStatusBar from '../components/PlayerStatusBar';
import Modal from '../components/Modal';
import TestConfigurator from '../components/TestConfigurator';
import Leaderboard from '../components/Leaderboard';
import TutorialAnchor from '../components/TutorialAnchor';
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
    loadNewSnippet,
    testMode,
    setTestMode,
    testDuration,
    setTestDuration,
    snippetDifficulty,
    setSnippetDifficulty,
    snippetCategory,
    setSnippetCategory,
    snippetSubject,
    setSnippetSubject,
    snippetError,
    refreshTrainingPlan
  } = useRace();
  const { isRunning, currentSection, currentStepIndex } = useTutorial();
  // index of the practice tutorial step when results screen should appear
  const practiceResultIndex = tutorialSteps.practice.findIndex(s => s.id === 'practice-results-screen');
  
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // If there is no active race context, redirect to home
  useEffect(() => {
    // raceState.code is set whenever a race or practice session exists
    if (!raceState.code) {
      navigate('/home', { replace: true });
    }
  }, [raceState.code, navigate]);
  
  // Handle back button
  const handleBack = () => {
    resetRace(true);
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
        isAlert={true}
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
          {/* Only show race title/back button before results */}
          {!raceState.completed && (
            <>
              <h1 className="race-title">{raceState.type === 'practice' ? 'Practice Mode' : 'Race'}</h1>
              <TutorialAnchor anchorId="back-button">
                <button className="back-button" onClick={handleBack}>
                  <span className="material-icons">arrow_back</span> Back
                </button>
              </TutorialAnchor>
            </>
          )}
          {/* Only show lobby code for private lobbies */}
          {raceState.type === 'private' && raceState.code && (
            <div className="lobby-code">Lobby Code: {raceState.code}</div>
          )}
        </div>
        
        {/* TestConfigurator - render only in practice mode */}
        {raceState.type === 'practice' && (
          <TutorialAnchor anchorId="configurator">
            {/* tiny wrapper ensures non-zero bounding box immediately */}
            <div style={{ minWidth: 1, minHeight: 1 }}>
              <TestConfigurator
                testMode={testMode}
                testDuration={testDuration}
                snippetDifficulty={snippetDifficulty}
                snippetCategory={snippetCategory}
                snippetSubject={snippetSubject}
                trainingState={raceState.training}
                setTestMode={setTestMode}
                setTestDuration={setTestDuration}
                setSnippetDifficulty={setSnippetDifficulty}
                setSnippetCategory={setSnippetCategory}
                setSnippetSubject={setSnippetSubject}
                setRaceState={setRaceState}
                loadNewSnippet={loadNewSnippet}
                snippetError={snippetError}
                onShowLeaderboard={toggleLeaderboard}
                refreshTrainingPlan={refreshTrainingPlan}
              />
            </div>
          </TutorialAnchor>
        )}
        
        <TutorialAnchor anchorId="race-content">
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
                  snippetCategory={raceState.type === 'practice' ? snippetCategory : null}
                  snippetSubject={raceState.type === 'practice' ? snippetSubject : null}
                />
              )}

              {/* Conditionally render Results */}
              {/* Show Results if race is completed */}
              {raceState.completed && (!isRunning || (currentSection === 'practice' && currentStepIndex >= practiceResultIndex)) && (
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
        </TutorialAnchor>
      </div>
    </div>
  );
}

export default Race;
