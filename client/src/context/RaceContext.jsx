import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';

// Create context
const RaceContext = createContext(null);

export const RaceProvider = ({ children }) => {
  const { socket, connected } = useSocket();
  const { user } = useAuth();
  
  // Race state
  const [raceState, setRaceState] = useState({
    code: null,
    type: null,
    snippet: null,
    players: [],
    startTime: null,
    inProgress: false,
    completed: false,
    results: []
  });
  
  // Local typing state
  const [typingState, setTypingState] = useState({
    input: '',
    position: 0,
    correctChars: 0,
    errors: 0,
    completed: false,
    wpm: 0,
    accuracy: 0
  });

  // Initialize Socket.IO event listeners when socket is available
  useEffect(() => {
    if (!socket || !connected) return;

    // Event handlers
    const handleRaceJoined = (data) => {
      console.log('Handling race:joined:', data);
      if (data.type === 'practice') {
        console.log('Setting up practice state specifically');
        // For practice mode, ensure inProgress, startTime, etc., are reset
        setRaceState({
          code: data.code,
          type: 'practice',
          lobbyId: data.lobbyId,
          snippet: data.snippet,
          players: data.players || [],
          startTime: null,
          inProgress: false, 
          completed: false,
          results: []
        });
        // Also reset local typing state upon joining new practice
        setTypingState({
          input: '',
          position: 0,
          correctChars: 0,
          errors: 0,
          completed: false,
          wpm: 0,
          accuracy: 0
        });
      } else {
        // For non-practice races, set state normally
        setRaceState(prev => ({
          ...prev,
          code: data.code,
          type: data.type,
          lobbyId: data.lobbyId,
          snippet: data.snippet,
          players: data.players || []
        }));
      }
    };

    const handlePlayersUpdate = (data) => {
      setRaceState(prev => ({
        ...prev,
        players: data.players
      }));
    };

    const handleRaceStart = (data) => {
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
        accuracy: 0
      });
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

    // Register event listeners
    socket.on('race:joined', handleRaceJoined);
    socket.on('race:playersUpdate', handlePlayersUpdate);
    socket.on('race:start', handleRaceStart);
    socket.on('race:playerProgress', handlePlayerProgress);
    socket.on('race:resultsUpdate', handleResultsUpdate);
    socket.on('race:end', handleRaceEnd);
    
    // Clean up on unmount
    return () => {
      socket.off('race:joined', handleRaceJoined);
      socket.off('race:playersUpdate', handlePlayersUpdate);
      socket.off('race:start', handleRaceStart);
      socket.off('race:playerProgress', handlePlayerProgress);
      socket.off('race:resultsUpdate', handleResultsUpdate);
      socket.off('race:end', handleRaceEnd);
    };
  }, [socket, connected]);

  // Methods for race actions
  const joinPracticeMode = useCallback(() => {
    if (!socket || !connected) return;
    console.log('Emitting practice:join...');
    socket.emit('practice:join');
  }, [socket, connected]);

  const joinPublicRace = useCallback(() => {
    if (!socket || !connected) return;
    console.log('Joining public race...');
    socket.emit('public:join');
  }, [socket, connected]);

  const setPlayerReady = useCallback(() => {
    if (!socket || !connected) return;
    console.log('Setting player ready...');
    socket.emit('player:ready');
  }, [socket, connected]);

  const updateProgress = useCallback((input, startTimeOverride = null) => {
    // Determine the start time to use: override if provided, otherwise use state
    const effectiveStartTime = startTimeOverride !== null ? startTimeOverride : raceState.startTime;

    // Ensure we have a valid start time before proceeding
    if (!effectiveStartTime) {
      console.warn('updateProgress called without a valid startTime.');
      return;
    }
    const now = Date.now();
    // Use effectiveStartTime for calculation
    const elapsedSeconds = Math.max(0.001, (now - effectiveStartTime) / 1000);
    
    const text = raceState.snippet?.text || '';
    let correctChars = 0;
    let errors = 0;
    
    for (let i = 0; i < input.length; i++) {
      if (i < text.length) {
        if (input[i] === text[i]) {
          correctChars++;
        } else {
          errors++;
        }
      }
    }
    
    const words = correctChars / 5;
    const wpm = (words / elapsedSeconds) * 60;
    const accuracy = input.length > 0 ? (correctChars / input.length) * 100 : 0;
    const isCompleted = input.length >= text.length;
    
    setTypingState({
      input,
      position: input.length,
      correctChars,
      errors,
      completed: isCompleted,
      wpm,
      accuracy
    });
    
    // Send progress to server
    if (socket && connected && raceState.inProgress && !raceState.completed) {
      socket.emit('race:progress', {
        code: raceState.code,
        position: input.length,
        total: text.length
      });
    }
      
    // Handle completion
    if (isCompleted) {
      // Use functional update for setRaceState to ensure we have latest state
      setRaceState(prev => {
        // Only update if not already completed in prev state
        if (prev.completed) return prev;
        
        const finalResults = prev.type === 'practice' ? [{
            netid: user?.netid,
            wpm,
            accuracy,
            completion_time: elapsedSeconds
        }] : prev.results;
        
        // Send completion to server only for multiplayer races
        if (socket && connected && prev.type !== 'practice') {
          socket.emit('race:result', {
            code: prev.code,
            lobbyId: prev.lobbyId,
            snippetId: prev.snippet?.id,
            wpm,
            accuracy,
            completion_time: elapsedSeconds
          });
        }
        
        return {
           ...prev,
           completed: true,
           results: finalResults
        };
      });
    }
  }, [socket, connected, user, raceState.startTime, raceState.snippet, raceState.code, raceState.lobbyId, raceState.inProgress, raceState.completed, raceState.type, setRaceState, setTypingState]);

  const resetRace = useCallback(() => {
    setRaceState({
      code: null,
      type: null,
      snippet: null,
      players: [],
      startTime: null,
      inProgress: false,
      completed: false,
      results: []
    });
    
    setTypingState({
      input: '',
      position: 0,
      correctChars: 0,
      errors: 0,
      completed: false,
      wpm: 0,
      accuracy: 0
    });
  // No external dependencies, but include setters just in case
  }, [setRaceState, setTypingState]); 

  return (
    <RaceContext.Provider value={{ 
      raceState, 
      typingState,
      // Provide the memoized functions
      joinPracticeMode,
      joinPublicRace,
      setPlayerReady,
      updateProgress, 
      resetRace,
      // setRaceState is stable by default, no need for useCallback
      setRaceState 
    }}>
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