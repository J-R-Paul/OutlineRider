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

                    // When keyboard opens, ensure the focused element is visible
                    if (keyboardVisible) {
                        requestAnimationFrame(() => {
                            const focusedEl = document.activeElement;
                            if (focusedEl && (focusedEl.isContentEditable || ['INPUT', 'TEXTAREA'].includes(focusedEl.tagName))) {
                                // Scroll the focused element into view with a slight delay to allow layout to update
                                setTimeout(() => {
                                    focusedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 100);
                            }
                        });
                    }
                }
             };

             window.visualViewport.addEventListener('resize', viewportHandler);
             window.visualViewport.addEventListener('scroll', viewportHandler);
             // Initial check
             viewportHandler();

        } else {
            console.warn('Visual Viewport API not available, using fallback keyboard detection (less reliable).');
            // Fallback: Use focusin/focusout and window resize (less accurate)
            document.body.addEventListener('focusin', handleFocusInFallback);
            document.body.addEventListener('focusout', handleFocusOutFallback);
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
        console.log("Mobile viewport handling cleaned up.");
    };


    // --- Public API ---
    return {
        initialize,
        cleanup
    };
})();