/**
 * Socket.IO event handlers for TigerType
 */

const SnippetModel = require('../models/snippet');
const RaceModel = require('../models/race');
const UserModel = require('../models/user');
const analytics = require('../utils/analytics');

// Store active races in memory
const activeRaces = new Map();
// Store players in each race
const racePlayers = new Map();
// Store player progress
const playerProgress = new Map();

// Throttle progress updates to avoid spamming
const PROGRESS_THROTTLE = 100; // ms
const lastProgressUpdate = new Map();

// Simple lobby code generator (replace with more robust if needed)
const generateLobbyCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// Initialize socket handlers with IO instance
const initialize = (io) => {
  io.on('connection', (socket) => {
    // Store user info from session middleware
    const { user: netid, userId } = socket.userInfo;
    
    // Debug info
    console.log('Socket connection attempt with info:', { 
      netid, 
      userId, 
      socketId: socket.id
    });
    
    // If no netid, log error but try to continue
    // This should not happen with auth middleware but we'll handle it gracefully
    if (!netid) {
      console.error('Socket connection has missing netid, this is unexpected');
      console.error('Socket userInfo:', socket.userInfo);
      
      // Try to recover the netid from another place if possible
      const sessionUserInfo = socket.request.session?.userInfo;
      if (sessionUserInfo && sessionUserInfo.user) {
        console.log('Found netid in session instead:', sessionUserInfo.user);
        // Update socket.userInfo for later use
        socket.userInfo = {
          ...socket.userInfo,
          user: sessionUserInfo.user
        };
      } else {
        console.error('Cannot find netid anywhere, disconnecting socket');
        socket.disconnect(true);
        return;
      }
    }
    
    console.log(`Socket connected: ${netid} (${socket.id})`);
    
    // Emit welcome event with user info
    socket.emit('connected', {
      id: socket.id,
      netid: netid || socket.userInfo?.user || 'unknown-user'
    });
    
    // Handle joining practice mode
    socket.on('practice:join', async () => {
      try {
        console.log(`User ${netid} joining practice mode`);
        
        // Check if player is already in a race
        let alreadyInRace = false;
        for (const [code, players] of racePlayers.entries()) {
          if (players.some(p => p.id === socket.id)) {
            alreadyInRace = true;
            console.log(`User ${netid} is already in race ${code}, leaving that race first`);
            
            // Leave existing race rooms
            socket.leave(code);
            
            // Clean up player from the race
            const updatedPlayers = players.filter(p => p.id !== socket.id);
            if (updatedPlayers.length === 0) {
              racePlayers.delete(code);
              activeRaces.delete(code);
            } else {
              racePlayers.set(code, updatedPlayers);
              
              // Notify other players
              io.to(code).emit('race:playersUpdate', {
                players: updatedPlayers.map(p => ({ netid: p.netid, ready: p.ready }))
              });
              
              // Broadcast player left message
              io.to(code).emit('race:playerLeft', { netid });
            }
          }
        }
        
        // Get a random snippet
        const snippet = await SnippetModel.getRandom();
        
        if (!snippet) {
          console.error('Failed to load snippet for practice mode');
          socket.emit('error', { message: 'Failed to load snippet' });
          return;
        }
        
        console.log(`Loaded snippet ID ${snippet.id} for practice mode`);
        
        // *** DO NOT CREATE A DATABASE LOBBY FOR PRACTICE MODE ***
        // Use an in-memory representation only
        const practiceLobbyCode = generateLobbyCode(); // Assume this function exists
        const practiceLobbyId = Date.now(); // Use timestamp as a temporary unique ID
        console.log(`Generated in-memory practice lobby code ${practiceLobbyCode}`);
        
        // Join the socket room
        socket.join(practiceLobbyCode);
        
        // Add player to in-memory race tracking
        racePlayers.set(practiceLobbyCode, [{
          id: socket.id,
          netid,
          userId,
          ready: true, // Player is always ready in practice
          lobbyId: practiceLobbyId, // Use temporary ID
          snippetId: snippet.id
        }]);
        
        // In-memory active race info
        activeRaces.set(practiceLobbyCode, {
          id: practiceLobbyId, // Use temporary ID
          code: practiceLobbyCode,
          snippet: {
            id: snippet.id,
            text: snippet.text
          },
          status: 'waiting', // Race starts when user types
          type: 'practice',
          startTime: null
        });
        
        // Send race info to player
        socket.emit('race:joined', {
          code: practiceLobbyCode,
          type: 'practice',
          lobbyId: practiceLobbyId, // Send temporary ID
          snippet: {
            id: snippet.id,
            text: snippet.text
          },
          // Include player info for consistency, even though it's just one player
          players: [{ netid, ready: true }] 
        });
        
        // *** DO NOT START COUNTDOWN FOR PRACTICE MODE ***
        // startPracticeCountdown(io, lobby.code); // Removed this line
        
      } catch (err) {
        console.error('Error joining practice:', err);
        socket.emit('error', { message: 'Failed to join practice mode' });
      }
    });
    
    // Handle joining public lobby
    socket.on('public:join', async () => {
      try {
        console.log(`User ${netid} joining public lobby`);
        
        // Check if player is already in a race
        for (const [code, players] of racePlayers.entries()) {
          if (players.some(p => p.id === socket.id)) {
            console.log(`User ${netid} is already in race ${code}, leaving that race first`);
            
            // Leave existing race rooms
            socket.leave(code);
            
            // Clean up player from the race
            const updatedPlayers = players.filter(p => p.id !== socket.id);
            if (updatedPlayers.length === 0) {
              racePlayers.delete(code);
              activeRaces.delete(code);
            } else {
              racePlayers.set(code, updatedPlayers);
              
              // Notify other players
              io.to(code).emit('race:playersUpdate', {
                players: updatedPlayers.map(p => ({ netid: p.netid, ready: p.ready }))
              });
              
              // Broadcast player left message
              io.to(code).emit('race:playerLeft', { netid });
            }
          }
        }
        
        // Try to find an existing public lobby
        let lobby = await RaceModel.findPublicLobby();
        let snippet;
        
        // If no lobby exists, create a new one with a random snippet
        if (!lobby) {
          console.log('No existing public lobby found, creating a new one');
          snippet = await SnippetModel.getRandom();
          if (!snippet) {
            console.error('Failed to load snippet for public lobby');
            socket.emit('error', { message: 'Failed to load snippet' });
            return;
          }
          lobby = await RaceModel.create('public', snippet.id);
          
          // Initialize active race
          activeRaces.set(lobby.code, {
            id: lobby.id,
            code: lobby.code,
            snippet: {
              id: snippet.id,
              text: snippet.text
            },
            status: 'waiting',
            type: 'public',
            startTime: null
          });
          
          // Initialize player list
          racePlayers.set(lobby.code, []);
          console.log(`Created new public lobby with code ${lobby.code}`);
        } else {
          console.log(`Found existing public lobby with code ${lobby.code}`);
          // Ensure active race exists for this lobby
          if (!activeRaces.has(lobby.code)) {
            // This is a safeguard against a race condition where the lobby exists in DB
            // but not in memory (server restart, etc.)
            console.log(`Lobby ${lobby.code} exists in database but not in memory, initializing...`);
            activeRaces.set(lobby.code, {
              id: lobby.id,
              code: lobby.code,
              snippet: {
                id: lobby.snippet_id,
                text: lobby.snippet_text
              },
              status: lobby.status || 'waiting',
              type: lobby.type,
              startTime: null
            });
            
            // Initialize player list if needed
            if (!racePlayers.has(lobby.code)) {
              racePlayers.set(lobby.code, []);
            }
          }
        }
        
        // Join the socket room
        socket.join(lobby.code);
        
        // Add player to race
        const players = racePlayers.get(lobby.code) || [];
        const raceInfo = activeRaces.get(lobby.code);
        if (!raceInfo || !raceInfo.id || !raceInfo.snippet?.id) {
            console.error(`Cannot find essential race info (lobbyId, snippetId) for ${lobby.code} when adding player ${netid}`);
            socket.emit('error', { message: 'Internal server error joining race.' });
            return;
        }
        players.push({
          id: socket.id,
          netid,
          userId,
          ready: false,
          lobbyId: raceInfo.id,
          snippetId: raceInfo.snippet.id
        });
        racePlayers.set(lobby.code, players);
        
        // Send race info to player
        const race = activeRaces.get(lobby.code);
        socket.emit('race:joined', {
          code: lobby.code,
          type: 'public',
          lobbyId: lobby.id,
          snippet: {
            id: race.snippet.id,
            text: race.snippet.text
          },
          players: players.map(p => ({ netid: p.netid, ready: p.ready }))
        });
        
        // Broadcast updated player list to all in the lobby
        io.to(lobby.code).emit('race:playersUpdate', {
          players: players.map(p => ({ netid: p.netid, ready: p.ready }))
        });
        
        // If all players are ready (2+), start countdown
        checkAndStartCountdown(io, lobby.code);
      } catch (err) {
        console.error('Error joining public lobby:', err);
        socket.emit('error', { message: 'Failed to join public lobby' });
      }
    });
    
    // Handle player ready status
    socket.on('player:ready', () => {
      try {
        console.log(`User ${netid} is ready`);
        
        // Find the race this player is in
        for (const [code, players] of racePlayers.entries()) {
          const playerIndex = players.findIndex(p => p.id === socket.id);
          
          if (playerIndex !== -1) {
            console.log(`Found user ${netid} in race ${code}, marking as ready`);
            
            // Mark player as ready
            players[playerIndex].ready = true;
            racePlayers.set(code, players);
            
            // Broadcast updated player list
            io.to(code).emit('race:playersUpdate', {
              players: players.map(p => ({ netid: p.netid, ready: p.ready }))
            });
            
            // If all players are ready (2+), start countdown
            checkAndStartCountdown(io, code);
            break;
          }
        }
      } catch (err) {
        console.error('Error setting player ready:', err);
      }
    });
    
    // Handle progress updates
    socket.on('race:progress', (data) => {
      try {
        // Client sends { position, total }, but we only need position
        // Server handler previously expected { position, completed }
        const { code, position } = data; 
        
        // Check if race exists and is active
        const race = activeRaces.get(code);
        if (!race || race.status !== 'racing') {
          return;
        }
        
        // Find player in the race
        const players = racePlayers.get(code);
        if (!players) {
          return;
        }
        
        const playerIndex = players.findIndex(p => p.id === socket.id);
        
        if (playerIndex === -1) {
          return;
        }
        
        // Throttle progress updates
        const now = Date.now();
        const lastUpdate = lastProgressUpdate.get(socket.id) || 0;
        
        // Calculate completed status based on position
        const snippetLength = race.snippet.text.length;
        const isCompleted = position >= snippetLength;

        // Allow immediate update if player just completed the race
        if (now - lastUpdate < PROGRESS_THROTTLE && !isCompleted) {
          return;
        }
        
        lastProgressUpdate.set(socket.id, now);
        
        // Validate the progress (ensure position is not negative or excessively large)
        // Allow position == snippetLength for completion
        if (position < 0 || position > snippetLength) {
          console.warn(`Invalid position from ${netid}: ${position}, snippet length: ${snippetLength}`);
          return;
        }
        
        // Store player progress, including the calculated completed status
        playerProgress.set(socket.id, {
          position,
          completed: isCompleted, // Store calculated completion status
          timestamp: now
        });
        
        // Calculate completion percentage 
        const percentage = Math.min(100, Math.floor((position / snippetLength) * 100));
        
        // Broadcast progress to all players in the race
        io.to(code).emit('race:playerProgress', {
          netid,
          position,
          percentage,
          completed: isCompleted // Broadcast calculated completion status
        });
        
        // Handle race completion for this player if they just completed
        if (isCompleted) {
          console.log(`User ${netid} has completed the race in lobby ${code} based on progress update`);
          // Ensure finish handler isn't called multiple times if progress updates arrive late
          const progressData = playerProgress.get(socket.id);
          if (progressData && !progressData.finishHandled) {
             progressData.finishHandled = true; // Mark finish as handled
             playerProgress.set(socket.id, progressData);
             handlePlayerFinish(io, code, socket.id);
          }
        }
      } catch (err) {
        console.error('Error updating progress:', err);
      }
    });
    
    // Handle race result
    socket.on('race:result', async (data) => {
      try {
        // Client sends { code, lobbyId, snippetId, wpm, accuracy, completion_time }
        const { code, lobbyId, snippetId, wpm, accuracy, completion_time } = data;
        const userIdFromSocket = socket.userInfo?.userId; // Get authenticated userId

        // Validate required data
        if (!lobbyId || !snippetId || !userIdFromSocket) {
            console.error(`Missing required data for race result processing: lobbyId=${lobbyId}, snippetId=${snippetId}, userId=${userIdFromSocket}`);
            socket.emit('error', { message: 'Failed to record result due to missing identifiers.' });
            return;
        }
        
        console.log(`Received race result from ${netid}: ${wpm} WPM, ${accuracy}% accuracy, time: ${completion_time}`);
        
        // Use the completion_time sent by the client directly
        const completionTime = completion_time;

        // Basic validation for completion time
        if (typeof completionTime !== 'number' || completionTime < 0) {
            console.warn(`Invalid completion_time received from ${netid}: ${completionTime}`);
            return; // Or handle appropriately
        }
        
        console.log(`User ${netid} completed race ${code} in ${completionTime.toFixed(2)} seconds (client-reported)`);
        
        // Record race result in database
        let currentResults = [];
        let processedResults = [];
        try {
          await RaceModel.recordResult(
            userIdFromSocket, 
            lobbyId,          
            snippetId,        
            wpm,
            accuracy,
            completionTime
          );
          console.log(`Recorded race result for ${netid} in database`);
          
          // Fetch current results list immediately after recording
          currentResults = await RaceModel.getResults(lobbyId);
          console.log(`Fetched ${currentResults.length} current results for race ${code}`);
          
          // <<< START: Convert decimal strings to numbers >>>
          processedResults = currentResults.map(result => ({ 
            ...result,
            wpm: typeof result.wpm === 'string' ? parseFloat(result.wpm) : result.wpm,
            accuracy: typeof result.accuracy === 'string' ? parseFloat(result.accuracy) : result.accuracy,
            completion_time: typeof result.completion_time === 'string' ? parseFloat(result.completion_time) : result.completion_time,
          }));
          // <<< END: Convert decimal strings to numbers >>>
          
        } catch (dbErr) {
          console.error('Error processing race result or fetching updated results:', dbErr);
          // Consider not broadcasting if DB operations failed
          return; 
        }
        
        // Broadcast updated results list to all players (using processed results)
        io.to(code).emit('race:resultsUpdate', { results: processedResults }); 
        console.log(`Broadcasted results update for race ${code} to ${io.sockets.adapter.rooms.get(code)?.size || 0} clients`);

      } catch (err) {
        console.error('Error handling race:result event:', err);
      }
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${netid} (${socket.id})`);
      
      // Remove player from all races
      for (const [code, players] of racePlayers.entries()) {
        const playerIndex = players.findIndex(p => p.id === socket.id);
        
        if (playerIndex !== -1) {
          console.log(`Removing user ${netid} from race ${code}`);
          
          // Remove player from race
          players.splice(playerIndex, 1);
          
          // If no players left, clean up race
          if (players.length === 0) {
            console.log(`No players left in race ${code}, cleaning up`);
            racePlayers.delete(code);
            activeRaces.delete(code);
            continue;
          }
          
          // Update player list
          racePlayers.set(code, players);
          
          // Broadcast updated player list
          io.to(code).emit('race:playersUpdate', {
            players: players.map(p => ({ netid: p.netid, ready: p.ready }))
          });
          
          // Broadcast player left message
          io.to(code).emit('race:playerLeft', { netid });
          
          // Check if we should end the race early if all remaining players are finished
          const race = activeRaces.get(code);
          if (race && race.status === 'racing') {
            const allCompleted = players.every(p => {
              const progress = playerProgress.get(p.id);
              return progress && progress.completed;
            });
            
            if (allCompleted && players.length > 0) {
              console.log(`All remaining players in race ${code} have finished, ending race`);
              endRace(io, code).catch(err => {
                console.error(`Error ending race ${code} after disconnect:`, err);
              });
            }
          }
        }
      }
      
      // Clean up any stored progress
      playerProgress.delete(socket.id);
      lastProgressUpdate.delete(socket.id);
    });
  });
};

// Check if all players are ready and start countdown if appropriate
const checkAndStartCountdown = (io, code) => {
  const players = racePlayers.get(code);
  const race = activeRaces.get(code);
  
  if (!race || race.status !== 'waiting') {
    console.log(`Race ${code} is not in waiting status, cannot start countdown`);
    return;
  }
  
  // Need at least 2 players for public races
  if (race.type === 'public' && (!players || players.length < 2)) {
    console.log(`Not enough players (${players ? players.length : 0}) in public race ${code} to start countdown`);
    return;
  }
  
  // Check if all players are ready
  const allReady = players.every(p => p.ready);
  
  if (allReady) {
    console.log(`All players in race ${code} are ready, starting countdown`);
    startCountdown(io, code);
  } else {
    console.log(`Not all players in race ${code} are ready, waiting`);
  }
};

// Start countdown for practice mode
const startPracticeCountdown = async (io, code) => {
  try {
    const race = activeRaces.get(code);
    
    if (!race || race.status !== 'waiting') {
      console.warn(`Race ${code} is not in waiting status, cannot start countdown`);
      return;
    }
    
    console.log(`Starting practice countdown for race ${code}`);
    
    // Update race status to countdown
    race.status = 'countdown';
    activeRaces.set(code, race);
    
    // Update database status
    try {
      await RaceModel.updateStatus(race.id, 'countdown');
      console.log(`Updated race ${code} status to countdown in database`);
    } catch (dbErr) {
      console.error(`Error updating race ${code} status in database:`, dbErr);
    }
    
    // Broadcast countdown start - 3 seconds for practice mode
    io.to(code).emit('race:countdown', { seconds: 3 });
    
    // Wait 3 seconds and start the race
    setTimeout(() => startRace(io, code), 3000);
  } catch (err) {
    console.error('Error starting practice countdown:', err);
  }
};

// Start the countdown for a multiplayer race
const startCountdown = async (io, code) => {
  try {
    const race = activeRaces.get(code);
    
    if (!race || race.status !== 'waiting') {
      console.warn(`Race ${code} is not in waiting status, cannot start countdown`);
      return;
    }
    
    console.log(`Starting countdown for race ${code}`);
    
    // Update race status to countdown
    race.status = 'countdown';
    activeRaces.set(code, race);
    
    // Update database status
    try {
      await RaceModel.updateStatus(race.id, 'countdown');
      console.log(`Updated race ${code} status to countdown in database`);
    } catch (dbErr) {
      console.error(`Error updating race ${code} status in database:`, dbErr);
    }
    
    // Broadcast countdown start - 5 seconds for multiplayer races
    io.to(code).emit('race:countdown', { seconds: 5 });
    
    // Wait 5 seconds and start the race
    setTimeout(() => startRace(io, code), 5000);
  } catch (err) {
    console.error('Error starting countdown:', err);
  }
};

// Start a race
const startRace = async (io, code) => {
  try {
    const race = activeRaces.get(code);
    
    if (!race || race.status !== 'countdown') {
      console.warn(`Race ${code} is not in countdown status, cannot start race`);
      return;
    }
    
    console.log(`Starting race ${code}`);
    
    // Update race status to racing
    race.status = 'racing';
    race.startTime = Date.now();
    activeRaces.set(code, race);
    
    // Update database status
    try {
      await RaceModel.updateStatus(race.id, 'racing');
      console.log(`Updated race ${code} status to racing in database`);
    } catch (dbErr) {
      console.error(`Error updating race ${code} status in database:`, dbErr);
    }
    
    // Broadcast race start
    io.to(code).emit('race:start', { startTime: race.startTime });
  } catch (err) {
    console.error('Error starting race:', err);
  }
};

// Handle player finishing a race
const handlePlayerFinish = async (io, code, playerId) => {
  try {
    const race = activeRaces.get(code);
    
    if (!race || race.status !== 'racing') {
      console.warn(`Race ${code} is not in racing status, cannot handle player finish`);
      return;
    }
    
    const players = racePlayers.get(code);
    if (!players) {
      console.warn(`Players list not found for race ${code}`);
      return;
    }
    
    const player = players.find(p => p.id === playerId);
    
    if (!player) {
      console.warn(`Player ${playerId} not found in race ${code}`);
      return;
    }
    
    console.log(`Player ${player.netid} has finished race ${code}`);
    
    // Check if all players have finished
    const allCompleted = players.every(p => {
      const progress = playerProgress.get(p.id);
      return progress && progress.completed;
    });
    
    // If all players are done, end the race
    if (allCompleted) {
      console.log(`All players in race ${code} have finished, ending race`);
      await endRace(io, code);
    } else {
      console.log(`Waiting for remaining players to finish race ${code}`);
    }
  } catch (err) {
    console.error('Error handling player finish:', err);
  }
};

// End a race and show results
const endRace = async (io, code) => {
  try {
    const race = activeRaces.get(code);
    
    if (!race || race.status !== 'racing') {
      console.warn(`Race ${code} is not in racing status, cannot end race`);
      return;
    }
    
    console.log(`Ending race ${code}`);
    
    // Update race status
    race.status = 'finished';
    activeRaces.set(code, race);
    
    // Update database
    try {
      await RaceModel.updateStatus(race.id, 'finished');
      console.log(`Updated race ${code} status to finished in database`);
    } catch (dbErr) {
      console.error(`Error updating race ${code} status in database:`, dbErr);
    }
    
    // Get final race results (optional, mainly for logging or final checks)
    let finalResults = [];
    try {
      finalResults = await RaceModel.getResults(race.id);
      console.log(`Retrieved ${finalResults.length} final results for ended race ${code}`);
    } catch (dbErr) {
      console.error(`Error getting final results for race ${code}:`, dbErr);
    }
    
    // Broadcast race end signal (without results payload)
    io.to(code).emit('race:end'); 
    console.log(`Broadcasted race end signal for ${code}`);

  } catch (err) {
    console.error('Error ending race:', err);
  }
};

module.exports = {
  initialize
};