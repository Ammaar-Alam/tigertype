/**
 * Timed test generator utility
 * 
 * Creates random word sequences for timed typing tests using common English words
 */

// Common words imported from client's commonWords.js
// This is a direct copy to avoid cross-dependencies between client and server
const commonWords = [
  "the", "of", "to", "and", "a", "in", "is", "it", "you", "that", 
  "he", "was", "for", "on", "are", "with", "as", "I", "his", "they", 
  "be", "at", "one", "have", "this", "from", "or", "had", "by", "hot", 
  "word", "but", "what", "some", "we", "can", "out", "other", "were", "all", 
  "there", "when", "up", "use", "your", "how", "said", "an", "each", "she", 
  "which", "do", "their", "time", "if", "will", "way", "about", "many", "then", 
  "them", "write", "would", "like", "so", "these", "her", "long", "make", "thing", 
  "see", "him", "two", "has", "look", "more", "day", "could", "go", "come", 
  "did", "number", "sound", "no", "most", "people", "my", "over", "know", "water", 
  "than", "call", "first", "who", "may", "down", "side", "been", "now", "find", 
  "any", "new", "work", "part", "take", "get", "place", "made", "live", "where", 
  "after", "back", "little", "only", "round", "man", "year", "came", "show", "every", 
  "good", "me", "give", "our", "under", "name", "very", "through", "just", "form", 
  "sentence", "great", "think", "say", "help", "low", "line", "differ", "turn", "cause", 
  "much", "mean", "before", "move", "right", "boy", "old", "too", "same", "tell", 
  "does", "set", "three", "want", "air", "well", "also", "play", "small", "end", 
  "put", "home", "read", "hand", "port", "large", "spell", "add", "even", "land", 
  "here", "must", "big", "high", "such", "follow", "act", "why", "ask", "men", 
  "change", "went", "light", "kind", "off", "need", "house", "picture", "try", "us", 
  "again", "animal", "point", "mother", "world", "near", "build", "self", "earth", "father"
];

/**
 * Generates a random text for timed typing tests
 * 
 * @param {number} wordCount - Number of words to generate
 * @param {Object} options - Generation options
 * @param {boolean} options.capitalize - Whether to capitalize the first letter of each sentence
 * @param {boolean} options.punctuation - Whether to add punctuation
 * @returns {string} Generated text
 */
function generateTimedText(wordCount = 100, options = {}) {
  const { capitalize = true, punctuation = true } = options;
  
  // Default: select words randomly from the common words list
  let selectedWords = [];
  
  for (let i = 0; i < wordCount; i++) {
    const randomIndex = Math.floor(Math.random() * commonWords.length);
    selectedWords.push(commonWords[randomIndex]);
  }
  
  // Add punctuation and capitalization if requested
  if (punctuation || capitalize) {
    // Randomly determine sentence lengths (5-15 words)
    const sentenceWords = [];
    let currentSentence = [];
    
    for (let i = 0; i < selectedWords.length; i++) {
      currentSentence.push(selectedWords[i]);
      
      // Decide if we should end the sentence (random length between 5-15 words)
      const randomSentenceLength = Math.floor(Math.random() * 11) + 5; // 5-15 words
      
      if (currentSentence.length >= randomSentenceLength && i < selectedWords.length - 1) {
        sentenceWords.push([...currentSentence]);
        currentSentence = [];
      }
    }
    
    // Add any remaining words as the last sentence
    if (currentSentence.length > 0) {
      sentenceWords.push(currentSentence);
    }
    
    // Format sentences with capitalization and punctuation
    let formattedText = '';
    
    sentenceWords.forEach((sentence, index) => {
      let sentenceText = sentence.join(' ');
      
      // Capitalize first letter if requested
      if (capitalize) {
        sentenceText = sentenceText.charAt(0).toUpperCase() + sentenceText.slice(1);
      }
      
      // Add period at the end if punctuation is requested
      if (punctuation) {
        sentenceText += '.';
      }
      
      formattedText += sentenceText;
      
      // Add space between sentences, but not after the last one
      if (index < sentenceWords.length - 1) {
        formattedText += ' ';
      }
    });
    
    return formattedText;
  }
  
  // If no formatting, just join the words with spaces
  return selectedWords.join(' ');
}

/**
 * Creates a snippet object with the same structure as database snippets
 * but generated programmatically for timed tests
 *
 * @param {number} duration - Test duration in seconds (used to determine word count)
 * @returns {Object} Snippet object with the same structure as database snippets
 */
function createTimedTestSnippet(duration = 15) {
  // For the initial words, we'll generate enough for about 20 seconds of typing
  // This ensures users will need to request more words frequently
  const initialWordCount = 100;
  
  // Generate the text content - NO capitalization or punctuation for timed tests
  const text = generateTimedText(initialWordCount, { 
    capitalize: false, 
    punctuation: false 
  });
  
  // Create a snippet object similar to what the database would return
  return {
    id: `timed-${duration}`, // Use a special ID format to identify timed tests
    text: text,
    source: 'Timed Test',
    category: 'timed',
    difficulty: 1,
    is_timed_test: true,
    duration: duration
  };
}

module.exports = {
  generateTimedText,
  createTimedTestSnippet
}; 