// [AI DISCLAIMER: AI was used to help debug socket emit for timed tests; lines 394-408]

import { useState, useEffect, useRef } from 'react';
import { useRace } from '../context/RaceContext';
import { useSocket } from '../context/SocketContext';
import playKeySound from './Sound.jsx';
import './Settings.css';
import { useAuth } from '../context/AuthContext';
import './Typing.css';
import TutorialAnchor from './TutorialAnchor';

// Typing Tips shown before race countdown start
const TYPING_TIPS = [
  "Keep your wrists neutral and fingers curved",
  "Learn touch typing, using all ten fingers, for faster typing",
  "Learn to look at the screen, not your keyboard",
  "Take regular breaks to avoid strain",
  "Practice regularly to build muscle memory",
  "Correct posture improves typing speed",
  "Don't rush - accuracy is more important than speed",
  "Learn keyboard shortcuts to save time",
  "CTRL + BACKSPACE will delete the entire word",
  "Also try TigerSpot :)",
  "Practicing just 10-minutes of typing daily can significantly improve your speed",
  "Two players are needed to start a race",
  "If you are the last player unreadied, you will be kicked for inactivity",
  "For feedback or suggestions, contact us at: it.admin@tigerapps.org",
  "You'll unlock badges and titles as you finish more races and practice more",
  "The average typing speed is 40WPM, but for most people who type regularly, it's closer to 65WPM",
  "Typing accurately is much more important than typing quickly",

  // if any of these tooltips are removed i am resigning and dropping the class - ammaar
  "Hoagie Club is irrelevant and should be restructured",
  "Seriously, Hoagie Club is just a den of rejected TigerApps",
  "Zak Kincaid is an opp"
];

function Typing({ 
  testMode,
  testDuration,
  snippetDifficulty,
  snippetType,
  snippetDepartment
}) {
  const { raceState, setRaceState, typingState, setTypingState, updateProgress, handleInput: raceHandleInput, loadNewSnippet } = useRace();
  const { socket } = useSocket();
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [lastTabPress, setLastTabPress] = useState(0);
  const [snippetId, setSnippetId] = useState(null);
  const [tipIndex, setTipIndex] = useState(Math.floor(Math.random() * TYPING_TIPS.length));
  const [tipVisible, setTipVisible] = useState(true);
  const tipContentRef = useRef(TYPING_TIPS[tipIndex]);
  const [isShaking, setIsShaking] = useState(false);
  const [showErrorMessage, setShowErrorMessage] = useState(false);
  const tabActionInProgressRef = useRef(false);
  const [displayedWpm, setDisplayedWpm] = useState(0);
  const [capsLockEnabled, setCapsLockEnabled] = useState(false);
  
  // Use testMode and testDuration for timed tests if provided
  useEffect(() => {
    if (raceState.type !== 'practice') return;
    
    // Mode-specific updates
    if (testMode === 'timed') {
      // Enable timed test mode and set duration
      setRaceState(prev => ({
        ...prev,
        timedTest: {
          enabled: true,
          duration: testDuration || 15,
        }
      }));
    } else if (testMode === 'snippet') {
      // Disable timed test mode
      setRaceState(prev => ({
        ...prev,
        timedTest: {
          enabled: false,
          duration: 15,
        }
      }));
    }
  }, [testMode, testDuration, raceState.type, setRaceState]);

  // Use snippet filters if provided
  useEffect(() => {
    if (raceState.type === 'practice' && snippetType && snippetDifficulty) {
      // Update snippet filters in race state
      setRaceState(prev => ({
        ...prev,
        snippetFilters: {
          difficulty: snippetDifficulty || 'all',
          type: snippetType || 'all',
          department: snippetDepartment || 'all'
        }
      }));
    }
  }, [snippetDifficulty, snippetType, snippetDepartment, raceState.type, setRaceState]);
  
  // Rotate through random tips every 5 seconds before race starts
  useEffect(() => {
    if (raceState.type !== 'practice' && !raceState.inProgress && !raceState.countdown) {
      const tipInterval = setInterval(() => {
        // Step 1: Hide the current tip
        setTipVisible(false);
        
        // Step 2: After fade out completes, change the content
        setTimeout(() => {
          // Get a new random index (skipping same one again)
          let newIndex;
          do {
            newIndex = Math.floor(Math.random() * TYPING_TIPS.length);
          } while (newIndex === tipIndex);
          
          // Update the tip index
          setTipIndex(newIndex);
          tipContentRef.current = TYPING_TIPS[newIndex];
          
          // Step 3: Show the new tip
          setTipVisible(true);
        }, 600); // Give enough time for fade out to complete
        
      }, 5000);
      
      return () => clearInterval(tipInterval);
    }
  }, [raceState.type, raceState.inProgress, raceState.countdown, tipIndex]);
  
  // Update tip content ref when tipIndex changes
  useEffect(() => {
    tipContentRef.current = TYPING_TIPS[tipIndex];
  }, [tipIndex]);
  
  // Handle race countdown
  useEffect(() => {
    if (!socket || raceState.type === 'practice') return;
    
    const handleCountdown = (data) => {
      // console.log('Countdown received:', data);
      setRaceState(prev => ({
        ...prev,
        countdown: data.seconds
      }));
    };

    socket.on('race:countdown', handleCountdown);
    
    return () => {
      socket.off('race:countdown', handleCountdown);
    };
  }, [socket, raceState.type, raceState.inProgress, raceState.completed]);
  
  // Listen for text updates in timed mode
  useEffect(() => {
    if (!socket || !raceState.snippet?.is_timed_test) return;
    
    const handleTextUpdate = (data) => {
      if (data.code === raceState.code) {
        // console.log('Received new words for timed test');
        
        // Update the snippet text with the new combined text
        setRaceState(prev => ({
          ...prev,
          snippet: {
            ...prev.snippet,
            text: data.text
          }
        }));
      }
    };
    
    // Listen for text updates
    socket.on('timed:text_update', handleTextUpdate);
    
    return () => {
      socket.off('timed:text_update', handleTextUpdate);
    };
  }, [socket, raceState.code, raceState.snippet?.is_timed_test, setRaceState]);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
    };
  }, []);

  // Gets latest typingState.position
  const positionRef = useRef(typingState.position);
  useEffect(() => {
    positionRef.current = typingState.position;
  }, [typingState.position]);

  // Track snippet changes to reset input
  useEffect(() => {
    if (raceState.snippet && raceState.snippet.id !== snippetId) {
      setSnippetId(raceState.snippet.id);
      setInput('');
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      
      // Scroll the snippet container back to the top when a new snippet is loaded
      const snippetContainer = document.querySelector('.snippet-display');
      if (snippetContainer) {
        snippetContainer.scrollTop = 0;
      }
    }
  }, [raceState.snippet, snippetId]);

  // Track when loadNewSnippet is called to ensure input is reset
  useEffect(() => {
    // Listener to when the race state is reset due to ext actions
    if (!raceState.inProgress && !raceState.manuallyStarted) {
      // Reset input state when race is reset externally
      setInput('');
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      
      // Also make sure snippet container is scrolled to top
      const snippetContainer = document.querySelector('.snippet-display');
      if (snippetContainer) {
        snippetContainer.scrollTop = 0;
      }
    }
  }, [raceState.inProgress, raceState.manuallyStarted]);

  // Focus input when race starts
  useEffect(() => {
    if ((raceState.inProgress || raceState.type === 'practice') && inputRef.current) {
      inputRef.current.focus();
    }
  }, [raceState.inProgress, raceState.type]);
  
  // Focus input immediately when component mounts in practice mode
  useEffect(() => {
    if (raceState.type === 'practice' && inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Handle special key combinations like Command+Backspace on Mac
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Skip if race not in progress or input not focused
      if (!raceState.inProgress || !inputRef.current || typingState.completed) return;
      
      // Handle Command+Backspace (Mac) - simulate normal backspace behavior for word locking
      if (e.metaKey && e.key === 'Backspace') {
        e.preventDefault(); // Prevent default to avoid browser/OS handling
        
        // Get current input value
        const currentInput = inputRef.current.value;
        
        // Process what the result would be after Command+Backspace 
        // (typically deletes to beginning of line or current word)
        // We'll just delete  the current word or up to previous space
        const cursorPosition = inputRef.current.selectionStart;
        
        if (cursorPosition > 0) {
          // Find the previous word boundary
          const lastSpace = currentInput.lastIndexOf(' ', cursorPosition - 1);
          let newValue;
          
          if (lastSpace >= 0) {
            // Delete from cursor to after last space
            newValue = currentInput.substring(0, lastSpace + 1) + 
                       currentInput.substring(cursorPosition);
          } else {
            // Delete from cursor to beginning if no space
            newValue = currentInput.substring(cursorPosition);
          }
          
          // Let our existing word locking handle this modified input
          raceHandleInput(newValue);
          setInput(typingState.input);
        }
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);
    
    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [raceState.inProgress, typingState.completed, raceHandleInput, typingState.input]);

  // Prevents the user from unfocusing the input box
  // Modify the unfocusing prevention effect so that you can click on settings,
  // then autofocuses after closing the settings modal or clicking outside of it

  useEffect(() => {
    const handleBodyClick = (e) => {
      // Check if this is something we should allow to be focused
      const isSettingsClick = e.target.closest('.settings-modal') ||
                              e.target.closest('.settings-icon');

      // Check if it's a select dropdown or its options
      const isSelectClick = e.target.tagName === 'SELECT' ||
                            e.target.tagName === 'OPTION' ||
                            e.target.closest('select') ||
                            e.target.closest('.config-select');

      // Special handling for close button
      if (e.target.closest('.close-button')) {
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
          }
        }, 10);
        return;
      }

      // Otherwise, force focus back to input if appropriate
      if (!isSettingsClick && !isSelectClick && inputRef.current) {
        inputRef.current.focus();
      }
    };

    // Add event listener for select change to refocus after selection
    const handleSelectChange = () => {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 10);
    };

    // Add listeners
    document.body.addEventListener('click', handleBodyClick);
    const selectElements = document.querySelectorAll('select');
    selectElements.forEach(select => {
      select.addEventListener('change', handleSelectChange);
    });

    return () => {
      document.body.removeEventListener('click', handleBodyClick);
      const selectElements = document.querySelectorAll('select');
      selectElements.forEach(select => {
        select.removeEventListener('change', handleSelectChange);
      });
    };
  }, []); 

  // Handle keyboard shortcuts for practice mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (raceState.type !== 'practice') return;

      // Tab: Load new snippet
      if (e.key === 'Tab') {
        e.preventDefault();
        
        // IMPORTANT: Only execute this event on keydown, not keypress or other events
        // This is the key fix to prevent duplicate lobbies without limiting spam ability
        if (e.type !== 'keydown') return;
        
        // Get current progress data before clearing input
        const progressData = {
          typedLength: input.length,
          input: input
        };
        
        // Send race:cancel event with progress data to track partial words
        if (socket && input.length > 0) {
          socket.emit('race:cancel', progressData);
        }
        
        // Clear input immediately
        setInput('');
        if (inputRef.current) {
          inputRef.current.value = '';
        }
        
        // Scroll the snippet container back to the top before loading new snippet
        const snippetContainer = document.querySelector('.snippet-display');
        if (snippetContainer) {
          snippetContainer.scrollTop = 0;
        }
        
        // Request new snippet
        loadNewSnippet();
      }
      
      // Escape: Restart current snippet
      if (e.key === 'Escape') {
        e.preventDefault();
        // Reset the input and restart the current race
        setInput('');
        if (inputRef.current) {
          inputRef.current.value = '';
        }
        // Reset typing state
        setTypingState({
          input: '',
          position: 0,
          correctChars: 0,
          errors: 0,
          completed: false,
          wpm: 0,
          accuracy: 0,
          lockedPosition: 0
        });
        setRaceState(prev => ({
          ...prev,
          startTime: null,
          inProgress: false,
          completed: false,
          manuallyStarted: false
        }));
        
      }
    };

    // Add event listener for capturing ONLY the keydown event
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [raceState.type, loadNewSnippet, setRaceState, setTypingState]);

  const getElapsedTime = () =>
    raceState.startTime ? (Date.now() - raceState.startTime) / 1000 : 0;

  // Update elapsed time every ms
  useEffect(() => {
    let interval;
    // Only run the interval if the race is in progress AND not completed
    if (raceState.inProgress && raceState.startTime && !raceState.completed) {
      interval = setInterval(() => {
        const currentElapsedTime = getElapsedTime(); // Calculate elapsed time once
        setElapsedTime(currentElapsedTime);
        
        // For timed tests, check if time is up
        if (raceState.snippet?.is_timed_test && raceState.snippet?.duration) {
          const duration = raceState.snippet.duration;
          // Use the calculated elapsed time
          const elapsed = currentElapsedTime; 
          
          // When time is up, mark race as completed AND EMIT RESULT
          if (elapsed >= duration && !raceState.completed) {
            // console.log('Timed test completed due to time limit');

            // Recalculate final WPM using fixed duration and total characters typed
            const durationInMinutes = duration / 60;
            // Use typingState.correctChars to prevent inflation from incorrect inputs
            const finalWords = typingState.correctChars / 5;
            const finalWpm = durationInMinutes > 0 ? (finalWords / durationInMinutes) : 0;
            // Capture accuracy at the moment of completion
            const finalAccuracy = typingState.accuracy;
            
            // Mark as completed locally
            setRaceState(prev => ({
              ...prev,
              completed: true,
              // Store results directly in state using correctly calculated final values
              results: [{
                netid: user?.netid,
                wpm: finalWpm,          // Use correctly calculated WPM
                accuracy: finalAccuracy, // Use captured Accuracy
                completion_time: duration // Use fixed duration as completion time
              }]
            }));

            // --- EMIT race:result FOR TIMED TEST COMPLETION --- 
            if (socket && raceState.code && raceState.snippet?.is_timed_test) { // Only emit for timed tests
              socket.emit('race:result', {
                code: raceState.code,
                lobbyId: null, // Practice mode lobbyId is null/irrelevant here
                snippetId: raceState.snippet?.id, // ex: 'timed-15'
                wpm: finalWpm, // Use correctly calculated WPM
                accuracy: finalAccuracy, // Use captured Accuracy
                completion_time: duration // Use fixed duration as completion time
              });
              // console.log(`[Typing.jsx] Emitted race:result for timed test completion (time limit) with WPM: ${finalWpm}`);
            } else {
              console.warn('[Typing.jsx] Cannot emit race:result - socket / race code missing, or not a timed test.');
            }
            // --- END EMIT --- 

            // Clear the interval immediately after completion logic
            clearInterval(interval);
          }
        }
      }, 1); // Update frequently for smoothness
    } else {
      // Clear interval if race stops or is completed
      if (interval) clearInterval(interval);
      // If not in progress and not completed, reset to 0
      if (!raceState.inProgress && !raceState.completed) {
         setElapsedTime(0);
      }
    }
  
    return () => {
      if (interval) clearInterval(interval); // Ensure cleanup on unmount/dependency change
    };
  // Add socket, raceState.code, user?.netid to dependency array
  }, [raceState.inProgress, raceState.startTime, raceState.completed, raceState.snippet?.is_timed_test, raceState.snippet?.duration, typingState.wpm, typingState.accuracy, user?.netid, socket, raceState.code, setRaceState]); // Added socket, raceState.code, user?.netid, setRaceState

  // Smoother update for WPM instead of constantly
  useEffect(() => {
    let wpmInterval;
    if (raceState.inProgress && raceState.startTime && !raceState.completed) {
      wpmInterval = setInterval(() => {
        const time = (Date.now() - raceState.startTime) / 1000;
        const minutes = time / 60;
        // Use only correctly typed characters to calculate WPM
        const charCount = typingState.correctChars; // Use correctChars to prevent inflation from incorrect inputs
        const words = charCount / 5;
        const currentWpm = minutes > 0 ? Math.round(words / minutes) : 0;
        setDisplayedWpm(currentWpm);
      }, 50); // Update every 100ms
    } else {
      // Reset WPM display when race is not active
      setDisplayedWpm(0);
    }

    // Cleanup interval on unmount or when dependencies change
    return () => {
      if (wpmInterval) clearInterval(wpmInterval);
    };
  }, [raceState.inProgress, raceState.startTime, raceState.completed, typingState.correctChars]); // Include typingState.correctChars

  // Handle typing input with word locking
  const handleComponentInput = (e) => {
    const newInput = e.target.value;
    const text = raceState.snippet?.text || '';

    // Check if new character is correct
    const isMovingForward = newInput.length > input.length;
    const isCorrectCharacter = newInput[newInput.length - 1] === text[newInput.length - 1];

    // Play sound if typing correctly (moved before practice mode check)
    if (isMovingForward && isCorrectCharacter) {
      playKeySound();
    }
    
    // For practice mode, start the race on first keypress
    if (raceState.type === 'practice' && !raceState.inProgress && !raceState.completed && newInput.length === 1) {
      // Update race state locally for practice mode
      const startTime = Date.now();
      setRaceState(prev => ({
        ...prev,
        startTime: startTime,
        inProgress: true,
        manuallyStarted: true // Set flag to indicate we manually started the race
      }));
      
      // Continue processing this first character instead of ignoring it
      if (raceState.inProgress) {
        raceHandleInput(newInput);
      } else {
        // Since raceState.inProgress hasn't updated yet in this render cycle,
        // we need to directly set the input so the character appears
        setInput(newInput);
        // Schedule an update after the state has changed
        setTimeout(() => raceHandleInput(newInput), 0);
      }
      return;
    }
    
    // Detect errors to trigger shake animation
    if (raceState.inProgress) {
      const text = raceState.snippet?.text || '';      
      // For timed tests, check if we need to get more words
      // Request when the user has typed about X% of the way through the text
      if (raceState.snippet?.is_timed_test && 
          newInput.length > text.length * 0.75 && 
          !raceState.completed) {
        // Request fewer words to be appended to the current text
        socket.emit('timed:more_words', {
          code: raceState.code,
          wordCount: 15 // Request 1 more words
        });
      }
      // Prevent typing past the end of the snippet
      if (newInput.length >= text.length + 1) {
        return;
      }
      
      // Check if there's a typing error (improved to check all characters)
      let hasError = false;
      
      // Check for any error in the entire input
      for (let i = 0; i < newInput.length && i < text.length; i++) {
        if (newInput[i] !== text[i]) {
          hasError = true;
          break;
        }
      }
      
      // Only trigger shake and error message on a new error
      if (hasError && !isShaking) {
        setIsShaking(true);
        setShowErrorMessage(true);
        
        // Remove the shake class after animation completes
        setTimeout(() => {
          setIsShaking(false);
        }, 500);
        
        // Hide error message after 1.5s (seems to be reasonable time)
        setTimeout(() => {
          setShowErrorMessage(false);
        }, 1500);
      }
      
      // Use the handleInput function from RaceContext
      raceHandleInput(newInput);

      // Update local input state to match what's in the typing state
      // This ensures the displayed input matches the processed input after word locking
      setInput(typingState.input);
    } else {
      // Prevent typing past the end of the snippet
      if (raceState.snippet && newInput.length > raceState.snippet.text.length) {
        return;
      }
      setInput(newInput);
    }
  }
  
  // Sync input with typingState.input to ensure locked words can't be deleted
  useEffect(() => {
    if (raceState.inProgress) {
      setInput(typingState.input);
    }
  }, [typingState.input, raceState.inProgress]);
  
  // Prevent paste
  const handlePaste = (e) => {
    e.preventDefault();
    return false;
  };
  
  // Generate highlighted text
  const getHighlightedText = () => {
    if (!raceState.snippet) return null;
    
    const text = raceState.snippet.text;
    
    // Split text by words, maintaining spaces between them
    const renderNonBreakingText = () => {
      const words = text.split(' ');
      const components = [];
      let charIndex = 0;
      let hasEncounteredError = false;
      
      words.forEach((word, wordIndex) => {
        // For each word, render each character
        const wordChars = [];
        for (let i = 0; i < word.length; i++) {
          const charPos = charIndex + i;
          
          if (charPos < input.length) {
            if (input[charPos] === text[charPos] && !hasEncounteredError) {
              wordChars.push(<span key={`${wordIndex}-${i}`} className="correct">{word[i]}</span>);
            } else {
              hasEncounteredError = true;
              wordChars.push(<span key={`${wordIndex}-${i}`} className="incorrect">{word[i]}</span>);
            }
          } else if (charPos === input.length) {
            wordChars.push(<span key={`${wordIndex}-${i}`} className="current">{word[i]}</span>);
          } else {
            wordChars.push(<span key={`${wordIndex}-${i}`}>{word[i]}</span>);
          }
        }
        
        // Add the word with non-breaking wrapper
        components.push(
          <span key={`word-${wordIndex}`} style={{display: 'inline-block', whiteSpace: 'nowrap'}}>
            {wordChars}
          </span>
        );
        
        // Add space after each word (except the last)
        if (wordIndex < words.length - 1) {
          const spacePos = charIndex + word.length;
          
          if (spacePos < input.length) {
            if (input[spacePos] === ' ' && !hasEncounteredError) {
              components.push(<span key={`space-${wordIndex}`} className="correct"> </span>);
            } else {
              hasEncounteredError = true;
              components.push(<span key={`space-${wordIndex}`} className="incorrect"> </span>);
            }
          } else if (spacePos === input.length) {
            components.push(<span key={`space-${wordIndex}`} className="current"> </span>);
          } else {
            components.push(<span key={`space-${wordIndex}`}> </span>);
          }
          
          charIndex += word.length + 1; // +1 for the space
        } else {
          charIndex += word.length;
        }
      });
      
      return components;
    };
    
    return renderNonBreakingText();
  };
    
  // Auto-scroll to keep cursor in view
  useEffect(() => {
    if (raceState.inProgress && input.length > 0) {
      // Find the current element (the character the user is about to type)
      const currentElement = document.querySelector('.current');
      if (currentElement) {
        // Get the container
        const container = document.querySelector('.snippet-display');
        if (container) {
          // Calculate position to keep the current element in the middle of the viewport
          const containerRect = container.getBoundingClientRect();
          const currentRect = currentElement.getBoundingClientRect();
          
          // Get the relative position within the container
          const relativeTop = currentRect.top - containerRect.top;
          
          // Check if the element is getting close to the bottom of the viewport
          if (relativeTop > containerRect.height * 0.6) {
            // Scroll to keep the current element at 1/3 of the container height
            container.scrollTop = container.scrollTop + (relativeTop - containerRect.height / 3);
          }
        }
      }
    }
  }, [input.length, raceState.inProgress]);
  
  // Render stats placeholder (before practice starts)
  const getStatsPlaceholder = () => {
    // Determine if user's in a timed‑test placeholder state
    const isTimedTest = raceState.snippet?.is_timed_test && raceState.snippet?.duration;

    // If it is a timed test, default the display to the full duration (ex: 15.00s left)
    const defaultTimeDisplay = isTimedTest
      ? `${parseFloat(raceState.snippet.duration).toFixed(2)}s`
      : '0.00s';

    return (
      <div className="stats practice-placeholder">
        <div className="stat-item">
          <span className="stat-label">WPM</span>
          <span className="stat-value">--</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Accuracy</span>
          <span className="stat-value">--</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Time</span>
          <span className="stat-value">{defaultTimeDisplay}</span>
        </div>
      </div>
    );
  };

  // Render live stats during race
  const getStats = () => {
    // Don't show stats if race is completed 
    //(Results component will show final stats)
    if (raceState.completed) return null;
    
    // Use accuracy directly from typingState which is now calculated properly
    const accuracy = typingState.accuracy;
    
    // For timed tests, show time remaining instead of elapsed time
    let timeDisplay;
    const time = elapsedTime || getElapsedTime(); // Keep calculating elapsed time for display
    if (raceState.snippet?.is_timed_test && raceState.snippet?.duration) {
      const timeRemaining = Math.max(0, raceState.snippet.duration - time);
      timeDisplay = `${timeRemaining.toFixed(2)}s left`;
    } else {
      timeDisplay = `${time.toFixed(2)}s`;
    }
      
    return (
      <div className="stats">
        <div className="stat-item">
          <span className="stat-label">WPM</span>
          {/* Use the smoothed displayedWpm state */}
          <span className="stat-value">{displayedWpm}</span> 
        </div>
        <div className="stat-item">
          <span className="stat-label">Accuracy</span>
          <span className="stat-value">{accuracy.toFixed(0)}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Time</span>
          <span className="stat-value">{timeDisplay}</span>
        </div>
      </div>
    );
  };
  
  // Render cancel message when countdown is cancelled due to insufficient players
  const getCancelledMessage = () => {
    return (
      <div className="stats countdown-stats">
        <div className="stat-item countdown-item">
          <span className="countdown-value">Start cancelled: not enough players</span>
        </div>
      </div>
    );
  };
  
  // Render countdown in the stats area
  const getCountdown = () => {
    return (
      <div className="stats countdown-stats">
        <div className="stat-item countdown-item">
          <span className="countdown-value">{raceState.countdown}</span>
        </div>
      </div>
    );
  };
  
  // Render tips before race starts
  const getTips = () => {
    return (
      <div className="stats tips-stats">
        <div className="tool-tip tip-item">
          <span className={`tip-text ${tipVisible ? 'tip-visible tip-pulsing' : 'tip-hidden'}`}>
            {tipContentRef.current}
          </span>
        </div>
      </div>
    );
  };

  // Render tooltip for keyboard shortcuts in practice mode
  const renderPracticeTooltip = () => {
    // Only show if in practice mode AND not completed
    if (raceState.type !== 'practice' || raceState.completed) return null;

    return (
      <div className="practice-tooltip">
        <div className="tooltip-content">
          <span>Press <kbd>Tab</kbd> for new snippet • <kbd>Esc</kbd> to restart</span>
        </div>
      </div>
    );
  };
  
  // Determine what content to show in the stats container
  const getStatsContent = () => {
    // For practice mode
    if (raceState.type === 'practice') {
      if (!raceState.inProgress) {
        return getStatsPlaceholder();
      } else {
        return getStats();
      }
    } 
    // For race mode
    else {
      if (raceState.countdown !== null) {
        return getCountdown();
      } else if (raceState.cancelledCountdown) {
        return getCancelledMessage();
      } else if (!raceState.inProgress) {
        return getTips();
      } else {
        return getStats();
      }
    }
  };
  
  // Add caps lock detection
  useEffect(() => {
    const checkCapsLock = (e) => {
      const capsLockOn = e.getModifierState && e.getModifierState('CapsLock');
      setCapsLockEnabled(capsLockOn);
    };

    // Check on key events
    window.addEventListener('keydown', checkCapsLock);
    window.addEventListener('keyup', checkCapsLock);
    
    // Check on focus events (in case caps lock state changes while window is not focused)
    window.addEventListener('focus', checkCapsLock);
    inputRef.current?.addEventListener('focus', checkCapsLock);

    // Initial check
    if (document.activeElement) {
      setCapsLockEnabled(document.activeElement.getModifierState && 
                         document.activeElement.getModifierState('CapsLock'));
    }

    return () => {
      window.removeEventListener('keydown', checkCapsLock);
      window.removeEventListener('keyup', checkCapsLock);
      window.removeEventListener('focus', checkCapsLock);
      inputRef.current?.removeEventListener('focus', checkCapsLock);
    };
  }, []);

  return (
    <>
      <div className="stats-container">
        {/* Caps Lock Warning */}
        {capsLockEnabled && (
          <div className="caps-lock-warning">
            <span className="caps-lock-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </span>
            Caps Lock
          </div>
        )}
        {getStatsContent()}
      </div>
      
      {/* Only show typing area (snippet + input) if race is NOT completed */}
      {!raceState.completed && (
          <div className="typing-area">
            <div className={`snippet-display ${isShaking ? 'shake-animation' : ''}`}>
              {/* Error message moved OUTSIDE snippet-display */}
              {/* 
              {showErrorMessage && (
                <div className="error-message">
                  Fix your mistake to continue
                </div>
              )} 
              */}
              {getHighlightedText()}
            </div>
            <TutorialAnchor anchorId="typing-input">
              <div className="typing-input-container">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={handleComponentInput}
                  onPaste={handlePaste}
                  className={isShaking ? 'shake' : ''}
                  disabled={
                    raceState.completed ||
                    (raceState.type !== 'practice' && !raceState.inProgress && raceState.countdown === null)
                  }
                  autoComplete="off"
                  spellCheck="false"
                  aria-label="Typing input"
                />
              </div>
            </TutorialAnchor>
          </div>
      )}
      
      {/* Render warnings */}
      {showErrorMessage && (
        <div className="error-message">
          Fix your mistake to continue
        </div>
      )}

      {renderPracticeTooltip()}
    </>
  );
}

export default Typing;