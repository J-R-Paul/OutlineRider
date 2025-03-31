// js/ui.js
const UI = (() => {
    // --- DOM Elements ---
    let elements = {}; // Cache elements
    let dragDropIndicator = null;

    // --- Initialization ---
    const initialize = () => {
        cacheElements();
        setupInitialVisibility();
        // Event listeners will be setup by App.js calling specific setup functions here
        console.log("UI Initialized.");
    };

    const cacheElements = () => {
        elements.fileInput = document.getElementById('fileInput');
        elements.directFileAccessDiv = document.getElementById('directFileAccess');
        elements.openDirectButton = document.getElementById('openDirectButton');
        elements.saveDirectButton = document.getElementById('saveDirectButton');
        elements.opfsFileAccessDiv = document.getElementById('opfsFileAccess');
        elements.newAppFileButton = document.getElementById('newAppFileButton');
        elements.saveToOpfsButton = document.getElementById('saveToOpfsButton');
        elements.saveAsButton = document.getElementById('saveAsButton');
        elements.outlineContainer = document.getElementById('outlineContainer');
        elements.toolbar = document.getElementById('toolbar');
        elements.currentFileNameSpan = document.getElementById('currentFileName');
        elements.initialMessageDiv = document.getElementById('initialMessage');
        elements.directInfoLi = document.getElementById('directInfo');
        elements.opfsInfoLi = document.getElementById('opfsInfo');
        elements.opfsInfoLi2 = document.getElementById('opfsInfo2');
        elements.contentWrapper = document.querySelector('.content-wrapper'); // For focus management
        // Add any other elements needed frequently
    };

    const setupInitialVisibility = () => {
         // Hide API-specific elements initially, let feature detection show them
         elements.directFileAccessDiv.style.display = 'none';
         elements.opfsFileAccessDiv.style.display = 'none';
         elements.directInfoLi.style.display = 'none';
         elements.opfsInfoLi.style.display = 'none';
         elements.opfsInfoLi2.style.display = 'none';
    };

    // --- UI State Updates ---

    const updateFileStateUI = () => {
        const source = State.getCurrentFileSource();
        const isDirty = State.getIsDirty();
        const rootElement = State.getRootElement();
        const directHandle = State.getDirectFileHandle();
        const opfsRoot = State.getOpfsRoot();
        const worker = State.getFileSystemWorker();
        const isLoading = State.getIsLoading();

        let fileNameDisplay = "No file";
        let fileTitle = "Current working file source";
        let saveDirectEnabled = false;
        let saveOpfsEnabled = false;
        const hasContent = rootElement && elements.outlineContainer.contains(rootElement);

        switch (source) {
            case 'direct':
                fileNameDisplay = directHandle?.name || "Direct File";
                fileTitle = `Editing direct file: ${fileNameDisplay}`;
                saveDirectEnabled = !!directHandle && hasContent;
                saveOpfsEnabled = !!opfsRoot && !!worker && hasContent;
                break;
            case 'opfs':
                fileNameDisplay = "App Storage";
                fileTitle = `Editing persistent file in App Storage (${FileSystem.PERSISTENT_OPFS_FILENAME})`;
                saveDirectEnabled = false;
                // Allow saving to OPFS even if empty, to create the initial file
                saveOpfsEnabled = !!opfsRoot && !!worker;
                break;
            case 'copy':
                const tempName = elements.currentFileNameSpan.textContent?.replace('*', '').replace(' (copy)', '').trim() || "Loaded Copy";
                fileNameDisplay = `${tempName} (copy)`;
                fileTitle = `Editing content loaded from: ${tempName}. Save to App or Save As.`;
                saveDirectEnabled = false;
                saveOpfsEnabled = !!opfsRoot && !!worker && hasContent;
                break;
            case 'new':
                fileNameDisplay = "New App File";
                fileTitle = "Editing new file for App Storage.";
                saveDirectEnabled = false;
                saveOpfsEnabled = !!opfsRoot && !!worker && hasContent; // Must have content for 'new'
                break;
            case 'draft':
                 fileNameDisplay = "Unsaved Draft";
                 fileTitle = "Editing temporary draft.";
                 saveDirectEnabled = false;
                 saveOpfsEnabled = !!opfsRoot && !!worker && hasContent;
                 break;
            case 'empty':
            default:
                fileNameDisplay = "No file";
                fileTitle = "No file open. Create new or load.";
                saveDirectEnabled = false;
                // Allow saving empty state to OPFS if user explicitly wants to clear it
                saveOpfsEnabled = !!opfsRoot && !!worker;
                break;
        }

        if (isDirty && source !== 'empty') {
            fileNameDisplay += "*";
        }

        elements.currentFileNameSpan.textContent = fileNameDisplay;
        elements.currentFileNameSpan.title = fileTitle;

        // Disable buttons if currently loading
        elements.saveDirectButton.disabled = !saveDirectEnabled || isLoading;
        elements.saveToOpfsButton.disabled = !saveOpfsEnabled || isLoading;
        elements.openDirectButton.disabled = isLoading;
        elements.newAppFileButton.disabled = isLoading;
        elements.saveAsButton.disabled = !hasContent || isLoading;
        elements.fileInput.disabled = isLoading;

        // Initial Message Visibility
        if (hasContent) {
            elements.initialMessageDiv?.remove(); // Use optional chaining
        } else if (!elements.outlineContainer.contains(elements.initialMessageDiv) && elements.initialMessageDiv) {
            // Re-add if removed previously and outline is empty
            elements.outlineContainer.prepend(elements.initialMessageDiv);
            elements.initialMessageDiv.style.display = 'block';
        } else if (elements.initialMessageDiv && source === 'empty' && !isLoading) {
            // Ensure visible if state is empty and not loading
             elements.initialMessageDiv.style.display = 'block';
        } else if (elements.initialMessageDiv && isLoading) {
             // Hide if loading, regardless of source
             elements.initialMessageDiv.style.display = 'none';
        }

        // Update visibility of API-specific buttons based on detection (done in App.js initialize)
    };

    const showFeatureSection = (id) => {
        const section = document.getElementById(id);
        const infoLiId = id.replace('Access', 'Info'); // e.g., directAccess -> directInfo
        const infoLi = document.getElementById(infoLiId);
        if (section) section.style.display = 'flex';
        if (infoLi) infoLi.style.display = 'list-item';
        if (id === 'opfsFileAccess') { // Show secondary OPFS info too
            const infoLi2 = document.getElementById('opfsInfo2');
             if(infoLi2) infoLi2.style.display = 'list-item';
        }
    };

    const resetEditorUI = (newSource = 'empty') => {
        console.log(`UI: Resetting editor display. New source: ${newSource}`);
        elements.outlineContainer.innerHTML = '';
        State.setRootElement(null);
        State.setSelectedLi(null);

        // Re-add initial message if it exists and isn't already there
        if (elements.initialMessageDiv && !elements.outlineContainer.contains(elements.initialMessageDiv)) {
             elements.outlineContainer.prepend(elements.initialMessageDiv);
        }

        // Show message only if truly empty *and* not during an active load
        if (elements.initialMessageDiv) {
            elements.initialMessageDiv.style.display = (newSource === 'empty' && !State.getIsLoading()) ? 'block' : 'none';
        }
        // updateFileStateUI will be called after state is fully reset
        console.log("UI: Editor display reset complete.");
    };

    // --- Visual Feedback ---

    const setSavingIndicator = (buttonId, isSaving, message = null) => {
        const button = elements[buttonId]; // Use cached elements
        if (!button) return;

        const originalText = button.getAttribute('data-original-text') || button.textContent;
        if (!button.hasAttribute('data-original-text')) {
             button.setAttribute('data-original-text', originalText);
        }

        if (isSaving) {
            button.textContent = message || 'Saving...';
            button.disabled = true;
            button.classList.add('saving');
            button.classList.remove('save-success');
        } else {
            button.classList.remove('saving');
            if (message) {
                // Show temporary success message
                button.textContent = message;
                button.classList.add('save-success');
            } else {
                // Restore original text
                button.textContent = button.getAttribute('data-original-text') || originalText;
                button.classList.remove('save-success');
                 button.removeAttribute('data-original-text');
            }
            // Re-enable based on current state (updateFileStateUI will handle this)
            // button.disabled = false; // Let updateFileStateUI handle final state
            updateFileStateUI(); // Update button states correctly
        }
    };

    const createDropIndicator = () => {
        if (!dragDropIndicator) {
            dragDropIndicator = document.createElement('div');
            dragDropIndicator.className = 'drop-indicator';
            dragDropIndicator.style.position = 'absolute';
            dragDropIndicator.style.height = '3px';
            dragDropIndicator.style.backgroundColor = '#0d6efd'; // Bootstrap primary color
            dragDropIndicator.style.zIndex = '1000';
            dragDropIndicator.style.pointerEvents = 'none';
            dragDropIndicator.style.display = 'none';
            document.body.appendChild(dragDropIndicator);
        }
    };

    const showDropIndicator = (target, position) => {
        createDropIndicator(); // Ensure it exists
        if (!dragDropIndicator || !target) return;

        const rect = target.getBoundingClientRect();
        // Adjust for scroll position
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;

        dragDropIndicator.style.width = `${rect.width}px`;

        // Remove previous 'inside' highlighting
        document.querySelectorAll('.drop-target-inside').forEach(el => {
            el.classList.remove('drop-target-inside');
        });

        switch (position) {
            case 'before':
                dragDropIndicator.style.left = `${rect.left + scrollX}px`;
                dragDropIndicator.style.top = `${rect.top + scrollY - 2}px`; // Position above the target
                dragDropIndicator.style.display = 'block';
                break;
            case 'after':
                dragDropIndicator.style.left = `${rect.left + scrollX}px`;
                dragDropIndicator.style.top = `${rect.bottom + scrollY - 1}px`; // Position below the target
                dragDropIndicator.style.display = 'block';
                break;
            case 'inside':
                dragDropIndicator.style.display = 'none'; // Hide line indicator
                target.classList.add('drop-target-inside'); // Highlight the target itself
                break;
        }
    };

    const hideDropIndicator = () => {
        if (dragDropIndicator) {
            dragDropIndicator.style.display = 'none';
        }
        // Remove any 'inside' highlighting
        document.querySelectorAll('.drop-target-inside').forEach(el => {
            el.classList.remove('drop-target-inside');
        });
    };

    // --- Focus Management ---
    const getFocusedP = () => {
         const active = document.activeElement;
         if (active?.tagName === 'P' && active.isContentEditable && elements.outlineContainer.contains(active)) {
             return active;
         }
         return null;
     };

    // Focuses an element and moves the cursor (if editable)
    const focusAndMoveCursor = (element, toStart = true) => {
        if (!element) return;

        if (element.focus) {
            element.focus();
        }

        if (element.contentEditable === 'true') {
           requestAnimationFrame(() => { // Ensure focus is set before manipulating selection
                if (document.activeElement !== element) return; // Check if focus was successful

                const selection = window.getSelection();
                if (!selection) return;
                const range = document.createRange();

                try {
                    if (element.innerHTML.trim() === '<br>' || element.childNodes.length === 0) {
                        // Handle empty paragraph or paragraph with only <br>
                        range.setStart(element, 0);
                    } else {
                        // Select contents and collapse cursor
                        range.selectNodeContents(element);
                        range.collapse(toStart); // true for start, false for end
                    }
                    selection.removeAllRanges();
                    selection.addRange(range);
                } catch (e) {
                    console.error("Error setting cursor position:", e, "on element:", element);
                    // Fallback: Place cursor at the very beginning or end
                    try {
                        range.selectNodeContents(element);
                        range.collapse(toStart);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } catch (fallbackError) {
                        console.error("Fallback cursor positioning failed:", fallbackError);
                    }
                }
           });
       }
    };

    // Selects an LI, focuses its P (or the LI itself for HR), and optionally scrolls
    const selectAndFocusItem = (li, focusStart = true) => {
         if (!li || !elements.outlineContainer.contains(li)) return;
         State.setSelectedLi(li); // Use State setter

         const pToFocus = li.querySelector(':scope > p[contenteditable="true"]');
         if (pToFocus) {
             focusAndMoveCursor(pToFocus, focusStart);
         } else if (li.getAttribute('data-type') === 'hr') {
             li.focus(); // Focus the LI itself for HR
         }

         // Optional: Scroll into view if needed
         li.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    };

    // Ensures focus is within an editable paragraph of the selected item
     const ensureFocusInEditableParagraph = (selectedLi = State.getSelectedLi()) => {
         if (!selectedLi) return null;
         let targetP = getFocusedP();

          // If focus is not on the P of the currently selected LI, try to focus it
          if (!targetP || targetP.closest('li') !== selectedLi) {
              targetP = selectedLi.querySelector(':scope > p[contenteditable="true"]');
              if (targetP) {
                  console.log("Focusing paragraph programmatically.");
                  focusAndMoveCursor(targetP, false); // Focus at end typically for toolbar actions
                  // Re-check active element after attempting focus
                   if (document.activeElement !== targetP) {
                        console.warn("Programmatic focus failed.");
                        return null; // Focus attempt failed
                   }

              } else {
                  if (selectedLi.getAttribute('data-type') === 'hr') {
                      alert("Cannot perform text formatting on a horizontal rule.");
                  } else {
                      alert("Cannot find editable text for this item.");
                  }
                  return null;
              }
          }

           // Final check if the focused P is indeed editable
           if (!targetP || targetP.contentEditable !== 'true') {
                console.warn("Target paragraph not found or not editable.");
                return null;
           }

         return targetP; // Return the focused, editable paragraph
     };

    return {
        initialize,
        elements, // Expose cached elements if needed by other modules directly
        updateFileStateUI,
        showFeatureSection,
        resetEditorUI,
        setSavingIndicator,
        createDropIndicator,
        showDropIndicator,
        hideDropIndicator,
        getFocusedP,
        focusAndMoveCursor,
        selectAndFocusItem,
        ensureFocusInEditableParagraph
    };
})();