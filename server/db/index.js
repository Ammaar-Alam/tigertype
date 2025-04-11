const { pool } = require('../config/database');
const migrations = require('./migrations');
const { runMigrations, logDatabaseState } = migrations;

/**
 * Initialize the database
 * This function should be called when the server starts
 */
const initDB = async () => {
  try {
    console.log('Initializing database...');
    
    // Run all pending migrations
    await runMigrations();
    
    // Log the user stats after migrations
    await logUserStats();
    
    console.log('Database initialization complete');
    return true;
  } catch (err) {
    console.error('Database initialization failed:', err);
    throw err;
  }
};

/**
 * Log user stats for debugging
 */
const logUserStats = async () => {
  const client = await pool.connect();
  try {
    // Query users with race results
    const usersWithRaces = await client.query(`
      SELECT u.id, u.netid, u.races_completed, u.avg_wpm, u.fastest_wpm,
             MAX(r.wpm) as max_wpm_from_results
      FROM users u
      LEFT JOIN race_results r ON u.id = r.user_id
      GROUP BY u.id, u.netid
      ORDER BY u.races_completed DESC
      LIMIT 10
    `);
    
    console.log('User stats check:');
    for (const user of usersWithRaces.rows) {
      console.log(`User ${user.netid} - races: ${user.races_completed}, avg_wpm: ${user.avg_wpm}, fastest_wpm: ${user.fastest_wpm}, max_wpm_from_results: ${user.max_wpm_from_results}`);
      
      // If there's a discrepancy between fastest_wpm and max_wpm_from_results
      if (user.fastest_wpm !== user.max_wpm_from_results && user.max_wpm_from_results !== null) {
        console.log(`  DISCREPANCY DETECTED for ${user.netid}: fastest_wpm=${user.fastest_wpm}, max_wpm_from_results=${user.max_wpm_from_results}`);
      }
    }
  } catch (err) {
    console.error('Error checking user stats:', err);
  } finally {
    client.release();
  }
};

// Seed initial data for testing
const seedTestData = async () => {
  try {
    // Check if our test snippets already exist by looking for a specific test snippet
    const { rows } = await pool.query("SELECT COUNT(*) FROM snippets WHERE text LIKE 'The quick brown fox%'");
    
    if (parseInt(rows[0].count) === 0) {
      // Add some test snippets
      await pool.query(`
        INSERT INTO snippets (text, source, category, difficulty)
        VALUES 
          ('The quick brown fox jumps over the lazy dog.', 'Typing Exercise', 'beginner', 1),
          ('Princeton University is located in Princeton, New Jersey and is one of the oldest universities in the United States.', 'Princeton Facts', 'medium', 2),
          ('To be or not to be, that is the question. Whether ''tis nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms against a sea of troubles, and by opposing end them.', 'Shakespeare', 'advanced', 3)
      `);
      console.log('Added test snippets');
    } else {
      console.log('Test snippets already exist, skipping insertion');
    }
  } catch (err) {
    console.error('Error seeding test data:', err);
  }
};

const createLobby = async (type, hostId = null, snippetId = null, textCategory = 'general') => {
  // ... existing code ...
};

const addPlayerToLobby = async (lobbyId, userId) => {
  // ... existing code ...
};

const removePlayerFromLobby = async (lobbyId, userId) => {
  // ... existing code ...
};

const updatePlayerReadyStatus = async (lobbyId, userId, isReady) => {
  // ... existing code ...
};

const getLobbyPlayers = async (lobbyId) => {
  // ... existing code ...
};

const updateLobbyStatus = async (lobbyId, status) => {
  // ... existing code ...
};

const startLobby = async (lobbyId, startTime) => {
  // ... existing code ...
};

const finishLobby = async (lobbyId, finishedAt) => {
  // ... existing code ...
};

const insertRaceResult = async (userId, lobbyId, snippetId, wpm, accuracy, completionTime) => {
  // ... existing code ...
};

const getRaceResults = async (lobbyId) => {
  // ... existing code ...
};

const getUserStats = async (userId) => {
  // ... existing code ...
};

const updateUserStats = async (userId) => {
  // ... existing code ...
};

const updateFastestWpm = async (userId) => {
  // ... existing code ...
};

// --- Timed Leaderboard Functions ---

const insertTimedResult = async (userId, duration, wpm, accuracy) => {
  if (!userId || !duration || wpm == null || accuracy == null) {
    console.error('Invalid data for insertTimedResult:', { userId, duration, wpm, accuracy });
    return null;
  }
  try {
    const result = await pool.query(
      `INSERT INTO timed_leaderboard (user_id, duration, wpm, accuracy) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, duration, wpm, accuracy]
    );
    console.log(`Inserted timed result for user ${userId}, duration ${duration}: WPM ${wpm}, Accuracy ${accuracy}`);
    return result.rows[0];
  } catch (error) {
    console.error('Error inserting timed result:', error);
    throw error;
  }
};

const getTimedLeaderboard = async (duration, period = 'alltime', limit = 100) => {
  if (![15, 30, 60, 120].includes(duration)) {
    throw new Error('Invalid duration for timed leaderboard');
  }
  if (!['daily', 'alltime'].includes(period)) {
    throw new Error('Invalid period for timed leaderboard');
  }

  let timeFilter = '';
  if (period === 'daily') {
    timeFilter = 'AND tl.created_at >= NOW() - INTERVAL \'1 day\'';
  }

  // Query to get the best score per user for the given duration and period
  const query = `
    WITH RankedScores AS (
      SELECT
        tl.user_id,
        u.netid,
        tl.wpm,
        tl.accuracy,
        tl.created_at,
        ROW_NUMBER() OVER(PARTITION BY tl.user_id ORDER BY tl.wpm DESC, tl.created_at DESC) as rn
      FROM timed_leaderboard tl
      JOIN users u ON tl.user_id = u.id
      WHERE tl.duration = $1 ${timeFilter}
    )
    SELECT
      user_id,
      netid,
      wpm,
      accuracy,
      created_at
    FROM RankedScores
    WHERE rn = 1
    ORDER BY wpm DESC, created_at ASC
    LIMIT $2;
  `;

  try {
    const result = await pool.query(query, [duration, limit]);
    return result.rows;
  } catch (error) {
    console.error(`Error fetching timed leaderboard (duration: ${duration}, period: ${period}):`, error);
    throw error;
  }
};

// --- End Timed Leaderboard Functions ---

module.exports = {
  initDB,
  seedTestData,
  logDatabaseState,
  logUserStats,
  createLobby,
  addPlayerToLobby,
  removePlayerFromLobby,
  updatePlayerReadyStatus,
  getLobbyPlayers,
  updateLobbyStatus,
  startLobby,
  finishLobby,
  insertRaceResult,
  getRaceResults,
  getUserStats,
  updateUserStats,
  updateFastestWpm,
  insertTimedResult,
  getTimedLeaderboard
};