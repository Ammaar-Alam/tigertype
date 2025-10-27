const db = require('../config/database');
const {
  buildPlanFromUnits,
  createBlockSnippet,
  BASE_FALLBACK_UNITS
} = require('../utils/training-content');

const PLAN_CACHE_TTL_MS = 15 * 60 * 1000;
const planCache = new Map(); // userId -> { expires, dayKey, plan }

const UNIT_TYPES = new Set(['char', 'digit', 'digraph', 'trigraph', 'word', 'punct']);

function sanitizeUnitType(unitType) {
  const normalized = (unitType || '').toLowerCase();
  if (UNIT_TYPES.has(normalized)) {
    return normalized;
  }
  return 'char';
}

function sanitizeToken(token) {
  return (token || '').toLowerCase().trim().slice(0, 32);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDayKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

function setPlanCache(userId, plan) {
  if (!userId || !plan) return;
  planCache.set(userId, {
    expires: Date.now() + PLAN_CACHE_TTL_MS,
    dayKey: formatDayKey(),
    plan
  });
}

function getPlanCache(userId, planId = null) {
  if (!userId) return null;
  const cached = planCache.get(userId);
  if (!cached) return null;
  if (cached.expires < Date.now()) {
    planCache.delete(userId);
    return null;
  }
  const todayKey = formatDayKey();
  if (cached.dayKey && cached.dayKey !== todayKey) {
    planCache.delete(userId);
    return null;
  }
  if (planId && cached.plan.planId !== planId) {
    return null;
  }
  return cached.plan;
}

function dropPlanCache(userId) {
  if (!userId) return;
  planCache.delete(userId);
}

function normalizeUnitStats(unitStats = [], charStatsFallback = []) {
  if (Array.isArray(unitStats) && unitStats.length) {
    return unitStats
      .map((row) => {
        const unitType = sanitizeUnitType(row.unitType || row.type);
        const token = sanitizeToken(row.token || row.character);
        if (!token) return null;
        return {
          unitType,
          token,
          exposures: Math.max(0, parseInt(row.exposures || 0, 10)),
          mistakes: Math.max(0, parseInt(row.mistakes || 0, 10)),
          extraHits: Math.max(0, parseInt(row.extraHits || 0, 10)),
          latencyMsSum: Math.max(0, parseInt(row.latencyMsSum || row.totalLatencyMs || 0, 10)),
          latencySamples: Math.max(0, parseInt(row.latencySamples || 0, 10))
        };
      })
      .filter(Boolean);
  }

  return (charStatsFallback || [])
    .map((row) => {
      const token = sanitizeToken(row.character);
      if (!token) return null;
      const latencySamples = Math.max(0, parseInt(row.latencySamples || 0, 10));
      const avgLatencyMs =
        row.avgLatencyMs != null ? Number(row.avgLatencyMs) : null;
      const latencyMsSum =
        avgLatencyMs != null ? Math.round(avgLatencyMs * latencySamples) : 0;
      return {
        unitType: 'char',
        token,
        exposures: Math.max(0, parseInt(row.exposures || 0, 10)),
        mistakes: Math.max(0, parseInt(row.mistakes || 0, 10)),
        extraHits: Math.max(0, parseInt(row.extraHits || 0, 10)),
        latencyMsSum,
        latencySamples
      };
    })
    .filter(Boolean);
}

async function ensureUnits(client, unitStats = []) {
  const mapping = new Map();

  for (const stat of unitStats) {
    const unitType = sanitizeUnitType(stat.unitType);
    const token = sanitizeToken(stat.token);
    if (!token) continue;
    const key = `${unitType}:${token}`;
    if (mapping.has(key)) continue;

    const existing = await client.query(
      `
        SELECT id FROM training_units
        WHERE unit_type = $1 AND token = $2
        LIMIT 1
      `,
      [unitType, token]
    );

    if (existing.rows.length) {
      mapping.set(key, existing.rows[0].id);
      continue;
    }

    const display =
      stat.display ||
      (unitType === 'word' ? token : token.toUpperCase().slice(0, 4));

    const inserted = await client.query(
      `
        INSERT INTO training_units (unit_type, token, display)
        VALUES ($1, $2, $3)
        ON CONFLICT (unit_type, token)
        DO UPDATE SET display = EXCLUDED.display
        RETURNING id
      `,
      [unitType, token, display]
    );

    mapping.set(key, inserted.rows[0].id);
  }

  return mapping;
}

async function upsertUnitTotals(client, userId, unitId, delta) {
  const exposures = Math.max(0, parseInt(delta.exposures || 0, 10));
  const mistakes = Math.max(0, parseInt(delta.mistakes || 0, 10));
  const extraHits = Math.max(0, parseInt(delta.extraHits || 0, 10));
  const latencyMsSum = Math.max(0, parseInt(delta.latencyMsSum || 0, 10));
  const latencySamples = Math.max(0, parseInt(delta.latencySamples || 0, 10));

  await client.query(
    `
      INSERT INTO training_user_unit_totals (
        user_id, unit_id, exposures, mistakes, extra_hits,
        latency_ms_sum, latency_samples, last_seen
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (user_id, unit_id)
      DO UPDATE SET
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

function qualityFromDelta(delta) {
  const exposures = Math.max(0, parseInt(delta.exposures || 0, 10));
  const mistakes = Math.max(0, parseInt(delta.mistakes || 0, 10));
  const accuracy = exposures > 0 ? (exposures - mistakes) / Math.max(exposures, 1) : 1;
  let quality = Math.round(accuracy * 5);

  if (delta.latencyMsSum && delta.latencySamples) {
    const avgLatency = delta.latencyMsSum / Math.max(delta.latencySamples, 1);
    if (avgLatency > 450) {
      quality = Math.max(0, quality - 2);
    } else if (avgLatency > 350) {
      quality = Math.max(0, quality - 1);
    }
  }

  return Math.max(0, Math.min(5, quality));
}

function sm2Update(ease, intervalDays, quality) {
  const q = Math.max(0, Math.min(5, quality));
  let newEase =
    ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (newEase < 1.3) {
    newEase = 1.3;
  }

  let newInterval;
  if (q <= 2) {
    newInterval = 1;
  } else if (intervalDays === 0) {
    newInterval = 1;
  } else {
    newInterval = Math.max(2, Math.round(intervalDays * newEase));
  }

  return {
    ease: newEase,
    interval: newInterval,
    dueAt: addDays(new Date(), newInterval)
  };
}

async function updateSrsState(client, userId, unitId, quality) {
  const existing = await client.query(
    `
      SELECT ease, interval_days
      FROM training_user_unit_srs
      WHERE user_id = $1 AND unit_id = $2
      LIMIT 1
    `,
    [userId, unitId]
  );

  const currentEase = existing.rows.length ? Number(existing.rows[0].ease || 2.5) : 2.5;
  const currentInterval = existing.rows.length ? parseInt(existing.rows[0].interval_days || 0, 10) : 0;

  const update = sm2Update(currentEase, currentInterval, quality);
  const dueAtDate = update.dueAt;

  await client.query(
    `
      INSERT INTO training_user_unit_srs (user_id, unit_id, ease, interval_days, due_at, stability)
      VALUES ($1, $2, $3, $4, $5, NULL)
      ON CONFLICT (user_id, unit_id)
      DO UPDATE SET
        ease = EXCLUDED.ease,
        interval_days = EXCLUDED.interval_days,
        due_at = EXCLUDED.due_at,
        stability = EXCLUDED.stability
    `,
    [userId, unitId, update.ease, update.interval, dueAtDate]
  );
}

async function insertKeystrokes(client, sessionId, events = []) {
  if (!Array.isArray(events) || !events.length) return;
  const insertValues = [];
  const params = [];

  events.forEach((event, index) => {
    const idx = event.idx != null ? parseInt(event.idx, 10) : index;
    insertValues.push(
      `($1, $${params.length + 2}, $${params.length + 3}, $${params.length + 4}, $${params.length + 5}, $${params.length + 6}, $${params.length + 7}, $${params.length + 8}, $${params.length + 9})`
    );
    params.push(
      idx,
      Math.max(0, parseInt(event.tMs || event.t_ms || 0, 10)),
      (event.expected || '').slice(0, 8),
      (event.actual || '').slice(0, 8),
      Boolean(event.correct),
      Boolean(event.backspace),
      event.dwellMs != null ? parseInt(event.dwellMs, 10) : null,
      event.flightMs != null ? parseInt(event.flightMs, 10) : null
    );
  });

  await client.query(
    `
      INSERT INTO training_keystrokes (
        session_id, idx, t_ms, expected, actual, correct, backspace, dwell_ms, flight_ms
      )
      VALUES ${insertValues.join(', ')}
      ON CONFLICT (session_id, idx)
      DO UPDATE SET
        t_ms = EXCLUDED.t_ms,
        expected = EXCLUDED.expected,
        actual = EXCLUDED.actual,
        correct = EXCLUDED.correct,
        backspace = EXCLUDED.backspace,
        dwell_ms = EXCLUDED.dwell_ms,
        flight_ms = EXCLUDED.flight_ms
    `,
    [sessionId, ...params]
  );
}

const TrainingModel = {
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
    let userId = null;
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

      userId = sessionResult.rows[0].user_id;

      if (charStats.length) {
        for (const stat of charStats) {
          const character = (stat.character || ' ').slice(0, 2);
          const exposures = Math.max(0, parseInt(stat.exposures || 0, 10));
          const mistakes = Math.max(0, parseInt(stat.mistakes || 0, 10));
          const extraHits = Math.max(0, parseInt(stat.extraHits || 0, 10));
          const avgLatencyMs = stat.avgLatencyMs != null ? Number(stat.avgLatencyMs) : null;

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

          const latencySamples = Math.max(0, parseInt(stat.latencySamples || exposures || 0, 10));
          const totalLatencyMs =
            avgLatencyMs != null ? Math.round(avgLatencyMs * latencySamples) : 0;

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

      const normalizedUnits = normalizeUnitStats(unitStats, charStats);
      if (normalizedUnits.length) {
        const unitIds = await ensureUnits(client, normalizedUnits);
        for (const stat of normalizedUnits) {
          const unitType = sanitizeUnitType(stat.unitType);
          const token = sanitizeToken(stat.token);
          if (!token) continue;
          const key = `${unitType}:${token}`;
          const unitId = unitIds.get(key);
          if (!unitId) continue;

          await upsertUnitTotals(client, userId, unitId, stat);
          const quality = qualityFromDelta(stat);
          await updateSrsState(client, userId, unitId, quality);
        }
      }

      await insertKeystrokes(client, sessionId, keystrokes);

      await client.query('COMMIT');
      return { userId };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error completing training session:', err);
      throw err;
    } finally {
      client.release();
    }
  },

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

  async getUnitTotals(userId, limit = 120) {
    if (!userId) return [];
    const result = await db.query(
      `
        SELECT
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
        ORDER BY
          (t.mistakes + 1)::float / (t.exposures + 2) DESC,
          t.mistakes DESC
        LIMIT $2
      `,
      [userId, limit]
    );
    return result.rows;
  },

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

  async getRecommendations(userId, limit = 5) {
    if (!userId) return [];

    const unitRows = await db.query(
      `
        SELECT
          u.unit_type,
          u.token,
          t.exposures,
          t.mistakes
        FROM training_user_unit_totals t
        JOIN training_units u ON u.id = t.unit_id
        WHERE t.user_id = $1 AND t.exposures >= 5
        ORDER BY (t.mistakes + 1)::float / (t.exposures + 2) DESC,
                 t.mistakes DESC
        LIMIT $2
      `,
      [userId, limit]
    );

    if (unitRows.rows.length) {
      return unitRows.rows.map((row) => row.token);
    }

    const totals = await this.getCharTotals(userId);
    if (!totals.length) return [];
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

  async getSummary(userId) {
    if (!userId) {
      return {
        totals: {},
        charTotals: [],
        unitTotals: [],
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
    const unitTotals = await this.getUnitTotals(userId, 60);
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
      const latencySamples = Number(row.latency_samples || 0);
      const avgLatency =
        latencySamples > 0 ? Number(row.latency_ms_sum || 0) / latencySamples : null;

      return {
        unitType: row.unit_type,
        token: row.token,
        display: row.display || row.token,
        exposures,
        mistakes,
        extraHits: Number(row.extra_hits || 0),
        accuracy,
        avgLatencyMs: avgLatency,
        p50LatencyMs: row.p50_latency_ms != null ? Number(row.p50_latency_ms) : null,
        p90LatencyMs: row.p90_latency_ms != null ? Number(row.p90_latency_ms) : null,
        latencySamples: Number(row.latency_samples || 0),
        lastSeen: row.last_seen
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
      recommendations
    };
  },

  async getWeakUnits(userId, limit = 8) {
    if (!userId) return [];
    const result = await db.query(
      `
        SELECT
          u.unit_type,
          u.token,
          u.display,
          t.exposures,
          t.mistakes,
          t.extra_hits,
          t.latency_ms_sum,
          t.latency_samples
        FROM training_user_unit_totals t
        JOIN training_units u ON u.id = t.unit_id
        WHERE t.user_id = $1
        ORDER BY (t.mistakes + 1)::float / (t.exposures + 2) DESC,
                 t.mistakes DESC
        LIMIT $2
      `,
      [userId, limit]
    );
    return result.rows;
  },

  async getDueUnits(userId, date = new Date()) {
    if (!userId) return [];
    const today = new Date(date);
    const result = await db.query(
      `
        SELECT
          u.unit_type,
          u.token,
          u.display,
          s.due_at,
          s.ease,
          s.interval_days
        FROM training_user_unit_srs s
        JOIN training_units u ON u.id = s.unit_id
        WHERE s.user_id = $1
          AND s.due_at <= $2::date
        ORDER BY s.due_at ASC
      `,
      [userId, today]
    );
    return result.rows;
  },

  async getPlanProgress(userId, plan) {
    if (!userId || !plan) {
      return { completedBlockIds: [], completedCount: 0, nextIndex: 0 };
    }

    const planId = plan.planId;
    if (!planId) {
      return { completedBlockIds: [], completedCount: 0, nextIndex: 0 };
    }

    const blocks = Array.isArray(plan.blocks) ? plan.blocks : [];
    const blockMap = new Map(blocks.map((block, idx) => [block.id, idx]));

    const result = await db.query(
      `
        SELECT DISTINCT config->>'blockId' AS block_id
        FROM training_sessions
        WHERE user_id = $1
          AND completed_at IS NOT NULL
          AND config ? 'planId'
          AND config->>'planId' = $2
          AND completed_at >= timezone('UTC', date_trunc('day', timezone('America/New_York', now())))
      `,
      [userId, planId]
    );

    const completedBlockIds = result.rows
      .map((row) => row.block_id)
      .filter((id) => blockMap.has(id));

    const uniqueCompleted = Array.from(new Set(completedBlockIds));
    const completedCount = Math.min(uniqueCompleted.length, blocks.length);
    const completedSet = new Set(uniqueCompleted);
    const nextIndex = blocks.findIndex((block) => !completedSet.has(block.id));

    return {
      completedBlockIds: uniqueCompleted,
      completedCount,
      nextIndex: nextIndex === -1 ? blocks.length : nextIndex
    };
  },

  async getPlanForToday(userId, options = {}) {
    if (!userId) {
      const fallbackPlan = buildPlanFromUnits(BASE_FALLBACK_UNITS, { dueCount: 0, fallbackUnits: BASE_FALLBACK_UNITS });
      fallbackPlan.generatedAt = new Date().toISOString();
      return {
        plan: fallbackPlan,
        progress: { completedBlockIds: [], completedCount: 0, nextIndex: 0 }
      };
    }

    const todayKey = formatDayKey();
    let plan = getPlanCache(userId);
    if (plan) {
      const planDayKey = plan.dayKey || (plan.generatedAt ? formatDayKey(new Date(plan.generatedAt)) : null);
      if (planDayKey && planDayKey !== todayKey) {
        dropPlanCache(userId);
        plan = null;
      }
    }

    if (!plan) {
      const dueUnits = await this.getDueUnits(userId, new Date());
      const weakUnits = await this.getWeakUnits(userId, 8);
      const combined = [
        ...dueUnits.map((row) => ({ unitType: row.unit_type, token: row.token, display: row.display })),
        ...weakUnits.map((row) => ({ unitType: row.unit_type, token: row.token, display: row.display }))
      ];
      plan = buildPlanFromUnits(combined, {
        dueCount: dueUnits.length,
        fallbackUnits: BASE_FALLBACK_UNITS
      });
      plan.generatedAt = new Date().toISOString();
      plan.dayKey = todayKey;
      setPlanCache(userId, plan);
    }

    const progress = await this.getPlanProgress(userId, plan);

    return { plan, progress };
  },

  async getPlanBlock(userId, { planId, blockId, wordPoolSize }) {
    const { plan, progress } = await this.getPlanForToday(userId);
    const blocks = Array.isArray(plan.blocks) ? plan.blocks : [];

    let block = null;
    if (blockId) {
      block = blocks.find((b) => b.id === blockId) || null;
    }

    if (!block) {
      const autoIndex = progress?.nextIndex ?? 0;
      block = blocks[autoIndex] || blocks[blocks.length - 1] || null;
    }

    const snippet = createBlockSnippet(
      block,
      {
        wordPoolSize: wordPoolSize || 600,
        baseWords: block?.type === 'warmup' ? 90 : 130
      }
    );
    return { plan, progress, block, snippet };
  },

  invalidatePlan(userId) {
    dropPlanCache(userId);
  }
};

module.exports = TrainingModel;
