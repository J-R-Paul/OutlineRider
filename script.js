document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const fileInput = document.getElementById('fileInput');
    const manageOpfsButton = document.getElementById('manageOpfsButton');
    const saveToOpfsButton = document.getElementById('saveToOpfsButton');
    const saveAsButton = document.getElementById('saveAsButton');
    const outlineContainer = document.getElementById('outlineContainer');
    const toolbar = document.getElementById('toolbar');
    const opfsFileAccessDiv = document.getElementById('opfsFileAccess');
    const opfsInfoLi = document.getElementById('opfsInfo'); // For initial message
    const currentFileNameSpan = document.getElementById('currentFileName');
    const clearLocalButton = document.getElementById('clearLocalButton');
    const initialMessageDiv = document.getElementById('initialMessage');

    // --- State Variables ---
    let rootUlElement = null;
    let currentlySelectedLi = null;
    let opfsFileHandle = null; // For OPFS File System Access API file handle
    let autoSaveTimeout = null; // For debouncing auto-save to local storage (draft)
    let opfsRoot = null; // Cache OPFS root directory handle
    let fileSystemWorker = null; // Web Worker instance

    // --- Constants ---
    const LOCAL_STORAGE_KEY = 'bikeEditorDraftContent';
    const AUTOSAVE_DELAY = 1500; // ms delay for auto-saving draft

    // --- Feature Detection & Initial Setup ---
    async function initialize() {
        // Check for OPFS support
        if ('storage' in navigator && 'getDirectory' in navigator.storage) {
            console.log("Origin Private File System (OPFS) API seems supported.");
            try {
                opfsRoot = await navigator.storage.getDirectory(); // Get root handle early
                opfsFileAccessDiv.style.display = 'inline-flex'; // Show OPFS buttons
                opfsInfoLi.style.display = 'list-item'; // Show OPFS info in initial message
                // Setup Worker
                fileSystemWorker = new Worker('worker.js');
                fileSystemWorker.onmessage = handleWorkerMessage;
                fileSystemWorker.onerror = (err) => console.error("Worker Error:", err);
                console.log("OPFS Root Handle obtained and Worker started.");
            } catch (err) {
                console.error("Error accessing OPFS root directory:", err);
                opfsFileAccessDiv.style.display = 'none'; // Hide if error
                opfsInfoLi.style.display = 'none';
                alert(`Could not initialize App Storage (OPFS): ${err.message}`);
            }
        } else {
            console.warn("Origin Private File System (OPFS) API not supported. App file storage disabled.");
            opfsFileAccessDiv.style.display = 'none';
            opfsInfoLi.style.display = 'none';
        }

        // Attempt to load draft from Local Storage
        loadFromLocalStorage();
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoadFromInput);
    manageOpfsButton.addEventListener('click', manageOpfsFiles);
    saveToOpfsButton.addEventListener('click', saveToOpfs);
    saveAsButton.addEventListener('click', saveFileAsDownload);
    clearLocalButton.addEventListener('click', clearLocalStorage);
    toolbar.addEventListener('click', handleToolbarClick);
    outlineContainer.addEventListener('keydown', handleKeyDown);
    outlineContainer.addEventListener('focusin', handleFocusIn);
    outlineContainer.addEventListener('input', triggerAutoSaveDraft); // Renamed for clarity

    // --- Initial Load ---
    initialize(); // Run async initialization

    // --- File Handling (Input & Download) ---

    function handleFileLoadFromInput(event) {
        const file = event.target.files[0];
        if (!file) return;
        console.log(`Loading file from input: ${file.name}`);
        resetEditorState(true); // Clear previous OPFS handle etc.
        loadFileContent(file, file.name + " (loaded copy)");
        fileInput.value = ''; // Clear input
    }

    async function loadFileContent(file, displayName) {
        console.log(`Reading content for: ${displayName}`);
        try {
            const fileContent = await file.text();
            const currentDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
            let proceed = true;

            if (currentDraft && currentDraft.length > 0 && !currentDraft.includes('<div id="initialMessage">')) {
                proceed = confirm("Loading this file will replace the current unsaved draft. Proceed?");
            }

            if (proceed) {
                if (currentDraft) {
                    clearLocalStorage(false); // Clear draft without prompt now
                }
                resetEditorState(true); // Clear editor before loading new content, keep OPFS root
                parseAndRenderBike(fileContent);
                currentFileNameSpan.textContent = displayName;
                opfsFileHandle = null; // Ensure no OPFS handle is associated with a loaded copy
                saveToOpfsButton.disabled = !opfsRoot; // Enable save *to* OPFS (will prompt for name) if OPFS is available
                console.log(`Successfully parsed and rendered: ${displayName}`);
                 // Remove initial message if present
                initialMessageDiv?.remove();

            } else {
                console.log("User cancelled loading file over existing draft.");
                fileInput.value = ''; // Reset file input if loading was from there
            }

        } catch (err) {
            console.error(`Error reading or parsing file content for ${displayName}:`, err);
            alert(`Error reading file content for ${file.name}. It might be invalid or corrupted.`);
            resetEditorState(true); // Reset on error, keep OPFS root
        }
    }

    function saveFileAsDownload() {
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

            let filename = 'outline.bike'; // Default
             if (opfsFileHandle?.name) {
                 filename = opfsFileHandle.name; // Use OPFS name if available
             } else if (currentFileNameSpan.textContent && !currentFileNameSpan.textContent.includes('(loaded copy)') && currentFileNameSpan.textContent !== 'No file open' && currentFileNameSpan.textContent !== 'Unsaved Draft') {
                 filename = currentFileNameSpan.textContent; // Use displayed name
             } else if (currentFileNameSpan.textContent.includes('(loaded copy)')) {
                 filename = currentFileNameSpan.textContent.replace(' (loaded copy)', '');
             }
             // Ensure it ends with .bike or .html
             if (!/\.(bike|html)$/i.test(filename)) {
                filename += '.bike';
             }

            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("File download initiated as:", filename);

            // Maybe clear draft after download? Optional.
            // clearLocalStorage(false);

        } catch (err) {
            console.error("Error preparing file for download:", err);
            alert(`Could not prepare file for download: ${err.message}.`);
        }
    }

    // --- OPFS File Handling ---

    async function manageOpfsFiles() {
        if (!opfsRoot) return alert("App Storage (OPFS) is not available.");

        let fileList = [];
        let fileListString = "Files in App Storage:\n";
        let index = 1;
        try {
            console.log("Enumerating OPFS directory...");
            for await (const handle of opfsRoot.values()) {
                if (handle.kind === 'file' && (handle.name.endsWith('.bike') || handle.name.endsWith('.html'))) {
                    fileList.push(handle.name);
                    fileListString += `${index}. ${handle.name}\n`;
                    index++;
                }
            }
        } catch (err) {
            console.error("Error listing OPFS files:", err);
            return alert(`Could not list files in App Storage: ${err.message}`);
        }

        if (fileList.length === 0) {
            fileListString += "(No .bike/.html files found)\n";
        }

        const actionPrompt = `
${fileListString}
Enter number to OPEN,
'N' to create NEW,
'D' + number to DELETE,
or Cancel.`;

        const choice = prompt(actionPrompt)?.trim();

        if (!choice) return; // User cancelled

        if (choice.toUpperCase() === 'N') {
            // Create New File in OPFS
            const newFileName = prompt("Enter name for new file (e.g., 'MyNotes.bike'):");
            if (newFileName && newFileName.trim()) {
                const finalName = newFileName.trim().endsWith('.bike') || newFileName.trim().endsWith('.html') ? newFileName.trim() : newFileName.trim() + '.bike';
                resetEditorState(false); // Clear editor, keep OPFS root
                // Create a minimal valid structure
                 rootUlElement = document.createElement('ul');
                 rootUlElement.id = generateUniqueId(5);
                 const firstLi = document.createElement('li'); firstLi.id = generateUniqueId();
                 const firstP = document.createElement('p'); firstP.contentEditable = 'true';
                 firstLi.appendChild(firstP);
                 rootUlElement.appendChild(firstLi);
                 outlineContainer.innerHTML = '';
                 outlineContainer.appendChild(rootUlElement);
                 initialMessageDiv?.remove(); // Remove initial message

                currentFileNameSpan.textContent = finalName + " (new)";
                opfsFileHandle = null; // No handle yet, will be created on first save
                saveToOpfsButton.disabled = false; // Enable saving the new file
                selectListItem(firstLi);
                firstP.focus();
                 console.log("Prepared new file structure:", finalName);
            }
        } else if (choice.toUpperCase().startsWith('D')) {
            // Delete File from OPFS
            const numStr = choice.substring(1).trim();
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num > 0 && num <= fileList.length) {
                const nameToDelete = fileList[num - 1];
                if (confirm(`Are you sure you want to PERMANENTLY DELETE '${nameToDelete}' from App Storage?`)) {
                    try {
                        await opfsRoot.removeEntry(nameToDelete);
                        console.log("Deleted from OPFS:", nameToDelete);
                        alert(`'${nameToDelete}' deleted.`);
                        // If the deleted file was currently open, reset the editor
                        if (opfsFileHandle && opfsFileHandle.name === nameToDelete) {
                            resetEditorState(true); // Full reset
                        }
                    } catch (err) {
                        console.error(`Error deleting ${nameToDelete} from OPFS:`, err);
                        alert(`Could not delete '${nameToDelete}': ${err.message}`);
                    }
                }
            } else {
                alert("Invalid delete number.");
            }
        } else {
            // Open Existing File from OPFS
            const num = parseInt(choice, 10);
            if (!isNaN(num) && num > 0 && num <= fileList.length) {
                const nameToOpen = fileList[num - 1];
                 // Check for unsaved changes before opening
                 const currentDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
                 let proceed = true;
                 if (currentDraft && currentDraft.length > 0 && !currentDraft.includes('<div id="initialMessage">')) {
                     proceed = confirm("Opening this file will replace the current unsaved draft. Proceed?");
                 }
                 if (!proceed) return; // User cancelled

                 if(currentDraft) clearLocalStorage(false); // Clear draft if proceeding

                try {
                    console.log("Opening from OPFS:", nameToOpen);
                    const handle = await opfsRoot.getFileHandle(nameToOpen);
                    const file = await handle.getFile();
                    const content = await file.text();

                    resetEditorState(false); // Clear editor, keep OPFS root
                    parseAndRenderBike(content);
                    opfsFileHandle = handle; // Store the handle
                    currentFileNameSpan.textContent = handle.name;
                    saveToOpfsButton.disabled = false; // Enable saving to this handle
                    console.log("Loaded from OPFS:", handle.name);
                    initialMessageDiv?.remove(); // Remove initial message
                     // Select first item
                     const firstLi = rootUlElement?.querySelector('li');
                     if (firstLi) {
                         selectListItem(firstLi);
                         firstLi.querySelector('p[contenteditable="true"]')?.focus();
                     }

                } catch (err) {
                    console.error(`Error opening ${nameToOpen} from OPFS:`, err);
                    alert(`Could not open '${nameToOpen}': ${err.message}`);
                    resetEditorState(true); // Reset on error
                }
            } else {
                alert("Invalid choice.");
            }
        }
    }


    function saveToOpfs() {
        console.log("Attempting to save to OPFS...");
        if (!opfsRoot || !fileSystemWorker) {
            alert("App Storage (OPFS) or Worker is not available/initialized.");
            return;
        }
        if (!rootUlElement || !outlineContainer.contains(rootUlElement)) {
            alert("Nothing to save.");
            return;
        }

        const htmlContent = serializeOutlineToHTML();
        if (!htmlContent) {
            alert("Serialization failed, cannot save empty content.");
            return;
        }

        // Determine the filename and get handle
        if (opfsFileHandle) {
            // Saving to the currently open OPFS file
            console.log("Saving to existing OPFS handle:", opfsFileHandle.name);
            setSavingIndicator(true, `Saving ${opfsFileHandle.name}...`);
            fileSystemWorker.postMessage({ action: 'save', handle: opfsFileHandle, content: htmlContent });
        } else {
            // No OPFS file is 'open', so prompt for a name to save *as* into OPFS
            const currentNameGuess = currentFileNameSpan.textContent?.replace(' (loaded copy)', '').replace(' (new)', '').replace('Unsaved Draft','').trim();
            const suggestedName = (currentNameGuess && currentNameGuess !== 'No file open' ? currentNameGuess : 'new_outline') + '.bike';

            const fileName = prompt("Enter filename to save in App Storage:", suggestedName);
            if (fileName && fileName.trim()) {
                const finalName = fileName.trim().endsWith('.bike') || fileName.trim().endsWith('.html') ? fileName.trim() : fileName.trim() + '.bike';
                 console.log("Saving new file to OPFS as:", finalName);
                 setSavingIndicator(true, `Saving ${finalName}...`);
                // We need to get the handle *first* before sending to worker
                opfsRoot.getFileHandle(finalName, { create: true })
                    .then(newHandle => {
                        opfsFileHandle = newHandle; // Store the handle for future saves
                        currentFileNameSpan.textContent = opfsFileHandle.name; // Update display name
                        fileSystemWorker.postMessage({ action: 'save', handle: opfsFileHandle, content: htmlContent });
                    })
                    .catch(err => {
                        console.error(`Error getting handle for new file ${finalName}:`, err);
                        alert(`Could not get handle to save file '${finalName}': ${err.message}`);
                         setSavingIndicator(false);
                    });
            } else {
                console.log("Save to OPFS cancelled by user (no filename).");
            }
        }
    }

    // Handle messages back from the worker
    function handleWorkerMessage(event) {
        const { success, fileName, error } = event.data;
        if (success) {
            console.log(`Worker successfully saved: ${fileName}`);
            setSavingIndicator(false, 'Saved!');
            clearLocalStorage(false); // Clear temporary draft after successful OPFS save
            setTimeout(() => { // Reset button text after a delay
                 saveToOpfsButton.textContent = 'Save to App Storage';
                 saveToOpfsButton.disabled = !opfsFileHandle; // Re-enable based on handle presence
            }, 2000);
        } else {
            console.error(`Worker failed to save ${fileName || 'file'}:`, error);
            alert(`Failed to save ${fileName ? `'${fileName}'` : 'file'} to App Storage: ${error}`);
            setSavingIndicator(false); // Remove saving indicator on failure
        }
    }

     function setSavingIndicator(isSaving, message = null) {
        if (isSaving) {
            saveToOpfsButton.textContent = message || 'Saving...';
            saveToOpfsButton.disabled = true;
        } else {
             saveToOpfsButton.textContent = message || 'Save to App Storage';
             // Re-enable button only if an OPFS file is actually open
             saveToOpfsButton.disabled = !opfsFileHandle && !rootUlElement; // Disable if no handle AND no content
             if (message === 'Saved!') {
                 saveToOpfsButton.style.backgroundColor = '#d4edda'; // Greenish feedback
                 setTimeout(() => { saveToOpfsButton.style.backgroundColor = ''; }, 2000);
             } else {
                  saveToOpfsButton.style.backgroundColor = ''; // Reset background
             }
        }
    }

    // --- Local Storage (Draft) Functions ---

    function triggerAutoSaveDraft() {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(saveDraftToLocalStorage, AUTOSAVE_DELAY);
    }

    function saveDraftToLocalStorage() {
        if (rootUlElement && outlineContainer.contains(rootUlElement)) {
            // Don't save if only initial message is present
            if (document.getElementById('initialMessage')) return;
            // Avoid saving placeholder content if editor was cleared somehow
            if (outlineContainer.firstElementChild?.tagName === 'P' && outlineContainer.firstElementChild?.nextElementSibling?.tagName === 'P' && !outlineContainer.querySelector('ul')) {
                return;
            }

            try {
                const bikeHTML = serializeOutlineToHTML();
                if (!bikeHTML) return;
                localStorage.setItem(LOCAL_STORAGE_KEY, bikeHTML);
                // console.log("Draft saved to local storage."); // Less verbose logging
            } catch (error) {
                console.error("Error saving draft to local storage:", error);
                if (error.name === 'QuotaExceededError') {
                    alert("Could not save draft: Browser storage is full.");
                }
            }
        }
    }

    function loadFromLocalStorage() {
        const storedContent = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (storedContent && storedContent.length > 0 && !storedContent.includes('<div id="initialMessage">')) {
            console.log("Found draft in local storage.");
             // Check if editor is currently empty or showing initial message
            const isEmpty = !rootUlElement || document.getElementById('initialMessage');

            if (isEmpty && confirm("Load unsaved draft from previous session? (Choosing 'Cancel' will discard the draft)")) {
                 try {
                    console.log("User confirmed loading draft.");
                    resetEditorState(true); // Full reset before loading draft
                    parseAndRenderBike(storedContent);
                    console.log("Draft loaded successfully.");
                    currentFileNameSpan.textContent = "Unsaved Draft";
                    opfsFileHandle = null; // Drafts don't have an OPFS handle
                    saveToOpfsButton.disabled = !opfsRoot; // Enable save *to* OPFS (will prompt name)
                    initialMessageDiv?.remove(); // Remove initial message
                 } catch (error) {
                    console.error("Error parsing draft from local storage:", error);
                    alert("Could not load draft, it might be corrupted. Discarding.");
                    clearLocalStorage(false);
                    resetEditorState(true);
                }
            } else if (!isEmpty) {
                console.log("Editor not empty, ignoring local storage draft for now.");
                // Or potentially ask if they want to overwrite current content with draft? Less common.
             } else {
                 console.log("User chose not to load draft, or editor wasn't empty. Discarding.");
                clearLocalStorage(false); // Clear the draft if user cancels
            }
        } else {
             console.log("No valid draft found in local storage.");
             if (storedContent) clearLocalStorage(false); // Clear invalid draft
         }
    }

    function clearLocalStorage(promptUser = true) {
        let confirmClear = !promptUser;
        if (promptUser) {
            confirmClear = confirm("Are you sure you want to clear the temporary locally saved draft? This cannot be undone.");
        }

        if (confirmClear) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            console.log("Local storage draft cleared.");
             if (currentFileNameSpan.textContent === "Unsaved Draft") {
                  alert("Local draft cleared. Editor reset.");
                  resetEditorState(true); // Reset to initial state if draft was loaded
             }
        } else {
             console.log("User cancelled clearing local storage.");
         }
    }

    // --- Parsing, Rendering, Serialization ---

    function parseAndRenderBike(htmlString) {
        const parser = new DOMParser();
        // Important: Use 'text/html' for parsing fragments or full docs that might be missing xml decl or xmlns
        // Use 'application/xhtml+xml' if strict XHTML/Bike format compliance is expected
        const doc = parser.parseFromString(htmlString, 'application/xhtml+xml'); // Sticking to Bike's likely format

        // Check for parser errors (more robustly)
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.error("XML Parse Error:", parseError.textContent);
            // Fallback attempt with text/html? Might mangle structure.
            console.log("Attempting fallback parse with text/html");
            const htmlDoc = new DOMParser().parseFromString(htmlString, 'text/html');
            rootUlElement = htmlDoc.body.querySelector('ul');
             if (!rootUlElement) { // If still no UL after fallback
                 throw new Error(`Parse Error: ${parseError.textContent}. Could not find root <ul>.`);
             }
             console.warn("Parsed using text/html fallback. Structure might be altered.");
        } else {
             rootUlElement = doc.body?.querySelector('ul'); // Standard case
        }


        if (!rootUlElement) throw new Error('Could not find the root <ul> element in the parsed content.');

        outlineContainer.innerHTML = ''; // Clear previous content/instructions
        // Use importNode for better compatibility than adoptNode sometimes
        outlineContainer.appendChild(document.importNode(rootUlElement, true));
        rootUlElement = outlineContainer.querySelector('ul'); // Re-assign rootUlElement to the one in the document

        makeEditableAndInteractive(outlineContainer);

        const firstLi = rootUlElement.querySelector('li');
        if (firstLi) {
            selectListItem(firstLi); // Select but don't focus yet
        } else {
            console.warn("Parsed content resulted in an empty root <ul>.");
            // Optionally create a default item here if desired
        }
         initialMessageDiv?.remove(); // Remove initial message if present
    }

    function makeEditableAndInteractive(container) {
        container.querySelectorAll('li').forEach(li => {
            const p = li.querySelector(':scope > p'); // Only direct child P
            if (p) {
                p.setAttribute('contenteditable', 'true');
                 // Ensure empty paragraphs render with some height
                 if (!p.textContent && !p.innerHTML.includes('<br>')) {
                     p.innerHTML = '<br>'; // Add a break to make it clickable
                 }
            } else if (li.getAttribute('data-type') === 'hr') {
                // HR LIs might not have a P, make LI itself focusable for selection
                 li.tabIndex = -1; // Make focusable programmatically
            } else {
                // If LI is not HR and has no P, create one (for consistency)
                 console.warn("Found LI without direct child P, creating one:", li.id || li.textContent.substring(0, 10));
                 const newP = document.createElement('p');
                 newP.setAttribute('contenteditable', 'true');
                 newP.innerHTML = '<br>'; // Start empty
                 // Prepend P to ensure it's the primary content element
                 li.insertBefore(newP, li.firstChild);
            }
            if (!li.id) li.id = generateUniqueId();
        });
        if (rootUlElement && !rootUlElement.id) {
            rootUlElement.id = generateUniqueId(5);
        }
    }

     function serializeOutlineToHTML() {
         if (!rootUlElement || !outlineContainer.contains(rootUlElement)) {
             console.warn("serializeOutlineToHTML called with no root element.");
             return "";
         }
         // Ensure active element changes are captured (blur is crucial)
         if (document.activeElement && document.activeElement.isContentEditable) {
            document.activeElement.blur();
         }

         const contentToSave = rootUlElement.cloneNode(true);

         // --- Cleanup ---
         contentToSave.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
         contentToSave.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
         contentToSave.querySelectorAll('[tabindex]').forEach(el => el.removeAttribute('tabindex'));
          // Remove placeholder <br> from empty paragraphs before saving
          contentToSave.querySelectorAll('p').forEach(p => {
              if (p.innerHTML === '<br>') p.innerHTML = '';
          });
         // Remove potentially empty ULs created by accident (e.g., after outdenting last child)
         contentToSave.querySelectorAll('ul:empty').forEach(ul => ul.remove());

        // Determine title for the saved file
        let title = 'Bike Outline';
         if (opfsFileHandle?.name) title = opfsFileHandle.name;
         else if (currentFileNameSpan.textContent && currentFileNameSpan.textContent !== 'No file open' && currentFileNameSpan.textContent !== 'Unsaved Draft') {
            title = currentFileNameSpan.textContent.replace(' (loaded copy)', '').replace(' (new)', '');
         }

        // Reconstruct the full Bike HTML structure
        // Using XHTML namespace and XML declaration for better .bike compatibility
        return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(title)}</title>
    <!-- Add other metadata if needed -->
  </head>
  <body>
    ${contentToSave.outerHTML}
  </body>
</html>`;
    }

    // Simple XML escaper for text content / attributes
     function escapeXml(unsafe) {
         return unsafe.replace(/[<>&'"]/g, function (c) {
             switch (c) {
                 case '<': return '&lt;';
                 case '>': return '&gt;';
                 case '&': return '&amp;';
                 case '\'': return '&apos;'; // Single quote
                 case '"': return '&quot;';
             }
             return c; // Should not happen
         });
     }


    // --- Editor State & Reset ---

    function resetEditorState(clearOpfsHandle = true) {
        console.log(`Resetting editor state (clearOpfsHandle=${clearOpfsHandle})`);
        outlineContainer.innerHTML = ''; // Clear content
        // Re-add initial message
         if (!document.getElementById('initialMessage')) {
             outlineContainer.appendChild(initialMessageDiv);
         }
        initialMessageDiv.style.display = 'block'; // Ensure it's visible

        rootUlElement = null;
        currentlySelectedLi = null;
        clearTimeout(autoSaveTimeout); // Cancel pending draft save

        if (clearOpfsHandle) {
            opfsFileHandle = null;
            saveToOpfsButton.disabled = true;
            currentFileNameSpan.textContent = 'No file open';
        } else {
            // Keep OPFS handle, update button state based on handle presence
            saveToOpfsButton.disabled = !opfsFileHandle;
             if (opfsFileHandle) {
                 currentFileNameSpan.textContent = opfsFileHandle.name;
             } else {
                 currentFileNameSpan.textContent = 'No file open'; // Or 'New file' if state allows
             }
        }
    }


    // --- Selection & Focus ---

    function handleFocusIn(event) {
        const target = event.target;
        const li = target.closest('li');

        if (li && outlineContainer.contains(li)) {
             // Select LI if focus is on its direct child P or the LI itself (for HR)
             if ((target.tagName === 'P' && target.parentElement === li) || (target === li && li.getAttribute('data-type') === 'hr')) {
                selectListItem(li);
             }
        }
    }

    function selectListItem(liElement) {
        if (!liElement || !outlineContainer.contains(liElement)) return;
        if (currentlySelectedLi === liElement) return; // Already selected

        if (currentlySelectedLi) {
            currentlySelectedLi.classList.remove('selected');
            // Remove temporary tabindex from previously selected HR
             if(currentlySelectedLi.getAttribute('data-type') === 'hr') {
                 currentlySelectedLi.removeAttribute('tabindex');
             }
        }
        currentlySelectedLi = liElement;
        currentlySelectedLi.classList.add('selected');
         // Ensure HR is focusable when selected
         if (currentlySelectedLi.getAttribute('data-type') === 'hr') {
             currentlySelectedLi.tabIndex = -1; // Make focusable
             // Optionally focus it immediately? Or wait for user interaction?
             // currentlySelectedLi.focus();
         }
        // console.log("Selected:", currentlySelectedLi?.id);
    }

    function getSelectedLi() {
        if (currentlySelectedLi && outlineContainer.contains(currentlySelectedLi)) {
            return currentlySelectedLi;
        }
        return outlineContainer.querySelector('li.selected'); // Fallback
    }

     function getFocusedP() {
         const active = document.activeElement;
         if (active && active.tagName === 'P' && active.isContentEditable && outlineContainer.contains(active)) {
             return active;
         }
         return null;
     }

    // --- Keyboard Navigation & Editing (Largely unchanged, ensure triggerAutoSaveDraft is called) ---

    function handleKeyDown(event) {
        const selectedLi = getSelectedLi();
        const targetP = getFocusedP(); // Might be null

         // Global Save Shortcut (Prioritize OPFS Save if handle exists)
         if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
             event.preventDefault();
             console.log("Ctrl+S detected");
             if (opfsFileHandle && !saveToOpfsButton.disabled) {
                 saveToOpfs();
             } else if (opfsRoot && rootUlElement) { // OPFS available but no handle - prompt to save *to* OPFS
                 saveToOpfs();
             } else if (rootUlElement) { // Fallback to download
                 saveFileAsDownload();
             }
             return;
         }

         // If nothing is loaded/created yet, Enter should create the first item
        if (!rootUlElement && event.key === 'Enter' && !event.shiftKey) {
             event.preventDefault();
             createFirstItem();
             return;
        }


        if (!selectedLi || !outlineContainer.contains(selectedLi)) {
            // If no LI selected, maybe allow Enter in empty container to create first item?
            if(event.key === 'Enter' && !event.shiftKey && !rootUlElement?.firstChild && !document.getElementById('initialMessage')) {
                 event.preventDefault();
                 createFirstItem();
            }
            return; // Most shortcuts require a selected LI
        }

        // --- Standard Key Handling ---
        switch (event.key) {
            case 'Enter':
                if (event.shiftKey) {
                    if (targetP) { // Shift+Enter: Insert line break
                         event.preventDefault();
                         document.execCommand('insertLineBreak');
                         triggerAutoSaveDraft();
                     }
                } else { // Enter: Create new item
                    event.preventDefault();
                    createNewItem(selectedLi); // Auto-saves draft inside
                }
                break;

            case 'Tab':
                event.preventDefault();
                if (event.shiftKey) outdentItem(selectedLi); // Auto-saves draft inside
                else indentItem(selectedLi); // Auto-saves draft inside
                break;

            case 'ArrowUp':
                 if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) { // Basic Nav Up
                     const prevLi = findPreviousVisibleLi(selectedLi);
                     if (prevLi) {
                         event.preventDefault();
                         selectAndFocusItem(prevLi, false); // Focus end
                     }
                 } else if (event.altKey && event.shiftKey) { // Move Up
                      event.preventDefault();
                      moveItemUp(selectedLi); // Auto-saves draft inside
                 }
                 break;

            case 'ArrowDown':
                 if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) { // Basic Nav Down
                     const nextLi = findNextVisibleLi(selectedLi);
                     if (nextLi) {
                         event.preventDefault();
                         selectAndFocusItem(nextLi, false); // Focus end
                     }
                 } else if (event.altKey && event.shiftKey) { // Move Down
                     event.preventDefault();
                     moveItemDown(selectedLi); // Auto-saves draft inside
                 }
                 break;

             case 'Backspace':
             case 'Delete':
                 // Delete item if P is empty or if Delete pressed on selected HR
                 const isHrSelected = selectedLi.getAttribute('data-type') === 'hr' && document.activeElement === selectedLi;
                 if ((targetP && targetP.textContent === '' && !targetP.querySelector('img') && !targetP.innerHTML.includes('<br>')) || // Empty P (ignore if just <br>)
                     (targetP && targetP.innerHTML === '<br>') || // Also delete if only placeholder <br>
                     (event.key === 'Delete' && isHrSelected))
                 {
                     event.preventDefault();
                     deleteItem(selectedLi); // Auto-saves draft inside
                 }
                 break;

             // Formatting shortcuts
             case 'b':
                 if (event.ctrlKey || event.metaKey) { event.preventDefault(); document.execCommand('bold'); triggerAutoSaveDraft(); }
                 break;
             case 'i':
                 if (event.ctrlKey || event.metaKey) { event.preventDefault(); document.execCommand('italic'); triggerAutoSaveDraft(); }
                 break;
             // Add others ('k' for link?)
             case 'k':
                 if (event.ctrlKey || event.metaKey) {
                     event.preventDefault();
                     handleLinkButtonClick(); // Trigger link logic
                 }
                 break;
        }
    }

     function createFirstItem() {
         console.log("Creating first item in empty container.");
         if (!rootUlElement) {
             rootUlElement = document.createElement('ul');
             rootUlElement.id = generateUniqueId(5);
             outlineContainer.innerHTML = ''; // Clear placeholder text
             outlineContainer.appendChild(rootUlElement);
         } else if (!outlineContainer.contains(rootUlElement)) {
              outlineContainer.innerHTML = ''; // Clear placeholder text
              outlineContainer.appendChild(rootUlElement);
         }
          initialMessageDiv?.remove(); // Remove initial message

         const newLi = document.createElement('li');
         newLi.id = generateUniqueId();
         const newP = document.createElement('p');
         newP.setAttribute('contenteditable', 'true');
         newP.innerHTML = '<br>'; // Start with a break for visibility
         newLi.appendChild(newP);
         rootUlElement.appendChild(newLi);

         selectListItem(newLi);
         newP.focus();
         triggerAutoSaveDraft();
     }

    function createNewItem(currentItemLi) {
        if (!currentItemLi || !outlineContainer.contains(currentItemLi)) return;

        const newLi = document.createElement('li');
        newLi.id = generateUniqueId();
        const newP = document.createElement('p');
        newP.setAttribute('contenteditable', 'true');
        newP.innerHTML = '<br>'; // Start with break
        newLi.appendChild(newP);

        // Insert after the current item at the same level
        currentItemLi.after(newLi);
        selectAndFocusItem(newLi, true); // Select and focus start
        triggerAutoSaveDraft();
    }

    // --- Navigation & Focus Helpers ---

    function selectAndFocusItem(li, focusStart = true) {
         if (!li) return;
         selectListItem(li);
         const pToFocus = li.querySelector(':scope > p[contenteditable="true"]');
         if (pToFocus) {
             focusAndMoveCursor(pToFocus, focusStart);
         } else if (li.getAttribute('data-type') === 'hr') {
             li.focus(); // Focus the LI itself for HR
         }
    }

     function focusAndMoveCursor(element, toStart = true) {
          if (!element) return;
          element.focus();
         const range = document.createRange();
         const selection = window.getSelection();
         range.selectNodeContents(element);
         range.collapse(toStart); // true = start, false = end
         selection.removeAllRanges();
         selection.addRange(range);
     }

     function findPreviousVisibleLi(li) { /* (Keep existing implementation) */
        let current = li.previousElementSibling;
         if (current) {
             while (true) {
                  const lastChildLi = current.querySelector(':scope > ul > li:last-child');
                  if (lastChildLi) current = lastChildLi;
                  else break;
             }
             return current;
         } else {
             const parentUl = li.parentElement;
             if (parentUl && parentUl !== rootUlElement) {
                 return parentUl.closest('li');
             }
         }
         return null;
     }

     function findNextVisibleLi(li) { /* (Keep existing implementation) */
          const firstChildLi = li.querySelector(':scope > ul > li:first-child');
         if (firstChildLi) return firstChildLi;

         let current = li;
         while (current) {
             const sibling = current.nextElementSibling;
             if (sibling) return sibling;
             const parentUl = current.parentElement;
             if (parentUl && parentUl !== rootUlElement) {
                 current = parentUl.closest('li');
             } else {
                 current = null;
             }
         }
         return null;
     }

    // --- Toolbar Actions ---

    function handleToolbarClick(event) {
        const button = event.target.closest('button');
        if (!button) return;

        const selectedLi = getSelectedLi();

        // Check if an action requires a selection
        const requiresSelection = button.classList.contains('type-button') ||
                                  ['indentButton', 'outdentButton', 'moveUpButton', 'moveDownButton', 'deleteButton', 'linkButton'].includes(button.id);

        if (requiresSelection && !selectedLi) {
            alert("Please select an item in the outline first.");
            return;
        }

        // --- Formatting ---
        if (button.classList.contains('format-button')) {
            const command = button.dataset.command;
            console.log(`Toolbar format: ${command}`);
            if (!ensureFocusInEditableParagraph(selectedLi)) return;

            if (command === 'highlight') wrapSelection('mark');
            else if (command === 'code') wrapSelection('code');
            else document.execCommand(command, false, null);
            triggerAutoSaveDraft();

        } else if (button.id === 'linkButton') {
             handleLinkButtonClick(selectedLi); // Use helper

        // --- Item Type ---
        } else if (button.classList.contains('type-button')) {
            const type = button.dataset.type;
            console.log(`Toolbar type change: ${type || 'plain'}`);
            changeItemType(selectedLi, type); // Use helper
            triggerAutoSaveDraft();

        // --- Outline Operations ---
        } else if (button.id === 'indentButton') indentItem(selectedLi); // Auto-saves draft
        else if (button.id === 'outdentButton') outdentItem(selectedLi); // Auto-saves draft
        else if (button.id === 'moveUpButton') moveItemUp(selectedLi);   // Auto-saves draft
        else if (button.id === 'moveDownButton') moveItemDown(selectedLi); // Auto-saves draft
        else if (button.id === 'deleteButton') deleteItem(selectedLi);   // Auto-saves draft
    }

     // Helper to ensure focus is inside an editable P, trying to focus if needed
     function ensureFocusInEditableParagraph(selectedLi) {
         let targetP = getFocusedP();
         if (!targetP && selectedLi) {
             targetP = selectedLi.querySelector(':scope > p[contenteditable="true"]');
             if (targetP) {
                 targetP.focus();
             }
         }
          if (!targetP || targetP.contentEditable !== 'true') {
              console.warn("Cannot perform action: No editable paragraph focused or selected.");
              alert("Please place your cursor inside an item's text.");
              return false;
          }
         return targetP; // Return the paragraph if successful
     }

     // Helper for Link Button logic (callable from toolbar and shortcut)
     function handleLinkButtonClick(selectedLi = getSelectedLi()) {
        const targetP = ensureFocusInEditableParagraph(selectedLi);
        if (!targetP) return;

        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
        const currentLink = range ? findParentLink(range.startContainer) : null;
        const defaultUrl = currentLink ? currentLink.href : "https://";

        // If selection is collapsed and not inside a link, maybe select word? (Optional QoL)

        const url = prompt("Enter link URL:", defaultUrl);
        if (url === null) return; // User cancelled

        // Restore selection if prompt caused it to lose focus (important!)
         if (range) {
             selection.removeAllRanges();
             selection.addRange(range);
         }

        // Unlink if needed (changing URL, or selection started/ended inside)
         if (currentLink) {
             document.execCommand('unlink', false, null);
             // Re-select the text after unlinking if possible
             if (range && !range.collapsed) {
                 selection.removeAllRanges();
                 selection.addRange(range);
             }
         }

        if (url !== "") { // Only create link if URL is not empty
             if (selection && !selection.isCollapsed) {
                document.execCommand('createLink', false, url);
            } else {
                 // Insert URL as text and link it if selection was collapsed
                 const linkHtml = `<a href="${escapeXml(url)}">${escapeXml(url)}</a>`;
                 document.execCommand('insertHTML', false, linkHtml);
            }
        }
         targetP.focus(); // Re-focus paragraph
        triggerAutoSaveDraft();
    }

    // Helper to change item type
    function changeItemType(li, type) {
         if (!li) return;
         const oldType = li.getAttribute('data-type');

         if (type) li.setAttribute('data-type', type);
         else li.removeAttribute('data-type');

         let p = li.querySelector(':scope > p'); // Direct child P

         if (type === 'hr') {
             // Ensure HR has NO editable P. A non-editable one could exist for structure.
             if (p) {
                 p.removeAttribute('contenteditable');
                 p.innerHTML = ''; // Clear content if any existed
             }
             li.tabIndex = -1; // Make HR itself focusable
             li.focus();
         } else {
              // Ensure other types HAVE an editable P
             if (!p) {
                 p = document.createElement('p');
                 li.insertBefore(p, li.firstChild); // Add P if missing
                 p.innerHTML = '<br>'; // Start with placeholder
             }
             p.setAttribute('contenteditable', 'true');
             li.removeAttribute('tabindex'); // Remove tabindex from LI if it had one (e.g., was HR)
             focusAndMoveCursor(p, false); // Focus end of the paragraph
         }
         // Optional: Handle list counter resets if type changes involve ordered lists?
         // CSS counters usually handle this automatically based on structure.
    }

     function findParentLink(node) { /* (Keep existing implementation) */
        while (node && node !== outlineContainer) {
            if (node.tagName === 'A') return node;
            node = node.parentNode;
        }
        return null;
    }


    // --- Selection Wrapping Helper ---
    function wrapSelection(tagName) { /* (Keep existing implementation, ensure triggerAutoSaveDraft) */
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        const editorP = range.commonAncestorContainer.closest('p[contenteditable="true"]');
         if (!editorP || !outlineContainer.contains(editorP)) return;

        const wrapper = document.createElement(tagName);
        try {
            // Check if selection spans across multiple block elements (won't work)
            if (range.startContainer.parentNode !== range.endContainer.parentNode ||
                 range.commonAncestorContainer === editorP) {
                range.surroundContents(wrapper);
            } else {
                 // Fallback for complex selections: Apply formatting via execCommand if possible
                 // This might not be perfect for custom tags like <mark> or <code>
                 console.warn("Complex selection, attempting execCommand fallback for wrapping");
                  const tempDiv = document.createElement('div'); tempDiv.appendChild(range.extractContents());
                  document.execCommand('insertHTML', false, `<${tagName}>${tempDiv.innerHTML}</${tagName}>`);
            }
        } catch (e) {
             console.warn("surroundContents failed, using insertHTML fallback:", e);
              const selectedHtml = range.toString(); // Get text before potential modification
              // Need to be careful with insertHTML potentially breaking structure
              document.execCommand('insertHTML', false, `<${tagName}>${escapeXml(selectedHtml)}</${tagName}>`);
        }
        editorP.focus(); // Re-focus
        triggerAutoSaveDraft(); // Content changed
    }


    // --- Outline Operation Implementations (Ensure triggerAutoSaveDraft) ---

    function indentItem(li) { /* (Keep existing, add triggerAutoSaveDraft) */
        if (!li) return;
        const previousLi = li.previousElementSibling;
        if (!previousLi || previousLi.getAttribute('data-type') === 'hr') return;
        console.log(`Indenting item: ${li.id}`);

        let targetUl = previousLi.querySelector(':scope > ul');
        if (!targetUl) { targetUl = document.createElement('ul'); previousLi.appendChild(targetUl); }
        targetUl.appendChild(li);
        selectAndFocusItem(li, false); // Reselect and focus end
        triggerAutoSaveDraft();
    }

    function outdentItem(li) { /* (Keep existing, add triggerAutoSaveDraft) */
        if (!li) return;
        const parentUl = li.parentElement;
        if (!parentUl || parentUl === rootUlElement || !parentUl.closest('li')) return;
        const grandparentLi = parentUl.closest('li');
        if (!grandparentLi) return;
        console.log(`Outdenting item: ${li.id}`);

        // Move subsequent siblings under the item being outdented?
        // Standard behavior: Move siblings into a new nested list under the item *before* the outdented one?
        // Simpler behavior (TaskPaper/Bike?): Just move the item itself. Let's stick to simple.
        let insertAfter = grandparentLi;

        // Move siblings that were *after* the outdented item
        let nextSibling = li.nextElementSibling;
        if(nextSibling) { // If there are siblings after it
            const newUl = document.createElement('ul');
            while(nextSibling) {
                const toMove = nextSibling;
                nextSibling = nextSibling.nextElementSibling; // Get next before moving
                newUl.appendChild(toMove);
            }
            li.appendChild(newUl); // Append the new UL with siblings to the moved item
        }


        grandparentLi.after(li); // Move the item itself

        if (parentUl.children.length === 0) parentUl.remove(); // Clean up empty UL

        selectAndFocusItem(li, false); // Reselect and focus end
        triggerAutoSaveDraft();
    }

    function moveItemUp(li) { /* (Keep existing, add triggerAutoSaveDraft) */
        if (!li) return;
        const previousLi = li.previousElementSibling;
        if (previousLi) {
            console.log(`Moving item up: ${li.id}`);
            li.parentElement.insertBefore(li, previousLi);
            selectListItem(li); // Keep selection
            ensureFocusInEditableParagraph(li); // Keep focus if possible
            triggerAutoSaveDraft();
        }
    }

    function moveItemDown(li) { /* (Keep existing, add triggerAutoSaveDraft) */
        if (!li) return;
        const nextLi = li.nextElementSibling;
        if (nextLi) {
             console.log(`Moving item down: ${li.id}`);
            li.parentElement.insertBefore(nextLi, li);
             selectListItem(li);
             ensureFocusInEditableParagraph(li);
             triggerAutoSaveDraft();
        }
    }

    function deleteItem(li) { /* (Keep existing, refine selection logic, add triggerAutoSaveDraft) */
         if (!li || !outlineContainer.contains(li)) return;

        const pText = li.querySelector('p')?.textContent || (li.getAttribute('data-type') === 'hr' ? '[HR]' : '[Empty]');
        console.log(`Deleting item: ${li.id} ("${pText.substring(0,20)}...")`);

        let itemToSelectAfter = findPreviousVisibleLi(li) || findNextVisibleLi(li);
        const parentUl = li.parentElement;
        const wasLastItemInParent = !li.nextElementSibling && parentUl !== rootUlElement;
        const parentLi = parentUl?.closest('li'); // Parent LI if nested

         // If deleting last item of a nested list, select parent LI instead of sibling
         if(wasLastItemInParent && parentLi) {
             itemToSelectAfter = parentLi;
         }

        li.remove();
        if(currentlySelectedLi === li) currentlySelectedLi = null; // Clear selection state

         if (parentUl && parentUl !== rootUlElement && parentUl.children.length === 0) {
            parentUl.remove();
        }

         if (rootUlElement && rootUlElement.children.length === 0) {
             console.log("Outline became empty after deletion.");
             resetEditorState(false); // Keep OPFS handle if any, show initial message
         } else if (itemToSelectAfter && outlineContainer.contains(itemToSelectAfter)) {
             selectAndFocusItem(itemToSelectAfter, false); // Select and focus end
         } else if (rootUlElement && rootUlElement.firstElementChild) {
              // Fallback: select first item in the whole outline
              const firstItem = rootUlElement.querySelector('li');
              if (firstItem) selectAndFocusItem(firstItem, false);
              else resetEditorState(false); // Should not happen if rootUl has children
         } else {
             // Truly empty now
             resetEditorState(false);
         }
         triggerAutoSaveDraft();
    }

    // --- Utility ---
    function generateUniqueId(length = 4) { /* (Keep existing) */
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let id = ''; let attempts = 0;
        do {
             id = '';
            for (let i = 0; i < length; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
            if (/^[0-9]/.test(id)) continue; // Avoid starting with number
            attempts++;
        } while (document.getElementById(id) && attempts < 100);
         if (attempts >= 100) return `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        return id;
    }

});