/**
 * Socket.IO event handlers for TigerType
 */

const SnippetModel = require('../models/snippet');
const RaceModel = require('../models/race');
const UserModel = require('../models/user');
const { insertTimedResult, getTimedLeaderboard } = require('../db');
const analytics = require('../utils/analytics');
const { createTimedTestSnippet, generateTimedText } = require('../utils/timed-test');

// Store active races in memory
const activeRaces = new Map();
// Store players in each race
const racePlayers = new Map();
// Store player progress
const playerProgress = new Map();

// Throttle progress updates to avoid spamming
const PROGRESS_THROTTLE = 100; // ms
const lastProgressUpdate = new Map();

// Inactivity warning and timeout settings
const INACTIVITY_WARNING_DELAY = 60000; // 60 seconds before warning
const INACTIVITY_KICK_DELAY = 30000; // 30 seconds before kick (45 seconds total)
const inactivityTimers = new Map(); // Store timers for inactivity warnings and kicks

// Store user avatar URLs for quicker lookup
const playerAvatars = new Map(); // socketId -> avatar_url

// Helper functions
// Get player data for client, including avatar URL
const getPlayerClientData = (player) => {
  // Use cached avatar if available, otherwise use null (default avatar will be used)
  const avatar_url = playerAvatars.get(player.id) || null;
  return { 
    netid: player.netid, 
    ready: player.ready,
    avatar_url
  };
};

// Fetch user avatar URL from database
const fetchUserAvatar = async (userId, socketId) => {
  try {
    if (!userId) {
      console.log(`Cannot fetch avatar: No userId provided for socketId ${socketId}`);
      return;
    }
    
    const user = await UserModel.findById(userId);
    if (user && user.avatar_url) {
      console.log(`Successfully fetched avatar for user ${userId} (socket ${socketId}): ${user.avatar_url}`);
      playerAvatars.set(socketId, user.avatar_url);
    } else {
      console.log(`No avatar found for user ${userId} (socket ${socketId})`);
      // Set to null explicitly to indicate we checked but found no avatar
      playerAvatars.set(socketId, null);
    }
  } catch (err) {
    console.error(`Error fetching avatar for user ${userId} (socket ${socketId}):`, err);
  }
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
    
    // If no netid, log error but try continuing
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
    
    // Fetch user avatar when connecting
    if (userId) {
      fetchUserAvatar(userId, socket.id);
    } else {
      console.log(`No userId available for fetching avatar: ${netid} (${socket.id})`);
    }
    
    // Emit welcome event with user info
    socket.emit('connected', {
      id: socket.id,
      netid: netid || socket.userInfo?.user || 'unknown-user'
    });
    
    // Handle joining practice mode
    socket.on('practice:join', async (options = {}) => {
      try {
        console.log(`User ${netid} joining practice mode with options:`, options);
        
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
                players: updatedPlayers.map(p => getPlayerClientData(p))
              });
              
              // Broadcast player left message
              io.to(code).emit('race:playerLeft', { netid });
            }
          }
        }
        
        let snippet;
        let lobby;
        
        // Handle timed test mode
        if (options.testMode === 'timed' && options.testDuration) {
          // Create a timed test snippet
          const duration = parseInt(options.testDuration) || 30;
          snippet = createTimedTestSnippet(duration);
          
          // Since this is a virtual snippet, create a practice lobby without a snippet ID
          lobby = await RaceModel.create('practice', null);
          
          console.log(`Created timed test (${duration}s) for practice mode`);
        } else {
          // Standard snippet mode - get a random snippet from database
          snippet = await SnippetModel.getRandom();
          
          if (!snippet) {
            console.error('Failed to load snippet for practice mode');
            socket.emit('error', { message: 'Failed to load snippet' });
            return;
          }
          
          console.log(`Loaded snippet ID ${snippet.id} for practice mode`);
          
          // Create a practice lobby
          lobby = await RaceModel.create('practice', snippet.id);
        }
        
        console.log(`Created practice lobby with code ${lobby.code}`);
        
        // Join the socket room
        socket.join(lobby.code);
        
        // Add player to race
        racePlayers.set(lobby.code, [{
          id: socket.id,
          netid,
          userId,
          ready: true,
          lobbyId: lobby.id,
          snippetId: snippet.id
        }]);
        
        // Active race info
        activeRaces.set(lobby.code, {
          id: lobby.id,
          code: lobby.code,
          snippet: {
            id: snippet.id,
            text: snippet.text,
            is_timed_test: snippet.is_timed_test || false,
            duration: snippet.duration || null
          },
          status: 'waiting',
          type: 'practice',
          startTime: null
        });
        
        // Send race info to player
        socket.emit('race:joined', {
          code: lobby.code,
          type: 'practice',
          lobbyId: lobby.id,
          snippet: {
            id: snippet.id,
            text: snippet.text,
            is_timed_test: snippet.is_timed_test || false,
            duration: snippet.duration || null
          }
        });
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
                players: updatedPlayers.map(p => getPlayerClientData(p))
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
        
        // Add the player to the lobby_players table for public matches
        try {
          await RaceModel.addPlayerToLobby(raceInfo.id, userId, false);
          console.log(`Added user ${netid} to lobby_players table for lobby ${lobby.code}`);
        } catch (dbErr) {
          console.error(`Error adding user ${netid} to lobby_players table:`, dbErr);
          // Continue anyway; in-memory state is already updated
        }
        
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
          players: players.map(p => getPlayerClientData(p))
        });
        
        // Broadcast updated player list to all in the lobby
        io.to(lobby.code).emit('race:playersUpdate', {
          players: players.map(p => getPlayerClientData(p))
        });
        
        // Check for inactive players
        checkForInactivePlayers(io, lobby.code);
        
        // If all players are ready (2+), start countdown
        checkAndStartCountdown(io, lobby.code);
      } catch (err) {
        console.error('Error joining public lobby:', err);
        socket.emit('error', { message: 'Failed to join public lobby' });
      }
    });
    
    // Handle player ready status
    socket.on('player:ready', async () => {
      try {
        console.log(`User ${netid} is ready`);
        
        // Find the race this player is in
        for (const [code, players] of racePlayers.entries()) {
          const playerIndex = players.findIndex(p => p.id === socket.id);
          
          if (playerIndex !== -1) {
            console.log(`Found user ${netid} in race ${code}, marking as ready`);
            
            // Clear any inactivity timers for this player
            clearInactivityTimers(code, socket.id);
            
            // Mark player as ready
            players[playerIndex].ready = true;
            racePlayers.set(code, players);
            
            // Update player ready status in database for non-practice lobbies
            const race = activeRaces.get(code);
            if (race && race.type !== 'practice') {
              try {
                await RaceModel.updatePlayerReadyStatus(race.id, userId, true);
                console.log(`Updated ready status in database for user ${netid} in lobby ${code}`);
              } catch (dbErr) {
                console.error(`Error updating ready status in database for user ${netid}:`, dbErr);
                // Continue anyway as the in-memory state is already updated
              }
            }
            
            // Broadcast updated player list
            io.to(code).emit('race:playersUpdate', {
              players: players.map(p => getPlayerClientData(p))
            });
            
            // Check for inactive players
            checkForInactivePlayers(io, code);
            
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
        // Client sends { position, total, isCompleted }
        const { code, position, isCompleted } = data; 
        
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

        // Allow immediate update if player just completed the race
        if (now - lastUpdate < PROGRESS_THROTTLE && !isCompleted) {
          return;
        }
        
        lastProgressUpdate.set(socket.id, now);
        
        // Validate the progress (ensure position is not negative or excessively large)
        const snippetLength = race.snippet.text.length;
        if (position < 0 || position > snippetLength) {
          console.warn(`Invalid position from ${netid}: ${position}, snippet length: ${snippetLength}`);
          return;
        }
        
        // Store player progress, using the client-provided completion status
        playerProgress.set(socket.id, {
          position,
          completed: isCompleted, // Use the client-provided completion status
          timestamp: now
        });
        
        // Calculate completion percentage 
        const percentage = Math.min(100, Math.floor((position / snippetLength) * 100));
        
        // Broadcast progress to all players in the race
        io.to(code).emit('race:playerProgress', {
          netid,
          position,
          percentage,
          completed: isCompleted // Use the client-provided completion status
        });
        
        // Handle race completion for this player if they just completed
        if (isCompleted) {
          console.log(`User ${netid} has completed the race in lobby ${code} based on progress update`);
          // Ensure finish handler isn't called multiple times if progress updates arrive late
          const progressData = playerProgress.get(socket.id);
          if (progressData && !progressData.finishHandled) {
             progressData.finishHandled = true; // Mark finish as handled
             playerProgress.set(socket.id, progressData);
             handlePlayerFinish(io, code, socket.id, progressData).catch(err => {
               console.error('Error handling player finish:', err);
             });
          }
        }
      } catch (err) {
        console.error('Error updating progress:', err);
      }
    });
    
    // Handle race result submission
    socket.on('race:result', async (data) => {
      try {
        const { code, lobbyId, snippetId, wpm, accuracy, completion_time } = data;
        const { user: netid, userId } = socket.userInfo;

        // --- BEGIN DEBUG LOGGING --- 
        console.log(`[DEBUG race:result] Received data:`, JSON.stringify(data));
        console.log(`[DEBUG race:result] User info: netid=${netid}, userId=${userId}`);
        // --- END DEBUG LOGGING ---

        if (!userId) {
          console.error(`[ERROR race:result] Cannot record result: No userId for socket ${socket.id} (netid: ${netid})`);
          return;
        }

        console.log(`Received result from ${netid}: WPM ${wpm}, Acc ${accuracy}, Time ${completion_time}`);

        // Check if the player is in the specified race
        const players = racePlayers.get(code);
        const player = players?.find(p => p.id === socket.id);
        const race = activeRaces.get(code);
        
        // --- BEGIN DEBUG LOGGING --- 
        console.log(`[DEBUG race:result] Found player: ${!!player}, Found race: ${!!race}`);
        if (race) {
          console.log(`[DEBUG race:result] Race snippet info: is_timed=${race.snippet?.is_timed_test}, duration=${race.snippet?.duration}`);
        }
        // --- END DEBUG LOGGING ---

        if (!player || !race) {
          console.warn(`[WARN race:result] Received result for race ${code}, but player ${netid} or race not found`);
          return;
        }

        // Check if the result is for a timed test
        if (race.snippet?.is_timed_test && race.snippet?.duration) {
          const duration = race.snippet.duration;
          // --- BEGIN DEBUG LOGGING --- 
          console.log(`[DEBUG race:result] Processing as TIMED test. Duration: ${duration}`);
          console.log(`[DEBUG race:result] Calling insertTimedResult with: userId=${userId}, duration=${duration}, wpm=${wpm}, accuracy=${accuracy}`);
          // --- END DEBUG LOGGING ---
          try {
            await insertTimedResult(userId, duration, wpm, accuracy);
            console.log(`[SUCCESS race:result] Saved timed test result for ${netid} (duration: ${duration})`);
          } catch (dbError) {
            console.error(`[ERROR race:result] Failed to insert timed result for user ${userId}:`, dbError);
            // Optionally emit an error back to client if needed
          }
          
          // Use UserModel correctly for stats updates
          try {
            await UserModel.updateStats(userId, wpm, accuracy, true); 
            await UserModel.updateFastestWpm(userId, wpm); 
            console.log(`[DEBUG race:result] Updated user stats (if applicable) for ${netid}`);
          } catch (statsError) {
             console.error(`[ERROR race:result] Failed to update user stats for ${userId} after timed result:`, statsError);
          }

        } else if (snippetId) {
           // --- BEGIN DEBUG LOGGING --- 
           console.log(`[DEBUG race:result] Processing as REGULAR race. Snippet ID: ${snippetId}`);
           console.log(`[DEBUG race:result] Calling RaceModel.saveResult with: userId=${userId}, lobbyId=${lobbyId}, snippetId=${snippetId}, wpm=${wpm}, accuracy=${accuracy}, completion_time=${completion_time}`);
          // --- END DEBUG LOGGING ---
          // Regular race result, save to race_results table
          try {
            await RaceModel.saveResult(userId, lobbyId, snippetId, wpm, accuracy, completion_time);
            console.log(`[SUCCESS race:result] Saved regular race result for ${netid} (lobby: ${lobbyId}, snippet: ${snippetId})`);
          } catch (dbError) {
             console.error(`[ERROR race:result] Failed to insert regular race result for user ${userId}:`, dbError);
          }
          
          // Use UserModel correctly for stats updates
          try {
            await UserModel.updateStats(userId, wpm, accuracy, false);
            await UserModel.updateFastestWpm(userId, wpm);
             console.log(`[DEBUG race:result] Updated user stats (if applicable) for ${netid}`);
          } catch (statsError) {
             console.error(`[ERROR race:result] Failed to update user stats for ${userId} after regular result:`, statsError);
          }
        } else {
          console.warn(`[WARN race:result] Result from ${netid} for race ${code} has no snippetId and is not a timed test.`);
        }

        // Handle player finish logic (updates progress, checks if race ends)
        // Wrap in try/catch as well
        try {
          await handlePlayerFinish(io, code, socket.id, { wpm, accuracy, completion_time });
          console.log(`[DEBUG race:result] Successfully handled player finish logic for ${netid}`);
        } catch (finishError) {
          console.error(`[ERROR race:result] Error in handlePlayerFinish for ${netid}:`, finishError);
        }

      } catch (err) {
        console.error('[ERROR race:result] General error in handler:', err);
        // Avoid emitting generic error to prevent potential info leak
        // socket.emit('error', { message: 'Failed to save race result' }); 
      }
    });
    
    // Handle fetching timed leaderboard data
    socket.on('leaderboard:timed', async (data, callback) => {
      try {
        const { duration, period = 'alltime' } = data;
        console.log(`Fetching timed leaderboard for duration ${duration}, period ${period}`);

        if (![15, 30, 60, 120].includes(duration) || !['daily', 'alltime'].includes(period)) {
          return callback({ error: 'Invalid parameters for timed leaderboard' });
        }

        const leaderboardData = await getTimedLeaderboard(duration, period);

        // Use UserModel correctly to fetch avatars
        const leaderboardWithAvatars = await Promise.all(leaderboardData.map(async (entry) => {
          const user = await UserModel.findById(entry.user_id);
          return {
            ...entry,
            avatar_url: user?.avatar_url || null
          };
        }));

        callback({ leaderboard: leaderboardWithAvatars });
      } catch (err) {
        console.error('Error fetching timed leaderboard:', err);
        callback({ error: 'Failed to fetch timed leaderboard' });
      }
    });
    
    // Handle requesting more words for timed tests
    socket.on('timed:more_words', (data) => {
      const { code, wordCount = 20 } = data; // Default to 20 words
      const race = activeRaces.get(code);

      if (race && race.snippet && race.snippet.is_timed_test) {
        const newWords = generateTimedText(wordCount, { capitalize: false, punctuation: false });
        const updatedText = race.snippet.text + ' ' + newWords;

        // Update the text in memory
        race.snippet.text = updatedText;

        // Broadcast the updated text to all players in the race
        io.to(code).emit('timed:text_update', {
          code: code,
          text: updatedText
        });
        console.log(`Sent ${wordCount} new words for timed test ${code}`);
      }
    });
    
    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${netid} (${socket.id})`);
      
      // Remove player from all races
      for (const [code, players] of racePlayers.entries()) {
        const playerIndex = players.findIndex(p => p.id === socket.id);
        
        if (playerIndex !== -1) {
          console.log(`Removing user ${netid} from race ${code}`);
          
          // Get player and race information before removing
          const player = players[playerIndex];
          const race = activeRaces.get(code);
          
          // Clear any inactivity timers for this player
          clearInactivityTimers(code, socket.id);
          
          // Remove player from race
          players.splice(playerIndex, 1);
          
          // If race exists and isn't practice mode, remove from db
          if (race && race.type !== 'practice' && player.userId) {
            try {
              await RaceModel.removePlayerFromLobby(race.id, player.userId);
              console.log(`Removed user ${netid} from lobby_players table for lobby ${code}`);
            } catch (dbErr) {
              console.error(`Error removing user ${netid} from lobby_players table:`, dbErr);
            }
          }
          
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
            players: players.map(p => getPlayerClientData(p))
          });
          
          // Broadcast player left message
          io.to(code).emit('race:playerLeft', { netid });
          
          // Check if we should end the race early if all remaining players are finished
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
      
      // Clean up stored avatar
      playerAvatars.delete(socket.id);
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
const handlePlayerFinish = async (io, code, playerId, resultData) => {
  const players = racePlayers.get(code);
  const race = activeRaces.get(code);
  const player = players?.find(p => p.id === playerId);

  if (!player || !race) return; // Player or race not found

  // Update player progress to 100% and mark completed
  const now = Date.now();
  const progress = {
    percentage: 100,
    position: race.snippet?.text?.length || 0, // Assuming full text length
    completed: true,
    timestamp: now,
    wpm: resultData?.wpm,
    accuracy: resultData?.accuracy,
    completion_time: resultData?.completion_time
  };
  playerProgress.set(playerId, progress);
  player.completed = true; // Mark player as completed in the main player list as well

  // Send final progress update for this player
  io.to(code).emit('race:playerProgress', {
    netid: player.netid,
    percentage: progress.percentage,
    position: progress.position,
    completed: progress.completed,
    wpm: progress.wpm,
    accuracy: progress.accuracy,
    completion_time: progress.completion_time,
  });

  // Collect all results from completed players
  const allResults = players
    .filter(p => p.completed && playerProgress.has(p.id))
    .map(p => {
      const prog = playerProgress.get(p.id);
      const avatarUrl = playerAvatars.get(p.id);
      
      // Log avatar status for debugging
      console.log(`Player ${p.netid} avatar status:`, {
        hasAvatar: !!avatarUrl,
        avatarUrl: avatarUrl || 'null'
      });
      
      return {
        netid: p.netid,
        wpm: prog.wpm,
        accuracy: prog.accuracy,
        completion_time: prog.completion_time,
        avatar_url: avatarUrl // Include avatar URL
      };
    })
    .sort((a, b) => a.completion_time - b.completion_time); // Sort by time initially

  // Broadcast updated results list
  io.to(code).emit('race:resultsUpdate', { results: allResults });

  // Check if all players have finished
  if (players.every(p => p.completed)) {
    console.log(`All players finished in race ${code}`);
    await endRace(io, code);
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

// Check if a single player isn't ready when everyone else is ready
const checkForInactivePlayers = (io, code) => {
  const players = racePlayers.get(code);
  if (!players || players.length < 2) {
    return; // Need at least 2 players
  }
  
  const notReadyPlayers = players.filter(p => !p.ready);
  const readyPlayers = players.filter(p => p.ready);
  
  // If only one player isn't ready and at least one other player is ready
  if (notReadyPlayers.length === 1 && readyPlayers.length > 0) {
    const inactivePlayer = notReadyPlayers[0];
    
    // Clear any existing timers for this player in this lobby
    const timerKey = `${code}-${inactivePlayer.id}`;
    if (inactivityTimers.has(timerKey)) {
      const { warningTimer, kickTimer } = inactivityTimers.get(timerKey);
      clearTimeout(warningTimer);
      clearTimeout(kickTimer);
    }
    
    // Set warning timer
    const warningTimer = setTimeout(() => {
      // Send inactivity warning
      io.to(inactivePlayer.id).emit('inactivity:warning', {
        message: 'You will be kicked for inactivity in 45 seconds if you do not ready up.',
        timeRemaining: INACTIVITY_KICK_DELAY / 1000
      });
      console.log(`Sent inactivity warning to ${inactivePlayer.netid} in lobby ${code}`);
    }, INACTIVITY_WARNING_DELAY);
    
    // Set kick timer
    const kickTimer = setTimeout(() => {
      console.log(`Kicking inactive player ${inactivePlayer.netid} from lobby ${code}`);
      
      // Send kick event to the inactive player
      io.to(inactivePlayer.id).emit('inactivity:kicked');
      
      // Clean up player from the race
      const currentPlayers = racePlayers.get(code) || [];
      const updatedPlayers = currentPlayers.filter(p => p.id !== inactivePlayer.id);
      racePlayers.set(code, updatedPlayers);
      
      // Force leave the room
      const socket = io.sockets.sockets.get(inactivePlayer.id);
      if (socket) {
        socket.leave(code);
      }
      
      // Update database if needed (non-practice lobbies)
      const race = activeRaces.get(code);
      if (race && race.type !== 'practice' && inactivePlayer.userId) {
        RaceModel.removePlayerFromLobby(race.id, inactivePlayer.userId)
          .catch(err => console.error(`Error removing inactive player from lobby_players table:`, err));
      }
      
      // Notify other players
      io.to(code).emit('race:playersUpdate', {
        players: updatedPlayers.map(p => getPlayerClientData(p))
      });
      
      // Broadcast player kicked message
      io.to(code).emit('race:playerLeft', { 
        netid: inactivePlayer.netid,
        reason: 'inactivity'
      });
      
      // Clean up timers
      inactivityTimers.delete(timerKey);
      
      // Check if we should start countdown now
      checkAndStartCountdown(io, code);
    }, INACTIVITY_WARNING_DELAY + INACTIVITY_KICK_DELAY);
    
    // Store timers
    inactivityTimers.set(timerKey, { warningTimer, kickTimer });
  }
};

// Clear inactivity timers for a player
const clearInactivityTimers = (code, playerId) => {
  const timerKey = `${code}-${playerId}`;
  if (inactivityTimers.has(timerKey)) {
    const { warningTimer, kickTimer } = inactivityTimers.get(timerKey);
    clearTimeout(warningTimer);
    clearTimeout(kickTimer);
    inactivityTimers.delete(timerKey);
  }
};

module.exports = {
  initialize
};