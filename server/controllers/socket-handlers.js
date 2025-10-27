/**
 * Socket.IO event handlers for TigerType
 */

const SnippetModel = require('../models/snippet');
const RaceModel = require('../models/race');
const UserModel = require('../models/user');
const { insertTimedResult, getTimedLeaderboard, recordPartialSession } = require('../db');
const User = require('../models/user');
const analytics = require('../utils/analytics');
const { createTimedTestSnippet, generateTimedText } = require('../utils/timed-test');
const TrainingModel = require('../models/training');
const { createTrainingSnippet } = require('../utils/training-text');

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
const INACTIVITY_WARNING_DELAY = 10000; // 10 seconds before warning
const INACTIVITY_KICK_DELAY = 15000; // 15 seconds before kick (30 seconds total)
const inactivityTimers = new Map(); // Store timers for inactivity warnings and kicks

// Store user avatar URLs for quicker lookup
const playerAvatars = new Map(); // socketId -> avatar_url

// Store host disconnect timers for private lobbies
const HOST_RECONNECT_GRACE_PERIOD = 15000; // 15 seconds
const hostDisconnectTimers = new Map(); // lobbyCode -> { timer: NodeJS.Timeout, userId: number }
// Store countdown timers for public races to allow aborting countdown
const countdownTimers = new Map(); // lobbyCode -> NodeJS.Timeout

// Helper functions
// Sanitize snippet text to avoid trailing empty lines that block completion
const sanitizeSnippetText = (text) => {
  if (typeof text !== 'string') return text;
  return text.replace(/(?:\r?\n)+\s*$/u, '');
};

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

// Helper function to find and disconnect existing sessions for the same user ID
const forceDisconnectExistingSessions = async (io, newSocket, userIdToDisconnect) => {
  if (!userIdToDisconnect) return; // Cannot disconnect if user ID is not known

  console.log(`Checking for existing sessions for userId: ${userIdToDisconnect}, excluding new socket: ${newSocket.id}`);

  let disconnectedSocketId = null;
  let disconnectedFromCode = null;
  let disconnectedNetId = null;

  // Iterate through all active races and their players
  for (const [code, players] of racePlayers.entries()) {
    const playerIndex = players.findIndex(p => p.userId === userIdToDisconnect && p.id !== newSocket.id);

    if (playerIndex !== -1) {
      const playerToDisconnect = players[playerIndex];
      disconnectedSocketId = playerToDisconnect.id;
      disconnectedFromCode = code;
      disconnectedNetId = playerToDisconnect.netid; // Store netid for logging/events

      console.log(`Found existing session for userId ${userIdToDisconnect} (netid: ${disconnectedNetId}) in lobby ${code} with socketId ${disconnectedSocketId}. Forcing disconnect.`);

      // Find the old socket object
      const oldSocket = io.sockets.sockets.get(disconnectedSocketId);

      if (oldSocket) {
        // 1. Emit force disconnect event to the old client
        oldSocket.emit('force_disconnect', { reason: 'You joined a race in another session. You may close this tab.' });

        // 2. Disconnect the old socket forcefully
        oldSocket.disconnect(true); // Pass true to close underlying connection
        console.log(`Forcefully disconnected old socket ${disconnectedSocketId}`);
      } else {
        console.log(`Old socket ${disconnectedSocketId} not found in io.sockets.sockets. Maybe already disconnected?`);
      }

      // 3. Manually remove the player from the specific race's player list in memory
      const race = activeRaces.get(code);
      players.splice(playerIndex, 1); // Remove player from the array for this code

      // --- Simulate parts of the disconnect logic for the removed player ---

      // Remove from DB if applicable (non-practice race)
      if (race && race.type !== 'practice' && playerToDisconnect.userId) {
        try {
          await RaceModel.removePlayerFromLobby(race.id, playerToDisconnect.userId);
          console.log(`Removed disconnected user ${disconnectedNetId} from DB lobby ${code}`);
        } catch (dbErr) {
          console.error(`Error removing disconnected user ${disconnectedNetId} from DB lobby ${code}:`, dbErr);
        }
      }

      // Clean up race if empty, otherwise notify others
      if (players.length === 0) {
        // Handle potential host disconnect timer if the lobby is now empty
        if (hostDisconnectTimers.has(code)) {
           console.log(`Lobby ${code} empty after forced disconnect, but host timer active. Deferring cleanup.`);
           // We might still need to update the player list *before* the timer potentially cleans up
           racePlayers.set(code, players); // Ensure the map reflects the empty list
        } else {
          console.log(`Lobby ${code} empty after forced disconnect. Cleaning up.`);
          racePlayers.delete(code);
          activeRaces.delete(code);
          // Attempt to terminate private lobbies in DB
          if (race && race.type === 'private') {
             try { await RaceModel.softTerminate(race.id); } catch(e) { /* ignore */ }
          }
        }
      } else {
         // Update player list in memory for the affected lobby
         racePlayers.set(code, players);

         // --- Handle host 'leaving' due to disconnect ---
         let newHostAssigned = false;
         if (race && race.type === 'private' && race.hostId === playerToDisconnect.userId) {
             console.log(`Host ${disconnectedNetId} was force-disconnected from ${code}. Checking for new host.`);
             // No grace period here, assign immediately if possible
             const newHost = players[0]; // Assign to the next player
             if (newHost) {
                 console.log(`Assigning new host for ${code}: ${newHost.netid}`);
                 race.hostId = newHost.userId;
                 race.hostNetId = newHost.netid;
                 activeRaces.set(code, race); // Update race state
                 newHostAssigned = true;
                 // Persist in DB (best effort)
                 try {
                     await RaceModel.reassignHost(race.id, newHost.userId);
                 } catch (e) {
                     console.error(`Failed to reassign host in DB for ${code} after force disconnect:`, e);
                 }
                 // Notify clients about the new host
                 io.to(code).emit('lobby:newHost', { newHostNetId: newHost.netid });
             } else {
                 // Should be handled by the 'lobby empty' check above, but log just in case
                 console.warn(`Host ${disconnectedNetId} force-disconnected from ${code}, but no players left to assign host.`);
             }
         }
         // --- End Host Handling ---

         // Broadcast updated player list (unless lobby became empty and is being cleaned up)
         if (!hostDisconnectTimers.has(code) || players.length > 0) {
           try {
             const clientPlayers = await Promise.all(players.map(p => getPlayerClientData(p)));
             io.to(code).emit('race:playersUpdate', { players: clientPlayers });
             io.to(code).emit('race:playerLeft', { netid: disconnectedNetId, reason: 'disconnected' }); // Inform others
             console.log(`Notified lobby ${code} about player ${disconnectedNetId} leaving.`);
           } catch (err) {
             console.error(`Error preparing/sending client data after forced disconnect in ${code}:`, err);
           }
         }
      }

      // 4. Clean up associated data for the old socket
      playerProgress.delete(disconnectedSocketId);
      lastProgressUpdate.delete(disconnectedSocketId);
      playerAvatars.delete(disconnectedSocketId);
      clearInactivityTimers(code, disconnectedSocketId); // Clear any inactivity timers

      // Found and handled the duplicate, no need to check other races for this user
      break;
    }
  }

  if (disconnectedSocketId) {
     console.log(`Finished force disconnect process for userId ${userIdToDisconnect}. Old socket ${disconnectedSocketId} removed from lobby ${disconnectedFromCode}.`);
  } else {
     console.log(`No existing sessions found for userId ${userIdToDisconnect} (excluding new socket ${newSocket.id}).`);
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

    socket.on('training:plan:get', async (options = {}) => {
      const { userId } = socket.userInfo;
      if (!userId) return;
      try {
        const plan = await TrainingModel.getPlanForToday(userId, {
          maxCoreBlocks: Math.max(2, Math.min(options.maxBlocks || 4, 6))
        });
        socket.emit('training:plan', plan);
      } catch (err) {
        console.error('Error generating training plan via socket:', err);
        socket.emit('training:error', { message: 'Failed to build training plan.' });
      }
    });

    socket.on('training:diagnostics:get', async () => {
      const { userId } = socket.userInfo;
      if (!userId) return;
      try {
        const diagnostics = await TrainingModel.getDiagnostics(userId);
        socket.emit('training:diagnostics', diagnostics);
      } catch (err) {
        console.error('Error fetching training diagnostics via socket:', err);
        socket.emit('training:error', { message: 'Failed to load training diagnostics.' });
      }
    });

    socket.on('training:start', async (options = {}) => {
      const { userId } = socket.userInfo;
      if (!userId) return;
      try {
        const { plan = null, blockIdx = 0 } = options;
        const planData = plan || (await TrainingModel.getPlanForToday(userId));
        const blocks = Array.isArray(planData?.blocks) ? planData.blocks : [];
        const block = blocks[blockIdx] || null;
        if (!block) {
          socket.emit('training:block', { error: 'No block available' });
          return;
        }
        socket.emit('training:block', {
          blockIdx,
          block,
          plan: planData
        });
      } catch (err) {
        console.error('Error starting training block:', err);
        socket.emit('training:error', { message: 'Failed to build training block.' });
      }
    });

    socket.on('training:unitsDelta', (payload = {}) => {
      // Currently handled client-side; this hook allows acknowledgement for future real-time dashboards.
      socket.emit('training:units:ack', { received: true, count: Array.isArray(payload?.items) ? payload.items.length : 0 });
    });

    socket.on('training:complete', async (payload = {}) => {
      try {
        if (!payload.sessionId) {
          throw new Error('training:complete requires sessionId');
        }
        await TrainingModel.completeSession(payload.sessionId, payload);
        socket.emit('training:complete:ack', { ok: true });
      } catch (err) {
        console.error('Error completing training session via socket:', err);
        socket.emit('training:error', { message: err.message || 'Failed to store training session.' });
      }
    });

    // Handle joining practice mode
    socket.on('practice:join', async (options = {}) => {
      const { user: netid, userId } = socket.userInfo;
      try {
        console.log(`User ${netid} joining practice mode with options:`, options);

        // Force disconnect any existing sessions for this user ID FIRST
        await forceDisconnectExistingSessions(io, socket, userId);

        // Leave any existing race first
        await leaveCurrentRace(io, socket, netid);

        let snippet;
        const practiceCode = `PRACTICE-${socket.id}-${Date.now()}`.slice(0, 16); // Generate an ephemeral code
        let snippetId = null;
        let isTimedTest = options.testMode === 'timed';
        const isTrainingMode = Boolean(options.trainingMode);
        let duration = isTimedTest ? (parseInt(options.testDuration, 10) || 15) : null;
        let trainingSession = null;
        let trainingMeta = null;

        // Get or create snippet text
        if (isTrainingMode) {
          isTimedTest = true;
          const maxBlocks = options.maxBlocks || 4;
          const wordPoolSize = options.wordPoolSize || options.trainingWordPoolSize || 1000;
          const plan = await TrainingModel.getPlanForToday(userId, { maxCoreBlocks: maxBlocks });
          const blocks = Array.isArray(plan?.blocks) ? plan.blocks : [];
          const aggregatedText = blocks.length
            ? blocks.map((block) => (block.text || '')).filter(Boolean).join('  ')
            : null;
          const derivedDuration = blocks.reduce((sum, block) => sum + (block.seconds || 45), 0);
          duration = derivedDuration || parseInt(options.testDuration, 10) || 360;
          if (!aggregatedText) {
            const fallback = createTrainingSnippet({ duration });
            snippet = fallback;
            snippetId = fallback.id;
          } else {
            snippetId = `training-plan-${Date.now()}`;
            snippet = {
              id: snippetId,
              text: aggregatedText,
              source: 'Training Mode',
              category: 'training',
              difficulty: 1,
              is_timed_test: true,
              is_training_session: true,
              duration,
              training_focus: (plan.focus || []).map((unit) => unit.token)
            };
          }

          trainingSession = await TrainingModel.createSession(userId, {
            mode: 'adaptive-plan',
            durationSeconds: duration,
            config: {
              plan,
              requestedDuration: duration,
              wordPoolSize
            },
            snippetId,
            plan
          });

          trainingMeta = {
            enabled: true,
            sessionId: trainingSession.id,
            plan,
            focusLetters: (plan.focus || []).map((unit) => unit.token),
            snippetId,
            totalSeconds: duration,
            wordPoolSize
          };
          console.log(
            `Created training session ${trainingSession.id} for user ${userId} with ${blocks.length} blocks`
          );
        } else if (isTimedTest) {
          // Pass wordPoolSize option for filtering commonWords
          snippet = createTimedTestSnippet(duration, { wordPoolSize: options.wordPoolSize });
          snippetId = `timed-${duration}`; // Use a special ID for timed tests in memory
          console.log(`Created timed test (${duration}s) for practice mode with wordPoolSize=${options.wordPoolSize}`);
        } else {
          // Implement progressive snippet filtering based on options.snippetFilters
          const { difficulty, type, department } = options.snippetFilters || {};
          const difficultyMap = { Easy: 1, Medium: 2, Hard: 3 };
          const numericDifficulty = difficultyMap[difficulty] || null;
          const category = type && type !== 'all'
            ? (type === 'course_reviews' ? 'course-reviews' : type)
            : null;
          const subject = category === 'course-reviews' && department && department !== 'all'
            ? department
            : null;
          // Build filter combinations, prioritizing difficulty
          const combos = [];
          if (numericDifficulty != null && category && subject) {
            combos.push({ difficulty: numericDifficulty, category, subject });
          }
          if (numericDifficulty != null && category) {
            combos.push({ difficulty: numericDifficulty, category });
          }
          if (numericDifficulty != null && subject) {
            combos.push({ difficulty: numericDifficulty, subject });
          }
          if (numericDifficulty != null) {
            combos.push({ difficulty: numericDifficulty });
          }
          if (category && subject) {
            combos.push({ category, subject });
          }
          if (category) {
            combos.push({ category });
          }
          // Fallback random only if no filters were selected (default behavior)
          if (numericDifficulty == null && !category && !subject) {
            combos.push({});
          }
          // Attempt filters in sequence
          let found = null;
          for (const f of combos) {
            const candidate = await SnippetModel.getRandom(f);
            if (candidate) {
              console.log(`Loaded snippet for practice mode with filters: ${JSON.stringify(f)}`);
              found = candidate;
              break;
            }
          }
          if (!found) {
            console.log(`No snippets found for filters: ${JSON.stringify(options.snippetFilters)}`);
            socket.emit('snippetNotFound', { message: 'No snippet available for selected categories. Please adjust your filters.' });
            return;
          }
          snippet = found;
          snippetId = snippet.id;
          console.log(`Loaded snippet ID ${snippetId} for practice mode`);
        }

        // --- Start: Manage Practice Lobby In-Memory ONLY --- 
        // NO LONGER creating a lobby in the database for practice
        // console.log(`Created practice lobby with code ${practiceCode}`);

        // Store active practice race info in memory
        activeRaces.set(practiceCode, {
          // No database ID needed for practice lobbies
          id: null, // Explicitly null to indicate no DB lobby ID
          code: practiceCode, 
          snippet: {
            id: snippetId, // Use DB ID or special timed ID
            text: sanitizeSnippetText(snippet.text),
            is_timed_test: isTimedTest,
            is_training_session: Boolean(trainingMeta?.enabled),
            training_session_id: trainingMeta?.sessionId || null,
            training_focus: trainingMeta?.focusLetters || [],
            duration: duration,
            princeton_course_url: snippet.princeton_course_url || null,
            course_name: snippet.course_name || null
          },
          status: 'waiting', // Practice starts in waiting, then immediately starts countdown/race
          type: 'practice',
          startTime: null,
          settings: { // Store settings used for this practice session
            testMode: isTrainingMode ? 'training' : (options.testMode || 'snippet'),
            testDuration: duration || 15, 
            snippetFilters: options.snippetFilters || { difficulty: 'all', type: 'all', department: 'all' }
          },
          training: trainingMeta
        });

        // Add player to the in-memory player list
        const player = {
          id: socket.id,
          netid,
          userId,
          ready: true, // Player is always ready in practice
          lobbyId: null, // No DB lobby ID
          snippetId: snippetId // Store snippetId used
        };
        racePlayers.set(practiceCode, [player]);
        // --- End: Manage Practice Lobby In-Memory ONLY ---

        // Join the socket room (using the ephemeral code)
        socket.join(practiceCode);

        // Fetch avatar 
        await fetchUserAvatar(userId, socket.id);
        const playerClientData = await getPlayerClientData(player);

        // Send practice info back to the player
        socket.emit('race:joined', {
          code: practiceCode,
          type: 'practice',
          lobbyId: null, // No DB lobby ID
          snippet: activeRaces.get(practiceCode).snippet,
          settings: activeRaces.get(practiceCode).settings,
          players: [playerClientData],
          training: trainingMeta
        });

      } catch (err) {
        console.error(`Error joining practice mode for ${netid}:`, err);
        socket.emit('error', { message: err.message || 'Failed to start practice mode' });
      }
    });

    // Handle joining public lobby (supports rejoin via code)
    socket.on('public:join', async (opts = {}) => {
      const { user: netid, userId } = socket.userInfo; // Get user info
      try {
        // Log join or rejoin
        if (opts.code) {
          console.log(`User ${netid} rejoining public lobby with code ${opts.code}`);
        } else {
          console.log(`User ${netid} joining public lobby`);
        }

        // Force disconnect any existing sessions for this user ID FIRST
        await forceDisconnectExistingSessions(io, socket, userId);

        // Leave any existing race first
        await leaveCurrentRace(io, socket, netid);

        // Try to find or rejoin public lobby
        let lobby;
        let snippet;
        if (opts.code) {
          // Rejoin specific public lobby
          const joinCode = opts.code.toString().trim();
          lobby = await RaceModel.findByCode(joinCode);
          if (!lobby) {
            console.error(`Public lobby ${joinCode} not found`);
            socket.emit('error', { message: 'Public lobby not found' });
            return;
          }
        } else {
          // Join any available public lobby
          lobby = await RaceModel.findPublicLobby();
        }

        // If no lobby exists (fresh join), create a new one
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
              text: sanitizeSnippetText(snippet.text),
              princeton_course_url: snippet.princeton_course_url || null,
              course_name: snippet.course_name || null
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
            console.log(`Lobby ${lobby.code} exists in database but not in memory, initializing...`);

            // Fetch full snippet details (stops bug where snippet was not found in quick match)
            const fullSnippet = await SnippetModel.getById(lobby.snippet_id);
            if (!fullSnippet) {
               console.error(`Failed to load snippet details (ID: ${lobby.snippet_id}) for existing lobby ${lobby.code}`);
               socket.emit('error', { message: 'Failed to load race details.' });
               return; // Stop processing if snippet can't be loaded
            }

            activeRaces.set(lobby.code, {
              id: lobby.id,
              code: lobby.code,
              snippet: {
                // Use fetched snippet data
                id: fullSnippet.id, // Use fetched snippet ID
                text: sanitizeSnippetText(fullSnippet.text), // Use fetched text
                princeton_course_url: fullSnippet.princeton_course_url || null, // Use fetched URL
                course_name: fullSnippet.course_name || null // Use fetched name
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
            text: sanitizeSnippetText(race.snippet.text),
            princeton_course_url: race.snippet.princeton_course_url || null,
            course_name: race.snippet.course_name || null
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

        // Force disconnect any existing sessions for this user ID FIRST
        await forceDisconnectExistingSessions(io, socket, userId);

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
          // Implement progressive snippet filtering based on options.snippetFilters
          const { difficulty, type, department } = options.snippetFilters || {};
          const difficultyMap = { Easy: 1, Medium: 2, Hard: 3 };
          const numericDifficulty = difficultyMap[difficulty] || null;
          const category = type && type !== 'all'
            ? (type === 'course_reviews' ? 'course-reviews' : type)
            : null;
          const subject = category === 'course-reviews' && department && department !== 'all'
            ? department
            : null;
          // Build filter combinations, prioritizing difficulty
          const combos = [];
          if (numericDifficulty != null && category && subject) {
            combos.push({ difficulty: numericDifficulty, category, subject });
          }
          if (numericDifficulty != null && category) {
            combos.push({ difficulty: numericDifficulty, category });
          }
          if (numericDifficulty != null && subject) {
            combos.push({ difficulty: numericDifficulty, subject });
          }
          if (numericDifficulty != null) {
            combos.push({ difficulty: numericDifficulty });
          }
          if (category && subject) {
            combos.push({ category, subject });
          }
          if (category) {
            combos.push({ category });
          }
          // Fallback random only if no filters were selected (default behavior)
          if (numericDifficulty == null && !category && !subject) {
            combos.push({});
          }
          let found = null;
          for (const f of combos) {
            const candidate = await SnippetModel.getRandom(f);
            if (candidate) {
              console.log(`Loaded snippet for private lobby with filters: ${JSON.stringify(f)}`);
              found = candidate;
              break;
            }
          }
          if (!found) {
            throw new Error('Failed to load snippet with any filter combination for private lobby');
          }
          snippet = found;
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
            text: sanitizeSnippetText(snippet.text),
            is_timed_test: snippet.is_timed_test || false,
            duration: snippet.duration || null,
            princeton_course_url: snippet.princeton_course_url || null,
            course_name: snippet.course_name || null
          },
          status: 'waiting',
          type: 'private',
          hostId: userId, // Store host ID
          hostNetId: netid, // Store host NetID
          startTime: null,
          settings: { // Store initial settings including snippetFilters
            testMode: options.testMode || 'snippet',
            testDuration: options.testDuration || 15,
            snippetFilters: options.snippetFilters || { difficulty: 'all', type: 'all', department: 'all' }
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
      const { code, hostNetId, playerNetId } = data;

      try {
        console.log(`User ${netid} attempting to join private lobby via:`, data);

        await forceDisconnectExistingSessions(io, socket, userId);
        await leaveCurrentRace(io, socket, netid);

        let sanitizedCode = code?.trim()?.toUpperCase?.();
        let sanitizedHostNetId = hostNetId?.trim(); // Trim just in case
        let sanitizedPlayerNetId = playerNetId?.trim()?.toLowerCase(); // Trim and lowercase

        let lobby = null;

        // 1. Try finding by Code if provided
        if (sanitizedCode) {
          console.log(`Attempting to find lobby by code: ${sanitizedCode}`);
          lobby = await RaceModel.findByCode(sanitizedCode);
          if (lobby && lobby.type === 'private') {
             console.log(`Found lobby ${lobby.code} via code.`);
          } else {
             lobby = null; // Reset if not found or not private
             console.log(`Lobby not found via code ${sanitizedCode} or was not private.`);
          }
        }

        // 2. If not found by code, try by Host NetID if provided
        if (!lobby && sanitizedHostNetId) {
           console.log(`Attempting to find lobby by hostNetId: ${sanitizedHostNetId}`);
           lobby = await RaceModel.findByHostNetId(sanitizedHostNetId);
           if (lobby) { // findByHostNetId already filters by type='private' and status='waiting'
              console.log(`Found lobby ${lobby.code} via hostNetId ${sanitizedHostNetId}.`);
           } else {
              console.log(`Lobby not found via hostNetId ${sanitizedHostNetId}.`);
           }
        }

        // 3. If not found by code or hostNetId, try by Player NetID if provided
        if (!lobby && sanitizedPlayerNetId) {
           console.log(`Attempting to find lobby by playerNetId: ${sanitizedPlayerNetId}`);
           lobby = await RaceModel.findByPlayerNetId(sanitizedPlayerNetId);
           if (lobby) { // findByPlayerNetId already filters by type='private' and status='waiting'
             console.log(`Found lobby ${lobby.code} via playerNetId ${sanitizedPlayerNetId}.`);
           } else {
             console.log(`Lobby not found via playerNetId ${sanitizedPlayerNetId}.`);
           }
        }

        // Fallback – if lobby not in DB but still alive in memory (e.g. DB rollback),
        // try pulling from activeRaces. This might be redundant now but keep as safety net.
        if (!lobby && sanitizedCode && activeRaces.has(sanitizedCode)) {
          console.warn(`Lobby ${sanitizedCode} not found via DB lookups but exists in memory – using in-memory copy.`);
          const memRace = activeRaces.get(sanitizedCode);
          // Ensure it's actually a private lobby we're recovering
          if (memRace.type === 'private') {
             lobby = {
               id: memRace.id,
               code: memRace.code,
               snippet_id: memRace.snippet?.id,
               snippet_text: memRace.snippet?.text,
               type: memRace.type,
               status: memRace.status,
               host_id: memRace.hostId,
               host_netid: memRace.hostNetId
             };
          } else {
             console.warn(`In-memory race ${sanitizedCode} found, but it is not private. Ignoring.`);
          }
        }

        // Final check: Did we find a valid private lobby?
        if (!lobby || lobby.type !== 'private') {
          // Consolidate error messages based on input
          let errorMsg = 'Private lobby not found';
          if (sanitizedCode && sanitizedPlayerNetId) {
             errorMsg += ` matching code '${sanitizedCode}' or NetID '${sanitizedPlayerNetId}'.`;
          } else if (sanitizedCode) {
             errorMsg += ` matching code '${sanitizedCode}'.`;
          } else if (sanitizedPlayerNetId) {
             errorMsg += ` matching NetID '${sanitizedPlayerNetId}'.`;
          } else if (sanitizedHostNetId) {
              errorMsg += ` matching host NetID '${sanitizedHostNetId}'.`;
          }
          throw new Error(errorMsg);
        }

        // Check status after finding the lobby
        if (lobby.status !== 'waiting') {
          throw new Error(`Lobby ${lobby.code} is already in progress or finished.`);
        }

       // --- Player Joining Logic (Handles both new joins and rejoins after forceDisconnect) ---
       const players = racePlayers.get(lobby.code) || [];

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
       // Add player to in-memory list
       const newPlayer = {
         id: socket.id,
         netid,
         userId,
         ready: false,
         lobbyId: lobby.id,
         snippetId: lobby.snippet_id, // Get snippetId from lobby data
         // Host status is derived from raceInfo later
       };
       players.push(newPlayer);
       racePlayers.set(lobby.code, players);
       // Fetch avatar for the joining player
       await fetchUserAvatar(userId, socket.id);
       // --- END Player Joining Logic ---

       // Join the socket room
       socket.join(lobby.code);

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
               text: sanitizeSnippetText(fullLobby.snippet_text),
               // Assuming private lobbies don't start with timed tests unless explicitly set later
               is_timed_test: false,
               duration: null,
               princeton_course_url: fullLobby.princeton_course_url || null,
               course_name: fullLobby.course_name || null
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

        // Send race info to the joining player (needs async handling for avatars)
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

    // Handle manual lobby leave from client
    socket.on('lobby:leave', async () => {
      const { user: netid } = socket.userInfo;
      console.log(`User ${netid} manually leaving lobby via leave event.`);
      // Reuse leave logic to remove the player and broadcast updates
      const leftCode = await leaveCurrentRace(io, socket, netid);
      // Abort countdown if public race with insufficient players
      if (leftCode) {
        const race = activeRaces.get(leftCode);
        const players = racePlayers.get(leftCode) || [];
        if (race && race.type === 'public' && race.status === 'countdown' && players.length > 0 && players.length < 2) {
          console.log(`Aborting countdown for public race ${leftCode} due to insufficient players (${players.length}) after manual leave.`);
          const timer = countdownTimers.get(leftCode);
          if (timer) {
            clearTimeout(timer);
            countdownTimers.delete(leftCode);
          }
          race.status = 'waiting';
          activeRaces.set(leftCode, race);
          try {
            await RaceModel.updateStatus(race.id, 'waiting');
            console.log(`Race ${leftCode} status reset to 'waiting' in database`);
          } catch (err) {
            console.error(`Error resetting race ${leftCode} status in database:`, err);
          }
          io.to(leftCode).emit('race:countdown', { seconds: null, code: leftCode });
        }
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

        // Choose new snippet based on updated settings
        if (settings.snippetFilters && (settings.testMode === 'snippet' || race.settings.testMode === 'snippet')) {
          // Apply progressive filter combos, prioritizing difficulty
          const { difficulty, type, department } = settings.snippetFilters;
          const difficultyMap = { Easy: 1, Medium: 2, Hard: 3 };
          const numericDifficulty = difficultyMap[difficulty] || null;
          const category = type && type !== 'all'
            ? (type === 'course_reviews' ? 'course-reviews' : type)
            : null;
          const subject = category === 'course-reviews' && department && department !== 'all'
            ? department
            : null;
          // Build filter combinations
          const combos = [];
          if (numericDifficulty != null && category && subject) {
            combos.push({ difficulty: numericDifficulty, category, subject });
          }
          if (numericDifficulty != null && category) {
            combos.push({ difficulty: numericDifficulty, category });
          }
          if (numericDifficulty != null && subject) {
            combos.push({ difficulty: numericDifficulty, subject });
          }
          if (numericDifficulty != null) {
            combos.push({ difficulty: numericDifficulty });
          }
          if (category && subject) {
            combos.push({ category, subject });
          }
          if (category) {
            combos.push({ category });
          }
          // Fallback: completely random
          combos.push({});
          let found = null;
          for (const f of combos) {
            const candidate = await SnippetModel.getRandom(f);
            if (candidate) {
              console.log(`Loaded snippet for private lobby with filters: ${JSON.stringify(f)}`);
              found = candidate;
              break;
            }
          }
          if (!found) {
            throw new Error('Failed to load snippet with any filter combination for private lobby');
          }
          newSnippet = {
            id: found.id,
            text: found.text,
            is_timed_test: false,
            duration: null,
            princeton_course_url: found.princeton_course_url || null,
            course_name: found.course_name || null
          };
          snippetChanged = true;
          race.settings.snippetFilters = settings.snippetFilters;
        } else if (settings.snippetId && settings.snippetId !== race.snippet?.id) {
          // Host selected a specific snippet
          const dbSnippet = await SnippetModel.findById(settings.snippetId);
          if (!dbSnippet) throw new Error('Selected snippet not found.');
          newSnippet = {
            id: dbSnippet.id,
            text: dbSnippet.text,
            is_timed_test: false,
            duration: null,
            princeton_course_url: dbSnippet.princeton_course_url || null,
            course_name: dbSnippet.course_name || null
          };
          snippetChanged = true;
        }
        // If mode changed to timed OR duration changed while already in timed mode
        else if (
          (settings.testMode === 'timed' && (race.settings.testMode !== 'timed' || settings.testDuration !== race.settings.testDuration)) ||
          // When only the duration is provided (without testMode) but we are already in timed mode
          (typeof settings.testMode === 'undefined' && typeof settings.testDuration !== 'undefined' && race.settings.testMode === 'timed' && settings.testDuration !== race.settings.testDuration)
        ) {
          // Timed test snippet
          const duration = parseInt(settings.testDuration) || parseInt(race.settings.testDuration) || 30;
          newSnippet = createTimedTestSnippet(duration);
          snippetChanged = true;
          // Ensure race.settings will reflect timed mode even if testMode was omitted
          settings.testMode = 'timed';
        }
        // If mode changed back to snippet from timed
        else if (settings.testMode === 'snippet' && race.settings.testMode === 'timed') {
          // Switch from timed back to snippet
          const randomSnippet = await SnippetModel.getRandom();
          if (!randomSnippet) throw new Error('Failed to load snippet for snippet mode.');
          newSnippet = {
            id: randomSnippet.id,
            text: randomSnippet.text,
            is_timed_test: false,
            duration: null,
            princeton_course_url: randomSnippet.princeton_course_url || null,
            course_name: randomSnippet.course_name || null
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
        // console.log(`[DEBUG race:result] Received data:`, JSON.stringify(data));
        // console.log(`[DEBUG race:result] User info: netid=${netid}, userId=${userId}`);
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
        // console.log(`[DEBUG race:result] Found player: ${!!player}, Found race: ${!!race}`);
        if (race) {
          // console.log(`[DEBUG race:result] Race snippet info: is_timed=${race.snippet?.is_timed_test}, duration=${race.snippet?.duration}`);
        }
        // --- END DEBUG LOGGING ---

        if (!player || !race) {
          console.warn(`[WARN race:result] Received result for race ${code}, but player ${netid} or race not found`);
          return;
        }

        let handled = false;

        // Handle adaptive training sessions
        if (race.training?.enabled && race.training.sessionId && !race.training.completed) {
          const trainingPayload = data.training || {};

          if (trainingPayload.sessionId && trainingPayload.sessionId !== race.training.sessionId) {
            console.warn(
              `[WARN race:result] Training payload sessionId mismatch for user ${netid}: expected ${race.training.sessionId}, received ${trainingPayload.sessionId}`
            );
          } else {
            const completionData = {
              totalChars: trainingPayload.totalChars || 0,
              errorCount: trainingPayload.errorCount || 0,
              correctedErrors: trainingPayload.correctedErrors || 0,
              wpm,
              accuracy,
              charStats: Array.isArray(trainingPayload.charStats)
                ? trainingPayload.charStats.map((stat) => ({
                    character: stat.character,
                    exposures: stat.exposures || 0,
                    mistakes: stat.mistakes || 0,
                    extraHits: stat.extraHits || 0,
                    avgLatencyMs: stat.avgLatencyMs != null ? Number(stat.avgLatencyMs) : null,
                    latencySamples: stat.latencySamples || stat.exposures || 0
                  }))
                : [],
              unitStats: Array.isArray(trainingPayload.unitStats)
                ? trainingPayload.unitStats.map((stat) => ({
                    token: stat.token || stat.character || stat.unit,
                    unitType: stat.unitType,
                    display: stat.display,
                    exposures: stat.exposures || 0,
                    mistakes: stat.mistakes || 0,
                    extraHits: stat.extraHits || 0,
                    latencySamples: stat.latencySamples || stat.latencyCount || stat.exposures || 0,
                    latencyMsSum: stat.latencyMsSum || stat.latencyTotal || 0
                  }))
                : [],
              keystrokes: Array.isArray(trainingPayload.keystrokes)
                ? trainingPayload.keystrokes.map((event) => ({
                    idx: event.idx,
                    t: event.t,
                    expected: event.expected,
                    actual: event.actual,
                    correct: event.correct,
                    backspace: event.backspace,
                    dwellMs: event.dwellMs,
                    flightMs: event.flightMs
                  }))
                : []
            };

            try {
              await TrainingModel.completeSession(race.training.sessionId, completionData);
              race.training.completed = true;
              console.log(
                `[SUCCESS race:result] Recorded training session ${race.training.sessionId} for ${netid}`
              );
            } catch (err) {
              console.error(
                `[ERROR race:result] Failed to complete training session ${race.training.sessionId} for user ${userId}:`,
                err
              );
            }
          }

          handled = true;
        }

        // Check if the result is for a timed test
        if (!handled && race.snippet?.is_timed_test && race.snippet?.duration) {
          const duration = race.snippet.duration;
          // --- BEGIN DEBUG LOGGING --- 
          // console.log(`[DEBUG race:result] Processing as TIMED test. Duration: ${duration}`);
          // console.log(`[DEBUG race:result] Calling insertTimedResult with: userId=${userId}, duration=${duration}, wpm=${wpm}, accuracy=${accuracy}`);
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
              // console.log(`[DEBUG race:result] Updated user stats for ${netid}`);
            }
          } catch (statsError) {
            console.error(`[ERROR race:result] Failed to update user stats for ${userId} after timed result:`, statsError);
          }

          handled = true;
        } else if (!handled && snippetId) {
           // --- BEGIN DEBUG LOGGING --- 
           // console.log(`[DEBUG race:result] Processing as REGULAR race. Snippet ID: ${snippetId}`);
           // console.log(`[DEBUG race:result] Calling RaceModel.recordResult with: userId=${userId}, lobbyId=${lobbyId}, snippetId=${snippetId}, wpm=${wpm}, accuracy=${accuracy}, completion_time=${completion_time}`);
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
              // console.log(`[DEBUG race:result] Updated user stats for ${netid}`);
            }
          } catch (statsError) {
            console.error(`[ERROR race:result] Failed to update user stats for ${userId} after regular result:`, statsError);
          }
        } else if (!handled) {
          console.warn(`[WARN race:result] Result from ${netid} for race ${code} has no snippetId and is not a timed test.`);
        }

        // Handle player finish logic (updates progress, checks if race ends)
        // Wrap in try/catch as well
        try {
          await handlePlayerFinish(io, code, socket.id, { wpm, accuracy, completion_time });
          // console.log(`[DEBUG race:result] Successfully handled player finish logic for ${netid}`);
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
        const leaderboardWithAvatars = leaderboardData.map((entry) => ({
          ...entry,
          created_at: new Date(entry.created_at).toISOString(),
          avatar_url: entry.avatar_url || null
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
      // --- BEGIN DISCONNECT LOGIC ---
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
            console.log(`Host ${netid} (userId: ${player.userId}) disconnected from private lobby ${code}. Starting grace period.`);

            // Clear any existing timer for this lobby (shouldn't happen often)
            const existingTimerInfo = hostDisconnectTimers.get(code);
            if (existingTimerInfo) {
              console.warn(`Found existing host disconnect timer for lobby ${code} while handling new disconnect. Clearing old timer.`);
              clearTimeout(existingTimerInfo.timer);
              hostDisconnectTimers.delete(code);
            }

            // Start the grace period timer
            const timer = setTimeout(async () => {
              console.log(`Host reconnect grace period expired for lobby ${code}. Reassigning host.`);
              hostDisconnectTimers.delete(code); // Remove timer entry

              // Re-fetch players in case someone else left during the grace period
              const currentPlayers = racePlayers.get(code) || [];
              const currentRace = activeRaces.get(code); // Re-fetch race state

              // Ensure the disconnected host is actually removed before picking a new one
              const remainingPlayersAfterGrace = currentPlayers.filter(p => p.userId !== player.userId);

              if (!currentRace || remainingPlayersAfterGrace.length === 0) {
                console.log(`No players left in lobby ${code} after host disconnected. Terminating.`);
                if (currentRace) {
                  io.to(code).emit('lobby:terminated', { reason: 'Lobby empty after host disconnected.' });
                  try { await RaceModel.softTerminate(currentRace.id); } catch (e) { console.error(`Error soft-terminating lobby ${code}:`, e); }
                  activeRaces.delete(code);
                }
                racePlayers.delete(code); // Ensure players map is cleared
                return; // Exit timer callback
              }

              // Choose the oldest remaining player as new host
              const newHost = remainingPlayersAfterGrace[0];
              console.log(`Reassigning host of lobby ${code} to ${newHost.netid} (userId: ${newHost.userId})`);

              currentRace.hostId = newHost.userId;
              currentRace.hostNetId = newHost.netid;
              activeRaces.set(code, currentRace); // Update race state

              // Persist new host in DB (best-effort)
              try {
                await RaceModel.reassignHost(currentRace.id, newHost.userId);
              } catch (e) {
                console.error(`Failed to reassign host in DB for lobby ${code}:`, e);
              }

              // Inform clients in the lobby
              io.to(code).emit('lobby:newHost', { newHostNetId: newHost.netid });

              // Update player list for clients (ensure host status is reflected)
              const clientPlayers = await Promise.all(remainingPlayersAfterGrace.map(p => getPlayerClientData(p)));
              io.to(code).emit('race:playersUpdate', { players: clientPlayers });

            }, HOST_RECONNECT_GRACE_PERIOD);

            // Store the timer and the disconnecting host's userId
            hostDisconnectTimers.set(code, { timer, userId: player.userId });

            // NOTE: We still proceed with removing the player from the list below,
            // but the host reassignment is now delayed by the timer.
          }
          // --- End Host Disconnect Handling ---


          // --- Standard Player Disconnect Logic ---
          console.log(`Standard disconnect for player ${netid} in race ${code}`);

          // Clear any inactivity timers for this player
          clearInactivityTimers(code, socket.id);

          // Remove player from race in memory
          players.splice(playerIndex, 1);

          // If race exists and isn't practice mode, remove player from DB lobby_players
          if (race && race.type !== 'practice' && player.userId) {
            try {
              await RaceModel.removePlayerFromLobby(race.id, player.userId);
              console.log(`Removed user ${netid} from lobby_players table for lobby ${code}`);
            } catch (dbErr) {
              console.error(`Error removing user ${netid} from lobby_players table:`, dbErr);
            }
          }
          console.log(`[Disconnect] Finished DB removal attempt for ${netid} in ${code}. Proceeding with broadcast.`);
          // Abort countdown if public race has fewer than 2 players during countdown
          if (race && race.type === 'public' && race.status === 'countdown' && players.length > 0 && players.length < 2) {
            console.log(`Aborting countdown for public race ${code} due to insufficient players (${players.length}) after disconnect.`);
            const timer = countdownTimers.get(code);
            if (timer) {
              clearTimeout(timer);
              countdownTimers.delete(code);
            }
            // Reset race status to waiting
            race.status = 'waiting';
            activeRaces.set(code, race);
            // Persist reset status in database
            try {
              await RaceModel.updateStatus(race.id, 'waiting');
              console.log(`Race ${code} status reset to 'waiting' in database`);
            } catch (err) {
              console.error(`Error resetting race ${code} status in database:`, err);
            }
            // Notify clients to clear countdown
            io.to(code).emit('race:countdown', { seconds: null, code });
          }

          // --- Lobby Cleanup / Player List Update ---
          if (players.length === 0) {
            if (!hostDisconnectTimers.has(code)) {
              console.log(`No players left in race ${code}, cleaning up`);
              racePlayers.delete(code);
              activeRaces.delete(code);
              if (race && race.type === 'private') {
                 try { await RaceModel.softTerminate(race.id); } catch(e) { /* ignore */ }
              }
              continue; 
            } else {
              console.log(`No players left in race ${code}, but host disconnect timer is active. Cleanup deferred to timer.`);
            }
          }
          
          racePlayers.set(code, players); 

          try {
            console.log(`[Disconnect] Preparing player data broadcast for ${code}. ${players.length} players remaining.`);
            const remainingPlayersClientDataDisc = await Promise.all(players.map(p => getPlayerClientData(p)));
            console.log(`[Disconnect] Broadcasting playersUpdate for ${code}...`);
            io.to(code).emit('race:playersUpdate', { 
              players: remainingPlayersClientDataDisc
            });
            console.log(`[Disconnect] Broadcasting playerLeft for ${code}...`);
            io.to(code).emit('race:playerLeft', { netid }); 
            console.log(`[Disconnect] Successfully broadcasted updates for ${code}.`);
          } catch (broadcastErr) {
             console.error(`[Disconnect] Error broadcasting player updates for lobby ${code}:`, broadcastErr);
          }

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
      // Clean up any inactivity timers associated with this specific socket ID across all lobbies
      for (const [key, timers] of inactivityTimers.entries()) {
         if (key.endsWith(`-${socket.id}`)) {
            clearInactivityTimers(key.split('-')[0], socket.id); // Call cleanup function
         }
      }
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

          // after recording a partial session, re-evaluate titles that depend on
          // completion rate so users are awarded w/o needing to finish another
          // session to trigger checks
          try {
            await User.checkAndAwardTitles(userId);
          } catch (titleErr) {
            console.error(`Error re-checking titles after partial for user ${netid}:`, titleErr);
          }
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
    
    // Wait 5 seconds and start the race (store timer to allow abort)
    const timer = setTimeout(() => {
      countdownTimers.delete(code);
      startRace(io, code);
    }, 5000);
    countdownTimers.set(code, timer);
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
        message: 'You will be kicked for inactivity in 15 seconds if you do not ready up.',
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
