// js/mobile.js
const Mobile = (() => {
    let keyboardVisible = false;
    let viewportHandler = null;
    let isIOS = false;

    const initialize = () => {
        isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            document.body.classList.add('ios-device');
            // Ensure viewport meta is set correctly for notch handling etc.
             let viewportMeta = document.querySelector('meta[name="viewport"]');
             if (viewportMeta && !viewportMeta.content.includes('viewport-fit=cover')) {
                 viewportMeta.setAttribute('content', `${viewportMeta.content}, viewport-fit=cover`);
             } else if (!viewportMeta) {
                  viewportMeta = document.createElement('meta');
                  viewportMeta.name = 'viewport';
                  viewportMeta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
                  document.head.appendChild(viewportMeta);
             }
        }
        setupViewportHandling();
        console.log(`Mobile support initialized. ${isIOS ? '(iOS detected)' : ''}`);
    };

    const setupViewportHandling = () => {
        // Prefer Visual Viewport API if available
        if ('visualViewport' in window && window.visualViewport) {
             console.log('Visual Viewport API available, using for keyboard detection.');

             viewportHandler = () => {
                const vv = window.visualViewport;
                const windowHeight = window.innerHeight;
                const viewportHeight = vv.height;
                const heightDiff = windowHeight - viewportHeight;

                // Threshold for keyboard detection (adjust as needed)
                // iOS keyboard can take up a lot of space, especially in landscape.
                // Android threshold might be smaller.
                const threshold = isIOS ? 50 : 100; // Simplified threshold

                const currentlyVisible = heightDiff > threshold;

                if (currentlyVisible !== keyboardVisible) {
                    keyboardVisible = currentlyVisible;
                    console.log(`Keyboard state changed: ${keyboardVisible ? 'Visible' : 'Hidden'}`);
                    document.body.classList.toggle('keyboard-open', keyboardVisible);

                    // --- Toolbar Positioning (iOS specific fix attempt) ---
                    // On iOS, when keyboard appears, fix toolbar to top of visual viewport
                     const toolbar = UI.elements.toolbar; // Get toolbar ref from UI module
                     if (isIOS && toolbar) {
                         if (keyboardVisible) {
                             toolbar.style.position = 'fixed'; // Fix position
                             toolbar.style.bottom = 'auto'; // Remove potential bottom styling
                             toolbar.style.top = `${vv.offsetTop}px`; // Align with top of visual viewport
                             toolbar.style.width = `${vv.width}px`; // Match visual viewport width
                             toolbar.style.left = `${vv.offsetLeft}px`; // Align left edge
                             toolbar.style.zIndex = '9999';

                              // Force redraw/reflow - might help Safari rendering glitches
                              toolbar.style.display = 'none';
                              toolbar.offsetHeight; // Trigger reflow
                              toolbar.style.display = ''; // Restore display

                         } else {
                             // Reset styles when keyboard hides
                             toolbar.style.position = '';
                             toolbar.style.top = '';
                             toolbar.style.width = '';
                             toolbar.style.left = '';
                             toolbar.style.zIndex = '';
                         }
                     }
                }

                 // Continuous update for iOS toolbar position while keyboard is visible
                 if (isIOS && keyboardVisible && UI.elements.toolbar) {
                    UI.elements.toolbar.style.top = `${vv.offsetTop}px`;
                    UI.elements.toolbar.style.left = `${vv.offsetLeft}px`;
                    UI.elements.toolbar.style.width = `${vv.width}px`;
                 }
             };

             window.visualViewport.addEventListener('resize', viewportHandler);
             window.visualViewport.addEventListener('scroll', viewportHandler); // Needed for position updates
             // Initial check
             viewportHandler();

        } else {
            console.warn('Visual Viewport API not available, using fallback keyboard detection (less reliable).');
            // Fallback: Use focusin/focusout and window resize (less accurate)
            // This fallback is less reliable for detecting keyboard *hiding* without user interaction.
            document.body.addEventListener('focusin', handleFocusInFallback);
            document.body.addEventListener('focusout', handleFocusOutFallback);
            // Basic resize check might sometimes correlate with keyboard
             window.addEventListener('resize', handleResizeFallback);
        }
    };

    // --- Fallback Handlers ---
    const handleFocusInFallback = (event) => {
        if (event.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
             if (!keyboardVisible) {
                keyboardVisible = true;
                document.body.classList.add('keyboard-open');
                console.log("Keyboard likely visible (focusin fallback).");
                // Add iOS toolbar fix attempt for fallback too? Less reliable positioning.
             }
        }
    };

    const handleFocusOutFallback = (event) => {
        // Check if focus moved to another editable element immediately
        requestAnimationFrame(() => {
             const activeElement = document.activeElement;
             if (!(activeElement?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(activeElement?.tagName))) {
                  if (keyboardVisible) {
                     keyboardVisible = false;
                     document.body.classList.remove('keyboard-open');
                     console.log("Keyboard likely hidden (focusout fallback).");
                     // Reset iOS toolbar fix attempt
                      if (isIOS && UI.elements.toolbar) {
                          UI.elements.toolbar.style.position = '';
                          UI.elements.toolbar.style.top = '';
                          // etc.
                      }
                  }
             }
        });
    };

     let resizeTimeout;
     const handleResizeFallback = () => {
         // Debounce resize checks for performance
         clearTimeout(resizeTimeout);
         resizeTimeout = setTimeout(() => {
             // Basic heuristic: if height significantly decreases, assume keyboard
             // This is very unreliable. VisualViewport API is much preferred.
             console.log("Window resized (fallback check)");
             // Might try to infer keyboard based on height change, but avoid complex logic here.
         }, 250);
     };


    // --- Cleanup ---
    const cleanup = () => {
        if (viewportHandler && 'visualViewport' in window && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', viewportHandler);
            window.visualViewport.removeEventListener('scroll', viewportHandler);
        } else {
            document.body.removeEventListener('focusin', handleFocusInFallback);
            document.body.removeEventListener('focusout', handleFocusOutFallback);
            window.removeEventListener('resize', handleResizeFallback);
        }
         // Reset any potentially stuck styles
         document.body.classList.remove('keyboard-open');
          if (isIOS && UI.elements.toolbar) {
              UI.elements.toolbar.style.position = '';
              UI.elements.toolbar.style.top = '';
              UI.elements.toolbar.style.width = '';
              UI.elements.toolbar.style.left = '';
              UI.elements.toolbar.style.zIndex = '';
          }
        console.log("Mobile viewport handling cleaned up.");
    };


    // --- Public API ---
    return {
        initialize,
        cleanup
    };
})();