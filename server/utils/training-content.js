const crypto = require('crypto');
const { commonWords } = require('../../client/src/lib/commonWords.cjs');

const VOWELS = ['a', 'e', 'i', 'o', 'u'];
const BASE_FALLBACK_UNITS = [
  { unitType: 'char', token: 'e', display: 'E' },
  { unitType: 'char', token: 't', display: 'T' },
  { unitType: 'char', token: 'a', display: 'A' },
  { unitType: 'char', token: 'o', display: 'O' },
  { unitType: 'char', token: 'h', display: 'H' },
  { unitType: 'char', token: 'n', display: 'N' },
  { unitType: 'digraph', token: 'th', display: 'TH' },
  { unitType: 'digraph', token: 'he', display: 'HE' },
  { unitType: 'digraph', token: 'an', display: 'AN' },
  { unitType: 'word', token: 'practice', display: 'practice' }
];

function makePlanId() {
  const now = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `plan_${now}_${rand}`;
}

function dedupeUnits(units = []) {
  const map = new Map();
  units
    .filter((unit) => unit && unit.unitType && unit.token)
    .forEach((unit) => {
      const key = `${unit.unitType}:${unit.token}`.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          unitType: unit.unitType,
          token: unit.token,
          display: unit.display || unit.token.toUpperCase()
        });
      }
    });
  return Array.from(map.values());
}

function chunk(array, size) {
  const out = [];
  let idx = 0;
  while (idx < array.length) {
    out.push(array.slice(idx, idx + size));
    idx += size;
  }
  return out;
}

function sampleWords(pool, count) {
  if (!pool.length) return [];
  const selected = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool[idx]);
  }
  return selected;
}

function buildCharWords(charToken, count, pool) {
  const lower = charToken.toLowerCase();
  const matches = pool.filter((word) => word.includes(lower));
  const need = Math.max(0, count - matches.length);
  const generated = [];
  for (let i = 0; i < need; i += 1) {
    const vowel = VOWELS[i % VOWELS.length];
    generated.push(`${lower}${vowel}${lower}`);
    generated.push(`${vowel}${lower}${vowel}`);
  }
  return [...matches.slice(0, count), ...generated].slice(0, count);
}

function buildTokenWords(token, count, pool) {
  const lower = token.toLowerCase();
  const matches = pool.filter((word) => word.includes(lower));
  const need = Math.max(0, count - matches.length);
  const generated = [];
  for (let i = 0; i < need; i += 1) {
    const vowel = VOWELS[i % VOWELS.length];
    generated.push(`${lower}${vowel}`);
    generated.push(`${vowel}${lower}`);
  }
  return [...matches.slice(0, count), ...generated].slice(0, count);
}

function buildWordRepeats(word, count) {
  return Array.from({ length: count }, () => word);
}

function createUnitSegment(unit, { pool, targetLength = 14 }) {
  switch (unit.unitType) {
    case 'char':
    case 'digit':
      return buildCharWords(unit.token, targetLength, pool);
    case 'digraph':
    case 'trigraph':
      return buildTokenWords(unit.token, targetLength, pool);
    case 'word':
      return buildWordRepeats(unit.token, targetLength);
    case 'punct': {
      const filler = pool.filter((word) => word.length <= 6);
      return filler.slice(0, targetLength).map((word, idx) => {
        if (idx % 2 === 0) {
          return `${word}${unit.token}`;
        }
        return `${word}${unit.token} ${word}`;
      });
    }
    default:
      return sampleWords(pool, targetLength);
  }
}

function interleaveSegments(segments, filler) {
  const output = [];
  let fillerIdx = 0;
  segments.forEach((segment) => {
    segment.forEach((word, idx) => {
      output.push(word);
      if ((idx + 1) % 4 === 0 && fillerIdx < filler.length) {
        output.push(filler[fillerIdx]);
        fillerIdx += 1;
      }
    });
  });
  while (fillerIdx < filler.length) {
    output.push(filler[fillerIdx]);
    fillerIdx += 1;
  }
  return output;
}

function buildPlanFromUnits(units = [], { dueCount = 0, fallbackUnits = BASE_FALLBACK_UNITS } = {}) {
  const planId = makePlanId();
  const primaryUnits = dedupeUnits(units);
  const fallback = dedupeUnits(fallbackUnits);
  const combined = dedupeUnits([...primaryUnits, ...fallback]);
  const targets = combined.slice(0, 12);
  const groups = chunk(targets, 3);

  const blocks = [];
  blocks.push({
    id: `${planId}-warmup`,
    planId,
    type: 'warmup',
    seconds: 45,
    targets: fallback.slice(0, 2)
  });

  groups.forEach((group, idx) => {
    if (!group.length) return;
    blocks.push({
      id: `${planId}-core-${idx + 1}`,
      planId,
      type: 'core',
      seconds: 60,
      targets: group
    });
  });

  blocks.push({
    id: `${planId}-cooldown`,
    planId,
    type: 'cooldown',
    seconds: 30,
    targets: fallback.slice(0, 1)
  });

  return {
    planId,
    generatedAt: new Date().toISOString(),
    dueCount,
    blocks
  };
}

function createBlockSnippet(block, { wordPoolSize = 600, fillerRatio = 0.35, baseWords = 110 } = {}) {
  const poolSize = Math.max(50, Math.min(commonWords.length, Math.round(wordPoolSize)));
  const pool = commonWords.slice(0, poolSize);
  const targetSegments = (block.targets || []).map((target) =>
    createUnitSegment(target, { pool, targetLength: Math.max(8, Math.round(baseWords / 3)) })
  );
  const totalSegmentWords = targetSegments.reduce((sum, segment) => sum + segment.length, 0);
  const fillerCount = Math.max(10, Math.round(totalSegmentWords * fillerRatio));
  const filler = sampleWords(pool, fillerCount);
  const arranged = interleaveSegments(targetSegments, filler);

  const wordsNeeded = Math.max(arranged.length, Math.round((block.seconds || 60) * 2));
  if (arranged.length < wordsNeeded) {
    arranged.push(...sampleWords(pool, wordsNeeded - arranged.length));
  }

  const text = arranged.join(' ').replace(/\s+/g, ' ').trim();

  return {
    id: `training-block-${block.id}-${Date.now()}`,
    text,
    source: 'Training Plan',
    category: 'training',
    difficulty: 1,
    is_timed_test: true,
    is_training_session: true,
    duration: block.seconds || 60,
    training_focus: (block.targets || []).map((target) => target.token),
    plan_block_id: block.id,
    plan_id: block.planId
  };
}

module.exports = {
  buildPlanFromUnits,
  createBlockSnippet,
  BASE_FALLBACK_UNITS
};
