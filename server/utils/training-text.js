const { commonWords } = require('../../client/src/lib/commonWords.cjs');

/**
 * Normalize focus letters into a unique lowercase array.
 */
function normalizeFocusLetters(focusLetters = []) {
  const set = new Set();
  focusLetters
    .map((letter) => (typeof letter === 'string' ? letter.trim().toLowerCase() : ''))
    .filter((letter) => letter)
    .forEach((letter) => {
      // Keep only first character if longer strings are passed in
      set.add(letter[0]);
    });
  return Array.from(set);
}

/**
 * Pick a random element from an array.
 */
function sample(array) {
  if (!array.length) return null;
  const idx = Math.floor(Math.random() * array.length);
  return array[idx];
}

/**
 * Generate a word sequence favouring focus letters.
 */
function generateTrainingWords({
  focusLetters,
  totalWords = 100,
  wordPoolSize = 1000,
  focusBias = 0.7
}) {
  const normalizedFocus = normalizeFocusLetters(focusLetters);
  const trimmedPoolSize = Math.min(Math.max(parseInt(wordPoolSize, 10) || 1000, 50), commonWords.length);
  const basePool = commonWords.slice(0, trimmedPoolSize);

  const focusPool = normalizedFocus.length
    ? basePool.filter((word) =>
        normalizedFocus.some((letter) => word.toLowerCase().includes(letter))
      )
    : [];

  const output = [];
  for (let i = 0; i < totalWords; i += 1) {
    let word = null;
    const useFocus = focusPool.length && Math.random() < focusBias;
    if (useFocus) {
      word = sample(focusPool);
    }
    if (!word) {
      word = sample(basePool);
    }
    output.push(word || 'practice');
  }
  return output.join(' ');
}

/**
 * Create a training snippet object compatible with existing race flow.
 * @param {Object} options
 * @param {Array<string>} options.focusLetters
 * @param {number} options.duration
 * @param {number} options.wordPoolSize
 * @returns {Object}
 */
function createTrainingSnippet({ focusLetters = [], duration = 30, wordPoolSize = 1000 } = {}) {
  const normalizedFocus = normalizeFocusLetters(focusLetters);
  const text = generateTrainingWords({
    focusLetters: normalizedFocus,
    totalWords: 120,
    wordPoolSize,
    focusBias: normalizedFocus.length ? 0.75 : 0.4
  });

  return {
    id: `training-${duration}-${Date.now()}`,
    text,
    source: 'Training Mode',
    category: 'training',
    difficulty: 1,
    is_timed_test: true,
    is_training_session: true,
    duration,
    training_focus: normalizedFocus
  };
}

module.exports = {
  createTrainingSnippet,
  normalizeFocusLetters
};
