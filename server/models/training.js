const db = require('../config/database');

/**
 * Training model responsible for adaptive practice session persistence.
 */
const TrainingModel = {
  /**
   * Create a new training session stub.
   * @param {number} userId
   * @param {Object} options
   * @param {string} options.mode
   * @param {number} options.durationSeconds
   * @param {Object} options.config
   * @param {string|null} options.snippetId
   * @returns {Promise<Object>}
   */
  async createSession(userId, { mode = 'adaptive', durationSeconds = null, config = {}, snippetId = null } = {}) {
    if (!userId) {
      throw new Error('createSession requires a userId');
    }
    const result = await db.query(
      `
        INSERT INTO training_sessions (user_id, mode, duration_seconds, config, snippet_id)
        VALUES ($1, $2, $3, $4::jsonb, $5)
        RETURNING *
      `,
      [userId, mode, durationSeconds, JSON.stringify(config || {}), snippetId]
    );
    return result.rows[0];
  },

  /**
   * Finalise a training session and persist per-character metrics.
   * @param {number} sessionId
   * @param {Object} payload
   * @param {number} payload.totalChars
   * @param {number} payload.errorCount
   * @param {number} payload.correctedErrors
   * @param {number|null} payload.wpm
   * @param {number|null} payload.accuracy
   * @param {Array<Object>} payload.charStats
   * @returns {Promise<void>}
   */
  async completeSession(sessionId, payload = {}) {
    if (!sessionId) {
      throw new Error('completeSession requires a sessionId');
    }

    const {
      totalChars = 0,
      errorCount = 0,
      correctedErrors = 0,
      wpm = null,
      accuracy = null,
      charStats = []
    } = payload;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const sessionResult = await client.query(
        `
          UPDATE training_sessions
          SET
            completed_at = now(),
            total_chars = $2,
            error_count = $3,
            corrected_errors = $4,
            wpm = $5,
            accuracy = $6
          WHERE id = $1
          RETURNING user_id
        `,
        [sessionId, totalChars, errorCount, correctedErrors, wpm, accuracy]
      );

      if (!sessionResult.rows.length) {
        throw new Error(`Training session ${sessionId} not found`);
      }

      const userId = sessionResult.rows[0].user_id;

      if (charStats.length) {
        for (const stat of charStats) {
          const character = (stat.character || ' ').slice(0, 2); // allow whitespace indicator
          const exposures = Math.max(0, parseInt(stat.exposures || 0, 10));
          const mistakes = Math.max(0, parseInt(stat.mistakes || 0, 10));
          const extraHits = Math.max(0, parseInt(stat.extraHits || 0, 10));
          const avgLatencyMs = stat.avgLatencyMs != null ? Number(stat.avgLatencyMs) : null;
          const latencySamples = Math.max(0, parseInt(stat.latencySamples || exposures || 0, 10));
          const totalLatencyMs = avgLatencyMs != null ? Math.round(avgLatencyMs * latencySamples) : 0;

          await client.query(
            `
              INSERT INTO training_session_char_stats (session_id, character, exposures, mistakes, extra_hits, avg_latency_ms)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (session_id, character) DO UPDATE
              SET exposures = training_session_char_stats.exposures + EXCLUDED.exposures,
                  mistakes = training_session_char_stats.mistakes + EXCLUDED.mistakes,
                  extra_hits = training_session_char_stats.extra_hits + EXCLUDED.extra_hits,
                  avg_latency_ms = EXCLUDED.avg_latency_ms
            `,
            [sessionId, character, exposures, mistakes, extraHits, avgLatencyMs]
          );

          await client.query(
            `
              INSERT INTO training_user_char_totals (user_id, character, exposures, mistakes, extra_hits, total_latency_ms, latency_samples, last_seen)
              VALUES ($1, $2, $3, $4, $5, $6, $7, now())
              ON CONFLICT (user_id, character) DO UPDATE
              SET
                exposures = training_user_char_totals.exposures + EXCLUDED.exposures,
                mistakes = training_user_char_totals.mistakes + EXCLUDED.mistakes,
                extra_hits = training_user_char_totals.extra_hits + EXCLUDED.extra_hits,
                total_latency_ms = training_user_char_totals.total_latency_ms + EXCLUDED.total_latency_ms,
                latency_samples = training_user_char_totals.latency_samples + EXCLUDED.latency_samples,
                last_seen = now()
            `,
            [userId, character, exposures, mistakes, extraHits, totalLatencyMs, latencySamples]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error completing training session:', err);
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Fetch per-character totals for a user.
   * @param {number} userId
   * @returns {Promise<Array>}
   */
  async getCharTotals(userId) {
    if (!userId) return [];
    const result = await db.query(
      `
        SELECT character, exposures, mistakes, extra_hits, total_latency_ms, latency_samples, last_seen
        FROM training_user_char_totals
        WHERE user_id = $1
        ORDER BY mistakes DESC, exposures DESC
      `,
      [userId]
    );
    return result.rows;
  },

  /**
   * Fetch a user's recent training sessions.
   * @param {number} userId
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async getRecentSessions(userId, limit = 20) {
    if (!userId) return [];
    const result = await db.query(
      `
        SELECT id, created_at, completed_at, mode, duration_seconds,
               total_chars, error_count, corrected_errors, wpm, accuracy
        FROM training_sessions
        WHERE user_id = $1
          AND completed_at IS NOT NULL
        ORDER BY completed_at DESC
        LIMIT $2
      `,
      [userId, limit]
    );
    return result.rows;
  },

  /**
   * Determine recommended focus letters based on mistake rate.
   * @param {number} userId
   * @param {number} limit
   * @returns {Promise<Array<string>>}
   */
  async getRecommendations(userId, limit = 5) {
    const totals = await this.getCharTotals(userId);
    if (!totals.length) {
      return [];
    }
    const scored = totals
      .filter((row) => row.exposures > 0)
      .map((row) => {
        const mistakeRate = row.exposures > 0 ? row.mistakes / row.exposures : 0;
        return {
          char: row.character,
          mistakeRate,
          mistakes: row.mistakes,
          exposures: row.exposures
        };
      })
      .sort((a, b) => {
        if (b.mistakeRate === a.mistakeRate) {
          return b.mistakes - a.mistakes;
        }
        return b.mistakeRate - a.mistakeRate;
      });
    return scored.slice(0, limit).map((row) => row.char);
  },

  /**
   * Produce a summary bundle including totals, char breakdown, and recommendations.
   * @param {number} userId
   * @returns {Promise<Object>}
   */
  async getSummary(userId) {
    if (!userId) {
      return {
        totals: {},
        charTotals: [],
        recommendations: []
      };
    }

    const totalsResult = await db.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed_sessions,
          AVG(wpm) FILTER (WHERE wpm IS NOT NULL) AS avg_wpm,
          AVG(accuracy) FILTER (WHERE accuracy IS NOT NULL) AS avg_accuracy,
          MAX(completed_at) AS last_completed
        FROM training_sessions
        WHERE user_id = $1
      `,
      [userId]
    );

    const totals = totalsResult.rows[0] || {};
    const charTotals = await this.getCharTotals(userId);
    const recommendations = await this.getRecommendations(userId);

    const formattedCharTotals = charTotals.map((row) => {
      const exposures = Number(row.exposures || 0);
      const mistakes = Number(row.mistakes || 0);
      const accuracy = exposures > 0 ? ((exposures - mistakes) / exposures) * 100 : 100;
      const latencySamples = Number(row.latency_samples || 0);
      const avgLatency =
        latencySamples > 0 ? Number(row.total_latency_ms || 0) / latencySamples : null;

      return {
        character: row.character,
        exposures,
        mistakes,
        extraHits: Number(row.extra_hits || 0),
        accuracy,
        avgLatencyMs: avgLatency
      };
    });

    return {
      totals: {
        completedSessions: Number(totals.completed_sessions || 0),
        avgWpm: totals.avg_wpm != null ? Number(totals.avg_wpm) : null,
        avgAccuracy: totals.avg_accuracy != null ? Number(totals.avg_accuracy) : null,
        lastCompletedAt: totals.last_completed
      },
      charTotals: formattedCharTotals,
      recommendations
    };
  }
};

module.exports = TrainingModel;
