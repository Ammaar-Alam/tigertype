const db = require('../config/database');
const pool = require('../config/database').pool;

// User model for managing user-related database operations
const User = {
  // Find user by ID
  async findById(userId) {
    if (!userId) return null;
    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      return result.rows[0];
    } catch (err) {
      console.error(`Error finding user by ID ${userId}:`, err);
      throw err;
    }
  },

  // Find user by netid, including bio and avatar_url
  async findByNetid(netid) {
    try {
      // Try to get all fields including fastest_wpm
      try {
        const result = await db.query(
          'SELECT id, netid, last_login, created_at, bio, avatar_url, races_completed, avg_wpm, avg_accuracy, fastest_wpm FROM users WHERE netid = $1',
          [netid]
        );
        return result.rows[0];
      } catch (error) {
        // If there's an error (likely missing column), fallback to a simpler query
        console.warn('Error in full findByNetid query, falling back to minimal query:', error.message);
        const fallbackResult = await db.query(
          'SELECT id, netid, last_login, created_at FROM users WHERE netid = $1',
          [netid]
        );
        
        // If we have a user, try to get other columns that might exist
        if (fallbackResult.rows[0]) {
          const user = fallbackResult.rows[0];
          
          // Try to get bio and avatar_url
          try {
            const profileResult = await db.query(
              'SELECT bio, avatar_url FROM users WHERE id = $1',
              [user.id]
            );
            if (profileResult.rows[0]) {
              user.bio = profileResult.rows[0].bio;
              user.avatar_url = profileResult.rows[0].avatar_url;
            }
          } catch (profileError) {
            console.warn('Could not get profile fields:', profileError.message);
          }
          
          // Try to get stats fields
          try {
            const statsResult = await db.query(
              'SELECT races_completed, avg_wpm, avg_accuracy FROM users WHERE id = $1',
              [user.id]
            );
            if (statsResult.rows[0]) {
              user.races_completed = statsResult.rows[0].races_completed;
              user.avg_wpm = statsResult.rows[0].avg_wpm;
              user.avg_accuracy = statsResult.rows[0].avg_accuracy;
            }
          } catch (statsError) {
            console.warn('Could not get stats fields:', statsError.message);
          }
          
          // Try to get fastest_wpm separately
          try {
            const fastestResult = await db.query(
              'SELECT fastest_wpm FROM users WHERE id = $1',
              [user.id]
            );
            if (fastestResult.rows[0]) {
              user.fastest_wpm = fastestResult.rows[0].fastest_wpm;
            } else {
              // Default to 0 if not available
              user.fastest_wpm = 0;
            }
          } catch (fastestError) {
            console.warn('Could not get fastest_wpm field:', fastestError.message);
            // Default to 0 if not available
            user.fastest_wpm = 0;
          }
          
          return user;
        }
        
        return fallbackResult.rows[0];
      }
    } catch (err) {
      console.error('Error finding user by netid:', err);
      throw err;
    }
  },

  // Create a new user (bio and avatar_url will be null initially)
  async create(netid) {
    try {
      const result = await db.query(
        'INSERT INTO users (netid) VALUES ($1) RETURNING id, netid, last_login, created_at, bio, avatar_url, races_completed, avg_wpm, avg_accuracy, fastest_wpm',
        [netid]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Error creating user:', err);
      throw err;
    }
  },

  // Update last login time
  async updateLastLogin(userId) {
    try {
      const result = await db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, netid, last_login, created_at, bio, avatar_url, races_completed, avg_wpm, avg_accuracy, fastest_wpm',
        [userId]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Error updating last login:', err);
      throw err;
    }
  },

  // Find or create a user by netid
  async findOrCreate(netid) {
    try {
      let user = await this.findByNetid(netid);
      
      if (!user) {
        user = await this.create(netid);
      } else {
        user = await this.updateLastLogin(user.id);
      }
      
      return user;
    } catch (err) {
      console.error('Error in findOrCreate:', err);
      throw err;
    }
  },

  // Update user bio
  async updateBio(userId, bio) {
    try {
      console.log('Calling updateBio with userId:', userId, 'and bio:', bio);
      
      // Focused query that just updates and returns waht's needed
      const result = await db.query(
        'UPDATE users SET bio = $1 WHERE id = $2 RETURNING id, netid, bio, avatar_url',
        [bio, userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('User not found');
      }
      
      // Try to get additional stats fields if they exist
      try {
        const statsResult = await db.query(
          'SELECT races_completed, avg_wpm, avg_accuracy, fastest_wpm FROM users WHERE id = $1',
          [userId]
        );
        
        if (statsResult.rows[0]) {
          // Merge the stats into our result
          Object.assign(result.rows[0], statsResult.rows[0]);
        }
      } catch (statsErr) {
        console.warn('Could not retrieve stats fields after bio update:', statsErr.message);
        // Continue without stats - they're not critical for bio functionality
      }
      
      return result.rows[0];
    } catch (err) {
      console.error('Error updating user bio:', err);
      throw err;
    }
  },

  // Update useravatar URL
  async updateAvatarUrl(userId, avatarUrl) {
    try {
      console.log('Calling updateAvatarUrl with userId:', userId, 'and avatarUrl:', avatarUrl);
      
      const result = await db.query(
        'UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, netid, bio, avatar_url',
        [avatarUrl, userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('User not found');
      }
      
      // Try to get additional stats fields if they exist
      try {
        const statsResult = await db.query(
          'SELECT races_completed, avg_wpm, avg_accuracy, fastest_wpm FROM users WHERE id = $1',
          [userId]
        );
        
        if (statsResult.rows[0]) {
          Object.assign(result.rows[0], statsResult.rows[0]);
        }
      } catch (statsErr) {
        console.warn('Could not retrieve stats fields after avatar update:', statsErr.message);
        // Continue without stats - they're not critical for avatar functionality
      }
      
      return result.rows[0];
    } catch (err) {
      console.error('Error updating user avatar URL:', err);
      throw err;
    }
  },

  // Get a user's recent race results
  async getRecentResults(userId, limit = 10) {
    try {
      const result = await db.query(
        `SELECT r.id, r.wpm, r.accuracy, r.completion_time, 
         s.text as snippet_text, s.source, s.category, 
         r.created_at
         FROM race_results r
         JOIN snippets s ON r.snippet_id = s.id
         WHERE r.user_id = $1
         ORDER BY r.created_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (err) {
      console.error('Error getting recent results:', err);
      throw err;
    }
  },

  // Get a user's stats summary
  async getStats(userId) {
    try {
      const result = await db.query(
        `SELECT 
          COUNT(*) as total_races,
          AVG(wpm) as avg_wpm,
          MAX(wpm) as max_wpm,
          AVG(accuracy) as avg_accuracy,
          COUNT(DISTINCT snippet_id) as unique_snippets
         FROM race_results
         WHERE user_id = $1`,
        [userId]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Error getting user stats:', err);
      throw err;
    }
  },

  // Update user's average WPM, accuracy, and races completed
  // Conditionally updates based on whether the result is from a timed test
  async updateStats(userId, wpm, accuracy, isTimed) {
    if (!userId) return;
    try {
      // Fetch current stats using the correct internal call
      const user = await User.findById(userId); 
      if (!user) return;

      const currentAvgWpm = parseFloat(user.avg_wpm) || 0;
      const currentAvgAcc = parseFloat(user.avg_accuracy) || 0;
      const racesCompleted = user.races_completed || 0;

      if (isTimed) {
        // For timed tests, update WPM and accuracy but not races completed
        // Calculate new averages using existing races completed count
        const newAvgWpm = ((currentAvgWpm * racesCompleted) + wpm) / (racesCompleted + 1);
        const newAvgAcc = ((currentAvgAcc * racesCompleted) + accuracy) / (racesCompleted + 1);

        await pool.query(
          'UPDATE users SET avg_wpm = $1, avg_accuracy = $2 WHERE id = $3',
          [newAvgWpm.toFixed(2), newAvgAcc.toFixed(2), userId]
        );
        console.log(`Updated timed test stats for user ${userId}: WPM=${newAvgWpm.toFixed(2)}, Acc=${newAvgAcc.toFixed(2)}`);
      } else {
        // For regular races, update everything including races completed
        const newAvgWpm = ((currentAvgWpm * racesCompleted) + wpm) / (racesCompleted + 1);
        const newAvgAcc = ((currentAvgAcc * racesCompleted) + accuracy) / (racesCompleted + 1);
        const newRacesCompleted = racesCompleted + 1;

        await pool.query(
          'UPDATE users SET avg_wpm = $1, avg_accuracy = $2, races_completed = $3 WHERE id = $4',
          [newAvgWpm.toFixed(2), newAvgAcc.toFixed(2), newRacesCompleted, userId]
        );
        console.log(`Updated regular stats for user ${userId}: WPM=${newAvgWpm.toFixed(2)}, Acc=${newAvgAcc.toFixed(2)}, Races=${newRacesCompleted}`);
      }
    } catch (error) {
      console.error(`Error updating stats for user ${userId}:`, error);
    }
  },

  // Update user's fastest WPM if the new WPM is higher
  async updateFastestWpm(userId, wpm) {
    if (!userId) return;
    try {
      // Fetch current fastest_wpm using the correct internal call
      const user = await User.findById(userId); 
      if (!user) return;

      // Update fastest_wpm if the new wpm is higher
      const currentFastest = parseFloat(user.fastest_wpm) || 0;
      if (wpm > currentFastest) {
        await pool.query(
          'UPDATE users SET fastest_wpm = $1 WHERE id = $2',
          [wpm, userId]
        );
        console.log(`Updated fastest_wpm for user ${userId} to ${wpm}`);
      } else {
        console.log(`Skipping fastest_wpm update for user ${userId} (${wpm} not higher than ${currentFastest})`);
      }
    } catch (error) {
      console.error(`Error updating fastest_wpm for user ${userId}:`, error);
    }
  }
};

// Debug check to verify functions exist
// console.log('User model has methods:', Object.keys(User));
// console.log('updateBio exists:', typeof User.updateBio === 'function');
// console.log('updateAvatarUrl exists:', typeof User.updateAvatarUrl === 'function');

module.exports = User;