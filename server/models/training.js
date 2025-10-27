const db = require('../config/database');
const { assembleBlocks } = require('../utils/training-content');

const UNIT_TYPE_WEIGHTS = {
  char: 1,
  digit: 1,
  punct: 1,
  digraph: 2,
  trigraph: 3,
  word: 4
};

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;

function normaliseUnitToken(token = '') {
  if (typeof token !== 'string') return '';
  return token.trim().toLowerCase().slice(0, 16);
}

function calculateMistakeRate(exposures = 0, mistakes = 0) {
  const exp = Math.max(0, Number(exposures) || 0);
  const err = Math.max(0, Number(mistakes) || 0);
  return (err + 1) / (exp + 2);
}

function calculateLatencyAverage(latencyMsSum = 0, latencySamples = 0) {
  const samples = Math.max(0, Number(latencySamples) || 0);
  if (!samples) return null;
  const sum = Number(latencyMsSum) || 0;
  return sum / samples;
}

function severityScore({
  exposures = 0,
  mistakes = 0,
  latencyAverage = null,
  latencyReference = null,
  lastSeen = null
}) {
  const mistakeRate = calculateMistakeRate(exposures, mistakes);
  let latencyScore = 0;
  if (latencyAverage != null && latencyReference != null && latencyReference > 0) {
    const over = latencyAverage / latencyReference;
    latencyScore = Math.max(0, over - 1);
  }
  let recencyScore = 0.1;
  if (lastSeen) {
    const deltaMs = Date.now() - new Date(lastSeen).getTime();
    const days = deltaMs / (1000 * 60 * 60 * 24);
    const weight = Math.exp(-Math.max(0, days) / 7);
    recencyScore = 0.1 * (1 - weight);
  }
  return 0.6 * mistakeRate + 0.3 * latencyScore + recencyScore;
}

function qualityFromStats({ accuracyPct = 100, latency = null, baselineLatency = null }) {
  const accQ = Math.round(accuracyPct / 20);
  let penalty = 0;
  if (latency != null && baselineLatency) {
    if (latency > baselineLatency * 1.2) {
      penalty = 2;
    } else if (latency > baselineLatency * 1.1) {
      penalty = 1;
    }
  }
  return Math.max(0, Math.min(5, accQ - penalty));
}

function sm2Update({ ease = DEFAULT_EASE, interval = 0 }, quality) {
  const clampedQ = Math.max(0, Math.min(5, Number(quality) || 0));
  const newEase = Math.max(
    MIN_EASE,
    ease + (0.1 - (5 - clampedQ) * (0.08 + (5 - clampedQ) * 0.02))
  );
  let newInterval = 1;
  if (clampedQ <= 2) {
    newInterval = 1;
  } else if (interval <= 1) {
    newInterval = 1;
  } else {
    newInterval = Math.round(interval * newEase);
  }
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + newInterval);
  return { ease: newEase, interval: newInterval, dueAt };
}

async function ensureUnit(unitType, token, display = null, client = db) {
  const type = (unitType || 'char').toLowerCase();
  const normalisedToken = normaliseUnitToken(token);
  if (!normalisedToken) {
    throw new Error('ensureUnit requires a token');
  }
  const result = await client.query(
    `
      INSERT INTO training_units (unit_type, token, display)
      VALUES ($1, $2, $3)
      ON CONFLICT (unit_type, token)
      DO UPDATE SET display = COALESCE(training_units.display, EXCLUDED.display)
      RETURNING id
    `,
    [type, normalisedToken, display]
  );
  return result.rows[0].id;
}

async function upsertUnitTotals(client, userId, unitId, {
  exposures = 0,
  mistakes = 0,
  extraHits = 0,
  latencyMsSum = 0,
  latencySamples = 0
} = {}) {
  await client.query(
    `
      INSERT INTO training_user_unit_totals (user_id, unit_id, exposures, mistakes, extra_hits, latency_ms_sum, latency_samples, last_seen)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (user_id, unit_id) DO UPDATE
      SET
        exposures = training_user_unit_totals.exposures + EXCLUDED.exposures,
        mistakes = training_user_unit_totals.mistakes + EXCLUDED.mistakes,
        extra_hits = training_user_unit_totals.extra_hits + EXCLUDED.extra_hits,
        latency_ms_sum = training_user_unit_totals.latency_ms_sum + EXCLUDED.latency_ms_sum,
        latency_samples = training_user_unit_totals.latency_samples + EXCLUDED.latency_samples,
        last_seen = now()
    `,
    [userId, unitId, exposures, mistakes, extraHits, latencyMsSum, latencySamples]
  );
}

async function updateSrsState(client, userId, unitId, quality) {
  const current = await client.query(
    `
      SELECT ease, interval_days
      FROM training_user_unit_srs
      WHERE user_id = $1 AND unit_id = $2
    `,
    [userId, unitId]
  );

  const prev = current.rows[0] || { ease: DEFAULT_EASE, interval_days: 0 };
  const next = sm2Update({ ease: Number(prev.ease) || DEFAULT_EASE, interval: Number(prev.interval_days) || 0 }, quality);

  await client.query(
    `
      INSERT INTO training_user_unit_srs (user_id, unit_id, ease, interval_days, due_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, unit_id) DO UPDATE
      SET ease = EXCLUDED.ease,
          interval_days = EXCLUDED.interval_days,
          due_at = EXCLUDED.due_at
    `,
    [userId, unitId, next.ease, next.interval, next.dueAt]
  );
  return next;
}

async function fetchUnitTotals(userId) {
  const result = await db.query(
    `
      SELECT
        u.id,
        u.unit_type,
        u.token,
        u.display,
        t.exposures,
        t.mistakes,
        t.extra_hits,
        t.latency_ms_sum,
        t.latency_samples,
        t.p50_latency_ms,
        t.p90_latency_ms,
        t.last_seen
      FROM training_user_unit_totals t
      JOIN training_units u ON u.id = t.unit_id
      WHERE t.user_id = $1
    `,
    [userId]
  );
  return result.rows;
}

async function fetchUserSrs(userId) {
  const result = await db.query(
    `
      SELECT unit_id, ease, interval_days, due_at
      FROM training_user_unit_srs
      WHERE user_id = $1
    `,
    [userId]
  );
  const map = new Map();
  result.rows.forEach((row) => {
    map.set(row.unit_id, row);
  });
  return map;
}

function computeBaselines(unitRows = []) {
  const totals = unitRows.reduce(
    (acc, row) => {
      const avg = calculateLatencyAverage(row.latency_ms_sum, row.latency_samples);
      if (avg != null) {
        acc.sum += avg * (row.latency_samples || 1);
        acc.samples += row.latency_samples || 1;
      }
      acc.mistakeWeighted += calculateMistakeRate(row.exposures, row.mistakes);
      acc.items += 1;
      return acc;
    },
    { sum: 0, samples: 0, mistakeWeighted: 0, items: 0 }
  );
  const latency = totals.samples ? totals.sum / totals.samples : null;
  const mistakeRate = totals.items ? totals.mistakeWeighted / totals.items : 0.04;
  return { latency, mistakeRate };
}

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const output = [];
  arr.forEach((item) => {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(item);
    }
  });
  return output;
}

function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

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
  async createSession(
    userId,
    { mode = 'adaptive', durationSeconds = null, config = {}, snippetId = null, plan = null } = {}
  ) {
    if (!userId) {
      throw new Error('createSession requires a userId');
    }
    const payloadConfig = { ...config };
    if (plan) {
      payloadConfig.plan = plan;
    }
    const result = await db.query(
      `
        INSERT INTO training_sessions (user_id, mode, duration_seconds, config, snippet_id)
        VALUES ($1, $2, $3, $4::jsonb, $5)
        RETURNING *
      `,
      [userId, mode, durationSeconds, JSON.stringify(payloadConfig || {}), snippetId]
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
      charStats = [],
      unitStats = [],
      keystrokes = []
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

      let baselineRows = [];
      if (unitStats && unitStats.length) {
        const baselineResult = await client.query(
          `
            SELECT exposures, mistakes, latency_ms_sum, latency_samples
            FROM training_user_unit_totals
            WHERE user_id = $1
          `,
          [userId]
        );
        baselineRows = baselineResult.rows;
      }
      const baselines = computeBaselines(baselineRows);

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

      if (Array.isArray(unitStats) && unitStats.length) {
        for (const stat of unitStats) {
          const token = normaliseUnitToken(stat.token || stat.character || stat.unit || '');
          if (!token) continue;
          const unitType = (stat.unitType || (token.length > 1 ? 'digraph' : 'char')).toLowerCase();
          const display = stat.display || token.toUpperCase();
          const exposures = Math.max(0, parseInt(stat.exposures || 0, 10));
          const mistakes = Math.max(0, parseInt(stat.mistakes || 0, 10));
          const extraHits = Math.max(0, parseInt(stat.extraHits || 0, 10));
          const latencySamples = Math.max(0, parseInt(stat.latencySamples || stat.latencyCount || 0, 10));
          const latencyMsSum = Math.max(0, parseInt(stat.latencyMsSum || stat.latencyTotal || 0, 10));
          const unitId = await ensureUnit(unitType, token, display, client);

          await upsertUnitTotals(client, userId, unitId, {
            exposures,
            mistakes,
            extraHits,
            latencyMsSum,
            latencySamples
          });

          const accuracyPct = exposures > 0 ? ((exposures - mistakes) / exposures) * 100 : 100;
          const latencyAvg = latencySamples > 0 ? latencyMsSum / latencySamples : null;
          const quality = qualityFromStats({
            accuracyPct,
            latency: latencyAvg,
            baselineLatency: baselines.latency
          });
          await updateSrsState(client, userId, unitId, quality);
        }
      }

      if (Array.isArray(keystrokes) && keystrokes.length) {
        const values = keystrokes
          .filter((event) => event && Number.isInteger(event.t))
          .map((event, idx) => ({
            idx: Number.isInteger(event.idx) ? event.idx : idx,
            t: event.t,
            expected: (event.expected || '').toString(),
            actual: (event.actual || '').toString(),
            correct: Boolean(event.correct),
            backspace: Boolean(event.backspace),
            dwell: event.dwellMs != null ? parseInt(event.dwellMs, 10) : null,
            flight: event.flightMs != null ? parseInt(event.flightMs, 10) : null
          }));
        if (values.length) {
          const insertValues = values
            .map(
              (event) =>
                client.query(
                  `
                    INSERT INTO training_keystrokes (session_id, idx, t_ms, expected, actual, correct, backspace, dwell_ms, flight_ms)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (session_id, idx) DO UPDATE
                    SET expected = EXCLUDED.expected,
                        actual = EXCLUDED.actual,
                        correct = EXCLUDED.correct,
                        backspace = EXCLUDED.backspace,
                        dwell_ms = EXCLUDED.dwell_ms,
                        flight_ms = EXCLUDED.flight_ms
                  `,
                  [
                    sessionId,
                    event.idx,
                    event.t,
                    event.expected,
                    event.actual,
                    event.correct,
                    event.backspace,
                    event.dwell,
                    event.flight
                  ]
                )
            );
          await Promise.all(insertValues);
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

  async getUnitTotals(userId) {
    if (!userId) return [];
    return fetchUnitTotals(userId);
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

  async getWeakUnits(userId, limit = 6) {
    if (!userId) return [];
    const totals = await fetchUnitTotals(userId);
    if (!totals.length) {
      return [];
    }
    const baselines = computeBaselines(totals);
    const latencyReference = baselines.latency || 220;
    const scored = totals
      .filter((row) => (row.exposures || 0) > 5)
      .map((row) => {
        const latencyAverage = row.p90_latency_ms || calculateLatencyAverage(row.latency_ms_sum, row.latency_samples);
        const severity = severityScore({
          exposures: row.exposures,
          mistakes: row.mistakes,
          latencyAverage,
          latencyReference,
          lastSeen: row.last_seen
        });
        return {
          id: row.id,
          unitType: row.unit_type,
          token: row.token,
          display: row.display || row.token,
          exposures: Number(row.exposures || 0),
          mistakes: Number(row.mistakes || 0),
          latencyAverage,
          severity
        };
      })
      .sort((a, b) => b.severity - a.severity);
    return scored.slice(0, limit);
  },

  async getDueUnits(userId, date = new Date()) {
    if (!userId) return [];
    const targetDate = date instanceof Date ? date.toISOString().slice(0, 10) : date;
    const result = await db.query(
      `
        SELECT
          u.id,
          u.unit_type,
          u.token,
          u.display,
          s.ease,
          s.interval_days,
          s.due_at
        FROM training_user_unit_srs s
        JOIN training_units u ON u.id = s.unit_id
        WHERE s.user_id = $1
          AND s.due_at <= $2::date
        ORDER BY s.due_at ASC, s.interval_days DESC
      `,
      [userId, targetDate]
    );
    return result.rows.map((row) => ({
      id: row.id,
      unitType: row.unit_type,
      token: row.token,
      display: row.display || row.token,
      ease: Number(row.ease || DEFAULT_EASE),
      intervalDays: Number(row.interval_days || 0),
      dueAt: row.due_at
    }));
  },

  async getPlanForToday(userId, { maxCoreBlocks = 4 } = {}) {
    const weak = await this.getWeakUnits(userId, 8);
    const due = await this.getDueUnits(userId, new Date());
    let focus = uniqueBy([...due, ...weak], (item) => `${item.unitType}:${item.token}`);
    if (!focus.length) {
      // seed with common high-yield letters
      focus = [
        { unitType: 'char', token: 't', display: 'T' },
        { unitType: 'char', token: 'h', display: 'H' },
        { unitType: 'char', token: 'e', display: 'E' }
      ];
    }
    const warmupTargets = focus.slice(0, 2);
    const blocks = [{ type: 'warmup', seconds: 45, targets: warmupTargets }];
    const coreChunks = chunkArray(focus, 3).slice(0, maxCoreBlocks);
    coreChunks.forEach((targets) => {
      blocks.push({ type: 'core', seconds: 60, targets });
    });
    blocks.push({ type: 'cooldown', seconds: 30, targets: warmupTargets });
    const assembled = assembleBlocks(blocks);
    return {
      blocks: assembled,
      focus,
      dueCount: due.length
    };
  },

  async getDiagnostics(userId) {
    const [weak, due] = await Promise.all([
      this.getWeakUnits(userId, 8),
      this.getDueUnits(userId, new Date())
    ]);
    return { weak, due };
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
    const [charTotals, unitTotals, diagnostics] = await Promise.all([
      this.getCharTotals(userId),
      this.getUnitTotals(userId),
      this.getDiagnostics(userId)
    ]);
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

    const formattedUnitTotals = unitTotals.map((row) => {
      const exposures = Number(row.exposures || 0);
      const mistakes = Number(row.mistakes || 0);
      const accuracy = exposures > 0 ? ((exposures - mistakes) / exposures) * 100 : 100;
      const latencyAvg = calculateLatencyAverage(row.latency_ms_sum, row.latency_samples);
      return {
        id: row.id,
        unitType: row.unit_type,
        token: row.token,
        display: row.display || row.token,
        exposures,
        mistakes,
        accuracy,
        latencyAvg,
        p50Latency: row.p50_latency_ms != null ? Number(row.p50_latency_ms) : null,
        p90Latency: row.p90_latency_ms != null ? Number(row.p90_latency_ms) : null
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
      unitTotals: formattedUnitTotals,
      recommendations,
      diagnostics
    };
  }
};

module.exports = TrainingModel;
