import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';

// Create context
const RaceContext = createContext(null);

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
    code: savedRaceState?.code || null,     // Code of the race
    type: savedRaceState?.type || null,     // Type of race (practice, public, custom)
    lobbyId: savedRaceState?.lobbyId || null, // ID of the lobby
    snippet: null,          // Snippet of the race
    players: [],            // Array of objects with netid, ready status  
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
    }
  });
  
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
        socket.emit('public:join');
      }
    }
  }, [socket, connected, raceState.code, raceState.snippet, raceState.type]);

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

    // Event handlers
    const handleRaceJoined = (data) => {
      console.log('Joined race:', data);
      setRaceState(prev => ({
        ...prev,
        code: data.code,
        type: data.type,
        lobbyId: data.lobbyId,
        snippet: data.snippet,
        players: data.players || []
      }));
    };

    const handlePlayersUpdate = (data) => {
      setRaceState(prev => ({
        ...prev,
        players: data.players
      }));
    };

    const handleRaceStart = (data) => {
      // Only process the race:start event if:
      // 1. It's not practice mode, OR
      // 2. It's practice mode but we haven't manually started it yet
      if (raceState.type !== 'practice' || !raceState.manuallyStarted) {
        setRaceState(prev => ({
          ...prev,
          startTime: data.startTime,
          inProgress: true
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

    // Register event listeners
    socket.on('race:joined', handleRaceJoined);
    socket.on('race:playersUpdate', handlePlayersUpdate);
    socket.on('race:start', handleRaceStart);
    socket.on('race:playerProgress', handlePlayerProgress);
    socket.on('race:resultsUpdate', handleResultsUpdate);
    socket.on('race:end', handleRaceEnd);
    
    // Register inactivity event listeners
    socket.on('inactivity:warning', handleInactivityWarning);
    socket.on('inactivity:kicked', handleInactivityKicked);
    
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
    };
  }, [socket, connected, raceState.type, raceState.manuallyStarted]);

  // Methods for race actions
  const joinPracticeMode = () => {
    if (!socket || !connected) return;
    console.log('Joining practice mode...');
    
    // Use current state values, not potentially stale ones from closure
    const currentRaceState = { ...raceState };
    
    // Pass test configuration when joining practice mode
    const options = {
      testMode: currentRaceState.timedTest?.enabled ? 'timed' : 'snippet',
      testDuration: currentRaceState.timedTest?.duration || 15,
      snippetFilters: currentRaceState.snippetFilters
    };
    
    socket.emit('practice:join', options);
  };

  const joinPublicRace = () => {
    if (!socket || !connected) return;
    console.log('Joining public race...');
    socket.emit('public:join');
  };

  const setPlayerReady = () => {
    if (!socket || !connected) return;
    console.log('Setting player ready...');
    socket.emit('player:ready');
  };

  // Load a new snippet for practice mode
  const loadNewSnippet = () => {
    if (!socket || !connected || raceState.type !== 'practice') return;
    console.log('Loading new practice snippet...');
    
    // Reset states
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
      // Get current race state
      const currentState = {
        ...prev,
        startTime: null,
        inProgress: false,
        completed: false,
        manuallyStarted: false
      };
      
      // Request a new practice snippet with test configuration 
      // using the current state values (not stale ones)
      const options = {
        testMode: currentState.timedTest?.enabled ? 'timed' : 'snippet',
        testDuration: currentState.timedTest?.duration || 15,
        snippetFilters: currentState.snippetFilters
      };
      
      console.log('Requesting new practice snippet with options:', options);
      socket.emit('practice:join', options);
      
      return currentState;
    });
  };

  // Handle text input, enforce word locking
  const handleInput = (newInput) => {
    if (!raceState.inProgress) {
      setTypingState(prev => ({
        ...prev,
        input: newInput,
        position: newInput.length
      }));
      return;
    }
    
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
    
    // Count correct characters up to firstErrorPosition
    for (let i = 0; i < input.length && i < text.length; i++) {
      if (i < firstErrorPosition) {
        // All characters before the first error are correct by definition
        correctChars++;
      } else if (input[i] === text[i]) {
        // After the first error, only count matching characters
        // but we don't count this for accuracy - just for WPM
        correctChars++;
      } else {
        currentErrors++;
      }
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
    
    // Calculate WPM using all correctly typed characters
    const words = correctChars / 5; // standard definition: 1 word = 5 chars
    const wpm = (words / elapsedSeconds) * 60;
    
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
          position: input.length,
          total: text.length,
          isCompleted: isCompleted // Send explicit completion status to server
        });
      }
      
      // Check if race is completed (input exactly matches the text)
      if (isCompleted) {
        // Mark as completed locally
        setRaceState(prev => ({
          ...prev,
          completed: true,
          // For practice mode, store results directly in state
          results: prev.type === 'practice' ? [{
            netid: user?.netid,
            wpm,
            accuracy,
            completion_time: elapsedSeconds
          }] : prev.results
        }));
        
        // Send completion to server for multiplayer races OR timed practice tests
        const isMultiplayer = raceState.type !== 'practice';
        const isTimedPractice = raceState.type === 'practice' && raceState.snippet?.is_timed_test;
        
        if (socket && connected && (isMultiplayer || isTimedPractice)) {
          socket.emit('race:result', {
            code: raceState.code,
            lobbyId: raceState.lobbyId, // Will be null for practice, that's okay
            snippetId: raceState.snippet?.id, // Will be like 'timed-15' for timed tests
            wpm,
            accuracy,
            completion_time: elapsedSeconds
          });
          console.log(`Emitted race:result for ${isMultiplayer ? 'multiplayer' : 'timed practice'} race ${raceState.code}`);
        }
      }
    }
  };

  const resetRace = () => {
    setRaceState({
      code: null,
      type: null,
      lobbyId: null,
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
      }
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
        setPlayerReady,
        handleInput,
        updateProgress,
        resetRace,
        loadNewSnippet,
        dismissInactivityWarning,
        dismissInactivityKick
      }}
    >
      {children}
    </RaceContext.Provider>
  );
};

// Custom hook to use the race context
export const useRace = () => {
  const context = useContext(RaceContext);
  if (!context) {
    throw new Error('useRace must be used within a RaceProvider');
  }
  return context;
};

export default RaceContext;