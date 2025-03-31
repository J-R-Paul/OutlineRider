// js/keyboard.js
const Keyboard = (() => {

    const initialize = () => {
        UI.elements.outlineContainer.addEventListener('keydown', handleKeyDown);
        console.log("Keyboard listeners initialized.");
        // Add other keyboard-related setup if needed
    };

    const handleKeyDown = (event) => {
        const selectedLi = State.getSelectedLi();
        const targetP = UI.getFocusedP(); // Get the currently focused paragraph, if any
        const rootElement = State.getRootElement();
        const outlineContainer = UI.elements.outlineContainer;

        // --- Global Shortcuts (like Save) ---
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            console.log("Ctrl/Cmd+S detected");
            // Determine which save action to trigger based on current state
            const source = State.getCurrentFileSource();
            if (source === 'direct' && State.getDirectFileHandle() && !UI.elements.saveDirectButton.disabled) {
                FileSystem.saveFileDirectly();
            } else if (State.getOpfsRoot() && !UI.elements.saveToOpfsButton.disabled) {
                 // Includes 'opfs', 'copy', 'draft', 'new' where OPFS save is enabled
                FileSystem.saveToOpfs();
            } else if (rootElement) {
                console.log("Ctrl+S: No primary save target available/enabled. Consider 'Save As'.");
                // Optionally trigger Save As?
                // FileSystem.saveFileAsDownload();
            } else {
                 console.log("Ctrl+S: Nothing to save.");
            }
            return; // Stop processing after save shortcut
        }

        // --- Handling Empty Editor ---
        // Create first item if editor is empty and Enter is pressed
        const isEditorEffectivelyEmpty = (!rootElement || !outlineContainer.contains(rootElement) || !!UI.elements.initialMessageDiv && outlineContainer.contains(UI.elements.initialMessageDiv));
        if (isEditorEffectivelyEmpty && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
             event.preventDefault();
             console.log("Enter pressed on empty editor, creating first item.");
             // Prefer creating an App File if OPFS is available, otherwise a simple 'new' state item
             if (State.getOpfsRoot()) {
                 FileSystem.createNewAppFile();
             } else {
                  // Create a bare minimum structure without saving capability yet
                  State.setIsLoading(true);
                  FileSystem.resetEditorState('new'); // Set state to new
                  const firstLi = Editor.createMinimalStructure();
                  State.setIsDirty(true);
                  State.setIsLoading(false);
                  UI.updateFileStateUI();
                  requestAnimationFrame(() => {
                       if (firstLi) UI.selectAndFocusItem(firstLi, true);
                       Editor.handleContentChange(); // Trigger draft save if applicable
                  });
             }
             return; // Stop processing
        }

        // --- Actions Requiring a Selected Item ---
        if (!selectedLi || !outlineContainer.contains(selectedLi)) {
             console.log("Keydown ignored: No selected item.");
             return; // Most actions below require a selected item
        }

        // --- Key-Specific Actions ---
        switch (event.key) {
            // --- Enter Key ---
            case 'Enter':
                 if (event.shiftKey) { // Shift+Enter = Line Break
                     if (targetP && targetP.isContentEditable) {
                         event.preventDefault();
                         document.execCommand('insertLineBreak');
                         Editor.handleContentChange({ target: targetP });
                     }
                 } else { // Enter = New Item / Convert Item
                      event.preventDefault();
                      const currentType = selectedLi.getAttribute('data-type');
                      const p = selectedLi.querySelector(':scope > p');

                      // Check if the paragraph is effectively empty (ignoring task checkbox)
                       let isEmptyP = false;
                       if (p) {
                            let textContent = p.textContent.trim();
                            if (currentType === 'task' && (textContent.startsWith('☐') || textContent.startsWith('☑'))) {
                                textContent = textContent.substring(1).trim();
                            }
                            // Also check innerHTML for cases like only <br>
                            isEmptyP = !textContent && p.innerHTML.trim().toLowerCase() === '<br>';
                       } else {
                            // If no paragraph (like HR), consider it "empty" for conversion logic if needed
                            isEmptyP = true;
                       }


                      // Special behavior: If item has a type (not plain, not HR, not LaTeX) and is empty, convert it to plain text
                      if (currentType && currentType !== '' && currentType !== 'hr' && currentType !== 'latex' && isEmptyP) {
                           console.log(`Converting empty ${currentType} item to plain on Enter: ${selectedLi.id}`);
                           Editor.changeItemType(selectedLi, ''); // '' for plain type
                      } else {
                           // Default: Create a new item below the current one
                           Editor.createNewItem(selectedLi);
                      }
                 }
                break;

            // --- Tab Key (Indent/Outdent) ---
            case 'Tab':
                event.preventDefault();
                if (event.shiftKey) {
                    Editor.outdentItem(selectedLi);
                } else {
                    Editor.indentItem(selectedLi);
                }
                break;

            // --- Arrow Keys (Navigation & Moving) ---
            case 'ArrowUp':
                 if (event.altKey && event.shiftKey) { // Move Item Up
                      event.preventDefault();
                      Editor.moveItemUp(selectedLi);
                 } else if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) { // Navigate Up
                      event.preventDefault();
                      const prevLi = Editor.findPreviousVisibleLi(selectedLi);
                      if (prevLi) UI.selectAndFocusItem(prevLi, false); // Focus end when moving up
                 }
                 // Allow default Alt+Up/Down etc. if needed by OS/Browser unless explicitly handled
                 break;
            case 'ArrowDown':
                 if (event.altKey && event.shiftKey) { // Move Item Down
                      event.preventDefault();
                      Editor.moveItemDown(selectedLi);
                 } else if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) { // Navigate Down
                      event.preventDefault();
                      const nextLi = Editor.findNextVisibleLi(selectedLi);
                      if (nextLi) UI.selectAndFocusItem(nextLi, true); // Focus start when moving down
                 }
                 break;
             case 'ArrowLeft':
                // Potential use: Collapse item or move cursor to beginning?
                 if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && targetP) {
                     const selection = window.getSelection();
                     if (selection?.rangeCount > 0 && selection.getRangeAt(0).collapsed && selection.getRangeAt(0).startOffset === 0) {
                         // If cursor is at the very start of the paragraph, potentially collapse
                         const childUl = selectedLi.querySelector(':scope > ul');
                          if (childUl && selectedLi.getAttribute('data-folded') !== 'true') {
                               event.preventDefault();
                               selectedLi.setAttribute('data-folded', 'true');
                               console.log(`Folded ${selectedLi.id} via ArrowLeft`);
                          } else if (!childUl) {
                              // Maybe navigate to parent if at start of first top-level item? Needs thought.
                          }
                     }
                 }
                 break;
             case 'ArrowRight':
                 // Potential use: Expand item or move cursor to end?
                 if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && targetP) {
                     const selection = window.getSelection();
                     const textLength = targetP.textContent.length;
                     // Checkbox adjustment needed if task
                     const isTask = selectedLi.getAttribute('data-type') === 'task';
                     const effectiveLength = isTask ? textLength - 1 : textLength; // Approx length excluding checkbox symbol

                     if (selection?.rangeCount > 0 && selection.getRangeAt(0).collapsed && selection.getRangeAt(0).startOffset >= effectiveLength) {
                         // If cursor is at the end of the paragraph, potentially expand
                          if (selectedLi.getAttribute('data-folded') === 'true') {
                               event.preventDefault();
                               selectedLi.removeAttribute('data-folded');
                               console.log(`Unfolded ${selectedLi.id} via ArrowRight`);
                          } else if (selectedLi.querySelector(':scope > ul')) {
                               // If already unfolded but has children, maybe navigate into children?
                               const firstChild = Editor.findNextVisibleLi(selectedLi);
                               if(firstChild && selectedLi.contains(firstChild)) { // Ensure it's a child
                                    event.preventDefault();
                                    UI.selectAndFocusItem(firstChild, true);
                               }
                          }
                     }
                 }
                 break;

            // --- Deletion Keys ---
            case 'Backspace':
                 if (targetP) { // Only act if focus is in a paragraph
                     const selection = window.getSelection();
                     const cursorAtStart = selection?.rangeCount > 0 && selection.getRangeAt(0).collapsed && selection.getRangeAt(0).startOffset === 0;
                     const nodeBeforeCursor = selection?.getRangeAt(0)?.startContainer.previousSibling;
                     // Special check for cursor being right after task checkbox
                      const isTask = selectedLi.getAttribute('data-type') === 'task';
                      const isAfterCheckbox = isTask && cursorAtStart && nodeBeforeCursor && nodeBeforeCursor.nodeType === Node.ELEMENT_NODE && nodeBeforeCursor.classList.contains('task-checkbox');


                     if (cursorAtStart && !isAfterCheckbox) { // Cursor is at the very start (or start of text after checkbox)
                         const dataType = selectedLi.getAttribute('data-type');
                          // Check if paragraph is effectively empty (ignoring task checkbox)
                           let isEmptyP = false;
                           let textContent = targetP.textContent.trim();
                           if (isTask && (textContent.startsWith('☐') || textContent.startsWith('☑'))) {
                               textContent = textContent.substring(1).trim();
                           }
                           isEmptyP = !textContent && targetP.innerHTML.trim().toLowerCase() === '<br>';

                         if (dataType && dataType !== '' && dataType !== 'hr' && dataType !== 'latex') { // Has a non-plain type
                              // If it's a non-plain type, convert to plain text first
                              event.preventDefault();
                              console.log(`Converting non-plain item ${selectedLi.id} to plain on Backspace at start.`);
                              Editor.changeItemType(selectedLi, ''); // Convert to plain
                         } else if (isEmptyP) {
                              // If it's plain text AND empty, delete the item
                              event.preventDefault();
                              Editor.deleteItem(selectedLi);
                         }
                         // If it's plain text but NOT empty, allow default backspace behavior (merge with previous item potentially - handled by browser/contenteditable)
                     }
                     // Allow default backspace if not at the start
                 } else if (selectedLi.getAttribute('data-type') === 'hr' && document.activeElement === selectedLi) {
                      // If HR itself has focus (not a P), delete it on backspace
                      event.preventDefault();
                      Editor.deleteItem(selectedLi);
                 }
                 break;
             case 'Delete':
                  // If HR itself has focus
                  if (selectedLi.getAttribute('data-type') === 'hr' && document.activeElement === selectedLi) {
                       event.preventDefault();
                       Editor.deleteItem(selectedLi);
                  } else if (targetP) { // If focus is in a paragraph
                       // Check if paragraph is effectively empty
                        const currentType = selectedLi.getAttribute('data-type');
                        let isEmptyP = false;
                        let textContent = targetP.textContent.trim();
                        if (currentType === 'task' && (textContent.startsWith('☐') || textContent.startsWith('☑'))) {
                            textContent = textContent.substring(1).trim();
                        }
                        isEmptyP = !textContent && targetP.innerHTML.trim().toLowerCase() === '<br>';

                        // Delete item if paragraph is empty
                        if (isEmptyP) {
                             event.preventDefault();
                             Editor.deleteItem(selectedLi);
                        }
                        // Allow default Delete behavior if paragraph has content (delete char or merge next line)
                  }
                 break;

            // --- Formatting Shortcuts ---
            case 'b': // Bold (Ctrl/Cmd+B)
                 if (event.ctrlKey || event.metaKey) {
                      event.preventDefault();
                      Editor.formatSelection('bold');
                 }
                 break;
            case 'i': // Italic (Ctrl/Cmd+I)
                 if (event.ctrlKey || event.metaKey) {
                      event.preventDefault();
                      Editor.formatSelection('italic');
                 }
                 break;
            case 'k': // Link (Ctrl/Cmd+K)
                 if (event.ctrlKey || event.metaKey) {
                      event.preventDefault();
                      Editor.handleLinkButtonClick(); // Editor handles getting selected P etc.
                 }
                 break;

            // Add other shortcuts as needed (e.g., Alt+Shift+Arrows for move already handled)
        }
    };

    // --- Public API ---
    return {
        initialize,
        handleKeyDown // Expose if needed for manual triggering? Unlikely.
    };
})();