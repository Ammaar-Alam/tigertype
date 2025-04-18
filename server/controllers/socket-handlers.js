/**
 * Socket.IO event handlers for TigerType
 */

const SnippetModel = require('../models/snippet');
const RaceModel = require('../models/race');
const UserModel = require('../models/user');
const { insertTimedResult, getTimedLeaderboard, recordPartialSession } = require('../db');
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
// Get player data for client, including avatar URL and basic stats
const getPlayerClientData = async (player) => { // Make async
  // Use cached avatar if available, otherwise use null
  const avatar_url = playerAvatars.get(player.id) || null;
  let avg_wpm = null;

  // Fetch basic stats if userId is available
  if (player.userId) {
    try {
      // Fetch only avg_wpm for efficiency
      const userStats = await UserModel.findById(player.userId, ['avg_wpm']);
      if (userStats && userStats.avg_wpm !== null) { // Check if avg_wpm exists
        // Parse the value, defaulting to 0 if null/undefined or NaN
        const parsedWpm = parseFloat(userStats.avg_wpm);
        avg_wpm = isNaN(parsedWpm) ? 0 : parsedWpm;
      } else {
         avg_wpm = 0; // Default to 0 if user not found or no stats
      }
    } catch (err) {
      console.error(`Error fetching stats for ${player.netid}:`, err);
      avg_wpm = 0; // Default to 0 on error
    }
  } else {
     avg_wpm = 0; // Default to 0 if no userId
  }


  return {
    netid: player.netid,
    ready: player.ready,
    avatar_url,
    avg_wpm // Include avg_wpm
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

// Helper function to leave the current race a socket might be in
const leaveCurrentRace = async (io, socket, netid) => {
  let leftRaceCode = null;
  for (const [code, players] of racePlayers.entries()) {
    const playerIndex = players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      leftRaceCode = code;
      console.log(`User ${netid} leaving previous race ${code}`);
      socket.leave(code); // Leave socket room

      const player = players[playerIndex];
      const race = activeRaces.get(code);

      // Remove player from memory
      players.splice(playerIndex, 1);

      // Remove from DB if applicable
      if (race && race.type !== 'practice' && player.userId) {
        try {
          await RaceModel.removePlayerFromLobby(race.id, player.userId);
        } catch (dbErr) {
          console.error(`Error removing user ${netid} from lobby_players table on leave:`, dbErr);
        }
      }

      // Clean up race if empty, otherwise notify others
      if (players.length === 0) {
        racePlayers.delete(code);
        activeRaces.delete(code);
        console.log(`Cleaned up empty race ${code}`);
      } else {
        racePlayers.set(code, players);
        // Update player list asynchronously
        try {
            const clientPlayers = await Promise.all(players.map(p => getPlayerClientData(p)));
            io.to(code).emit('race:playersUpdate', { players: clientPlayers });
            io.to(code).emit('race:playerLeft', { netid });
        } catch (err) {
            console.error(`Error preparing client data after leave in ${code}:`, err);
        }
        // TODO: Handle host leaving a private lobby
      }
      break; // Assume player is only in one race
    }
  }
  return leftRaceCode; // Return the code of the race left, if any
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
      const { user: netid, userId } = socket.userInfo; // Get user info
      try {
        console.log(`User ${netid} joining practice mode with options:`, options);

        // Leave any existing race first
        await leaveCurrentRace(io, socket, netid);

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
          // No players array needed for practice mode join confirmation
        });
      } catch (err) {
        console.error('Error joining practice:', err);
        socket.emit('error', { message: 'Failed to join practice mode' });
      }
    });

    // Handle joining public lobby
    socket.on('public:join', async () => {
      const { user: netid, userId } = socket.userInfo; // Get user info
      try {
        console.log(`User ${netid} joining public lobby`);

        // Leave any existing race first
        await leaveCurrentRace(io, socket, netid);

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

        // Send race info to player (needs async handling)
        const clientPlayersPublicJoin = await Promise.all(players.map(p => getPlayerClientData(p)));
        const race = activeRaces.get(lobby.code);
        socket.emit('race:joined', {
          code: lobby.code,
          type: 'public',
          lobbyId: lobby.id,
          snippet: {
            id: race.snippet.id,
            text: race.snippet.text
          },
          players: clientPlayersPublicJoin // Use resolved data
        });

        // Broadcast updated player list to all in the lobby
        io.to(lobby.code).emit('race:playersUpdate', {
          players: clientPlayersPublicJoin // Use resolved data
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

    // --- Private Lobby Handlers ---

    // Handle creating a private lobby
    socket.on('private:create', async (options = {}, callback) => {
      const { user: netid, userId } = socket.userInfo;
      try {
        console.log(`User ${netid} creating private lobby with options:`, options);

        // Leave any existing race first
        await leaveCurrentRace(io, socket, netid);

        // Determine snippet ID (can be null for timed tests)
        let snippetId = null;
        let snippet = null;
        if (options.testMode === 'timed' && options.testDuration) {
          // Create a timed test snippet (virtual, not stored in DB)
          const duration = parseInt(options.testDuration) || 30;
          snippet = createTimedTestSnippet(duration);
          // snippetId remains null for timed tests in practice/private
        } else {
          // Get a snippet based on filters or random
          // TODO: Implement snippet filtering based on options.snippetFilters
          snippet = await SnippetModel.getRandom(); // Using random for now
          if (!snippet) throw new Error('Failed to load snippet');
          snippetId = snippet.id;
        }

        // Create the private lobby in the database, associating the host
        const lobby = await RaceModel.create('private', snippetId, userId);
        console.log(`Created private lobby ${lobby.code} hosted by ${netid}`);

        // Join the socket room
        socket.join(lobby.code);

        // Add host player to the lobby in memory
        const hostPlayer = {
          id: socket.id,
          netid,
          userId,
          ready: true, // Host is implicitly ready
          lobbyId: lobby.id,
          snippetId: snippetId // Store snippetId used
        };
        racePlayers.set(lobby.code, [hostPlayer]);

        // Add host to lobby_players table
        try {
          await RaceModel.addPlayerToLobby(lobby.id, userId, true);
        } catch (dbErr) {
          console.error(`Error adding host ${netid} to lobby_players table:`, dbErr);
          // If DB fails, rollback memory state? For now, log and continue.
        }

        // Store active race info
        activeRaces.set(lobby.code, {
          id: lobby.id,
          code: lobby.code,
          snippet: { // Store full snippet info
            id: snippet?.id, // Use optional chaining as timed snippet has no DB id
            text: snippet.text,
            is_timed_test: snippet.is_timed_test || false,
            duration: snippet.duration || null
          },
          status: 'waiting',
          type: 'private',
          hostId: userId, // Store host ID
          hostNetId: netid, // Store host NetID
          startTime: null,
          settings: { // Store initial settings
            testMode: options.testMode || 'snippet',
            testDuration: options.testDuration || 15,
            // snippetFilters: options.snippetFilters || { difficulty: 'all', type: 'all', department: 'all' }
          }
        });

        // Fetch avatar for the host
        await fetchUserAvatar(userId, socket.id);

        // Send race info back to the host (needs async handling for player data)
        const hostClientDataCreate = await getPlayerClientData(hostPlayer); // Renamed variable
        const joinedDataCreate = { // Renamed variable
          code: lobby.code,
          type: 'private',
          lobbyId: lobby.id,
          hostNetId: netid, // Include host netid
          snippet: activeRaces.get(lobby.code).snippet,
          settings: activeRaces.get(lobby.code).settings,
          players: [hostClientDataCreate] // Use renamed variable
        };
        socket.emit('race:joined', joinedDataCreate); // Use renamed variable

        // Optional: Use callback for confirmation
        if (callback) callback({ success: true, lobby: joinedDataCreate }); // Use renamed variable

      } catch (err) {
        console.error(`Error creating private lobby for ${netid}:`, err);
        socket.emit('error', { message: err.message || 'Failed to create private lobby' });
        if (callback) callback({ success: false, error: err.message || 'Failed to create private lobby' });
      }
    });

    // Handle joining a private lobby
    socket.on('private:join', async (data, callback) => {
      const { user: netid, userId } = socket.userInfo;
      const { code, hostNetId, playerNetId } = data; // Can join by code, host netId, or any player's netId

      try {
        console.log(`User ${netid} attempting to join private lobby via:`, data);

        // Leave any existing race first
        await leaveCurrentRace(io, socket, netid);

        let lobby;
        if (code) {
          lobby = await RaceModel.findByCode(code);
        } else if (hostNetId) {
          lobby = await RaceModel.findByHostNetId(hostNetId);
        } else if (playerNetId) {
          lobby = await RaceModel.findByPlayerNetId(playerNetId);
        } else {
          throw new Error('Lobby code or NetID required to join.');
        }

        if (!lobby || lobby.type !== 'private') {
          throw new Error('Private lobby not found.');
        }

        if (lobby.status !== 'waiting') {
          throw new Error('Lobby is already in progress or finished.');
        }

        // Check if lobby is full (using DB check within addPlayerToLobby)
        try {
          await RaceModel.addPlayerToLobby(lobby.id, userId, false);
        } catch (err) {
          if (err.message === 'Lobby is full.') {
             throw new Error('Lobby is full (max 10 players).');
          }
          // Re-throw other DB errors
          throw err;
        }

        // Join the socket room
        socket.join(lobby.code);

        // Add player to in-memory list
        const players = racePlayers.get(lobby.code) || [];
        const newPlayer = {
          id: socket.id,
          netid,
          userId,
          ready: false,
          lobbyId: lobby.id,
          snippetId: lobby.snippet_id // Get snippetId from lobby data
        };
        players.push(newPlayer);
        racePlayers.set(lobby.code, players);

        // Ensure active race exists in memory (might happen if server restarted)
        if (!activeRaces.has(lobby.code)) {
           console.warn(`Lobby ${lobby.code} exists in DB but not memory, re-initializing.`);
           // Fetch full lobby details including snippet text
           const fullLobby = await RaceModel.getLobbyWithHost(lobby.id);
           if (!fullLobby) throw new Error('Failed to re-initialize lobby data.');

           activeRaces.set(lobby.code, {
             id: fullLobby.id,
             code: fullLobby.code,
             snippet: {
               id: fullLobby.snippet_id,
               text: fullLobby.snippet_text,
               // Assuming private lobbies don't start with timed tests unless explicitly set later
               is_timed_test: false,
               duration: null
             },
             status: fullLobby.status,
             type: 'private',
             hostId: fullLobby.host_id,
             hostNetId: fullLobby.host_netid,
             startTime: null,
             settings: { /* TODO: Load settings if stored */ }
           });
        }
        const raceInfo = activeRaces.get(lobby.code);

        // Fetch avatar for the joining player
        await fetchUserAvatar(userId, socket.id);

        // Send race info to the joining player (needs async handling)
        const currentPlayersClientDataJoin = await Promise.all(players.map(p => getPlayerClientData(p)));
        const joinedDataJoin = { // Renamed variable
          code: lobby.code,
          type: 'private',
          lobbyId: lobby.id,
          hostNetId: raceInfo.hostNetId,
          snippet: raceInfo.snippet,
          settings: raceInfo.settings,
          players: currentPlayersClientDataJoin // Use resolved data
        };
        socket.emit('race:joined', joinedDataJoin); // Use renamed variable

        // Broadcast updated player list to all in the lobby
        io.to(lobby.code).emit('race:playersUpdate', {
          players: currentPlayersClientDataJoin // Use resolved data
        });

        // Optional: Use callback for confirmation
        if (callback) callback({ success: true, lobby: joinedDataJoin }); // Use renamed variable

      } catch (err) {
        console.error(`Error joining private lobby for ${netid}:`, err);
        socket.emit('error', { message: err.message || 'Failed to join private lobby' });
        if (callback) callback({ success: false, error: err.message || 'Failed to join private lobby' });
      }
    });

    // Handle kicking a player (host only)
    socket.on('lobby:kick', async (data, callback) => {
       const { user: hostNetid, userId: hostUserId } = socket.userInfo;
       const { targetNetId, code } = data;

       try {
         console.log(`Host ${hostNetid} attempting to kick ${targetNetId} from lobby ${code}`);
         const race = activeRaces.get(code);
         const players = racePlayers.get(code);

         if (!race || !players || race.type !== 'private') {
           throw new Error('Lobby not found or not private.');
         }

         // Check if emitter is the host
         if (race.hostId !== hostUserId) {
           throw new Error('Only the host can kick players.');
         }

         const targetPlayerIndex = players.findIndex(p => p.netid === targetNetId);
         if (targetPlayerIndex === -1) {
           throw new Error('Player not found in lobby.');
         }

         const targetPlayer = players[targetPlayerIndex];
         if (targetPlayer.userId === hostUserId) {
           throw new Error('Host cannot kick themselves.');
         }

         // Remove player from memory
         players.splice(targetPlayerIndex, 1);
         racePlayers.set(code, players);

         // Remove player from DB
         try {
           await RaceModel.removePlayerFromLobby(race.id, targetPlayer.userId);
         } catch (dbErr) {
           console.error(`Error removing kicked player ${targetNetId} from DB:`, dbErr);
           // Continue anyway, memory state is updated
         }

         // Notify the kicked player
         const targetSocket = io.sockets.sockets.get(targetPlayer.id);
         if (targetSocket) {
           targetSocket.emit('lobby:kicked', { reason: `Kicked by host ${hostNetid}` });
           targetSocket.leave(code); // Force leave the room
         }

         // Notify remaining players (needs async handling)
         const remainingPlayersClientDataKick = await Promise.all(players.map(p => getPlayerClientData(p)));
         io.to(code).emit('race:playersUpdate', {
           players: remainingPlayersClientDataKick
         });
         io.to(code).emit('race:playerLeft', { netid: targetNetId, reason: 'kicked' });

         console.log(`Player ${targetNetId} kicked from lobby ${code} by host ${hostNetid}`);
         if (callback) callback({ success: true });

       } catch (err) {
         console.error(`Error kicking player ${targetNetId} from ${code}:`, err);
         socket.emit('error', { message: err.message || 'Failed to kick player' });
         if (callback) callback({ success: false, error: err.message || 'Failed to kick player' });
       }
    });

    // Handle updating lobby settings (host only)
    socket.on('lobby:updateSettings', async (data, callback) => {
      const { user: hostNetid, userId: hostUserId } = socket.userInfo;
      const { code, settings } = data; // settings = { testMode, testDuration, snippetId? }

      try {
        console.log(`Host ${hostNetid} updating settings for lobby ${code}:`, settings);
        const race = activeRaces.get(code);

        if (!race || race.type !== 'private') {
          throw new Error('Lobby not found or not private.');
        }

        if (race.hostId !== hostUserId) {
          throw new Error('Only the host can change settings.');
        }

        if (race.status !== 'waiting') {
          throw new Error('Cannot change settings after race has started.');
        }

        // --- Update Snippet if necessary ---
        let newSnippet = race.snippet;
        let snippetChanged = false;

        // If snippetId is explicitly provided (user selected a specific snippet)
        if (settings.snippetId && settings.snippetId !== race.snippet?.id) {
          const dbSnippet = await SnippetModel.findById(settings.snippetId);
          if (!dbSnippet) throw new Error('Selected snippet not found.');
          newSnippet = {
            id: dbSnippet.id,
            text: dbSnippet.text,
            is_timed_test: false, // Assume regular snippet
            duration: null
          };
          snippetChanged = true;
        }
        // If mode changed to timed OR duration changed while already in timed mode
        else if (
          (settings.testMode === 'timed' && (race.settings.testMode !== 'timed' || settings.testDuration !== race.settings.testDuration)) ||
          // When only the duration is provided (without testMode) but we are already in timed mode
          (typeof settings.testMode === 'undefined' && typeof settings.testDuration !== 'undefined' && race.settings.testMode === 'timed' && settings.testDuration !== race.settings.testDuration)
        ) {
          const duration = parseInt(settings.testDuration) || parseInt(race.settings.testDuration) || 30;
          newSnippet = createTimedTestSnippet(duration);
          snippetChanged = true;
          // Ensure race.settings will reflect timed mode even if testMode was omitted
          settings.testMode = 'timed';
        }
        // If mode changed back to snippet from timed
        else if (settings.testMode === 'snippet' && race.settings.testMode === 'timed') {
          // Load a new random snippet (or based on filters if implemented)
          const randomSnippet = await SnippetModel.getRandom();
          if (!randomSnippet) throw new Error('Failed to load snippet for snippet mode.');
          newSnippet = {
            id: randomSnippet.id,
            text: randomSnippet.text,
            is_timed_test: false,
            duration: null
          };
          snippetChanged = true;
        }

        // Update race state in memory
        race.settings = { ...race.settings, ...settings }; // Update settings
        if (snippetChanged) {
          race.snippet = newSnippet; // Update snippet
        }
        activeRaces.set(code, race);

        // Update settings in DB (currently only snippet_id is supported by model)
        if (snippetChanged && newSnippet.id) { // Only update DB if it's a DB snippet
          try {
            await RaceModel.updateSettings(race.id, { snippet_id: newSnippet.id });
          } catch (dbErr) {
            console.error(`Error updating snippet_id in DB for lobby ${code}:`, dbErr);
            // Log and continue, memory state is updated
          }
        }

        // Broadcast updated settings and potentially new snippet to all players
        io.to(code).emit('lobby:settingsUpdated', {
           settings: race.settings,
           snippet: race.snippet // Send the potentially new snippet
        });

        console.log(`Lobby ${code} settings updated by host ${hostNetid}`);
        if (callback) callback({ success: true, settings: race.settings, snippet: race.snippet });

      } catch (err) {
        console.error(`Error updating settings for lobby ${code}:`, err);
        socket.emit('error', { message: err.message || 'Failed to update settings' });
        if (callback) callback({ success: false, error: err.message || 'Failed to update settings' });
      }
    });

     // Handle starting the race (host only)
    socket.on('lobby:startRace', async (data, callback) => {
      const { user: hostNetid, userId: hostUserId } = socket.userInfo;
      const { code } = data;

      try {
        console.log(`Host ${hostNetid} attempting to start race for lobby ${code}`);
        const race = activeRaces.get(code);
        const players = racePlayers.get(code);

        if (!race || !players || race.type !== 'private') {
          throw new Error('Lobby not found or not private.');
        }

        if (race.hostId !== hostUserId) {
          throw new Error('Only the host can start the race.');
        }

        if (race.status !== 'waiting') {
           throw new Error('Race cannot be started.');
         }

         // --- Minimum Player Check ---
         if (players.length < 2) {
           // Allow host to start alone for testing/specific scenarios? For now, require 2.
           // If allowing 1 player: if (players.length < 1) ...
           throw new Error('At least two players are required to start the race.');
         }
         // --- End Minimum Player Check ---

         // Optional: Check if all players are ready? Or allow host to force start?
         // For now, allow host to start regardless of readiness.
         // const allReady = players.every(p => p.ready);
        // if (!allReady) {
        //   throw new Error('Not all players are ready.');
        // }

        // Start the countdown (using the standard 5-second countdown)
        await startCountdown(io, code);

        console.log(`Race ${code} countdown initiated by host ${hostNetid}`);
        if (callback) callback({ success: true });

      } catch (err) {
        console.error(`Error starting race for lobby ${code}:`, err);
        socket.emit('error', { message: err.message || 'Failed to start race' });
        if (callback) callback({ success: false, error: err.message || 'Failed to start race' });
      }
    });

    // --- End Private Lobby Handlers ---
    
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
            
            // Broadcast updated player list (needs async handling)
            const currentPlayersClientDataReady = await Promise.all(players.map(p => getPlayerClientData(p)));
            io.to(code).emit('race:playersUpdate', {
              players: currentPlayersClientDataReady
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

        // Retrieve race and player info
        const players = racePlayers.get(code);
        const player = players?.find(p => p.id === socket.id);
        const race = activeRaces.get(code);
        // Skip base stat updates for private lobbies
        const isPrivate = race?.type === 'private';
        
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
          
          // Update base stats only for non-private lobbies
          try {
            if (!isPrivate) {
              await UserModel.updateStats(userId, wpm, accuracy, true);
              await UserModel.updateFastestWpm(userId, wpm);
              console.log(`[DEBUG race:result] Updated user stats for ${netid}`);
            }
          } catch (statsError) {
            console.error(`[ERROR race:result] Failed to update user stats for ${userId} after timed result:`, statsError);
          }

        } else if (snippetId) {
           // --- BEGIN DEBUG LOGGING --- 
           console.log(`[DEBUG race:result] Processing as REGULAR race. Snippet ID: ${snippetId}`);
           console.log(`[DEBUG race:result] Calling RaceModel.recordResult with: userId=${userId}, lobbyId=${lobbyId}, snippetId=${snippetId}, wpm=${wpm}, accuracy=${accuracy}, completion_time=${completion_time}`);
          // --- END DEBUG LOGGING ---
          // Regular race result, save to race_results table
          try {
            await RaceModel.recordResult(userId, lobbyId, snippetId, wpm, accuracy, completion_time);
            console.log(`[SUCCESS race:result] Saved regular race result for ${netid} (lobby: ${lobbyId}, snippet: ${snippetId})`);
          } catch (dbError) {
             console.error(`[ERROR race:result] Failed to insert regular race result for user ${userId}:`, dbError);
          }
          
          // Update base stats only for non-private lobbies
          try {
            if (!isPrivate) {
              await UserModel.updateStats(userId, wpm, accuracy, false);
              await UserModel.updateFastestWpm(userId, wpm);
              console.log(`[DEBUG race:result] Updated user stats for ${netid}`);
            }
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
            created_at: new Date(entry.created_at).toISOString(),
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

          // --- Handle Host Disconnecting from Private Lobby ---
          if (race && race.type === 'private' && race.hostId === player.userId) {
            console.log(`Host ${netid} disconnected from private lobby ${code}. Attempting host reassignment.`);

            // Remove host player from list (already about to be removed below as part of splice, but ensure)
            // players.splice(playerIndex, 1);  // will be executed after this block

            // Filter out the disconnecting host to derive remaining players
            const remainingPlayers = players.filter(p => p.id !== socket.id);

            if (remainingPlayers.length === 0) {
              // No one left – terminate lobby as before
              console.log(`No players left in lobby ${code} after host disconnect. Terminating lobby.`);

              socket.to(code).emit('lobby:terminated', { reason: 'Lobby empty after host disconnected.' });

              // Clean up memory structures
              racePlayers.delete(code);
              activeRaces.delete(code);

              // Soft‑terminate in DB for consistency (best‑effort)
              try {
                await RaceModel.softTerminate(race.id);
              } catch (e) {
                console.error(`Error soft‑terminating lobby ${code}:`, e);
              }

              continue; // Done with this lobby
            }

            // Choose the oldest remaining player (index 0 after filtering) as new host
            const newHost = remainingPlayers[0];

            race.hostId = newHost.userId;
            race.hostNetId = newHost.netid;
            activeRaces.set(code, race);

            // Persist new host in DB (best‑effort)
            try {
              await RaceModel.reassignHost(race.id, newHost.userId);
            } catch (e) {
              console.error(`Failed to reassign host in DB for lobby ${code}:`, e);
            }

            // Inform clients in the lobby
            io.to(code).emit('lobby:newHost', { newHostNetId: newHost.netid });

            console.log(`Reassigned host of lobby ${code} to ${newHost.netid}`);
            // Continue with standard disconnect handling (player list has been adjusted already below)
          }
          // --- End Host Disconnect Handling ---


          // --- Standard Player Disconnect Logic ---
          console.log(`Standard disconnect for player ${netid} in race ${code}`);

          // Clear any inactivity timers for this player
          clearInactivityTimers(code, socket.id);

          // Remove player from race in memory
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
          
          // Broadcast updated player list (needs async handling)
          const remainingPlayersClientDataDisc = await Promise.all(players.map(p => getPlayerClientData(p)));
          io.to(code).emit('race:playersUpdate', {
            players: remainingPlayersClientDataDisc
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

    // Handle player canceling a race (pressing TAB to restart)
    socket.on('race:cancel', async (progressData) => {
      const { user: netid, userId } = socket.userInfo;
      console.log(`User ${netid} canceled race with progress:`, progressData);
      
      try {
        // Find the race the player is in
        let raceCode = null;
        let sessionType = 'snippet'; // Default
        let isTimed = false;
        
        for (const [code, players] of racePlayers.entries()) {
          const playerInRace = players.find(p => p.id === socket.id);
          if (playerInRace) {
            raceCode = code;
            
            // Check if this is a timed test
            const race = activeRaces.get(code);
            if (race && race.snippet && race.snippet.is_timed_test) {
              sessionType = 'timed';
              isTimed = true;
            }
            
            break;
          }
        }
        
        if (!raceCode) {
          console.log(`User ${netid} not found in any race, can't record partial session`);
          return;
        }
        
        // Calculate words and characters typed from progress data
        if (progressData && progressData.typedLength) {
          const charactersTyped = progressData.typedLength || 0;
          
          // Estimate words typed (using the common average of 5 characters per word)
          const avgCharsPerWord = 5;
          const wordsTyped = Math.max(0, Math.floor(charactersTyped / avgCharsPerWord));
          
          // Record partial session data
          await recordPartialSession(
            userId, 
            sessionType, 
            wordsTyped, 
            charactersTyped
          );
          
          console.log(`Recorded partial session for user ${netid}: ${wordsTyped} words, ${charactersTyped} characters`);
        }
      } catch (err) {
        console.error(`Error recording partial session for user ${netid}:`, err);
      }
    });
  });
};

// Check if all players are ready and start countdown if appropriate (for PUBLIC lobbies only)
const checkAndStartCountdown = (io, code) => {
  const players = racePlayers.get(code);
  const race = activeRaces.get(code);

  // Only proceed for PUBLIC lobbies in waiting status
  if (!race || race.status !== 'waiting' || race.type !== 'public') {
    if (race && race.type === 'private') {
      console.log(`Race ${code} is private, host must start manually.`);
    } else {
      console.log(`Race ${code} cannot start countdown (status: ${race?.status}, type: ${race?.type})`);
    }
    return;
  }

  // Need at least 2 players for public races
  if (!players || players.length < 2) {
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
    io.to(code).emit('race:countdown', { seconds: 3, code });
    
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
    io.to(code).emit('race:countdown', { seconds: 5, code });
    
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
    const kickTimer = setTimeout(async () => { // Make the callback async
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
      
      // Notify other players (needs async handling)
      const updatedPlayersClientDataKick = await Promise.all(updatedPlayers.map(p => getPlayerClientData(p)));
      io.to(code).emit('race:playersUpdate', {
        players: updatedPlayersClientDataKick
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
