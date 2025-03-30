document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const fileInput = document.getElementById('fileInput');
    const openDirectButton = document.getElementById('openDirectButton');
    const saveDirectButton = document.getElementById('saveDirectButton');
    const saveAsButton = document.getElementById('saveAsButton');
    const outlineContainer = document.getElementById('outlineContainer');
    const toolbar = document.getElementById('toolbar');
    const directFileAccessDiv = document.getElementById('directFileAccess');
    const currentFileNameSpan = document.getElementById('currentFileName');
    const clearLocalButton = document.getElementById('clearLocalButton'); // Get the clear button

    // State Variables
    let rootUlElement = null;
    let currentlySelectedLi = null;
    let fileHandle = null; // For File System Access API
    let autoSaveTimeout = null; // For debouncing auto-save

    // Constants
    const LOCAL_STORAGE_KEY = 'bikeEditorDraftContent';
    const AUTOSAVE_DELAY = 1500; // ms delay for auto-saving to local storage


    // --- Feature Detection & Initial Setup ---
    if ('showOpenFilePicker' in window && 'createWritable' in FileSystemFileHandle.prototype) {
        console.log("File System Access API (with Write) seems supported.");
        directFileAccessDiv.style.display = 'inline-flex'; // Show direct access buttons (use flex for alignment)
    } else {
        console.warn("File System Access API (with Write) not fully supported. Direct file editing disabled.");
        directFileAccessDiv.style.display = 'none'; // Ensure it's hidden
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoadFromInput);
    openDirectButton.addEventListener('click', openFileDirectly);
    saveDirectButton.addEventListener('click', saveFileDirectly);
    saveAsButton.addEventListener('click', saveFileAs);
    clearLocalButton.addEventListener('click', clearLocalStorage); // Listener for clear button
    toolbar.addEventListener('click', handleToolbarClick);
    outlineContainer.addEventListener('keydown', handleKeyDown);
    outlineContainer.addEventListener('focusin', handleFocusIn);
    outlineContainer.addEventListener('input', triggerAutoSave); // Use trigger function for debounce

    // --- Initial Load ---
    loadFromLocalStorage(); // Attempt to load draft first


    // --- File Handling ---

    function handleFileLoadFromInput(event) {
        const file = event.target.files[0];
        if (!file) return;
        console.log(`Loading file from input: ${file.name}`);
        resetEditorState(); // Clear previous file handle etc.
        loadFileContent(file, file.name + " (loaded copy)");
        fileInput.value = ''; // Clear input to allow reloading same file
    }

    async function openFileDirectly() {
        console.log("Attempting to open file directly...");
        if (!('showOpenFilePicker' in window)) {
             console.error("File System Access API not supported by this browser.");
             alert("Direct file editing is not supported by your browser. Use 'Load (Copy)'.");
             return;
         }
        try {
            [fileHandle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Bike Outline Files',
                    // Use broader accept here too, mirroring the input
                    accept: { 'application/xhtml+xml': ['.bike', '.html'], 'text/xml': ['.xml']}
                }],
            });
            console.log("File handle obtained:", fileHandle.name);
            resetEditorState(false); // Keep file handle, reset rest
            const file = await fileHandle.getFile();
            await loadFileContent(file, fileHandle.name); // Pass original name
            saveDirectButton.disabled = false;
            console.log("File loaded directly:", file.name);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("Error opening file directly:", err);
                alert(`Could not open file directly: ${err.message}. See console for details.`);
                 resetEditorState(); // Ensure clean state on error
            } else {
                console.log("User cancelled file open dialog.");
            }
        }
    }

    async function loadFileContent(file, displayName) {
         console.log(`Reading content for: ${displayName}`);
         try {
            const fileContent = await file.text();
            // Clear local storage ONLY if user confirms replacing draft with a newly loaded file
            const currentDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
            let proceed = true;
            if(currentDraft) {
                proceed = confirm("Loading this file will replace the current unsaved draft. Proceed?");
            }

            if (proceed) {
                if (currentDraft) {
                    clearLocalStorage(false); // Clear draft without prompt now
                }
                parseAndRenderBike(fileContent);
                currentFileNameSpan.textContent = displayName;
                console.log(`Successfully parsed and rendered: ${displayName}`);
            } else {
                console.log("User cancelled loading file over existing draft.");
                 // Reset file input value if loading was from there
                 fileInput.value = '';
            }

        } catch (err) {
            console.error(`Error reading or parsing file content for ${displayName}:`, err);
            alert(`Error reading file content for ${file.name}. It might be invalid.`);
            resetEditorState(); // Reset on error
        }
    }

    async function saveFileDirectly() {
        console.log("Attempting to save file directly...");
        if (!fileHandle) {
            console.warn("Save Directly clicked, but no file handle available.");
            alert("No file open for direct saving. Use 'Save As' or 'Open File (Direct Edit)' first.");
            return;
        }
        if (!rootUlElement || !outlineContainer.contains(rootUlElement)) {
             alert("Nothing to save.");
             return;
         }

        try {
            // Verify permission exists, request if needed (might be needed if browser lost it)
             if (await fileHandle.queryPermission({mode: 'readwrite'}) !== 'granted') {
                 if (await fileHandle.requestPermission({mode: 'readwrite'}) !== 'granted') {
                     throw new Error("Permission to write to the file was denied.");
                 }
             }

            console.log("Creating writable stream for:", fileHandle.name);
            const writable = await fileHandle.createWritable();
            const bikeHTML = serializeOutlineToHTML();
            if (!bikeHTML) throw new Error("Serialization failed, cannot save."); // Check for empty result

            console.log("Writing content to file...");
            await writable.write(bikeHTML);
            await writable.close();
            console.log("File saved directly successfully:", fileHandle.name);

            // Clear local storage draft after successful direct save
            clearLocalStorage(false);

            // Visual confirmation
            const originalText = saveDirectButton.textContent;
            saveDirectButton.textContent = 'Saved!';
            saveDirectButton.style.backgroundColor = '#d4edda'; // Greenish feedback
            setTimeout(() => {
                saveDirectButton.textContent = originalText;
                saveDirectButton.style.backgroundColor = ''; // Reset background
             }, 2000);

        } catch (err) {
            console.error("Error saving file directly:", err);
            alert(`Could not save file directly. ${err.message}. Try 'Save As'.`);
            // Consider disabling direct save button or re-requesting handle?
            // saveDirectButton.disabled = true; fileHandle = null; currentFileNameSpan.textContent = "Direct save failed";
        }
    }

    function saveFileAs() {
        console.log("Attempting Save As / Download...");
        if (!rootUlElement || !outlineContainer.contains(rootUlElement)) {
             alert("Nothing to save.");
             return;
         }
        try {
             const bikeHTML = serializeOutlineToHTML();
             if (!bikeHTML) throw new Error("Serialization failed, cannot save.");

            const blob = new Blob([bikeHTML], { type: 'application/xhtml+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Try to get a reasonable filename
            const currentName = currentFileNameSpan.textContent || '';
            let filename = 'outline.bike'; // Default
             if (fileHandle?.name) {
                 filename = fileHandle.name;
             } else if (currentName && !currentName.includes('(loaded copy)') && !currentName.includes('Unsaved Draft')) {
                 filename = currentName; // Use displayed name if it seems like a real one
             } else if (currentName.includes('(loaded copy)')) {
                 filename = currentName.replace(' (loaded copy)', ''); // Use original loaded name
             }

            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("File download initiated as:", filename);

             // Clear local storage draft after successful "Save As"? Optional, maybe safer not to.
             // clearLocalStorage(false);

        } catch (err) {
            console.error("Error preparing file for download:", err);
            alert(`Could not prepare file for download: ${err.message}.`);
        }
    }

    function serializeOutlineToHTML() {
         if (!rootUlElement || !outlineContainer.contains(rootUlElement)) {
             console.warn("serializeOutlineToHTML called with no root element.");
             return ""; // Return empty string if nothing to serialize
         }
         // Ensure active element changes are captured (important!)
         if (document.activeElement && document.activeElement.isContentEditable) {
            document.activeElement.blur(); // Force update from contenteditable
         }

         // Clone the root UL to avoid modifying the live DOM
         const contentToSave = rootUlElement.cloneNode(true);

         // Clean up internal classes, attributes etc. from the clone
         contentToSave.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
         contentToSave.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
         contentToSave.querySelectorAll('[data-placeholder]').forEach(el => el.removeAttribute('data-placeholder')); // Remove placeholders if used


        // Reconstruct the full Bike HTML structure
        return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8"/>
    <title>${fileHandle?.name || currentFileNameSpan.textContent || 'Bike Outline'}</title>
  </head>
  <body>
    ${contentToSave.outerHTML}
  </body>
</html>`;
    }


    function resetEditorState(clearHandle = true) {
        console.log(`Resetting editor state (clearHandle=${clearHandle})`);
        outlineContainer.innerHTML = '<p>Load or Open a .bike file to start editing.</p><p>Use <b>Enter</b> for new item, <b>Shift+Enter</b> for line break, <b>Tab</b> to indent, <b>Shift+Tab</b> to outdent.</p>';
        rootUlElement = null;
        currentlySelectedLi = null;
        if (clearHandle) {
            fileHandle = null;
            saveDirectButton.disabled = true;
            currentFileNameSpan.textContent = 'No file open';
        }
         // Reset other UI states if necessary (e.g., toolbar button states)
    }


    // --- Local Storage Functions ---

    function triggerAutoSave() {
        clearTimeout(autoSaveTimeout); // Clear previous timeout
        autoSaveTimeout = setTimeout(() => {
            saveToLocalStorage();
        }, AUTOSAVE_DELAY);
    }


    function saveToLocalStorage() {
        if (rootUlElement && outlineContainer.contains(rootUlElement)) {
            // Avoid saving placeholder content
             if (outlineContainer.firstElementChild?.tagName === 'P' && outlineContainer.firstElementChild?.nextElementSibling?.tagName === 'P' && !outlineContainer.querySelector('ul')) {
                 console.log("Skipping save to local storage: Only placeholder content present.");
                 return;
             }

            console.log(`Saving draft to local storage (Key: ${LOCAL_STORAGE_KEY})...`);
            try {
                const bikeHTML = serializeOutlineToHTML();
                if (!bikeHTML) {
                    console.warn("Skipping save to local storage: Serialization resulted in empty content.");
                    return;
                }
                localStorage.setItem(LOCAL_STORAGE_KEY, bikeHTML);
            } catch (error) {
                console.error("Error saving to local storage:", error);
                if (error.name === 'QuotaExceededError') {
                    alert("Could not save draft: Browser storage is full.");
                }
            }
        } else {
             console.log("Skipping save to local storage: No root element found.");
         }
    }

    function loadFromLocalStorage() {
        const storedContent = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (storedContent) {
            console.log("Found draft in local storage.");
            // Check if it's just the placeholder content (from a previous bug maybe)
            if (storedContent.includes('<p>Load or Open') && storedContent.includes('<b>Enter</b> for new item')) {
                console.log("Stored content looks like placeholder, ignoring and clearing.");
                clearLocalStorage(false);
                return;
            }


            if (confirm("Load unsaved draft from previous session? (Choosing 'Cancel' will discard the draft)")) {
                try {
                    console.log("User confirmed loading draft.");
                    outlineContainer.innerHTML = ''; // Clear default message
                    parseAndRenderBike(storedContent);
                    console.log("Draft loaded successfully.");
                    resetEditorState(true); // Clear handle, reset buttons etc.
                    currentFileNameSpan.textContent = "Unsaved Draft"; // Clearer name
                    // Note: No file handle is associated, so direct save is disabled.

                } catch (error) {
                    console.error("Error parsing content from local storage:", error);
                    alert("Could not load draft from local storage, it might be corrupted. Discarding draft.");
                    clearLocalStorage(false);
                    resetEditorState(true); // Restore default placeholder
                }
            } else {
                console.log("User chose not to load draft. Discarding.");
                clearLocalStorage(false);
            }
        } else {
             console.log("No draft found in local storage.");
         }
    }

    function clearLocalStorage(promptUser = true) {
        let confirmClear = !promptUser; // If promptUser is false, confirmClear is true
        if (promptUser) {
            confirmClear = confirm("Are you sure you want to clear the locally saved draft? This cannot be undone.");
        }

        if (confirmClear) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            console.log("Local storage draft cleared.");
            // If a draft was currently loaded, maybe reset the view?
             if (currentFileNameSpan.textContent === "Unsaved Draft") {
                  alert("Local draft cleared. Editor reset.");
                  resetEditorState(true); // Reset to initial state
             }
        } else {
             console.log("User cancelled clearing local storage.");
         }
    }


    // --- Parsing & Rendering ---

    function parseAndRenderBike(htmlString) {
        // try/catch is handled by the caller (loadFileContent, loadFromLocalStorage)
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'application/xhtml+xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) throw new Error(`Parse Error: ${parseError.textContent}`);

        rootUlElement = doc.body.querySelector('ul');
        if (!rootUlElement) throw new Error('Could not find the root <ul> element.');

        outlineContainer.innerHTML = ''; // Clear previous content/instructions
        outlineContainer.appendChild(document.adoptNode(rootUlElement, true)); // Use adoptNode
        makeEditableAndInteractive(outlineContainer);

        // Select the first item automatically, but don't focus
        const firstLi = rootUlElement.querySelector('li');
        if (firstLi) {
            selectListItem(firstLi);
        }
    }

    function makeEditableAndInteractive(container) {
        container.querySelectorAll('li').forEach(li => {
            const p = li.querySelector('p');
            if (p) {
                p.setAttribute('contenteditable', 'true');
            } else if (li.getAttribute('data-type') === 'hr') {
                 // Ensure HR has an empty non-editable p for structure consistency? Optional.
                 // Bike seems to allow LI without P for HR. Let's stick to that.
                 // Make the LI itself focusable via focusin handler later.
            }

            if (!li.id) li.id = generateUniqueId();
        });
        if (rootUlElement && !rootUlElement.id) {
            rootUlElement.id = generateUniqueId(5); // Longer ID for root maybe
        }
    }

    // --- Selection & Focus Handling ---

    function handleFocusIn(event) {
        const target = event.target;
        const li = target.closest('li'); // Find the nearest parent LI

        if (li && outlineContainer.contains(li)) {
            // Select the LI if focus entered its P or the LI itself (for HR)
            if ((target.tagName === 'P' && target.contentEditable === 'true') || (target === li && li.getAttribute('data-type') === 'hr')) {
                 selectListItem(li);
            }
        }
    }


    function selectListItem(liElement) {
        if (!liElement || !outlineContainer.contains(liElement)) return;
        if (currentlySelectedLi === liElement) return;

        if (currentlySelectedLi) {
            currentlySelectedLi.classList.remove('selected');
        }
        currentlySelectedLi = liElement;
        currentlySelectedLi.classList.add('selected');
        // console.log("Selected:", currentlySelectedLi?.id);
    }

    function getSelectedLi() {
        if (currentlySelectedLi && outlineContainer.contains(currentlySelectedLi)) {
            return currentlySelectedLi;
        }
        // Fallback if state variable is out of sync (shouldn't happen often)
        return outlineContainer.querySelector('li.selected');
    }

     function getFocusedP() {
         const active = document.activeElement;
         if (active && active.tagName === 'P' && active.isContentEditable && outlineContainer.contains(active)) {
             return active;
         }
         return null;
     }


    // --- Keyboard Navigation & Editing ---

    function handleKeyDown(event) {
        const selectedLi = getSelectedLi();
        const targetP = getFocusedP(); // Might be null even if LI is selected

         // Global shortcuts (like save) can potentially work even without selection
         if ((event.ctrlKey || event.metaKey) && event.key === 's') {
             event.preventDefault();
             console.log("Ctrl+S detected");
             if (fileHandle && !saveDirectButton.disabled) {
                 saveFileDirectly();
             } else {
                 saveFileAs(); // Fallback to Save As if direct save not possible
             }
             return;
         }


        if (!selectedLi || !outlineContainer.contains(selectedLi)) {
            // If no LI selected, maybe allow Enter in empty container to create first item?
            if(event.key === 'Enter' && !event.shiftKey && !rootUlElement?.firstChild) {
                 event.preventDefault();
                 createFirstItem();
            }
            return; // Most shortcuts require a selected LI
        }

        switch (event.key) {
            case 'Enter':
                if (event.shiftKey) {
                    // Shift+Enter: Insert line break
                     if (targetP) {
                         event.preventDefault();
                         document.execCommand('insertLineBreak');
                         triggerAutoSave(); // Content changed
                     }
                } else {
                    // Enter: Create new item at the same level
                    event.preventDefault();
                    createNewItem(selectedLi); // This function will trigger auto-save
                }
                break;

            case 'Tab':
                event.preventDefault();
                if (event.shiftKey) {
                    outdentItem(selectedLi); // This function will trigger auto-save
                } else {
                    indentItem(selectedLi); // This function will trigger auto-save
                }
                break;

            case 'ArrowUp':
                 if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                     // Basic up navigation
                     const prevLi = findPreviousVisibleLi(selectedLi);
                     if (prevLi) {
                         event.preventDefault();
                         selectListItem(prevLi);
                         const pToFocus = prevLi.querySelector('p');
                          if(pToFocus && pToFocus.contentEditable === 'true') {
                             focusAndMoveCursorToEnd(pToFocus);
                         } else {
                             prevLi.focus(); // Focus LI itself if no editable P (e.g. HR)
                         }
                     }
                 } else if (event.altKey && event.shiftKey) {
                      // Alt+Shift+Up: Move Item Up
                      event.preventDefault();
                      moveItemUp(selectedLi); // This function will trigger auto-save
                 }
                 break;

            case 'ArrowDown':
                 if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                      // Basic down navigation
                     const nextLi = findNextVisibleLi(selectedLi);
                     if (nextLi) {
                         event.preventDefault();
                         selectListItem(nextLi);
                         const pToFocus = nextLi.querySelector('p');
                         if(pToFocus && pToFocus.contentEditable === 'true') {
                             focusAndMoveCursorToEnd(pToFocus);
                         } else {
                              nextLi.focus();
                         }
                     }
                 } else if (event.altKey && event.shiftKey) {
                     // Alt+Shift+Down: Move Item Down
                     event.preventDefault();
                     moveItemDown(selectedLi); // This function will trigger auto-save
                 }
                 break;

             case 'Backspace':
             case 'Delete':
                 // Delete item if backspace/delete is pressed when the paragraph is empty
                 if (targetP && targetP.textContent === '' && !targetP.querySelector('br') && !targetP.querySelector('img')) { // Check if truly empty
                     event.preventDefault();
                     deleteItem(selectedLi); // This function will trigger auto-save
                 } else if (event.key === 'Delete' && !targetP && selectedLi.getAttribute('data-type') === 'hr') {
                      // Allow deleting HR rule with Delete key when LI is selected
                      event.preventDefault();
                      deleteItem(selectedLi);
                 }
                 break;

             // Formatting shortcuts
             case 'b':
                 if (event.ctrlKey || event.metaKey) {
                      event.preventDefault();
                      document.execCommand('bold'); triggerAutoSave();
                 }
                 break;
             case 'i':
                 if (event.ctrlKey || event.metaKey) {
                      event.preventDefault();
                      document.execCommand('italic'); triggerAutoSave();
                 }
                 break;
             // Add more shortcuts (U for underline, etc.) if desired

        }
    }

     function createFirstItem() {
         console.log("Creating first item in empty container.");
         if (!rootUlElement) {
             rootUlElement = document.createElement('ul');
             rootUlElement.id = generateUniqueId(5);
             outlineContainer.innerHTML = ''; // Clear placeholder text
             outlineContainer.appendChild(rootUlElement);
         }
         const newLi = document.createElement('li');
         newLi.id = generateUniqueId();
         const newP = document.createElement('p');
         newP.setAttribute('contenteditable', 'true');
         newLi.appendChild(newP);
         rootUlElement.appendChild(newLi);

         selectListItem(newLi);
         newP.focus();
         triggerAutoSave();
     }


    function createNewItem(currentItemLi) {
        if (!currentItemLi || !outlineContainer.contains(currentItemLi)) return;

        const newLi = document.createElement('li');
        newLi.id = generateUniqueId();
        const newP = document.createElement('p');
        newP.setAttribute('contenteditable', 'true');
        newLi.appendChild(newP);

        // Insert after the current item at the same level
        currentItemLi.after(newLi);

        // Select and focus the new item
        selectListItem(newLi);
        newP.focus();

        triggerAutoSave(); // Structure changed
    }

     // Helper to focus and place cursor at the end of contenteditable
     function focusAndMoveCursorToEnd(element) {
          if (!element) return;
          element.focus();
         const range = document.createRange();
         const selection = window.getSelection();
         range.selectNodeContents(element);
         range.collapse(false); // Collapse to the end
         selection.removeAllRanges();
         selection.addRange(range);
     }

     // --- Navigation Helpers (Improved) ---
     function findPreviousVisibleLi(li) {
         let current = li.previousElementSibling;
         if (current) {
             // If previous sibling has visible children, go to the deepest last child
             while (true) {
                  const lastChildLi = current.querySelector(':scope > ul > li:last-child');
                  if (lastChildLi) {
                      current = lastChildLi;
                  } else {
                      break; // No more nested children
                  }
             }
             return current;
         } else {
             // Move up to parent LI if possible
             const parentUl = li.parentElement;
             if (parentUl && parentUl !== rootUlElement) {
                 return parentUl.closest('li'); // The LI containing the UL
             }
         }
         return null; // Top of list
     }

     function findNextVisibleLi(li) {
          // First, check for children
         const firstChildLi = li.querySelector(':scope > ul > li:first-child');
         if (firstChildLi) {
             return firstChildLi;
         }

         // Then, check siblings and ancestors' siblings
         let current = li;
         while (current) {
             const sibling = current.nextElementSibling;
             if (sibling) {
                 return sibling;
             }
             // If no more siblings, move up to parent and check its siblings
             const parentUl = current.parentElement;
             if (parentUl && parentUl !== rootUlElement) {
                 current = parentUl.closest('li'); // Get the li containing the ul
             } else {
                 current = null; // Reached top level or root
             }
         }
         return null; // End of list
     }


    // --- Toolbar Actions Handler ---
    function handleToolbarClick(event) {
        const button = event.target.closest('button');
        if (!button) return;

        const selectedLi = getSelectedLi(); // Use the getter function

        // --- Formatting ---
        if (button.classList.contains('format-button')) {
             let targetP = getFocusedP() || selectedLi?.querySelector('p');
              if (!targetP || targetP.contentEditable !== 'true') {
                  console.warn("Cannot format: No editable paragraph focused or selected.");
                  // Try focusing the selected li's p if possible
                   if(selectedLi && selectedLi.querySelector('p[contenteditable="true"]')) {
                       targetP = selectedLi.querySelector('p[contenteditable="true"]');
                       targetP.focus();
                   } else {
                      return; // Still can't format
                   }
              }

            const command = button.dataset.command;
             console.log(`Toolbar format: ${command}`);
            if (command === 'highlight') wrapSelection('mark');
            else if (command === 'code') wrapSelection('code');
            else document.execCommand(command, false, null);
            targetP?.focus(); // Re-focus
            triggerAutoSave(); // Content potentially changed

        } else if (button.id === 'linkButton') {
             let targetP = getFocusedP() || selectedLi?.querySelector('p');
             if (!targetP || targetP.contentEditable !== 'true') return alert("Select text or place cursor in an item to create a link.");
             targetP.focus();

             const selection = window.getSelection();
             const existingUrl = selection && selection.rangeCount ? findParentLink(selection.getRangeAt(0).startContainer) : null;
             const defaultUrl = existingUrl ? existingUrl.href : "https://";

             const url = prompt("Enter link URL:", defaultUrl);
             if (url) {
                 // Unlink first if necessary to change URL or if selection was inside a link
                 if (existingUrl) document.execCommand('unlink', false, null);

                 if (selection && selection.toString().length > 0) {
                     document.execCommand('createLink', false, url);
                 } else {
                      // Insert URL as text and link it
                     document.execCommand('insertHTML', false, `<a href="${url}">${url}</a>`);
                 }
             }
              targetP?.focus(); // Re-focus
             triggerAutoSave();

        // --- Item Type ---
        } else if (button.classList.contains('type-button')) {
            if (!selectedLi) return alert("Select an item first.");
            const type = button.dataset.type;
            console.log(`Toolbar type change: ${type || 'plain'}`);
            // Handle type change
             if (type) selectedLi.setAttribute('data-type', type);
             else selectedLi.removeAttribute('data-type');

             let p = selectedLi.querySelector('p');
             if (type === 'hr') {
                 if (!p) { p = document.createElement('p'); selectedLi.insertBefore(p, selectedLi.firstChild); }
                 p.innerHTML = ''; p.removeAttribute('contenteditable'); // HR P shouldn't be editable
             } else {
                  if (!p) { p = document.createElement('p'); selectedLi.insertBefore(p, selectedLi.firstChild); }
                  p.setAttribute('contenteditable', 'true'); // Ensure P is editable for non-HR
             }
              // Focus the P if it exists and isn't HR
             if (p && type !== 'hr') p.focus();
              else if(type === 'hr') selectedLi.focus(); // Focus the LI itself for HR

             triggerAutoSave(); // Structure/attributes changed

        // --- Outline Operations ---
        } else if (button.id === 'indentButton') indentItem(selectedLi); // Auto-saves inside
        else if (button.id === 'outdentButton') outdentItem(selectedLi); // Auto-saves inside
        else if (button.id === 'moveUpButton') moveItemUp(selectedLi); // Auto-saves inside
        else if (button.id === 'moveDownButton') moveItemDown(selectedLi); // Auto-saves inside
        else if (button.id === 'deleteButton') deleteItem(selectedLi); // Auto-saves inside
    }

     // Helper to find if selection is inside a link
     function findParentLink(node) {
        while (node && node !== outlineContainer) {
            if (node.tagName === 'A') return node;
            node = node.parentNode;
        }
        return null;
    }


    // --- Selection Wrapping Helper ---
    function wrapSelection(tagName) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) {
             console.warn("WrapSelection: No text selected.");
             return;
        }
        const range = selection.getRangeAt(0);
        const editorP = range.commonAncestorContainer.closest('p[contenteditable="true"]');

         if (!editorP || !outlineContainer.contains(editorP)) {
             console.warn("WrapSelection: Selection not within an editable paragraph.");
             return;
         }

        const wrapper = document.createElement(tagName);
        try {
            range.surroundContents(wrapper);
            selection.removeAllRanges();
             // Optional: place cursor after wrapped element
             // range.selectNode(wrapper); range.collapse(false); selection.addRange(range);
        } catch (e) {
            console.warn("surroundContents failed, using execCommand insertHTML fallback:", e);
             const selectedText = range.toString(); // Get text before fallback potentially modifies it
             document.execCommand('insertHTML', false, `<${tagName}>${selectedText}</${tagName}>`);
        }
        editorP.focus(); // Re-focus
        triggerAutoSave(); // Content changed
    }


    // --- Outline Operation Implementations ---

    function indentItem(li) {
        if (!li) return;
        const previousLi = li.previousElementSibling;
        if (!previousLi || previousLi.getAttribute('data-type') === 'hr') {
            console.log("Cannot indent: No valid previous sibling.");
            return;
        }
        console.log(`Indenting item: ${li.id}`);

        let targetUl = previousLi.querySelector(':scope > ul');
        if (!targetUl) {
            targetUl = document.createElement('ul');
            previousLi.appendChild(targetUl);
        }
        targetUl.appendChild(li);
        selectListItem(li);
        li.querySelector('p[contenteditable="true"]')?.focus(); // Focus editable P if exists
        triggerAutoSave();
    }

    function outdentItem(li) {
        if (!li) return;
        const parentUl = li.parentElement;
        if (!parentUl || parentUl === rootUlElement || !parentUl.closest('li')) {
             console.log("Cannot outdent: Item is at the top level.");
             return;
         }
        const grandparentLi = parentUl.closest('li');
        if (!grandparentLi) {
             console.error("Cannot outdent: Structure invalid.");
             return;
        }
        console.log(`Outdenting item: ${li.id}`);

        // Move subsequent siblings *with* the outdented item? No, standard is just the item.
        grandparentLi.after(li);

        if (parentUl.children.length === 0) {
            parentUl.remove();
        }
        selectListItem(li);
        li.querySelector('p[contenteditable="true"]')?.focus();
        triggerAutoSave();
    }

    function moveItemUp(li) {
        if (!li) return;
        const previousLi = li.previousElementSibling;
        if (previousLi) {
            console.log(`Moving item up: ${li.id}`);
            li.parentElement.insertBefore(li, previousLi);
            selectListItem(li); // Keep selection
            li.querySelector('p[contenteditable="true"]')?.focus(); // Keep focus within item if possible
            triggerAutoSave();
        } else {
             console.log("Cannot move up: Already first.");
         }
    }

    function moveItemDown(li) {
        if (!li) return;
        const nextLi = li.nextElementSibling;
        if (nextLi) {
             console.log(`Moving item down: ${li.id}`);
            li.parentElement.insertBefore(nextLi, li); // Insert next before current
             selectListItem(li);
             li.querySelector('p[contenteditable="true"]')?.focus();
             triggerAutoSave();
        } else {
             console.log("Cannot move down: Already last.");
         }
    }

    function deleteItem(li) {
        if (!li) return;

         // More careful check for being the only real item
         const isOnlyMeaningfulItem = !findPreviousVisibleLi(li) && !findNextVisibleLi(li);

        const pText = li.querySelector('p')?.textContent || (li.getAttribute('data-type') === 'hr' ? '[HR]' : '[Empty]');
        console.log(`Attempting to delete item: ${li.id} ("${pText.substring(0,20)}...")`);

        // No confirmation needed for empty items or HRs usually
        // if (pText.length > 0 && !confirm(`Delete item "${pText.substring(0, 30)}..."?`)) {
        //    console.log("Deletion cancelled by user.");
        //    return;
        // }

         let siblingToSelect = findPreviousVisibleLi(li) || findNextVisibleLi(li);
         const parentUl = li.parentElement;

        li.remove();
        currentlySelectedLi = null; // Clear selection state variable

         // Remove parent UL if it becomes empty and isn't the root
         if (parentUl && parentUl !== rootUlElement && parentUl.children.length === 0 && parentUl.closest('li')) {
            parentUl.remove();
        }

         if (isOnlyMeaningfulItem && rootUlElement?.children.length === 0) {
             console.log("Outline became empty after deletion.");
             // If outline empty, create a new first item or show placeholder?
             // Let's create a new first item for better UX
              createFirstItem();

         } else if (siblingToSelect && outlineContainer.contains(siblingToSelect)) {
             selectListItem(siblingToSelect);
              const pToFocus = siblingToSelect.querySelector('p[contenteditable="true"]');
              if (pToFocus) focusAndMoveCursorToEnd(pToFocus);
              else siblingToSelect.focus(); // Focus LI if no editable P

         } else if (rootUlElement && rootUlElement.firstElementChild){
             // Fallback: select first item
              const firstItem = rootUlElement.querySelector('li'); // Find first LI descendant
              if (firstItem) {
                  selectListItem(firstItem);
                  const pToFocus = firstItem.querySelector('p[contenteditable="true"]');
                  if (pToFocus) focusAndMoveCursorToEnd(pToFocus);
                   else firstItem.focus();
              } else {
                  // Should be handled by isOnlyMeaningfulItem case now
                  resetEditorState(false); // Keep handle if any, reset view
                  outlineContainer.innerHTML = '<p>Outline empty. Press Enter to add an item.</p>';
                  outlineContainer.focus();
              }
         } else {
              // Outline container is truly empty, reset view
              console.log("Outline container empty after deletion.");
              resetEditorState(false);
               outlineContainer.innerHTML = '<p>Outline empty. Press Enter to add an item.</p>';
               outlineContainer.focus();
         }
         triggerAutoSave(); // Structure changed
    }

    // --- Utility ---
    function generateUniqueId(length = 3) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; // Removed -_ for simpler IDs
        let id = '';
        let attempts = 0;
        do {
             id = '';
            for (let i = 0; i < length; i++) {
                id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            // Ensure ID doesn't start with a number for broader compatibility, though modern browsers handle it.
            if (/^[0-9]/.test(id)) continue;
            attempts++;
         // Check against existing IDs in the *entire document* - safer
        } while (document.getElementById(id) && attempts < 100); // Limit attempts to prevent infinite loop

         if (attempts >= 100) console.warn("Could not generate a unique ID after 100 attempts."); // Fallback or error?
        return id || `gen_${Date.now()}`; // Fallback ID
    }

});