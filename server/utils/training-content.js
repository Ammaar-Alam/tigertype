const { commonWords } = require('../../client/src/lib/commonWords.cjs');

const VOWELS = ['a', 'e', 'i', 'o', 'u'];
const CONSONANTS = 'bcdfghjklmnpqrstvwxyz'.split('');
const DEFAULT_ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('');

function pickRandom(array) {
  if (!array.length) return null;
  const idx = Math.floor(Math.random() * array.length);
  return array[idx];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function ensureArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function tokensFromCVPatterns(units = [], seconds = 45, {
  targetShare = 0.65,
  minWordLen = 2,
  maxWordLen = 5
} = {}) {
  const tokenCount = clamp(Math.round((seconds * 3.5)), 20, 220);
  const letterPool = new Set(DEFAULT_ALPHA);
  units
    .filter((u) => typeof u === 'string' && u.length === 1)
    .forEach((u) => letterPool.add(u.toLowerCase()));
  const targetLetters = ensureArray(units)
    .map((u) => (typeof u === 'string' ? u.toLowerCase() : ''))
    .filter((u) => u.length === 1);

  const tokens = [];
  let targetBudget = Math.round(tokenCount * targetShare);

  while (tokens.length < tokenCount) {
    const length = clamp(Math.floor(Math.random() * (maxWordLen - minWordLen + 1)) + minWordLen, minWordLen, maxWordLen);
    let word = '';
    let lastWasVowel = false;
    for (let i = 0; i < length; i += 1) {
      let letter;
      const useTarget = targetLetters.length && targetBudget > 0 && Math.random() < targetShare;
      if (useTarget) {
        letter = pickRandom(targetLetters);
        targetBudget -= 1;
      } else if (lastWasVowel) {
        letter = pickRandom(CONSONANTS);
      } else {
        letter = Math.random() < 0.55 ? pickRandom(VOWELS) : pickRandom(CONSONANTS);
      }
      if (!letter) {
        letter = pickRandom([...letterPool]);
      }
      word += letter;
      lastWasVowel = VOWELS.includes(letter);
    }
    tokens.push(word);
  }

  return tokens.join(' ');
}

function stitchDigraphs(digraphs = [], seconds = 45, {
  targetShare = 0.55,
  connectors = commonWords
} = {}) {
  const safeConnectors = connectors.length ? connectors : commonWords;
  const tokenCount = clamp(Math.round(seconds * 2.8), 16, 160);
  const output = [];
  let targetBudget = Math.round(tokenCount * targetShare);
  let idx = 0;
  while (output.length < tokenCount) {
    const useTarget = targetBudget > 0 && digraphs.length && (idx % 2 === 0 || Math.random() < targetShare);
    if (useTarget) {
      const dg = pickRandom(digraphs);
      const filler = pickRandom(safeConnectors);
      const joiner = `${dg}${pickRandom(['a', 'e', 'i', 'o', 'u']) || 'a'}`;
      output.push(dg);
      output.push(filler);
      output.push(joiner);
      targetBudget -= 1;
    } else {
      output.push(pickRandom(safeConnectors));
    }
    idx += 1;
  }
  return output.slice(0, tokenCount).join(' ');
}

function sampleWordsWeighted(words = commonWords, seconds = 60, {
  includeUnits = [],
  focusBias = 0.6,
  minLen = 3,
  maxLen = 10
} = {}) {
  const pool = (words || commonWords).filter((word) => word && word.length >= minLen && word.length <= maxLen);
  const focusUnits = ensureArray(includeUnits)
    .map((u) => (typeof u === 'string' ? u.toLowerCase() : ''))
    .filter(Boolean);
  const focusWords = focusUnits.length
    ? pool.filter((word) => focusUnits.some((unit) => word.toLowerCase().includes(unit)))
    : [];
  const neutralWords = pool.filter((word) => !focusUnits.some((unit) => word.toLowerCase().includes(unit)));
  const tokenCount = clamp(Math.round(seconds * 2.5), 12, 180);
  const output = [];
  while (output.length < tokenCount) {
    const useFocus = focusWords.length && Math.random() < focusBias;
    const word = useFocus ? pickRandom(focusWords) : pickRandom(neutralWords.length ? neutralWords : pool);
    output.push(word || pickRandom(pool) || 'practice');
  }
  return output.join(' ');
}

function markovCharStream(alphabet = DEFAULT_ALPHA, seconds = 45, {
  preferCV = true,
  avgLen = 4
} = {}) {
  const allowed = alphabet.length ? alphabet : DEFAULT_ALPHA;
  const tokenCount = clamp(Math.round(seconds * 3.2), 18, 200);
  const tokens = [];
  for (let i = 0; i < tokenCount; i += 1) {
    const len = clamp(Math.round(avgLen + (Math.random() * 2 - 1)), 2, 6);
    let word = '';
    let lastType = null;
    for (let j = 0; j < len; j += 1) {
      let letter;
      if (preferCV) {
        if (lastType === 'vowel') {
          letter = pickRandom(CONSONANTS);
          lastType = 'cons';
        } else {
          const useVowel = Math.random() < 0.6;
          letter = useVowel ? pickRandom(VOWELS) : pickRandom(CONSONANTS);
          lastType = useVowel ? 'vowel' : 'cons';
        }
      } else {
        letter = pickRandom(allowed);
      }
      if (!letter) {
        letter = pickRandom(allowed);
      }
      word += letter;
    }
    tokens.push(word);
  }
  return tokens.join(' ');
}

function buildBlockText(block, seconds) {
  const { type, targets = [] } = block || {};
  const targetTokens = targets.map((t) => t.token || t).filter(Boolean);
  switch (type) {
    case 'warmup':
      return sampleWordsWeighted(commonWords, seconds, { includeUnits: targetTokens, focusBias: 0.35 });
    case 'core':
      if (targetTokens.some((token) => token.length > 1)) {
        const digraphs = targetTokens.filter((token) => token.length === 2);
        if (digraphs.length) {
          return stitchDigraphs(digraphs, seconds, { targetShare: 0.6 });
        }
      }
      return genLetterDrill(targetTokens, seconds, { targetShare: 0.7 });
    case 'micro':
      return stitchDigraphs(targetTokens, Math.max(15, seconds), { targetShare: 0.7 });
    case 'pseudo':
      return genPseudoWordDrill(new Set(targetTokens), seconds || 40);
    case 'cooldown':
    default:
      return sampleWordsWeighted(commonWords, seconds, { includeUnits: targetTokens, focusBias: 0.2 });
  }
}

function genLetterDrill(units, seconds = 45, opts = {}) {
  return tokensFromCVPatterns(units, seconds, opts);
}

function genDigraphDrill(digraphs, seconds = 45, opts = {}) {
  return stitchDigraphs(digraphs, seconds, opts);
}

function genWordDrill(focusUnits, seconds = 60, opts = {}) {
  return sampleWordsWeighted(commonWords, seconds, { ...opts, includeUnits: focusUnits });
}

function genPseudoWordDrill(letterSet, seconds = 45) {
  const alphabet = letterSet && letterSet.size ? Array.from(letterSet) : DEFAULT_ALPHA;
  return markovCharStream(alphabet, seconds, { preferCV: true, avgLen: 4 });
}

function assembleBlocks(blocks = []) {
  return blocks.map((block) => ({
    ...block,
    text: buildBlockText(block, block.seconds || 45)
  }));
}

module.exports = {
  DEFAULT_ALPHA,
  assembleBlocks,
  buildBlockText,
  genDigraphDrill,
  genLetterDrill,
  genPseudoWordDrill,
  genWordDrill,
  markovCharStream,
  sampleWordsWeighted,
  stitchDigraphs,
  tokensFromCVPatterns
};
