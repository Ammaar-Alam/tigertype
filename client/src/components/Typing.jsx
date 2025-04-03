import { useState, useEffect, useRef } from 'react';
import { useRace } from '../context/RaceContext';
import './Typing.css';

function Typing() {
  const { raceState, typingState, updateProgress, setRaceState } = useRace();
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const typingAreaRef = useRef(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Cursor specific refs and state
  const blinkIntervalRef = useRef(null);
  const cursorAnimationTimeoutRef = useRef(null); // Use for scroll fallback if needed
  const currentCursorSpanRef = useRef(null); 
  const [isCursorVisibleForBlink, setIsCursorVisibleForBlink] = useState(true);
  const BLINK_SPEED = 530; // ms
  const SCROLL_MARGIN = 50; // px

  // Gets latest typingState.position (keep for potential stats calculation)
  const positionRef = useRef(typingState.position);
  useEffect(() => {
    positionRef.current = typingState.position;
  }, [typingState.position]);

  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Fira+Code&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { // Cleanup font link
      document.head.removeChild(link);
    };
  }, []);

  // Focus container effect (keep)
  useEffect(() => {
    if ((raceState.inProgress || raceState.type === 'practice') && typingAreaRef.current) {
      typingAreaRef.current.focus(); 
    }
    setInput(''); 
  }, [raceState.inProgress, raceState.type, raceState.snippet]);

  const getElapsedTime = () =>
    raceState.startTime ? (Date.now() - raceState.startTime) / 1000 : 0;

  // Update elapsed time every ms
  useEffect(() => {
    let interval;
    if (raceState.inProgress && raceState.startTime) {
      interval = setInterval(() => {
        setElapsedTime(getElapsedTime());
      }, 1);
    } else {
      setElapsedTime(0);
    }
  
    return () => {
      clearInterval(interval);
    };
  }, [raceState.inProgress, raceState.startTime]);
  
  // Main input handler (now called manually from keydown listener)
  const processInput = (newInput) => {
    // Special case for the first keystroke in practice mode
    if (raceState.type === 'practice' && !raceState.inProgress && !raceState.completed && input === '' && newInput.length > 0) {
      // Start the race immediately AND process this first character
      setRaceState(prev => ({
        ...prev,
        inProgress: true,
        startTime: Date.now()
      }));
      
      // Now we need to immediately update progress with this first character
      // instead of waiting for the next useEffect cycle
      setInput(newInput);
      updateProgress(newInput);
      return; // Return early since we've handled the input update
    }
    
    setInput(newInput);
    
    // Update progress only if the race has actually started
    if (raceState.inProgress) {
      updateProgress(newInput);
    }
  };
  
  // Global keyboard listener on the typing area
  useEffect(() => {
    const handleContainerKeyDown = (e) => {
      // Allow TAB and ESC to bubble up for the Race.jsx handlers
      if (e.key === 'Tab' || e.key === 'Escape') {
        return; 
      }
      
      e.preventDefault();
      let currentInput = input;
      if (e.key === 'Backspace') {
        currentInput = currentInput.slice(0, -1);
      } else if (e.key.length === 1) { // Handle printable characters
        currentInput += e.key;
      }
      
      // Process the potentially updated input
      processInput(currentInput);
    };

    const area = typingAreaRef.current;
    if (area) {
      // Use keydown for better handling of backspace etc.
      area.addEventListener('keydown', handleContainerKeyDown);
    }

    return () => {
      if (area) {
        area.removeEventListener('keydown', handleContainerKeyDown);
      }
    };
    // Rerun if the input state changes to correctly capture the current value
  }, [input, raceState.type, raceState.inProgress, raceState.completed, setRaceState, updateProgress]);
  
  // Prevent paste - might need to be on the container now?
  // Let's attach it to the container as well
  useEffect(() => {
    const handleContainerPaste = (e) => {
      e.preventDefault();
      return false;
    };
    const area = typingAreaRef.current;
    if (area) {
      area.addEventListener('paste', handleContainerPaste);
    }
    return () => {
      if (area) {
        area.removeEventListener('paste', handleContainerPaste);
      }
    };
  }, []);
  
  // *** NEW: Cursor Blinking Effect ***
  useEffect(() => {
    const typingArea = typingAreaRef.current;
    if (!typingArea) return; // Skip if not mounted
    
    let hasFocus = document.activeElement === typingArea;

    // Handle focus and blur events
    const handleFocus = () => {
      hasFocus = true;
      // Start blinking only if race is active or it's practice mode
      if ((raceState.inProgress || raceState.type === 'practice') && !typingState.completed) {
        startBlinking();
      }
    };

    const handleBlur = () => {
      hasFocus = false;
      stopBlinking();
    };

    const startBlinking = () => {
      stopBlinking(); // Clear any existing interval first
      
      const span = currentCursorSpanRef.current;
      if (!span) return; // No cursor element to blink
      
      setIsCursorVisibleForBlink(true);
      applyCursorStyle(true); 

      blinkIntervalRef.current = setInterval(() => {
        setIsCursorVisibleForBlink(prev => {
          applyCursorStyle(!prev); 
          return !prev;
        });
      }, BLINK_SPEED);
    };

    const stopBlinking = () => {
      if (blinkIntervalRef.current) {
        clearInterval(blinkIntervalRef.current);
        blinkIntervalRef.current = null;
      }
      // Only apply null style if we have a reference to avoid errors
      if (currentCursorSpanRef.current) {
        applyCursorStyle(null);
      }
    };

    // Helper to apply styles to the current cursor span - simplified to let CSS handle most of the styling
    const applyCursorStyle = (isVisible) => {
      const span = currentCursorSpanRef.current;
      if (!span) return;
      
      if (isVisible === null) { 
        // Reset styles completely on cleanup or blur
        span.classList.remove('current');
      } else {
        // The .current class now has all necessary CSS for styling
        // Just toggle opacity of the ::after element (left border) for blinking
        span.style.setProperty('--cursor-opacity', isVisible ? '1' : '0');
      }
    };

    // Add event listeners
    typingArea.addEventListener('focus', handleFocus);
    typingArea.addEventListener('blur', handleBlur);

    // Initial check - start blinking if focused and active
    if (hasFocus && (raceState.inProgress || raceState.type === 'practice') && !typingState.completed) {
      // Slight delay to ensure DOM is ready after render
      requestAnimationFrame(() => {
        startBlinking();
      });
    }

    // Cleanup on unmount or dependency change
    return () => {
      stopBlinking();
      typingArea.removeEventListener('focus', handleFocus);
      typingArea.removeEventListener('blur', handleBlur);
    };
  }, [raceState.inProgress, raceState.type, typingState.completed]);

  // *** NEW: Cursor Position & Scrolling Effect ***
  useEffect(() => {
    const snippetDisplay = typingAreaRef.current?.querySelector('.snippet-display');
    if (!snippetDisplay || !raceState.snippet) return; // Ensure snippet text exists

    const spans = snippetDisplay.querySelectorAll('span');
    const currentIndex = input.length;
    const textLength = raceState.snippet.text.length;

    // --- Update Cursor Position --- 
    if (currentCursorSpanRef.current) {
      currentCursorSpanRef.current.classList.remove('current');
      // Clear any inline styles that might have been set
      currentCursorSpanRef.current.removeAttribute('style');
    }

    // Target the correct span based on input position
    let targetSpan;
    if (currentIndex <= textLength) {
      targetSpan = spans[currentIndex];
    }

    // If we have a valid span to highlight as current
    if (targetSpan) {
      // Add the cursor class
      targetSpan.classList.add('current');
      targetSpan.classList.add('next-to-type'); // Additional class for highlighting next char
      currentCursorSpanRef.current = targetSpan;

      // --- Ensure Visible (Scrolling) --- 
      const containerRect = snippetDisplay.getBoundingClientRect();
      const cursorRect = targetSpan.getBoundingClientRect();
      
      // Calculate if we need to scroll
      let targetScrollTop = snippetDisplay.scrollTop;
      let shouldScroll = false;

      if (cursorRect.bottom > containerRect.bottom - SCROLL_MARGIN) {
        // Need to scroll down
        targetScrollTop = snippetDisplay.scrollTop + 
          (cursorRect.bottom - containerRect.bottom) + SCROLL_MARGIN;
        shouldScroll = true;
      } else if (cursorRect.top < containerRect.top + SCROLL_MARGIN) {
        // Need to scroll up
        targetScrollTop = snippetDisplay.scrollTop + 
          (cursorRect.top - containerRect.top) - SCROLL_MARGIN;
        shouldScroll = true;
      }

      // Apply scroll if needed - use smoother animation
      if (shouldScroll) {
        snippetDisplay.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        });
      }
    } else {
      currentCursorSpanRef.current = null;
    }
  // Depend on input to recalculate position
  }, [input, raceState.snippet, typingState.completed]);
  
  // Generate highlighted text - simplified to let CSS handle styling
  const getHighlightedText = () => {
    if (!raceState.snippet) return null;
    
    const text = raceState.snippet.text;
    const components = [];
    
    for (let i = 0; i < text.length; i++) {
      // Only consider correctness for typed characters
      if (i < input.length) {
        components.push(
          <span key={i} className={input[i] === text[i] ? 'correct' : 'incorrect'}>
            {text[i]}
          </span>
        );
      } else {
        // Untyped characters don't have any special class
        // The cursor effect will add 'current' class via DOM in the cursor position useEffect
        components.push(<span key={i}>{text[i]}</span>);
      }
    }
    
    // Add a space at the end for cursor to position after last character when typing is complete
    if (text.length > 0) {
      components.push(<span key={text.length}>&nbsp;</span>);
    }
    
    return components;
  };
  
  // Get progress bars
  const getProgressBars = () => {
    if (!raceState.players) return null;
    
    return raceState.players.map((player, index) => {
      const progress = player.progress || 0;
      
      return (
        <div key={index} className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          <div className="progress-label">
            {player.netid}: {progress}%
          </div>
        </div>
      );
    });
  };
  
  // Get real-time statistics
  const getStats = () => {
    if (!raceState.startTime) return null;
    
    return (
      <div className="stats">
        <div className="stat-item">
          <span className="stat-label">WPM:</span>
          <span className="stat-value">{Math.round(typingState.wpm)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Accuracy:</span>
          <span className="stat-value">{Math.round(typingState.accuracy)}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Time:</span>
          <span className="stat-value">{elapsedTime.toFixed(2)}s</span>
        </div>
      </div>
    );
  };
  
  return (
    <div 
      className="typing-area" 
      ref={typingAreaRef} 
      tabIndex="0" 
    >
      {raceState.inProgress && getStats()}
      
      <div className="snippet-display" >
        {getHighlightedText()}
      </div>
      
      <div className="typing-input-container hidden-input-container">
        <input
          ref={inputRef}
          type="text"
          value={input}
          readOnly
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          style={{ opacity: 0, position: 'absolute', top: '-9999px', left: '-9999px' }}
        />
      </div>
      
      <div className="progress-container">
        {getProgressBars()}
      </div>
    </div>
  );
}

export default Typing;