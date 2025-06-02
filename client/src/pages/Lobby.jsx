import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useRace } from '../context/RaceContext';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext'; // Import useSocket
import TestConfigurator from '../components/TestConfigurator';
import ProfileWidget from '../components/ProfileWidget';
import Modal from '../components/Modal';
import Loading from '../components/Loading';
import './Lobby.css';
import './Race.css';

function Lobby() {
  const { lobbyCode: rawLobbyCode } = useParams();
  const sanitizedLobbyCode = (rawLobbyCode || '').replace(/[^a-zA-Z0-9]/g, '');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket } = useSocket();
  const {
    raceState,
    inactivityState,
    setPlayerReady,
    resetRace,
    dismissInactivityKick,
    joinPrivateLobby,
    kickPlayer,
    updateLobbySettings,
    startPrivateRace,
    loadNewSnippet,
    setRaceState,
    snippetError
  } = useRace();

  const [isLoading, setIsLoading] = useState(true);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  const location = useLocation();

  // Check if the current user is the host
  const isHost = user?.netid === raceState.hostNetId;

  // Effect to handle joining the lobby via URL or if state is lost
  useEffect(() => {
    // Only attempt to join if sanitizedLobbyCode is present and doesn't match current state
    if (sanitizedLobbyCode && (!raceState.code || raceState.code !== sanitizedLobbyCode)) {
      console.log(`Attempting to join lobby ${sanitizedLobbyCode} from URL...`);
      setIsLoading(true); // Set loading while joining
      joinPrivateLobby({ code: sanitizedLobbyCode });
    } else if (raceState.code === sanitizedLobbyCode) {
      // If code matches, we are likely already joined or reconnected
      setIsLoading(false);
    } else if (!sanitizedLobbyCode && raceState.code) {
       // If no lobby code in URL but we have one in state, likely navigated away improperly
       console.warn("In lobby page without code in URL, but have state. Resetting.");
       resetRace();
       navigate('/home');
    } else {
       // Default case, likely no lobby active
       setIsLoading(false);
    }
  }, [sanitizedLobbyCode, raceState.code, joinPrivateLobby, navigate, resetRace]); // Added navigate/resetRace

  // Effect to handle navigation away if kicked or lobby terminated, or state mismatch
  useEffect(() => {
    if (inactivityState.kicked || inactivityState.redirectToHome) {
       console.log('Kicked or lobby terminated, context should handle redirect.');
       // Context's useEffect for redirectToHome handles the navigation
    }
    // If the raceState code becomes null OR doesn't match the URL code while on this page
    if (!isLoading && (!raceState.code || (sanitizedLobbyCode && raceState.code !== sanitizedLobbyCode))) {
        console.log('Lobby state lost or mismatched, redirecting home.');
        resetRace(); // Ensure state is cleared
        navigate('/home');
    }
  }, [inactivityState.kicked, inactivityState.redirectToHome, raceState.code, isLoading, navigate, sanitizedLobbyCode, resetRace]); // Added sanitizedLobbyCode/resetRace

  useEffect(() => {
    // Only trigger navigation if we have successfully joined this lobby
    if (raceState.code !== sanitizedLobbyCode) return;

    // When countdown begins (raceState.countdown becomes a number) or
    // the race is already marked as in progress / completed, navigate.
    if (raceState.countdown !== null || raceState.inProgress || raceState.completed) {
      navigate('/race', { replace: true });
    }
  }, [raceState.countdown, raceState.inProgress, raceState.completed, raceState.code, sanitizedLobbyCode, navigate]);


  // --- TestConfigurator State ---
  // Use settings directly from raceState now that context handles it
  const currentSettings = raceState.settings || { testMode: 'snippet', testDuration: 15 };
  // Local state for filters not yet in raceState.settings
  const [snippetDifficulty, setSnippetDifficulty] = useState('');
  const [snippetCategory, setSnippetCategory] = useState('');
  const [snippetSubject, setSnippetSubject] = useState('');
  // --- ---

  // Handler for settings changes (only host can trigger)
  // Generic handler factory that maps a particular setter (identified by a string
  // rather than the actual function reference) to a callback that
  //  1. Updates any local UI state (for filters that are still local‑only)
  //  2. Builds a full settings object (mode + duration) so that the server
  //     always receives a complete picture of the desired configuration.
  //     This avoids edge‑cases where only one of the two values is sent which
  //     previously prevented the backend from regenerating a new timed‑test
  //     snippet when the duration alone was changed
  const handleSettingChange = (setter) => (value) => {
    if (!isHost) return; // Only the host may change settings

    // Ensure snippetFilters exist in settings. Key should be 'department' for backend.
    const defaultFilters = { difficulty: 'all', type: 'all', department: 'all' }; 
    const current = {
      ...(raceState.settings || { testMode: 'snippet', testDuration: 15 }),
      snippetFilters: raceState.settings?.snippetFilters || defaultFilters
    };

    let updatedSettings = { ...current };

    switch (setter) {
      case 'setTestMode':
        updatedSettings.testMode = value;
        break;
      case 'setTestDuration':
        updatedSettings.testDuration = parseInt(value, 10) || 15;
        break;
      case 'setSnippetDifficulty':
        setSnippetDifficulty(value);
        updatedSettings.snippetFilters = { ...current.snippetFilters, difficulty: value };
        break;
      case 'setSnippetCategory':
        setSnippetCategory(value);
        // API expects 'type'. If snippetCategory is 'all', pass 'all', else pass the value.
        updatedSettings.snippetFilters = { ...current.snippetFilters, type: value }; 
        break;
      case 'setSnippetSubject': 
        setSnippetSubject(value); 
        // UI uses 'snippetSubject', but pass as 'department' to backend/RaceContext
        updatedSettings.snippetFilters = { ...current.snippetFilters, department: value }; 
        break;
      default:
        return;
    }
    updateLobbySettings(updatedSettings);
  };

  // Handles clicks on player widgets
  const handlePlayerClick = (playerNetId) => {
    navigate(`/profile/${playerNetId}`, { state: { backgroundLocation: location } });
  };

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
    // Notify the server of manual lobby leave so other players are updated
    if (socket && socket.connected) {
      // console.log(`Emitting manual leave for lobby ${raceState.code}`);
      socket.emit('lobby:leave');
    }
    // Reset local race state and navigate home
    resetRace(false);
    navigate('/home');
  };

  // Render loading state
  if (isLoading) {
    return <Loading message={`Joining lobby ${sanitizedLobbyCode}...`} />;
  }

  // Render if lobby code doesn't match URL (error state after loading)
  if (!raceState.code || raceState.code !== sanitizedLobbyCode) {
     return (
        <div className="lobby-page error-page">
            <h2>Error</h2>
            <p>Could not join or find lobby "{sanitizedLobbyCode}". It might be invalid or closed.</p>
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
                    testMode={currentSettings.testMode ?? 'snippet'}
                    testDuration={currentSettings.testDuration ?? 15}
                    snippetDifficulty={snippetDifficulty}
                    snippetCategory={snippetCategory}
                    snippetSubject={snippetSubject}
                    setTestMode={handleSettingChange('setTestMode')}
                    setTestDuration={handleSettingChange('setTestDuration')}
                    setSnippetDifficulty={handleSettingChange('setSnippetDifficulty')}
                    setSnippetCategory={handleSettingChange('setSnippetCategory')}
                    setSnippetSubject={handleSettingChange('setSnippetSubject')}
                    setRaceState={setRaceState}
                    loadNewSnippet={loadNewSnippet}
                    snippetError={snippetError}
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
                    disabled={raceState.players?.length < 2 && !raceState.players?.every(p => p.ready === true)} // Require 2 players
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
        {false && (
          <div></div>
        )}
      </div>

    </div>
  );
}

export default Lobby;
