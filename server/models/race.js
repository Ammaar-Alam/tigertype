const db = require('../config/database');
const crypto = require('crypto');

// Race/Lobby model for managing race sessions
const Race = {
  // Generate a unique lobby code
  generateCode() {
    // Generate a 6-character alphanumeric code
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  },

  // Create a new race lobby
  async create(type, snippetId) {
    try {
      const code = this.generateCode();
      
      // For practice mode with timed tests, snippetId can be null
      if (type === 'practice' && !snippetId) {
        const result = await db.query(
          `INSERT INTO lobbies (code, type, status)
           VALUES ($1, $2, 'waiting')
           RETURNING *`,
          [code, type]
        );
        
        return result.rows[0];
      }
      
      const result = await db.query(
        `INSERT INTO lobbies (code, type, status, snippet_id)
         VALUES ($1, $2, 'waiting', $3)
         RETURNING *`,
        [code, type, snippetId]
      );
      
      return result.rows[0];
    } catch (err) {
      console.error('Error creating race lobby:', err);
      throw err;
    }
  },

  // Find a race lobby by code
  async findByCode(code) {
    try {
      const result = await db.query(
        `SELECT l.*, s.text AS snippet_text
         FROM lobbies l
         JOIN snippets s ON l.snippet_id = s.id
         WHERE l.code = $1`,
        [code]
      );
      
      return result.rows[0];
    } catch (err) {
      console.error('Error finding race by code:', err);
      throw err;
    }
  },

  // Find a public lobby with 'waiting' status
  async findPublicLobby() {
    try {
      const result = await db.query(
        `SELECT l.*, s.text AS snippet_text
         FROM lobbies l
         JOIN snippets s ON l.snippet_id = s.id
         WHERE l.type = 'public' AND l.status = 'waiting'
         ORDER BY l.created_at ASC
         LIMIT 1`
      );
      
      return result.rows[0];
    } catch (err) {
      console.error('Error finding public lobby:', err);
      throw err;
    }
  },

  // Update race lobby status
  async updateStatus(lobbyId, status) {
    try {
      const updates = { status };
      
      // Add timestamps based on status
      if (status === 'racing') {
        updates.started_at = 'CURRENT_TIMESTAMP';
      } else if (status === 'finished') {
        updates.finished_at = 'CURRENT_TIMESTAMP';
      }
      
      // Build the SET clause dynamically
      const setClause = Object.entries(updates)
        .map(([key, value], index) => {
          return `${key} = ${value === 'CURRENT_TIMESTAMP' ? 'CURRENT_TIMESTAMP' : `$${index + 1}`}`;
        })
        .join(', ');
      
      // Filter out timestamp literals from params
      const params = Object.values(updates)
        .filter(value => value !== 'CURRENT_TIMESTAMP')
        .concat([lobbyId]);
      
      const query = `
        UPDATE lobbies
        SET ${setClause}
        WHERE id = $${params.length}
        RETURNING *
      `;
      
      const result = await db.query(query, params);
      return result.rows[0];
    } catch (err) {
      console.error('Error updating race status:', err);
      throw err;
    }
  },

  // Record a race result
  async recordResult(userId, lobbyId, snippetId, wpm, accuracy, completionTime) {
    try {
      const dbHelpers = require('../utils/db-helpers');
      
      // Use the helper to record result and update user stats in a single transaction
      return await dbHelpers.recordRaceResult({
        userId,
        lobbyId,
        snippetId,
        wpm,
        accuracy,
        completionTime
      });
    } catch (err) {
      console.error('Error recording race result:', err);
      throw err;
    }
  },

  // Get results for a specific race
  async getResults(lobbyId) {
    try {
      const result = await db.query(
        `SELECT r.*, u.netid, u.avatar_url
         FROM race_results r
         JOIN users u ON r.user_id = u.id
         WHERE r.lobby_id = $1
         ORDER BY r.wpm DESC`,
        [lobbyId]
      );
      
      return result.rows;
    } catch (err) {
      console.error('Error getting race results:', err);
      throw err;
    }
  },
  
  // Add a player to a lobby
  async addPlayerToLobby(lobbyId, userId, isReady = false) {
    try {
      const result = await db.query(
        `INSERT INTO lobby_players (lobby_id, user_id, is_ready, join_time)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (lobby_id, user_id) 
         DO UPDATE SET is_ready = $3, join_time = CURRENT_TIMESTAMP
         RETURNING *`,
        [lobbyId, userId, isReady]
      );
      
      return result.rows[0];
    } catch (err) {
      console.error('Error adding player to lobby:', err);
      throw err;
    }
  },
  
  // Update player ready stauts
  async updatePlayerReadyStatus(lobbyId, userId, isReady) {
    try {
      const result = await db.query(
        `UPDATE lobby_players 
         SET is_ready = $3 
         WHERE lobby_id = $1 AND user_id = $2
         RETURNING *`,
        [lobbyId, userId, isReady]
      );
      
      return result.rows[0];
    } catch (err) {
      console.error('Error updating player ready status:', err);
      throw err;
    }
  },
  
  // Remove a player from a lobby
  async removePlayerFromLobby(lobbyId, userId) {
    try {
      const result = await db.query(
        `DELETE FROM lobby_players 
         WHERE lobby_id = $1 AND user_id = $2
         RETURNING *`,
        [lobbyId, userId]
      );
      
      return result.rows[0];
    } catch (err) {
      console.error('Error removing player from lobby:', err);
      throw err;
    }
  }
};

module.exports = Race;