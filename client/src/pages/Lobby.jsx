import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRace } from '../context/RaceContext';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext'; // Import useSocket
import TestConfigurator from '../components/TestConfigurator';
import Typing from '../components/Typing';
import Results from '../components/Results';
import ProfileWidget from '../components/ProfileWidget';
import Modal from '../components/Modal';
import Loading from '../components/Loading';
import PlayerStatusBar from '../components/PlayerStatusBar'; // Import PlayerStatusBar
import './Lobby.css';
import './Race.css';

function Lobby() {
  const { lobbyCode } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket } = useSocket(); // Get socket instance
  const {
    raceState,
    // typingState, // Typing state not directly needed here
    inactivityState,
    setPlayerReady,
    resetRace,
    dismissInactivityKick,
    joinPrivateLobby,
    kickPlayer,
    updateLobbySettings,
    startPrivateRace,
    loadNewSnippet,
    setRaceState
  } = useRace();

  const [isLoading, setIsLoading] = useState(true);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  // Remove state for the simple stats modal
  // const [showStatsModal, setShowStatsModal] = useState(false);
  // const [selectedPlayerStats, setSelectedPlayerStats] = useState(null);

  // Check if the current user is the host
  const isHost = user?.netid === raceState.hostNetId;

  // Effect to handle joining the lobby via URL or if state is lost
  useEffect(() => {
    // Only attempt to join if lobbyCode is present and doesn't match current state
    if (lobbyCode && (!raceState.code || raceState.code !== lobbyCode)) {
      console.log(`Attempting to join lobby ${lobbyCode} from URL...`);
      setIsLoading(true); // Set loading while joining
      joinPrivateLobby({ code: lobbyCode });
    } else if (raceState.code === lobbyCode) {
      // If code matches, we are likely already joined or reconnected
      setIsLoading(false);
    } else if (!lobbyCode && raceState.code) {
       // If no lobby code in URL but we have one in state, likely navigated away improperly
       console.warn("In lobby page without code in URL, but have state. Resetting.");
       resetRace();
       navigate('/home');
    } else {
       // Default case, likely no lobby active
       setIsLoading(false);
    }
  }, [lobbyCode, raceState.code, joinPrivateLobby, navigate, resetRace]); // Added navigate/resetRace

  // Effect to handle navigation away if kicked or lobby terminated, or state mismatch
  useEffect(() => {
    if (inactivityState.kicked || inactivityState.redirectToHome) {
       console.log('Kicked or lobby terminated, context should handle redirect.');
       // Context's useEffect for redirectToHome handles the navigation
    }
    // If the raceState code becomes null OR doesn't match the URL code while on this page
    if (!isLoading && (!raceState.code || (lobbyCode && raceState.code !== lobbyCode))) {
        console.log('Lobby state lost or mismatched, redirecting home.');
        resetRace(); // Ensure state is cleared
        navigate('/home');
    }
  }, [inactivityState.kicked, inactivityState.redirectToHome, raceState.code, isLoading, navigate, lobbyCode, resetRace]); // Added lobbyCode/resetRace

  // Countdown display handled by Typing component – no local countdown logic needed now


  // --- TestConfigurator State ---
  // Use settings directly from raceState now that context handles it
  const currentSettings = raceState.settings || { testMode: 'snippet', testDuration: 15 };
  // Local state for filters not yet in raceState.settings
  const [snippetDifficulty, setSnippetDifficulty] = useState('');
  const [snippetType, setSnippetType] = useState('');
  const [snippetDepartment, setSnippetDepartment] = useState('');
  // --- ---

  // Handler for settings changes (only host can trigger)
  const handleSettingChange = (setter) => (value) => {
    if (!isHost) return;

    let newSettings = {};
    // Map local state setters to keys in raceState.settings
    if (setter === 'setTestMode') {
      newSettings = { testMode: value };
    } else if (setter === 'setTestDuration') {
      newSettings = { testDuration: parseInt(value, 10) || 15 }; // Ensure it's a number
    } else if (setter === 'setSnippetDifficulty') {
       setSnippetDifficulty(value); // Update local filter state
       // TODO: Add snippetDifficulty to settings if needed on backend
       // newSettings = { snippetDifficulty: value };
       return; // Don't emit for filters yet
    } else if (setter === 'setSnippetType') {
       setSnippetType(value); // Update local filter state
       // TODO: Add snippetType to settings if needed on backend
       // newSettings = { snippetType: value };
       return; // Don't emit for filters yet
    } else if (setter === 'setSnippetDepartment') {
       setSnippetDepartment(value); // Update local filter state
       // TODO: Add snippetDepartment to settings if needed on backend
       // newSettings = { snippetDepartment: value };
       return; // Don't emit for filters yet
    } else {
       return; // Unknown setter
    }

    // Emit update to server if settings changed
    if (Object.keys(newSettings).length > 0) {
       updateLobbySettings(newSettings);
    }
  };

  // --- Profile Modal Trigger ---
  const handlePlayerClick = (playerNetId) => {
    if (playerNetId === user?.netid) {
      // Navigate to own profile page if clicking self
      navigate('/profile');
    } else {
      // TODO: Implement opening the detailed profile modal here
      // This will likely involve setting state to show the modal
      // and potentially fetching more detailed profile data for playerNetId
      console.log(`Trigger profile modal for ${playerNetId} (Not Implemented)`);
      // Example (if using state for modal visibility):
      // setSelectedProfileNetId(playerNetId);
      // setShowProfileModal(true);
    }
  };
  // --- End Profile Modal Trigger ---


  const handleCopyInviteLink = () => {
    const inviteLink = `${window.location.origin}/lobby/${raceState.code}`;
    navigator.clipboard.writeText(inviteLink)
      .then(() => {
        setShowCopiedMessage(true);
        setTimeout(() => setShowCopiedMessage(false), 2000);
      })
      .catch(err => console.error('Failed to copy invite link:', err));
  };

  const handleLeaveLobby = () => {
    resetRace(true);
    navigate('/home');
  };

  // Render loading state
  if (isLoading) {
    return <Loading message={`Joining lobby ${lobbyCode}...`} />;
  }

  // Render if lobby code doesn't match URL (error state after loading)
  if (!raceState.code || raceState.code !== lobbyCode) {
     return (
        <div className="lobby-page error-page">
            <h2>Error</h2>
            <p>Could not join or find lobby "{lobbyCode}". It might be invalid, closed, or you might have been removed.</p>
            <button onClick={() => navigate('/home')}>Go Home</button>
        </div>
     );
  }

  // --- Main Lobby Render ---
  return (
    <div className="lobby-page">
      {/* Kicked Modal (reuse from context) */}
      <Modal
        isOpen={inactivityState.kicked}
        title="Removed from Lobby"
        message={inactivityState.kickMessage || "You have been removed from the lobby."}
        buttonText="I Understand"
        onClose={dismissInactivityKick} // Context handles redirect
      />

      {/* Placeholder for the future Profile Modal */}
      {/* <Modal isOpen={showProfileModal} onClose={handleCloseProfileModal} ... > ... </Modal> */}


      <div className="lobby-container">
        {/* Header - Always visible */}
        <div className="lobby-header">
          <h1>Private Lobby</h1>
          <div className="lobby-code-display">
            <span>Code:</span>
            <strong>{raceState.code}</strong>
            <button onClick={handleCopyInviteLink} title="Copy Invite Link">
              <i className="bi bi-clipboard"></i>
            </button>
            {showCopiedMessage && <span className="copied-message">Copied!</span>}
          </div>
          <button className="leave-lobby-button" onClick={handleLeaveLobby}>Leave Lobby</button>
        </div>

        {/* Countdown handled by Typing component (overlay) */}

        {/* Conditional Content: Lobby UI OR Race UI OR Results */}
        {!raceState.inProgress && !raceState.completed && (
          /* --- Lobby Waiting UI --- */
          <div className="lobby-main-content">
            {/* Left Column: Settings */}
            <div className="lobby-left-column">
              <div className="lobby-settings">
                <h2>Settings</h2>
                {isHost ? (
                  <TestConfigurator
                    testMode={currentSettings.testMode}
                    testDuration={currentSettings.testDuration}
                    snippetDifficulty={snippetDifficulty} // Still local state
                    snippetType={snippetType}           // Still local state
                    snippetDepartment={snippetDepartment} // Still local state
                    setTestMode={handleSettingChange('setTestMode')}
                    setTestDuration={handleSettingChange('setTestDuration')}
                    setSnippetDifficulty={handleSettingChange('setSnippetDifficulty')}
                    setSnippetType={handleSettingChange('setSnippetType')}
                    setSnippetDepartment={handleSettingChange('setSnippetDepartment')}
                    setRaceState={setRaceState} // Pass down if needed by TestConfigurator internals
                    loadNewSnippet={loadNewSnippet} // Pass down if needed
                    onShowLeaderboard={() => {}} // Disable leaderboard button in lobby
                  />
                ) : (
                  <div className="read-only-settings">
                    <p>Mode: {currentSettings.testMode}</p>
                    {currentSettings.testMode === 'timed' && (
                      <p>Duration: {currentSettings.testDuration}s</p>
                    )}
                    <p>Snippet: {raceState.snippet?.id ? `ID ${raceState.snippet.id}` : 'Default/Random'}</p>
                    <p><i>Only the host ({raceState.hostNetId}) can change settings.</i></p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Players & Controls */}
            <div className="lobby-right-column">
              <div className="lobby-players">
                <h2>Players ({raceState.players?.length || 0}/10)</h2>
                <div className="player-grid">
                  {raceState.players?.map(player => (
                    <div key={player.netid} className="player-card">
                      <ProfileWidget
                        // Pass user object including avg_wpm fetched from server
                        user={{ netid: player.netid, avatar_url: player.avatar_url, avg_wpm: player.avg_wpm }}
                        onClick={() => handlePlayerClick(player.netid)}
                      />
                      <div className="player-status">
                        {player.netid === raceState.hostNetId && <span className="host-tag">Host</span>}
                        {player.ready ? <span className="ready-tag">Ready</span> : <span className="not-ready-tag">Not Ready</span>}
                      </div>
                      {isHost && player.netid !== user?.netid && (
                        <button
                          className="kick-button"
                          onClick={() => kickPlayer(player.netid)}
                          title={`Kick ${player.netid}`}
                        >
                          Kick
                        </button>
                      )}
                    </div>
                  ))}
                  {[...Array(Math.max(0, 10 - (raceState.players?.length || 0)))].map((_, i) => (
                     <div key={`empty-${i}`} className="player-card empty-slot">Waiting...</div>
                  ))}
                </div>
              </div>
              <div className="lobby-controls">
                {isHost ? (
                  <button
                    className="start-race-button"
                    onClick={startPrivateRace}
                    disabled={raceState.players?.length < 2} // Require 2 players
                    title={raceState.players?.length < 2 ? "Need at least 2 players to start" : "Start the race!"}
                  >
                    Start Race
                  </button>
                ) : (
                  <button
                    className={`ready-button ${raceState.players?.find(p => p.netid === user?.netid)?.ready ? 'is-ready' : ''}`}
                    onClick={setPlayerReady}
                  >
                    {raceState.players?.find(p => p.netid === user?.netid)?.ready ? 'Ready ✓' : 'Ready Up'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- Race Active UI --- */}
        {raceState.inProgress && !raceState.completed && (
          <div className="lobby-race-active race-content">
            <div className="race-info">
              <div className="race-content-container">
                <Typing
                  testMode={currentSettings.testMode}
                  testDuration={currentSettings.testDuration}
                />
              </div>

              {raceState.players && raceState.players.length > 0 && (
                <div className="player-status-container">
                  <PlayerStatusBar
                    players={raceState.players}
                    isRaceInProgress={raceState.inProgress}
                    currentUser={user}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- Results UI --- */}
        {raceState.completed && (
           <div className="lobby-results">
             <h2>Race Finished!</h2>
             <Results />
             <button onClick={() => resetRace()}>Return to Home</button>
             {/* TODO: Add a "Play Again" button that maybe resets state but keeps players/settings? */}
           </div>
        )}
      </div>
    </div>
  );
}

export default Lobby;
