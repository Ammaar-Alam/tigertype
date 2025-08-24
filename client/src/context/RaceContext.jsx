import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';

// Create context
export const RaceContext = createContext(null);

// Helper functions for session storage
const saveInactivityState = (state) => {
  try {
    sessionStorage.setItem('inactivityState', JSON.stringify(state));
  } catch (error) {
    console.error('Error saving inactivity state to session storage:', error);
  }
};

const loadInactivityState = () => {
  try {
    const savedState = sessionStorage.getItem('inactivityState');
    return savedState ? JSON.parse(savedState) : null;
  } catch (error) {
    console.error('Error loading inactivity state from session storage:', error);
    return null;
  }
};

// Helper functions for race state persistence
const saveRaceState = (state) => {
  try {
    // Only save essential info needed to rejoin a race
    const minimalState = {
      code: state.code,
      type: state.type,
      lobbyId: state.lobbyId
    };
    if (state.code) {
      sessionStorage.setItem('raceState', JSON.stringify(minimalState));
    } else {
      // If no active race, remove from storage
      sessionStorage.removeItem('raceState');
    }
  } catch (error) {
    console.error('Error saving race state to session storage:', error);
  }
};

const loadRaceState = () => {
  try {
    const savedState = sessionStorage.getItem('raceState');
    return savedState ? JSON.parse(savedState) : null;
  } catch (error) {
    console.error('Error loading race state from session storage:', error);
    return null;
  }
};

export const RaceProvider = ({ children }) => {
  const { socket, connected } = useSocket();
  const { user } = useAuth();
  
  // Load saved race state from session storage
  const savedRaceState = loadRaceState();
  
  // Race state
  const [raceState, setRaceState] = useState({
    code: savedRaceState?.code || null,     // Code of the race/lobby
    type: savedRaceState?.type || null,     // Type of race (practice, public, private)
    lobbyId: savedRaceState?.lobbyId || null, // ID of the lobby
    hostNetId: null,        // NetID of the host (for private lobbies)
    snippet: null,          // Snippet of the race
    players: [],            // Array of objects { netid, ready, avatar_url }
    startTime: null,        // Timestamp when the race started/is starting
    inProgress: false,      // Whether the race is currently in progress
    completed: false,       // Whether the race has been completed
    results: [],            // Array of objects with netid, wpm, accuracy, completion_time
    manuallyStarted: false, // Flag to track if practice mode was manually started
    timedTest: {            // Configuration for timed tests
      enabled: false,
      duration: 15          // Default duration in seconds
    },
    snippetFilters: {       // Filters for snippets
      difficulty: 'all',
      type: 'all',
      department: 'all'
    },
    settings: {             // Settings for the current lobby/race
      testMode: 'snippet',
      testDuration: 15,
      // Add other potential settings here
    },
    countdown: null // Track countdown seconds
  });

  // Explicit state for TestConfigurator to avoid passing setRaceState
  const [testMode, setTestMode] = useState('snippet');
  const [testDuration, setTestDuration] = useState(15);
  const [snippetDifficulty, setSnippetDifficulty] = useState('');
  const [snippetCategory, setSnippetCategory] = useState('');
  const [snippetSubject, setSnippetSubject] = useState('');
  const [snippetError, setSnippetError] = useState(null);

  // Add state for word pool size, loaded from localStorage
  const [wordDifficulty, setWordDifficulty] = useState(() => {
    return localStorage.getItem('wordDifficulty') || 'easy'; // 'easy' (200) or 'hard' (1000)
  });

  // Persist wordDifficulty to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('wordDifficulty', wordDifficulty);
    } catch (err) {
      console.error('Error saving wordDifficulty to localStorage:', err);
    }
  }, [wordDifficulty]);

  // Clear snippetError when filters change
  useEffect(() => {
    setSnippetError(null);
  }, [snippetDifficulty, snippetCategory, snippetSubject]);

  // Local typing state
  const [typingState, setTypingState] = useState({
    input: '',
    position: 0,
    correctChars: 0,
    errors: 0,
    completed: false,
    wpm: 0,
    accuracy: 0,
    lockedPosition: 0 // Pos up to which text is locked
  });

  // Initialize inactivity state from session storage or default values
  const savedInactivityState = loadInactivityState();
  
  // Inactivity state
  const [inactivityState, setInactivityState] = useState(savedInactivityState || {
    warning: false,
    warningMessage: '',
    kicked: false,
    kickMessage: '',
    redirectToHome: false
  });

  // Update session storage when inactivity state changes
  useEffect(() => {
    saveInactivityState(inactivityState);
  }, [inactivityState]);

  // Save race state to session storage when it changes
  useEffect(() => {
    saveRaceState(raceState);
  }, [raceState.code, raceState.type, raceState.lobbyId]);

  /* ------------------------------------------------------------------ *
   *  joinPrivateLobby – moved above first usage to avoid TDZ error
   *    joinData can be { code } or { hostNetId }
   * ------------------------------------------------------------------ */

  // Attempt to join a private lobby. Accepts optional callback to receive
  // the raw server response so that calling components (e.g. JoinLobbyPanel)
  // can surface errors directly in the UI.
  const joinPrivateLobby = useCallback((joinData, cb) => {
    if (!socket || !connected) {
      cb?.({ success: false, error: 'Not connected.' });
      return;
    }
    console.log('Joining private lobby with data:', joinData);
    socket.emit('private:join', joinData, (response) => {
      if (!response.success) {
        console.error('Failed to join private lobby:', response.error);
      }
      cb?.(response);
      // Successful join will be handled by race:joined listener
    });
  }, [socket, connected]);
  
  // Handle reconnection to races when socket connects
  useEffect(() => {
    // Only run if socket connection and saved race code
    if (!socket || !connected || !raceState.code) return;
    
    // Check if we don't have snippet data (which means we need to rejoin)
      if (raceState.code && !raceState.snippet) {
        console.log('Reconnecting to race after page refresh/connection loss:', raceState.code);

        // Rejoin the same race based on type
        if (raceState.type === 'practice') {
          socket.emit('practice:join');
        } else if (raceState.type === 'public') {
          // Rejoin existing public lobby after reconnect
          socket.emit('public:join', { code: raceState.code });
        } else if (raceState.type === 'private') {
          joinPrivateLobby({ code: raceState.code });
        }
    }
  }, [socket, connected, raceState.code, raceState.snippet, raceState.type, joinPrivateLobby]);

  // Handle inactivity redirection
  useEffect(() => {
    if (inactivityState.redirectToHome) {
      window.location.href = '/home?kicked=inactivity';
      
      // Reset the flag
      setInactivityState(prev => ({
        ...prev,
        redirectToHome: false
      }));
    }
  }, [inactivityState.redirectToHome]);

  // Initialize Socket.IO event listeners when socket is available
  useEffect(() => {
    if (!socket || !connected) return;

    // Handle snippet not found events from server
    const handleSnippetNotFound = (data) => {
      console.log('Snippet not found:', data.message);
      setSnippetError(data.message);
    };
    socket.on('snippetNotFound', handleSnippetNotFound);
    
    // Event handlers
    const handleRaceJoined = (data) => {
      // console.log('Joined race:', data);
      setRaceState(prev => ({
        ...prev,
        code: data.code,
        type: data.type,
        lobbyId: data.lobbyId,
        hostNetId: data.hostNetId || null, // Explicitly store hostNetId
        snippet: data.snippet,
        settings: data.settings || prev.settings, // Store settings from server
        players: data.players || []
      }));
    };

    const handlePlayersUpdate = (data) => {
      setRaceState(prev => {
        // For quick-match public races, if the race is already in progress, we want to keep
        // any players previously marked as disconnected even if they are no longer in the
        // server-provided list. This preserves their progress bars.

        if (prev.type === 'public' && prev.inProgress) {
          // Map of players currently reported by server
          const livePlayersMap = new Map(data.players.map(p => [p.netid, p]));

          // Build merged list starting with live players (server is authoritative for connected users)
          const mergedPlayers = [...data.players];

          // Helper to avoid duplicates
          const addOrReplace = (playerObj) => {
            const idx = mergedPlayers.findIndex(pl => pl.netid === playerObj.netid);
            if (idx === -1) {
              mergedPlayers.push(playerObj);
            } else {
              mergedPlayers[idx] = { ...mergedPlayers[idx], ...playerObj };
            }
          };

          // Iterate over previous players to detect disconnects / rejoins
          prev.players.forEach(prevPlayer => {
            const isLive = livePlayersMap.has(prevPlayer.netid);

            if (!isLive) {
              // Player missing from live list – mark as disconnected (retain last known state)
              addOrReplace({ ...prevPlayer, disconnected: true });
            } else if (prevPlayer.disconnected) {
              // Player was previously marked disconnected but has reappeared -> clear flag
              const livePlayer = livePlayersMap.get(prevPlayer.netid);
              addOrReplace({ ...livePlayer, disconnected: false });
            }
          });

          return { ...prev, players: mergedPlayers };
        }

        // Default behaviour – replace list
        return { ...prev, players: data.players };
      });
    };

    const handleRaceStart = (data) => {
      // Only process the race:start event if:
      // 1. It's not practice mode, OR
      // 2. It's practice mode but we haven't manually started it yet
      if (raceState.type !== 'practice' || !raceState.manuallyStarted) {
        setRaceState(prev => ({
          ...prev,
          startTime: data.startTime,
          inProgress: true,
          countdown: null
        }));
        
        // Reset typing state
        setTypingState({
          input: '',
          position: 0,
          correctChars: 0,
          errors: 0,
          completed: false,
          wpm: 0,
          accuracy: 0,
          lockedPosition: 0
        });
      }
    };

    const handlePlayerProgress = (data) => {
      setRaceState(prev => {
        // Update players array with progress
        const updatedPlayers = prev.players.map(player => {
          if (player.netid === data.netid) {
            return {
              ...player,
              progress: data.percentage,
              position: data.position,
              completed: data.completed
            };
          }
          return player;
        });
        
        return {
          ...prev,
          players: updatedPlayers
        };
      });
    };

    const handleResultsUpdate = (data) => {
      setRaceState(prev => ({
        ...prev,
        // Sort results by completion time (ascending)
        results: data.results.sort((a, b) => a.completion_time - b.completion_time) 
      }));
    };

    const handleRaceEnd = () => {
      setRaceState(prev => ({
        ...prev,
        inProgress: false,
        completed: true
      }));
    };

    // Inactivity event handlers
    const handleInactivityWarning = (data) => {
      console.log('Inactivity warning received:', data);
      setInactivityState(prev => ({
        ...prev,
        warning: true,
        warningMessage: data.message || 'You will be kicked for inactivity if you do not ready up soon.'
      }));
    };
    
    const handleInactivityKicked = () => {
      console.log('Kicked for inactivity');
      setInactivityState(prev => ({
        ...prev,
        kicked: true,
        kickMessage: 'You have been removed from the lobby due to inactivity. Please ready up promptly when joining a race.',
        redirectToHome: true 
      }));
      
      // Reset race state
      setRaceState({
        code: null,
        type: null,
        lobbyId: null,
        snippet: null,
        players: [],
        inProgress: false,
        completed: false,
        results: [],
        startTime: null,
        manuallyStarted: false
      });
    };

    // --- New Lobby Event Handlers ---
    const handleLobbySettingsUpdated = (data) => {
      // console.log('Lobby settings updated:', data);
      setRaceState(prev => ({
        ...prev,
        settings: { ...prev.settings, ...data.settings },
        snippet: data.snippet // Update snippet as it might change with settings
      }));
      // Reset typing state if snippet changed
      if (data.snippet?.id !== raceState.snippet?.id) {
         setTypingState({
           input: '', position: 0, correctChars: 0, errors: 0,
           completed: false, wpm: 0, accuracy: 0, lockedPosition: 0
         });
      }
    };

    const handleLobbyKicked = (data) => {
      console.log('Kicked from lobby:', data.reason);
      // Show a message to the user
      setInactivityState(prev => ({
        ...prev,
        kicked: true, // Reuse kicked state for general kicks
        kickMessage: data.reason || 'You have been removed from the lobby.',
        redirectToHome: true // Force redirect to home after kick
      }));
      // Reset race state locally
      resetRace(); // Call resetRace without notifying server
      // Explicitly disconnect the client socket to prevent auto-rejoin
      socket?.disconnect(); 
    };

    const handleLobbyTerminated = (data) => {
      // console.log('Lobby terminated:', data.reason);
       // Show a message
       setInactivityState(prev => ({
         ...prev,
         kicked: true, // Reuse kicked state
         kickMessage: data.reason || 'The lobby has been terminated.',
         redirectToHome: true
       }));
       resetRace();
    };

    const handleRaceCountdown = (data) => {
      // console.log('Received race countdown:', data);
      setRaceState(prev => ({ ...prev, countdown: data.seconds }));
    };

    const handleNewHost = (data) => {
      console.log(`New host assigned: ${data.newHostNetId}`);
      setRaceState(prev => ({ ...prev, hostNetId: data.newHostNetId }));
    };

    // Handler for when a player explicitly leaves/disconnects
    const handlePlayerLeft = (data) => {
      const { netid, reason } = data;
      console.log(`Player ${netid} left lobby. Reason: ${reason || 'disconnect'}`);
      setRaceState(prev => {
        // If player already exists in list, update according to rules.
        const existingIndex = prev.players.findIndex(p => p.netid === netid);

        // Rule set as described earlier
        if (prev.type === 'private' || !prev.inProgress) {
          // Remove from list entirely
          const updatedPlayers = prev.players.filter(p => p.netid !== netid);
          return { ...prev, players: updatedPlayers };
        }

        // Public race in progress: mark as disconnected
        let updatedPlayers;
        if (existingIndex !== -1) {
          updatedPlayers = prev.players.map(p =>
            p.netid === netid ? { ...p, disconnected: true } : p
          );
        } else {
          // Player not found (likely already removed by earlier playersUpdate) – create placeholder
          updatedPlayers = [
            ...prev.players,
            {
              netid,
              progress: 0,
              ready: false,
              disconnected: true
            }
          ];
        }
        return { ...prev, players: updatedPlayers };
      });
    };

    // Register event listeners
    socket.on('race:joined', handleRaceJoined);
    socket.on('race:playersUpdate', handlePlayersUpdate);
    socket.on('race:start', handleRaceStart);
    socket.on('race:playerProgress', handlePlayerProgress);
    socket.on('race:resultsUpdate', handleResultsUpdate);
    socket.on('race:end', handleRaceEnd);
    
    // Register inactivity event listeners
    socket.on('inactivity:warning', handleInactivityWarning);
    socket.on('inactivity:kicked', handleInactivityKicked); // Keep existing inactivity kick handler

    // Register new lobby event listeners
    socket.on('lobby:settingsUpdated', handleLobbySettingsUpdated);
    socket.on('lobby:kicked', handleLobbyKicked);
    socket.on('lobby:terminated', handleLobbyTerminated);
    socket.on('race:countdown', handleRaceCountdown);
    socket.on('lobby:newHost', handleNewHost);
    socket.on('race:playerLeft', handlePlayerLeft);

    // Clean up on unmount
    return () => {
      socket.off('race:joined', handleRaceJoined);
      socket.off('race:playersUpdate', handlePlayersUpdate);
      socket.off('race:start', handleRaceStart);
      socket.off('race:playerProgress', handlePlayerProgress);
      socket.off('race:resultsUpdate', handleResultsUpdate);
      socket.off('race:end', handleRaceEnd);
      
      // Clean up inactivity event listeners
      socket.off('inactivity:warning', handleInactivityWarning);
      socket.off('inactivity:kicked', handleInactivityKicked);

      // Clean up new lobby event listeners
      socket.off('lobby:settingsUpdated', handleLobbySettingsUpdated);
      socket.off('lobby:kicked', handleLobbyKicked);
      socket.off('lobby:terminated', handleLobbyTerminated);
      socket.off('race:countdown', handleRaceCountdown);
      socket.off('lobby:newHost', handleNewHost); // Added cleanup
      socket.off('race:playerLeft', handlePlayerLeft);
      socket.off('snippetNotFound', handleSnippetNotFound); // Cleanup snippet not found listener
    };
    // Add raceState.snippet?.id to dependency array to reset typing state on snippet change
  }, [socket, connected, raceState.type, raceState.manuallyStarted, raceState.snippet?.id]); 

  // Methods for race actions
  const joinPracticeMode = () => {
    if (!socket || !connected) return;
    // Clear any previous snippet errors
    setSnippetError(null);
    console.log('Joining practice mode...');
    
    // Pass test configuration and current snippet filters
    const options = {
      testMode: raceState.timedTest?.enabled ? 'timed' : 'snippet',
      testDuration: raceState.timedTest?.duration || 15,
      wordPoolSize: wordDifficulty === 'easy' ? '200' : '1000', // Map difficulty to size
      snippetFilters: {
        difficulty: snippetDifficulty || 'all',
        type: snippetCategory || 'all',
        department: snippetSubject || 'all'
      }
    };
    // console.log('Joining practice with options:', options);
    socket.emit('practice:join', options);
  };

  // Join or rejoin a public race. Pass forceNew=true to always start a new queue.
  const joinPublicRace = (forceNew = false) => {
    if (!socket || !connected) return;
    const hasExisting = raceState.code && raceState.type === 'public';
    if (!forceNew && hasExisting) {
      console.log('Rejoining public race with code:', raceState.code);
      socket.emit('public:join', { code: raceState.code });
    } else {
      if (hasExisting && forceNew) {
        // console.log('Forcing join of a new public race, ignoring old code:', raceState.code);
      } else {
        console.log('Joining public race...');
      }
      socket.emit('public:join');
    }
  };

  const setPlayerReady = () => {
    if (!socket || !connected) return;
    // console.log('Setting player ready...');
    socket.emit('player:ready');
  };

  // Load a new snippet for practice mode
  const loadNewSnippet = async (modeOverride, durationOverride, difficultyOverride, categoryOverride, subjectOverride) => {
    const currentMode = modeOverride || testMode;
    const currentDuration = durationOverride || testDuration;
    // Use overrides if provided, otherwise use current state from RaceContext
    const difficulty = difficultyOverride || snippetDifficulty || 'all';
    const category = categoryOverride || snippetCategory || 'all';
    const subjectValue = subjectOverride || snippetSubject || 'all';

    // console.log(`Loading new snippet. Mode: ${currentMode}, Duration: ${currentDuration}, Difficulty: ${difficulty}, Category: ${category}, Subject: ${subjectValue}`);
    setSnippetError(null); // Clear previous errors

    if (!socket || !connected || raceState.type !== 'practice') return;
    
    // Reset typing state
    setTypingState({
      input: '',
      position: 0,
      correctChars: 0,
      errors: 0,
      completed: false,
      wpm: 0,
      accuracy: 0,
      lockedPosition: 0
    });
    
    setRaceState(prev => {
      const currentState = {
        ...prev,
        startTime: null,
        inProgress: false,
        completed: false,
        manuallyStarted: false
      };
      
      // Build options with current snippet filters
      const options = {
        testMode: currentState.timedTest?.enabled ? 'timed' : 'snippet',
        testDuration: currentState.timedTest?.duration || 15,
        wordPoolSize: wordDifficulty === 'easy' ? '200' : '1000', // Map difficulty to size
        snippetFilters: {
          difficulty: difficulty,
          type: category,
          department: subjectValue
        }
      };
      
      // console.log('Requesting new practice snippet with options:', options);
      socket.emit('practice:join', options);
      
      return currentState;
    });
  };

  // Handle text input, enforce word locking
  const handleInput = (newInput) => {
    // Disable input handling for non-practice races before countdown begins
    if (raceState.type !== 'practice' && !raceState.inProgress && raceState.countdown === null) {
      return;
    }
    
    // --- Start Practice Race on First Input --- 
    if (raceState.type === 'practice' && !raceState.inProgress && newInput.length > 0) {
      // console.log("First input detected in practice mode, starting race locally.");
      setRaceState(prev => ({
        ...prev,
        inProgress: true,
        startTime: Date.now() // Set start time locally
      }));
      // Note: The first call to updateProgress will use this new startTime
    }
    // --- End Practice Race Start --- 

    if (!raceState.inProgress && !(raceState.type === 'practice' && newInput.length > 0) ) {
      // If not in progress (and not the very first input of practice mode), 
      // just update the input field visually without processing WPM etc.
      setTypingState(prev => ({
        ...prev,
        input: newInput,
        position: newInput.length
      }));
      return;
    }
    
    // If we are in progress (or just started practice), proceed with full update
    const currentInput = typingState.input;
    const lockedPosition = typingState.lockedPosition;
    const text = raceState.snippet?.text || '';
    
    // Find the position of the first error in the current input
    let firstErrorPosition = text.length; // Default to end of text (no errors)
    for (let i = 0; i < Math.min(text.length, currentInput.length); i++) {
      if (currentInput[i] !== text[i]) {
        firstErrorPosition = i;
        break;
      }
    }
    
    // If trying to delete locked text, only preserve correctly typed text before the first error
    if (newInput.length < currentInput.length && lockedPosition > 0) {
      // Only preserve text up to the last complete word before the first error
      const lastWordBreakBeforeError = currentInput.lastIndexOf(' ', Math.max(0, firstErrorPosition - 1)) + 1;
      
      // Only enforce locking if trying to delete before the locked position
      if (newInput.length < lastWordBreakBeforeError) {
        const preservedPart = currentInput.substring(0, lastWordBreakBeforeError);
        let newPart = '';
        
        // Keep the user's input after the preserved part
        if (newInput.length >= preservedPart.length) {
          newPart = newInput.substring(preservedPart.length);
        } else {
          // Deletion is attempting to erase preserved text
          newPart = currentInput.substring(preservedPart.length);
        }
        
        // This enforces that only correctly typed words before any error cannot be deleted
        newInput = preservedPart + newPart;
      }
    }
    
    // Update progress with the potentially modified input
    updateProgress(newInput);
  };

  const updateProgress = (input) => {
    const now = Date.now();
    const elapsedSeconds = (now - raceState.startTime) / 1000;
    
    // Calculate current position in the snippet
    const text = raceState.snippet?.text || '';
    let correctChars = 0;
    let currentErrors = 0;
    let hasError = false;
    let firstErrorPosition = text.length;
    
    // Find the first error position
    for (let i = 0; i < input.length; i++) {
      if (i < text.length && input[i] !== text[i]) {
        firstErrorPosition = i;
        hasError = true;
        break;
      }
    }
    
    // Count only the contiguous correct characters from the start of the snippet.
    // As soon as an error is encountered we stop counting further characters.
    if (!hasError) {
      // No error – all typed characters are correct up to input length (bounded by snippet length)
      correctChars = Math.min(input.length, text.length);
    } else {
      // Error present – only count chars before the first error index
      correctChars = firstErrorPosition;
    }

    // Count current error characters (everything typed after first error is considered incorrect)
    if (hasError) {
      currentErrors = input.length - firstErrorPosition;
    }
    
    // Get previous total errors (persist even after fixes)
    let totalErrors = typingState.errors;
    
    // If there's a new error (wasn't there in previous input)
    const previousInput = typingState.input;
    let isNewError = false;
    
    // Check if we have a new error that wasn't in the previous input
    if (hasError && (previousInput.length <= firstErrorPosition || 
        (previousInput.length > firstErrorPosition && previousInput[firstErrorPosition] === text[firstErrorPosition]))) {
      isNewError = true;
    }
    
    // Only increment error count if this is a new error
    if (isNewError) {
      totalErrors += 1;
    }
    
    // For accuracy calculation:
    // - The denominator is (all correct characters typed + all errors made)
    // - The numerator is all correct characters typed
    const totalCharsForAccuracy = Math.min(firstErrorPosition, input.length) + totalErrors;
    const accuracyCorrectChars = Math.min(firstErrorPosition, input.length);
    
    // Calculate WPM using only correctly typed characters (prevents inflation)
    const words = correctChars / 5; // Standard definition: 1 word = 5 correct chars
    const wpm = elapsedSeconds > 0 ? (words / elapsedSeconds) * 60 : 0;
    
    // Calculate accuracy using only valid characters (before first error) plus cumulative errors
    const accuracy = totalCharsForAccuracy > 0 ? (accuracyCorrectChars / totalCharsForAccuracy) * 100 : 100;
    
    // Check if all characters are typed correctly for completion
    const isCompleted = input.length === text.length && !hasError;
    
    // Find the last completely correct word boundary before any error
    let newLockedPosition = 0;
    
    // Only process word locking if there are characters
    if (input.length > 0) {
      let wordStart = 0;
      
      // Only lock text if there are no errors, or only lock up to the last word break before first error
      if (firstErrorPosition > 0) {
        let wordStart = 0;
        
        // Iterate through the input text word by word
        for (let i = 0; i <= Math.min(input.length, firstErrorPosition); i++) {
          // We found a space or reached the first error
          if (i === firstErrorPosition || input[i] === ' ') {
            // Check if this entire word is correct
            let isWordCorrect = true;
            for (let j = wordStart; j < i; j++) {
              if (j >= text.length || input[j] !== text[j]) {
                isWordCorrect = false;
                break;
              }
            }
            
            // If we reached a space in both input and text, and the word is correct
            if (isWordCorrect && i < firstErrorPosition && input[i] === ' ' && i < text.length && input[i] === text[i]) {
              // Lock position after this word (including space)
              newLockedPosition = i + 1;
            }
            
            // Start of next word is after the space
            if (i < input.length && input[i] === ' ') {
              wordStart = i + 1;
            }
          }
        }
      }
    }
    
    // Update the typing state
    setTypingState({
      input,
      position: input.length, // Use actual input length instead of correct chars
      correctChars,
      errors: totalErrors,
      completed: isCompleted, // Only completed when all characters match exactly
      wpm,
      accuracy,
      lockedPosition: newLockedPosition
    });
    
    // If the race is still in progress, update progress
    if (raceState.inProgress && !raceState.completed) {
      // Emit progress to the server
      if (socket && connected) {
        socket.emit('race:progress', {
          code: raceState.code,
          position: correctChars,
          total: text.length,
          isCompleted: isCompleted // Send explicit completion status to server
        });
      }
      
      // Check if race is completed (input exactly matches the text)
      if (isCompleted) {
        const isMultiplayer = raceState.type !== 'practice';
        const isTimedPractice = raceState.type === 'practice' && raceState.snippet?.is_timed_test;
        
        let finalWpm = wpm;
        let finalCompletionTime = elapsedSeconds;
        
        // For TIMED tests, calculate final WPM and completion time based on fixed duration
        if (isTimedPractice && raceState.snippet?.duration) {
          const durationInMinutes = raceState.snippet.duration / 60;
          // Use correctChars which contains only valid characters
          const finalWords = correctChars / 5;
          finalWpm = durationInMinutes > 0 ? (finalWords / durationInMinutes) : 0;
          finalCompletionTime = raceState.snippet.duration; // Use fixed duration
        } else {
           // For regular races (non-timed), use the WPM calculated based on elapsed time
           finalWpm = wpm;
           finalCompletionTime = elapsedSeconds;
        }
          
        // Mark as completed locally, ensuring the results array gets the correctly calculated final values
        setRaceState(prev => ({
          ...prev,
          completed: true,
          // For practice mode, store the CORRECTLY calculated final results directly in state
          results: prev.type === 'practice' ? [{
            netid: user?.netid,
            wpm: finalWpm, // Use final calculated WPM
            accuracy,
            completion_time: finalCompletionTime // Use final calculated time (duration for timed tests)
          }] : prev.results // Keep existing results for multiplayer
        }));
        
        // Send completion to server for all race types (multiplayer, timed practice, and snippet practice)
        // The finalWpm and finalCompletionTime calculated above are used here
        if (socket && connected) {
          socket.emit('race:result', {
            code: raceState.code,
            lobbyId: raceState.lobbyId, // Will be null for practice, that's okay
            snippetId: raceState.snippet?.id, // Will be like 'timed-15' for timed tests
            wpm: finalWpm, // Use the correctly calculated final WPM
            accuracy,
            completion_time: finalCompletionTime // Send fixed duration or actual time
          });
          // console.log(`Emitted race:result for ${raceState.type} race ${raceState.code} with WPM: ${finalWpm}`);
        }
      }
    }
  };

  const resetRace = (notifyServer = false) => { // Added optional param
    // Optionally notify server about leaving (e.g., for private lobbies)
    if (notifyServer && socket && connected && (raceState.code || raceState.lobbyId)) {
      const lobbyIdentifier = raceState.lobbyId || raceState.code; // Use lobbyId if available, else code
      if (lobbyIdentifier) {
        // console.log(`Notifying server: leaving lobby ${lobbyIdentifier}`);
        socket.emit('lobby:leave', { lobbyId: lobbyIdentifier });
      } else {
         console.warn('Cannot notify server of leave: No lobby code or ID found.');
      }
    }

    setRaceState({
      code: null,
      type: null,
      lobbyId: null,
      hostNetId: null, // Clear hostNetId
      snippet: null,
      players: [],
      startTime: null,
      inProgress: false,
      completed: false,
      results: [],
      manuallyStarted: false,
      timedTest: {
        enabled: false,
        duration: 15
      },
      snippetFilters: {
        difficulty: 'all',
        type: 'all',
        department: 'all'
      },
      settings: { // Reset settings
        testMode: 'snippet',
        testDuration: 15,
      },
      countdown: null
    });

    setTypingState({
      input: '',
      position: 0,
      correctChars: 0,
      errors: 0,
      completed: false,
      wpm: 0,
      accuracy: 0,
      lockedPosition: 0
    });
    
    // Clear race state from session storage
    sessionStorage.removeItem('raceState');
  };

  // --- Private Lobby Actions ---
  const createPrivateLobby = (options = {}) => {
    if (!socket || !connected) return;
    console.log('Creating private lobby with options:', options);
    // Include current test settings and snippet filters from local state or options
    const lobbyOptions = {
      testMode: options.testMode || raceState.settings.testMode,
      testDuration: options.testDuration || raceState.settings.testDuration,
      wordPoolSize: options.wordPoolSize || (wordDifficulty === 'easy' ? '200' : '1000'),
      snippetFilters: options.snippetFilters || {
        difficulty: snippetDifficulty || 'all',
        type: snippetCategory || 'all',
        department: snippetSubject || 'all'
      }
    };
    socket.emit('private:create', lobbyOptions, (response) => {
      if (!response.success) {
        console.error('Failed to create private lobby:', response.error);
        // TODO: Show error to user
      } else {
        console.log('Private lobby created successfully:', response.lobby);
        // raceState will be updated by the 'race:joined' listener
      }
    });
  };

  // joinPrivateLobby is declared earlier with useCallback to avoid TDZ

  const kickPlayer = (targetNetId) => {
    if (!socket || !connected || !raceState.code || raceState.type !== 'private') return;
    // console.log(`Attempting to kick player ${targetNetId} from lobby ${raceState.code}`);
    socket.emit('lobby:kick', { code: raceState.code, targetNetId }, (response) => {
      if (!response.success) {
        console.error(`Failed to kick player ${targetNetId}:`, response.error);
        // TODO: Show error to host
      } else {
        console.log(`Player ${targetNetId} kicked successfully.`);
        // Player list update handled by 'race:playersUpdate' listener
      }
    });
  };

  const updateLobbySettings = (newSettings) => {
    if (!socket || !connected || !raceState.code || raceState.type !== 'private') return;
    // console.log(`Attempting to update lobby ${raceState.code} settings:`, newSettings);
    socket.emit('lobby:updateSettings', { code: raceState.code, settings: newSettings }, (response) => {
      if (!response.success) {
        console.error('Failed to update lobby settings:', response.error);
        // TODO: Show error to host
      } else {
        // console.log('Lobby settings updated successfully:', response);
        // State update handled by 'lobby:settingsUpdated' listener
        // Only set snippet if test mode is snippet, or if it's timed and no snippet exists or duration changed
        if (newSettings.testMode === 'snippet' || 
            (newSettings.testMode === 'timed' && 
             (!raceState.snippet || (newSettings.testDuration && newSettings.testDuration !== raceState.settings?.testDuration)))) {
          loadNewSnippet(
            newSettings.testMode,
            newSettings.testDuration,
            newSettings.snippetFilters?.difficulty,
            newSettings.snippetFilters?.type,
            newSettings.snippetFilters?.subject
          );
        }
      }
    });
  };

  const startPrivateRace = () => {
    if (!socket || !connected || !raceState.code || raceState.type !== 'private') return;
    // console.log(`Attempting to start race for private lobby ${raceState.code}`);
    socket.emit('lobby:startRace', { code: raceState.code }, (response) => {
      if (!response.success) {
        console.error('Failed to start private race:', response.error);
        // TODO: Show error to host
      } else {
        console.log('Private race countdown initiated successfully.');
        // Race start handled by 'race:countdown' and 'race:start' listeners
      }
    });
  };
  // --- End Private Lobby Actions ---


  // Methods for inactivity
  const dismissInactivityWarning = () => {
    setInactivityState(prev => ({
      ...prev,
      warning: false,
      warningMessage: ''
    }));
  };
  
  const dismissInactivityKick = () => {
    setInactivityState(prev => ({
      ...prev,
      kicked: false,
      kickMessage: ''
    }));
    
    // Clear from session storage too
    sessionStorage.removeItem('inactivityState');
  };

  // Decrement countdown every second
  useEffect(() => {
    if (raceState.countdown == null) return;
    const interval = setInterval(() => {
      setRaceState(prev => {
        if (prev.countdown <= 1) {
          clearInterval(interval);
          return { ...prev, countdown: null };
        }
        return { ...prev, countdown: prev.countdown - 1 };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [raceState.countdown]);

  return (
    <RaceContext.Provider
      value={{
        raceState,
        typingState,
        inactivityState,
        setRaceState,
        setTypingState,
        setInactivityState,
        joinPracticeMode,
        joinPublicRace,
        createPrivateLobby, // Add new actions to value
        joinPrivateLobby,
        kickPlayer,
        updateLobbySettings,
        startPrivateRace,
        setPlayerReady,
        handleInput,
        updateProgress,
        resetRace,
        loadNewSnippet,
        dismissInactivityWarning,
        dismissInactivityKick,
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
        wordDifficulty,
        setWordDifficulty
      }}
    >
      {children}
    </RaceContext.Provider>
  );
};

const useEnhancedRace = () => {
  const context = useContext(RaceContext);
  if (!context) {
    throw new Error('useEnhancedRace must be used within a RaceProvider');
  }

  // Add specific setters for test config
  const setConfigTestMode = useCallback((mode) => {
    if (typeof context.setTestMode === 'function') context.setTestMode(mode);
    // Optionally trigger loadNewSnippet or other side effects here
    if (context.raceState.type === 'practice') {
      context.setRaceState(prev => ({ ...prev, timedTest: { ...prev.timedTest, enabled: mode === 'timed' } }));
      context.loadNewSnippet(); // Reload snippet on mode change
    }
  }, [context]);

  const setConfigTestDuration = useCallback((duration) => {
    if (typeof context.setTestDuration === 'function') context.setTestDuration(duration);
    if (context.raceState.type === 'practice' && context.testMode === 'timed') {
      context.setRaceState(prev => ({ ...prev, timedTest: { ...prev.timedTest, duration: duration } }));
      context.loadNewSnippet(); // Reload snippet on duration change
    }
  }, [context]);

  // Add setter for word pool size if needed for TestConfigurator or other components
  const setConfigWordPoolSize = useCallback((size) => {
    if (typeof context.setWordPoolSize === 'function') context.setWordPoolSize(size);
    // Optionally, trigger a reload if in practice mode
    if (context.raceState.type === 'practice') {
      context.loadNewSnippet(); // Reload snippet on word pool size change
    }
  }, [context]);

  // Getter for wordDifficulty, setter for wordDifficulty that maps to internal state
  const currentWordDifficulty = context.wordDifficulty;
  const setConfigWordDifficulty = useCallback((difficulty) => {
    if (typeof context.setWordDifficulty === 'function') {
      context.setWordDifficulty(difficulty);
      // Reload snippet in practice mode if difficulty changes
      if (context.raceState.type === 'practice') {
        context.loadNewSnippet();
      }
    }
  }, [context]);

  return {
    ...context,
    setConfigTestMode,
    setConfigTestDuration,
    setConfigWordPoolSize,
    wordDifficulty: currentWordDifficulty,
    setWordDifficulty: setConfigWordDifficulty
  };
};

export { useEnhancedRace as useRace };
