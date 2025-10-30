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
      this.isTypingActive = false;
      this.cursorMode = this.getCursorMode();
      this.overlay = null;
      this.overlayContainer = null;
      this.overlayTarget = null;
      this.overlayInitialized = false;
      this.overlayPrevY = null;
      this.overlayPrevX = null;
      this.boundHandleContainerScroll = null;
      this.boundHandleWindowResize = null;

      this.initOverlay();
    }
  
    /**
     * Start cursor blinking animation
     * @returns {CursorManager} This instance for chaining
     */
    startBlink() {
      if (!this.enabled) return this;
      if (this.isTypingActive) {
        this.syncCursorMode();
        this.cursorVisible = true;
        this.applyBlinkState(true);
        return this;
      }
      
      if (this.blinkInterval) this.stopBlink();
      
      this.isBlinking = true;
      this.syncCursorMode();
      // Reset visibility immediately so caret/block start from visible state
      this.cursorVisible = true;
      this.applyBlinkState(true);

      this.blinkInterval = setInterval(() => {
        this.cursorVisible = !this.cursorVisible;
        this.applyBlinkState();
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
      this.cursorVisible = true;
      this.syncCursorMode();
      this.applyBlinkState(true);
      
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
      
      const spans = document.querySelectorAll('#snippet-display span, #text-display span, #practice-text-display span');
      
      // Remove current class from all spans
      spans.forEach(span => {
        span.classList.remove('current');
        span.classList.remove('next-to-type');
        span.style.opacity = '1';
        span.style.borderLeftColor = 'transparent';
      });
      
      this.currentIndex = index;
      this.isError = isError;
      this.setTypingActive(index > 0);
      
      // Find and mark the new current element
      if (spans[index]) {
        const targetSpan = spans[index];
        // Add the current class with a slight delay to ensure smooth transition
        requestAnimationFrame(() => {
          const modeBeforeUpdate = this.cursorMode;
          this.syncCursorMode();
          targetSpan.classList.add('current');
          targetSpan.classList.add('next-to-type');
          this.currentElement = targetSpan;
          
          if (isError) {
            targetSpan.classList.add('error');
          } else {
            targetSpan.classList.remove('error');
          }
          
          // Ensure the element is visible
          this.ensureCursorVisible(targetSpan);

          if (this.shouldUseCaret()) {
            this.updateOverlayTarget(targetSpan, {
              immediate: !this.overlayInitialized || modeBeforeUpdate !== this.cursorMode
            });
          } else {
            this.hideOverlay({ immediate: true });
          }
          
          // Start blinking if not already
          if (!this.isBlinking && !this.isTypingActive) {
            this.startBlink();
          } else {
            this.applyBlinkState(true);
          }
        });
      } else {
        this.currentElement = null;
        this.hideOverlay({ immediate: true });
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
        element.closest('#snippet-display') ||
        element.closest('.snippet-display') || 
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
     * Track whether the user is actively typing to control blink behaviour
     * @param {boolean} active
     */
    setTypingActive(active) {
      if (this.isTypingActive === active) return;
      this.isTypingActive = active;
      this.syncCursorMode();

      if (active) {
        if (this.isBlinking) {
          this.stopBlink();
        } else {
          this.cursorVisible = true;
          this.applyBlinkState(true);
        }
      } else if (this.enabled) {
        if (!this.isBlinking) {
          this.startBlink();
        } else {
          this.applyBlinkState(true);
        }
      }
    }

    /**
     * Determine whether caret mode is active
     * @returns {boolean}
     */
    shouldUseCaret() {
      return this.cursorMode === 'caret';
    }

    /**
     * Synchronize cursor mode with global preference
     */
    syncCursorMode() {
      const latestMode = this.getCursorMode();
      if (latestMode !== this.cursorMode) {
        this.handleModeChange(latestMode);
      }
      return this.cursorMode;
    }

    /**
     * Handle cursor-mode changes
     * @param {string} newMode
     */
    handleModeChange(newMode) {
      this.cursorMode = newMode;
      if (newMode !== 'caret') {
        this.hideOverlay({ immediate: true });
        if (this.overlayContainer) {
          this.overlayContainer.removeEventListener('scroll', this.boundHandleContainerScroll);
          this.overlayContainer = null;
        }
      } else if (this.currentElement) {
        this.updateOverlayTarget(this.currentElement, { immediate: true });
      }
      this.applyBlinkState(true);
    }

    /**
     * Initialise overlay element for smooth caret animation
     */
    initOverlay() {
      if (typeof document === 'undefined') return;
      this.overlay = document.createElement('div');
      this.overlay.className = 'cursor-overlay';
      this.overlay.setAttribute('aria-hidden', 'true');
      this.overlay.style.opacity = '0';
      this.boundHandleContainerScroll = () => this.handleContainerScroll();
      this.boundHandleWindowResize = () => this.handleWindowResize();
      window.addEventListener('resize', this.boundHandleWindowResize, { passive: true });
    }

    /**
     * Attach overlay to matching container
     * @param {HTMLElement|null} container
     */
    attachOverlayToContainer(container) {
      if (!this.overlay || !container) return;
      if (this.overlayContainer === container) return;
      
      if (this.overlayContainer) {
        this.overlayContainer.removeEventListener('scroll', this.boundHandleContainerScroll);
      }
      this.overlayContainer = container;
      if (!container.contains(this.overlay)) {
        container.appendChild(this.overlay);
      }
      container.addEventListener('scroll', this.boundHandleContainerScroll, { passive: true });
      this.overlayInitialized = false;
    }

    /**
     * Update overlay target reference
     * @param {HTMLElement} element
     * @param {{immediate?: boolean}} [options]
     */
    updateOverlayTarget(element, { immediate = false } = {}) {
      if (!this.overlay || !element) return;
      if (!this.shouldUseCaret()) return;

      const container = element.closest('#snippet-display') ||
        element.closest('.snippet-display') ||
        element.closest('#text-display') ||
        element.closest('.text-display') ||
        element.closest('#practice-text-display') ||
        element.closest('.typing-container');
      this.attachOverlayToContainer(container);

      if (!this.overlayContainer) return;

      this.overlayTarget = element;
      this.overlay.classList.remove('block');
      this.overlay.classList.add('caret');
      this.overlay.style.opacity = this.cursorVisible ? '1' : '0';
      this.updateOverlayPosition({ immediate });
    }

    /**
     * Position overlay on top of current character
     * @param {{immediate?: boolean}} [options]
     */
    updateOverlayPosition({ immediate = false } = {}) {
      if (!this.overlay || !this.overlayTarget || !this.shouldUseCaret()) return;
      if (!this.overlayContainer) return;

      const cursorRect = this.overlayTarget.getBoundingClientRect();
      const containerRect = this.overlayContainer.getBoundingClientRect();

      const x = cursorRect.left - containerRect.left + (this.overlayContainer.scrollLeft || 0);
      const y = cursorRect.top - containerRect.top + (this.overlayContainer.scrollTop || 0);
      const height = cursorRect.height;
      const caretWidth = this.getCaretWidth();

      this.overlay.style.height = `${height}px`;
      this.overlay.style.width = `${caretWidth}px`;

      const needsInstantPlacement = immediate || !this.overlayInitialized ||
        Math.abs((this.overlayPrevY ?? y) - y) > height * 1.2;

      if (needsInstantPlacement) {
        const previousTransition = this.overlay.style.transition;
        this.overlay.style.transition = 'none';
        this.overlay.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        void this.overlay.offsetHeight; // force reflow
        this.overlay.style.transition = previousTransition || '';
        this.overlayInitialized = true;
      } else {
        this.overlay.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        this.overlayInitialized = true;
      }

      this.overlayPrevX = x;
      this.overlayPrevY = y;

      const cursorColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--cursor-color').trim() || '#F58025';
      this.overlay.style.setProperty('--cursor-color', cursorColor);
    }

    /**
     * Get caret width in pixels from CSS custom property
     * @returns {number}
     */
    getCaretWidth() {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--caret-width').trim();
      const numeric = parseFloat(raw);
      if (!Number.isNaN(numeric) && numeric > 0) {
        return numeric;
      }
      return 3;
    }

    /**
     * Hide the overlay caret
     * @param {{immediate?: boolean}} [options]
     */
    hideOverlay({ immediate = false } = {}) {
      if (!this.overlay) return;
      if (immediate) {
        const previousTransition = this.overlay.style.transition;
        this.overlay.style.transition = 'none';
        this.overlay.style.opacity = '0';
        void this.overlay.offsetHeight;
        this.overlay.style.transition = previousTransition || '';
      } else {
        this.overlay.style.opacity = '0';
      }
      this.overlayTarget = null;
      this.overlayInitialized = false;
      this.overlayPrevX = null;
      this.overlayPrevY = null;
    }

    /**
     * Apply blink state to caret/block
     * @param {boolean} [forceInstant=false]
     */
    applyBlinkState(forceInstant = false) {
      const mode = this.cursorMode;
      const cursorColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--cursor-color').trim() || '#F58025';
      const currentSpans = document.querySelectorAll('.current');

      currentSpans.forEach(span => {
        if (mode === 'caret') {
          span.style.opacity = '1';
          span.style.borderLeftColor = 'transparent';
        } else {
          span.style.opacity = this.cursorVisible ? '1' : '0.3';
          span.style.borderLeftColor = this.cursorVisible ? cursorColor : 'transparent';
        }
      });

      if (!this.overlay) return;

      if (mode === 'caret') {
        this.overlay.classList.remove('block');
        this.overlay.classList.add('caret');
        if (forceInstant) {
          const previousTransition = this.overlay.style.transition;
          this.overlay.style.transition = 'none';
          this.overlay.style.opacity = this.cursorVisible ? '1' : '0';
          void this.overlay.offsetHeight;
          this.overlay.style.transition = previousTransition || '';
        } else {
          this.overlay.style.opacity = this.cursorVisible ? '1' : '0';
        }
      } else {
        this.overlay.classList.remove('caret');
        this.overlay.classList.add('block');
        this.overlay.style.opacity = '0';
      }
    }

    /**
     * Keep overlay aligned on scroll
     */
    handleContainerScroll() {
      this.updateOverlayPosition({ immediate: true });
    }

    /**
     * Keep overlay aligned on resize
     */
    handleWindowResize() {
      this.updateOverlayPosition({ immediate: true });
    }

    /**
     * Resolve cursor mode using attributes, localStorage, or defaults
     * @returns {string}
     */
    getCursorMode() {
      if (typeof document === 'undefined') return 'caret';
      const root = document.documentElement;
      if (!root) return 'caret';

      const attr = root.getAttribute('data-cursor');
      if (attr === 'caret' || attr === 'block') return attr;

      if (root.dataset) {
        const ds = root.dataset.cursorStyle || root.dataset.cursor;
        if (ds === 'caret' || ds === 'block') return ds;
      }

      try {
        const stored = localStorage.getItem('cursorStyle') || localStorage.getItem('cursorMode');
        if (stored === 'caret' || stored === 'block') return stored;
      } catch (error) {
        // localStorage access may be restricted; ignore errors
      }

      if (root.classList.contains('cursor-caret') || root.classList.contains('caret-cursor')) {
        return 'caret';
      }

      const cssValue = getComputedStyle(root).getPropertyValue('--cursor-style').trim();
      if (cssValue === 'caret' || cssValue === 'block') return cssValue;

      return 'caret';
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
      this.isTypingActive = false;
      this.hideOverlay({ immediate: true });
      if (this.overlayContainer) {
        this.overlayContainer.removeEventListener('scroll', this.boundHandleContainerScroll);
        this.overlayContainer = null;
      }
      
      return this;
    }
  
    /**
     * Handle window or container focus
     * @returns {CursorManager} This instance for chaining
     */
    onFocus() {
      this.hasFocus = true;
      this.syncCursorMode();
      if (this.shouldUseCaret() && this.currentElement) {
        this.updateOverlayTarget(this.currentElement, { immediate: true });
      }
      
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
      this.hideOverlay({ immediate: false });
      
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
      
      this.hideOverlay({ immediate: true });
      if (this.overlayContainer) {
        this.overlayContainer.removeEventListener('scroll', this.boundHandleContainerScroll);
        this.overlayContainer = null;
      }
      if (this.boundHandleWindowResize) {
        window.removeEventListener('resize', this.boundHandleWindowResize);
        this.boundHandleWindowResize = null;
      }
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      this.overlay = null;
      this.overlayTarget = null;
      this.isTypingActive = false;
      this.currentElement = null;
      this.scrollContainer = null;
    }
  }
  
  // Export the CursorManager class for use in other modules
  window.CursorManager = CursorManager;
