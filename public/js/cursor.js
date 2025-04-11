/**
 * CursorManager Class
 * Manages text cursor display, animation, and positioning
 */
class CursorManager {
    /**
     * Create a new cursor manager
     */
    constructor() {
      this.blinkInterval = null;
      this.cursorVisible = true;
      this.isBlinking = false;
      this.currentElement = null;
      this.currentIndex = -1;
      this.isError = false;
      this.scrollContainer = null;
      this.animationTimeout = null;
      this.blinkSpeed = 530; // milliseconds
      this.scrollMargin = 100; // pixels above and below cursor for scrolling
      this.animationDuration = 300; // milliseconds for scroll animation
      this.enabled = true;
      this.hasFocus = true;
      this.pausedState = null;
    }
  
    /**
     * Start cursor blinking animation
     * @returns {CursorManager} This instance for chaining
     */
    startBlink() {
      if (!this.enabled) return this;
      
      if (this.blinkInterval) this.stopBlink();
      
      this.isBlinking = true;
      this.blinkInterval = setInterval(() => {
        const currentSpans = document.querySelectorAll('.current');
        currentSpans.forEach(span => {
          span.style.opacity = this.cursorVisible ? '0.3' : '1';
          const cursorColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--cursor-color').trim() || '#F58025';
          span.style.borderLeftColor = this.cursorVisible ? 'transparent' : cursorColor;
        });
        this.cursorVisible = !this.cursorVisible;
      }, this.blinkSpeed);
      
      return this;
    }
  
    /**
     * Stop cursor blinking animation
     * @returns {CursorManager} This instance for chaining
     */
    stopBlink() {
      if (this.blinkInterval) {
        clearInterval(this.blinkInterval);
        this.blinkInterval = null;
      }
      
      this.isBlinking = false;
      
      const currentSpans = document.querySelectorAll('.current');
      currentSpans.forEach(span => {
        span.style.opacity = '1';
        span.style.borderLeftColor = 'transparent';
      });
      
      return this;
    }
  
    /**
     * Set cursor blink speed
     * @param {number} milliseconds Blink interval in milliseconds
     * @returns {CursorManager} This instance for chaining
     */
    setBlinkSpeed(milliseconds) {
      if (milliseconds >= 100 && milliseconds <= 2000) {
        this.blinkSpeed = milliseconds;
        
        // Restart blinking if currently active
        if (this.isBlinking) {
          this.stopBlink();
          this.startBlink();
        }
      }
      
      return this;
    }
  
    /**
     * Update cursor position to a specific character index
     * @param {number} index Character index to move cursor to
     * @param {boolean} [isError=false] Whether this position represents an error
     * @returns {CursorManager} This instance for chaining
     */
    updateCursor(index, isError = false) {
      if (!this.enabled) return this;
      
      const spans = document.querySelectorAll('#text-display span, #practice-text-display span');
      
      // Remove current class from all spans
      spans.forEach(span => {
        span.classList.remove('current');
        span.classList.remove('next-to-type');
        span.style.opacity = '1';
        span.style.borderLeftColor = 'transparent';
      });
      
      this.currentIndex = index;
      this.isError = isError;
      
      // Find and mark the new current element
      if (spans[index]) {
        // Add the current class with a slight delay to ensure smooth transition
        requestAnimationFrame(() => {
          spans[index].classList.add('current');
          spans[index].classList.add('next-to-type');
          this.currentElement = spans[index];
          
          if (isError) {
            spans[index].classList.add('error');
          }
          
          // Ensure the element is visible
          this.ensureCursorVisible(spans[index]);
          
          // Start blinking if not already
          if (!this.isBlinking) {
            this.startBlink();
          }
        });
      } else {
        this.currentElement = null;
      }
      
      return this;
    }
  
    /**
     * Ensure cursor element is visible within its container
     * @param {HTMLElement} element The cursor element to make visible
     * @returns {CursorManager} This instance for chaining
     */
    ensureCursorVisible(element) {
      if (!element) return this;
      
      // Find the closest scrollable container
      const container = this.findScrollContainer(element) || 
        element.closest('.text-display') || 
        element.closest('.typing-container');
      
      if (!container) return this;
      
      this.scrollContainer = container;
      
      // Get element positions
      const containerRect = container.getBoundingClientRect();
      const cursorRect = element.getBoundingClientRect();
      
      // Only scroll if element is not fully visible
      if (cursorRect.bottom > containerRect.bottom - this.scrollMargin || 
          cursorRect.top < containerRect.top + this.scrollMargin) {
        
        // Cancel any existing scroll animation
        if (this.animationTimeout) {
          clearTimeout(this.animationTimeout);
          this.animationTimeout = null;
        }
        
        // Calculate desired scroll position - center the element
        let targetScrollTop = container.scrollTop;
        
        if (cursorRect.bottom > containerRect.bottom - this.scrollMargin) {
          // Scroll down if cursor is below visible area
          targetScrollTop = container.scrollTop + 
            (cursorRect.bottom - containerRect.bottom) + 
            this.scrollMargin;
        } else if (cursorRect.top < containerRect.top + this.scrollMargin) {
          // Scroll up if cursor is above visible area
          targetScrollTop = container.scrollTop + 
            (cursorRect.top - containerRect.top) - 
            this.scrollMargin;
        }
        
        // Smooth scroll to the target position
        this.smoothScrollTo(container, targetScrollTop);
      }
      
      return this;
    }
  
    /**
     * Find the closest scrollable container for an element
     * @param {HTMLElement} element Element to find the scroll container for
     * @returns {HTMLElement|null} The scroll container or null if none found
     * @private
     */
    findScrollContainer(element) {
      if (!element) return null;
      
      // Start with the element's parent
      let parent = element.parentElement;
      
      while (parent) {
        const style = window.getComputedStyle(parent);
        const overflow = style.getPropertyValue('overflow') || 
                         style.getPropertyValue('overflow-y');
        
        // Check if this parent has scrollable overflow
        if (overflow === 'auto' || overflow === 'scroll') {
          return parent;
        }
        
        parent = parent.parentElement;
      }
      
      return null;
    }
  
    /**
     * Smoothly scroll an element to a target position
     * @param {HTMLElement} element Element to scroll
     * @param {number} targetScrollTop Target scroll position
     * @private
     */
    smoothScrollTo(element, targetScrollTop) {
      if (!element) return;
      
      // Try to use the native scrollTo with smooth behavior
      try {
        element.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        });
      } catch (error) {
        // Fallback for browsers that don't support smooth scrolling
        const startTime = performance.now();
        const startScrollTop = element.scrollTop;
        const distance = targetScrollTop - startScrollTop;
        
        const scrollStep = (timestamp) => {
          const elapsed = timestamp - startTime;
          const progress = Math.min(elapsed / this.animationDuration, 1);
          
          // Easing function: ease-in-out
          const easeProgress = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          
          element.scrollTop = startScrollTop + (distance * easeProgress);
          
          if (progress < 1) {
            this.animationTimeout = requestAnimationFrame(scrollStep);
          }
        };
        
        this.animationTimeout = requestAnimationFrame(scrollStep);
      }
    }
  
    /**
     * Enable the cursor manager
     * @returns {CursorManager} This instance for chaining
     */
    enable() {
      this.enabled = true;
      
      // Restore blinking if it was active before
      if (this.pausedState && this.pausedState.isBlinking) {
        this.startBlink();
      }
      
      // Restore cursor position if it was active before
      if (this.pausedState && this.pausedState.currentIndex >= 0) {
        this.updateCursor(this.pausedState.currentIndex, this.pausedState.isError);
      }
      
      this.pausedState = null;
      
      return this;
    }
  
    /**
     * Disable the cursor manager
     * @returns {CursorManager} This instance for chaining
     */
    disable() {
      // Save current state
      this.pausedState = {
        isBlinking: this.isBlinking,
        currentIndex: this.currentIndex,
        isError: this.isError
      };
      
      // Stop blinking
      this.stopBlink();
      
      // Hide cursor
      const currentSpans = document.querySelectorAll('.current');
      currentSpans.forEach(span => {
        span.classList.remove('current');
      });
      
      this.enabled = false;
      
      return this;
    }
  
    /**
     * Handle window or container focus
     * @returns {CursorManager} This instance for chaining
     */
    onFocus() {
      this.hasFocus = true;
      
      // Restart blinking if it was active
      if (this.isBlinking) {
        this.stopBlink();
        this.startBlink();
      }
      
      return this;
    }
  
    /**
     * Handle window or container blur
     * @returns {CursorManager} This instance for chaining
     */
    onBlur() {
      this.hasFocus = false;
      
      // Stop blinking on blur to save resources
      this.stopBlink();
      
      return this;
    }
  
    /**
     * Cleanup and release resources
     */
    destroy() {
      this.stopBlink();
      
      if (this.animationTimeout) {
        clearTimeout(this.animationTimeout);
        this.animationTimeout = null;
      }
      
      this.currentElement = null;
      this.scrollContainer = null;
    }
  }
  
  // Export the CursorManager class for use in other modules
  window.CursorManager = CursorManager;