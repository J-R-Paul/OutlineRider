document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const fileInput = document.getElementById('fileInput');
    const directFileAccessDiv = document.getElementById('directFileAccess');
    const openDirectButton = document.getElementById('openDirectButton');
    const saveDirectButton = document.getElementById('saveDirectButton');
    const opfsFileAccessDiv = document.getElementById('opfsFileAccess');
    const manageOpfsButton = document.getElementById('manageOpfsButton');
    const saveToOpfsButton = document.getElementById('saveToOpfsButton');
    const saveAsButton = document.getElementById('saveAsButton');
    const outlineContainer = document.getElementById('outlineContainer');
    const toolbar = document.getElementById('toolbar');
    const currentFileNameSpan = document.getElementById('currentFileName');
    const clearLocalButton = document.getElementById('clearLocalButton');
    const initialMessageDiv = document.getElementById('initialMessage');
    const directInfoLi = document.getElementById('directInfo');
    const opfsInfoLi = document.getElementById('opfsInfo');

    // --- State Variables ---
    let rootUlElement = null;
    let currentlySelectedLi = null;
    let directFileHandle = null; // Standard File System Access API handle
    let opfsFileHandle = null; // Origin Private File System handle
    let currentFileSource = null; // 'direct', 'opfs', 'copy', 'draft', 'new'
    let opfsRoot = null; // Cache OPFS root directory handle
    let fileSystemWorker = null; // Web Worker instance
    let autoSaveTimeout = null;
    let isDirty = false; // Track if changes have been made since last save/load

    // --- Constants ---
    const LOCAL_STORAGE_KEY = 'bikeEditorProDraft'; // Updated key
    const AUTOSAVE_DELAY = 1500;

    // --- Feature Detection & Initial Setup ---
    async function initialize() {
        let opfsSupported = false;
        let directAccessSupported = false;

        // Check for OPFS support (Safari / others)
        if ('storage' in navigator && 'getDirectory' in navigator.storage) {
            console.log("OPFS API supported.");
            try {
                opfsRoot = await navigator.storage.getDirectory();
                opfsFileAccessDiv.style.display = 'flex'; // Use flex for group
                opfsInfoLi.style.display = 'list-item';
                opfsSupported = true;
                // Setup Worker only if OPFS is supported
                fileSystemWorker = new Worker('worker.js');
                fileSystemWorker.onmessage = handleWorkerMessage;
                fileSystemWorker.onerror = (err) => console.error("Worker Error:", err);
                console.log("OPFS Root Handle obtained and Worker started.");
            } catch (err) {
                console.error("Error initializing OPFS:", err);
                opfsFileAccessDiv.style.display = 'none';
                opfsInfoLi.style.display = 'none';
            }
        } else {
            console.warn("OPFS API not supported.");
            opfsFileAccessDiv.style.display = 'none';
            opfsInfoLi.style.display = 'none';
        }

        // Check for Standard File System Access API (Chrome/Edge)
        if ('showOpenFilePicker' in window && 'createWritable' in FileSystemFileHandle.prototype) {
            console.log("Standard File System Access API (with Write) supported.");
            directFileAccessDiv.style.display = 'flex'; // Use flex for group
            directInfoLi.style.display = 'list-item';
            directAccessSupported = true;
        } else {
            console.warn("Standard File System Access API (with Write) not supported.");
            directFileAccessDiv.style.display = 'none';
            directInfoLi.style.display = 'none';
        }

        // Attempt to load draft from Local Storage if nothing else loaded
        if (!directAccessSupported && !opfsSupported) {
             // If no file system access, draft is more important
             loadFromLocalStorage(true); // Force prompt if exists
        } else {
             loadFromLocalStorage(false); // Only load if editor is empty and user confirms
        }

         // Set initial UI state based on whether content is loaded
         updateFileStateUI();

         // Add beforeunload listener for unsaved changes
         window.addEventListener('beforeunload', (event) => {
            if (isDirty) {
                const message = "You have unsaved changes. Are you sure you want to leave?";
                event.returnValue = message; // Standard for most browsers
                return message; // For older browsers
            }
        });
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoadFromInput);
    openDirectButton.addEventListener('click', openFileDirectly);
    saveDirectButton.addEventListener('click', saveFileDirectly);
    manageOpfsButton.addEventListener('click', manageOpfsFiles);
    saveToOpfsButton.addEventListener('click', saveToOpfs);
    saveAsButton.addEventListener('click', saveFileAsDownload);
    clearLocalButton.addEventListener('click', clearLocalStorage);
    toolbar.addEventListener('click', handleToolbarClick);
    outlineContainer.addEventListener('keydown', handleKeyDown);
    outlineContainer.addEventListener('focusin', handleFocusIn);
    // Use a single input handler for simplicity
    outlineContainer.addEventListener('input', handleContentChange);
    // Click listener for task toggling
    outlineContainer.addEventListener('click', handleOutlineClick);


    // --- Initial Load ---
    initialize();

    // --- State Management ---

    function handleContentChange() {
        if (!isDirty) {
            console.log("Content changed, marking as dirty.");
            isDirty = true;
            updateFileStateUI(); // Update UI (e.g., add '*' to filename)
        }
        triggerAutoSaveDraft();
    }

    function markAsClean() {
        if (isDirty) {
            console.log("Marking content as clean (saved).");
            isDirty = false;
            updateFileStateUI();
            // Clear draft *after* successful save of the primary file
            clearLocalStorage(false);
        }
    }

    function updateFileStateUI() {
        let fileName = "No file open";
        let saveDirectEnabled = false;
        let saveOpfsEnabled = false;

        if (directFileHandle) {
            fileName = directFileHandle.name;
            saveDirectEnabled = true;
        } else if (opfsFileHandle) {
            fileName = opfsFileHandle.name;
            saveOpfsEnabled = true;
        } else if (currentFileSource === 'copy' || currentFileSource === 'draft' || currentFileSource === 'new') {
            fileName = currentFileNameSpan.textContent || "Untitled"; // Keep temporary name
             // Allow saving *to* OPFS if supported, even without a current OPFS handle
             saveOpfsEnabled = !!opfsRoot && !!rootUlElement;
             // Direct save is never enabled for copies/drafts/new
             saveDirectEnabled = false;
        } else {
            // No file truly open, might be initial state
            fileName = "No file open";
        }

        // Add dirty indicator
        if (isDirty && fileName !== "No file open") {
            fileName += "*";
        }

        currentFileNameSpan.textContent = fileName;
        currentFileNameSpan.title = fileName; // Update tooltip as well

        saveDirectButton.disabled = !saveDirectEnabled;
        // Enable OPFS save if OPFS is supported AND (either an OPFS file is open OR there is content to save as new)
        saveToOpfsButton.disabled = !(opfsRoot && (opfsFileHandle || rootUlElement));

        // Show/hide initial message based on content
        if (rootUlElement && outlineContainer.contains(rootUlElement)) {
            initialMessageDiv?.remove(); // Remove if content exists
        } else if (!document.getElementById('initialMessage')) {
            outlineContainer.prepend(initialMessageDiv); // Add if no content
            initialMessageDiv.style.display = 'block';
        }
    }

    function resetEditorState(newSource = null) {
        console.log(`Resetting editor state. New source: ${newSource}`);
        const hadContent = !!rootUlElement;

        outlineContainer.innerHTML = ''; // Clear content first
        // Re-add initial message div if it's not already there
        if (!document.getElementById('initialMessage')) {
             outlineContainer.prepend(initialMessageDiv);
        }
        initialMessageDiv.style.display = 'block'; // Ensure it's visible

        rootUlElement = null;
        currentlySelectedLi = null;
        directFileHandle = null;
        opfsFileHandle = null;
        currentFileSource = newSource;
        clearTimeout(autoSaveTimeout);

        // Only mark as clean if we explicitly loaded something or started fresh
        // Don't mark clean if reset was due to an error during load/save
        if(newSource !== 'error') {
             isDirty = false; // Reset dirty state
        }

        updateFileStateUI(); // Update buttons and filename display

        // If we cleared content that existed, trigger a draft save immediately
        // This saves the "empty" state if the user intended to clear.
        // However, maybe only clear draft? Let's just clear it.
        // if (hadContent) {
        //      triggerAutoSaveDraft(); // Save the cleared state? Or just clear?
        // }
    }


    // --- File Handling (Input & Download) ---

    async function checkUnsavedChanges(actionDescription = "perform this action") {
        if (isDirty) {
            return confirm(`You have unsaved changes. Are you sure you want to ${actionDescription} and discard them?`);
        }
        return true; // Proceed if not dirty
    }

    async function handleFileLoadFromInput(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!await checkUnsavedChanges(`load '${file.name}'`)) {
            fileInput.value = ''; // Clear input if cancelled
            return;
        }

        console.log(`Loading file from input: ${file.name}`);
        loadFileContent(file, file.name, 'copy');
        fileInput.value = ''; // Clear input after processing
    }

    async function loadFileContent(file, displayName, source) {
         console.log(`Reading content for: ${displayName}, Source: ${source}`);
         try {
            const fileContent = await file.text();
            resetEditorState(source); // Reset state FIRST, marking source
            parseAndRenderBike(fileContent); // Parse and render

            // Update UI based on source AFTER parsing
            currentFileNameSpan.textContent = source === 'copy' ? `${displayName} (copy)` : displayName;
            currentFileSource = source; // Ensure source is set
            markAsClean(); // Freshly loaded file is clean
            console.log(`Successfully parsed and rendered: ${displayName}`);

            // Select first item automatically
            const firstLi = rootUlElement?.querySelector('li');
             if (firstLi) {
                 selectAndFocusItem(firstLi, true); // Focus start
             }

        } catch (err) {
            console.error(`Error reading or parsing file content for ${displayName}:`, err);
            alert(`Error loading file '${displayName}'. It might be invalid or corrupted.\n\n${err.message}`);
            resetEditorState('error'); // Reset on error
        }
    }

    function fixFileName(name, defaultExt = '.bike') {
        let fixedName = name.trim();
        if (!fixedName) fixedName = "untitled";

        // Remove trailing dots or slashes
        fixedName = fixedName.replace(/[.\/]+$/, '');

        // Ensure it has the correct extension, avoiding double extensions
        const extensions = ['.bike', '.html', '.xhtml', '.xml'];
        let hasExt = false;
        for (const ext of extensions) {
            if (fixedName.toLowerCase().endsWith(ext)) {
                hasExt = true;
                break;
            }
        }
        if (!hasExt) {
            fixedName += defaultExt;
        }
        return fixedName;
    }


    function saveFileAsDownload() {
        console.log("Attempting Save As / Download...");
        if (!rootUlElement || !outlineContainer.contains(rootUlElement)) {
             alert("Nothing to save.");
             return;
         }
        try {
             const bikeHTML = serializeOutlineToHTML();
             if (!bikeHTML) throw new Error("Serialization failed, cannot save empty content.");

            const blob = new Blob([bikeHTML], { type: 'application/xhtml+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            let filename = 'outline'; // Default base
             if (directFileHandle?.name) {
                 filename = directFileHandle.name;
             } else if (opfsFileHandle?.name) {
                 filename = opfsFileHandle.name;
             } else if (currentFileNameSpan.textContent && currentFileNameSpan.textContent !== 'No file open') {
                  // Use current display name, remove dirty indicator and copy marker
                  filename = currentFileNameSpan.textContent.replace('*', '').replace(' (copy)', '').replace(' (new)', '');
             }

            a.download = fixFileName(filename); // Ensure correct extension
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("File download initiated as:", a.download);

            // Mark as clean ONLY if the current source wasn't 'direct' or 'opfs'
            // Because downloading a copy doesn't save the original handle
            if (currentFileSource !== 'direct' && currentFileSource !== 'opfs') {
                 // Optional: Should downloading a copy mark the editor clean? Maybe not.
                 // markAsClean();
            }

        } catch (err) {
            console.error("Error preparing file for download:", err);
            alert(`Could not prepare file for download: ${err.message}.`);
        }
    }

    // --- Standard File System Access API ---

    async function openFileDirectly() {
        console.log("Attempting to open file directly (Standard FSA)...");
         if (!('showOpenFilePicker' in window)) return alert("Direct file editing is not supported by this browser."); // Should be hidden anyway

        if (!await checkUnsavedChanges("open a new file")) return;

        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Bike Outline Files',
                    accept: { 'application/xhtml+xml': ['.bike', '.html', '.xhtml'], 'text/xml': ['.xml']}
                }],
            });
            console.log("Direct file handle obtained:", handle.name);
            const file = await handle.getFile();
            await loadFileContent(file, handle.name, 'direct'); // Load content, sets source
            directFileHandle = handle; // Store the handle AFTER successful load
            opfsFileHandle = null; // Clear OPFS handle
            updateFileStateUI(); // Update buttons etc.
            console.log("File loaded directly:", file.name);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("Error opening file directly:", err);
                alert(`Could not open file directly: ${err.message}.`);
                 resetEditorState('error');
            } else {
                console.log("User cancelled direct file open dialog.");
            }
        }
    }

    async function saveFileDirectly() {
        console.log("Attempting to save file directly (Standard FSA)...");
        if (!directFileHandle) {
            alert("No direct file is open for saving.");
            return;
        }
        if (!rootUlElement || !outlineContainer.contains(rootUlElement)) {
             alert("Nothing to save.");
             return;
         }

        setSavingIndicator('saveDirectButton', true, 'Saving...');
        try {
             const bikeHTML = serializeOutlineToHTML();
             if (!bikeHTML) throw new Error("Serialization failed.");

             // Verify permission (important for robustness)
             if (await directFileHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
                 if (await directFileHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
                     throw new Error("Permission to write to the file was denied.");
                 }
             }

            const writable = await directFileHandle.createWritable();
            await writable.write(bikeHTML);
            await writable.close();
            console.log("File saved directly successfully:", directFileHandle.name);
            markAsClean(); // Mark as clean after successful save
            setSavingIndicator('saveDirectButton', false, 'Saved!');
            setTimeout(() => setSavingIndicator('saveDirectButton', false, 'Save Directly'), 2000); // Reset text

        } catch (err) {
            console.error("Error saving file directly:", err);
            alert(`Could not save file directly: ${err.message}. Try 'Save As'.`);
            setSavingIndicator('saveDirectButton', false, 'Save Directly'); // Reset on error
        }
    }

    // --- OPFS File Handling ---

    async function manageOpfsFiles() {
        if (!opfsRoot) return alert("App Storage (OPFS) is not available.");

        // Check for unsaved changes before potentially loading a new file
        // Do this *before* listing files to avoid unnecessary work if user cancels
        if (isDirty && !(await checkUnsavedChanges("manage app files"))) {
             console.log("Manage OPFS cancelled due to unsaved changes.");
             return;
        }

        let fileList = [];
        let fileListString = "Files in App Storage:\n";
        let index = 1;
        try {
            console.log("Enumerating OPFS directory...");
            for await (const handle of opfsRoot.values()) {
                // Simple filter for likely bike files
                if (handle.kind === 'file' && /\.(bike|html|xml|xhtml)$/i.test(handle.name)) {
                    fileList.push(handle.name);
                    fileListString += `${index}. ${handle.name}\n`;
                    index++;
                }
            }
        } catch (err) {
            console.error("Error listing OPFS files:", err);
            return alert(`Could not list files in App Storage: ${err.message}`);
        }

        if (fileList.length === 0) fileListString += "(No suitable files found)\n";

        const actionPrompt = `${fileListString}\nEnter number to OPEN,\n'N' to create NEW,\n'D' + number to DELETE,\nor Cancel.`;
        const choice = prompt(actionPrompt)?.trim();

        if (!choice) return; // User cancelled

        if (choice.toUpperCase() === 'N') {
            const newFileName = prompt("Enter name for new file (e.g., 'MyNotes.bike'):");
            if (newFileName && newFileName.trim()) {
                const finalName = fixFileName(newFileName); // Ensure .bike/.html etc.
                resetEditorState('new'); // Clear editor, mark as new source
                createMinimalStructure(); // Create basic UL/LI/P
                opfsFileHandle = null; // No handle *yet*, created on first save
                directFileHandle = null;
                currentFileNameSpan.textContent = finalName + " (new)";
                currentFileSource = 'new';
                isDirty = true; // New file is inherently 'dirty' until first save
                updateFileStateUI();
                selectAndFocusItem(rootUlElement.querySelector('li'), true); // Focus first item
                console.log("Prepared new file structure for OPFS:", finalName);
            }
        } else if (choice.toUpperCase().startsWith('D')) {
            const numStr = choice.substring(1).trim();
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num > 0 && num <= fileList.length) {
                const nameToDelete = fileList[num - 1];
                if (confirm(`Are you sure you want to PERMANENTLY DELETE '${nameToDelete}' from App Storage?`)) {
                    try {
                        await opfsRoot.removeEntry(nameToDelete);
                        console.log("Deleted from OPFS:", nameToDelete);
                        alert(`'${nameToDelete}' deleted.`);
                        // If the deleted file was currently open via OPFS, reset
                        if (opfsFileHandle && opfsFileHandle.name === nameToDelete) {
                            resetEditorState('deleted');
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
            const num = parseInt(choice, 10);
            if (!isNaN(num) && num > 0 && num <= fileList.length) {
                const nameToOpen = fileList[num - 1];
                // Unsaved changes check was already done above
                try {
                    console.log("Opening from OPFS:", nameToOpen);
                    const handle = await opfsRoot.getFileHandle(nameToOpen);
                    const file = await handle.getFile();
                    await loadFileContent(file, handle.name, 'opfs'); // Load content, sets source
                    opfsFileHandle = handle; // Store handle AFTER successful load
                    directFileHandle = null; // Clear other handle
                    updateFileStateUI();
                    console.log("Loaded from OPFS:", handle.name);
                } catch (err) {
                    console.error(`Error opening ${nameToOpen} from OPFS:`, err);
                    alert(`Could not open '${nameToOpen}': ${err.message}`);
                    resetEditorState('error');
                }
            } else {
                alert("Invalid choice.");
            }
        }
    }


    async function saveToOpfs() {
        console.log("Attempting to save to OPFS...");
        if (!opfsRoot || !fileSystemWorker) {
            return alert("App Storage (OPFS) or Worker is not available/initialized.");
        }
        if (!rootUlElement || !outlineContainer.contains(rootUlElement)) {
            return alert("Nothing to save.");
        }

        const htmlContent = serializeOutlineToHTML();
        if (!htmlContent) {
            return alert("Serialization failed, cannot save empty content.");
        }

        let targetFileName;

        setSavingIndicator('saveToOpfsButton', true, 'Saving...');

        try {
            if (opfsFileHandle) {
                // Saving to the currently open OPFS file
                targetFileName = opfsFileHandle.name;
                console.log("Saving to existing OPFS handle:", targetFileName);
                // Send filename and content to worker
                fileSystemWorker.postMessage({ action: 'saveOpfs', fileName: targetFileName, content: htmlContent });
            } else {
                // No OPFS file is 'open', prompt for a name to save *as* into OPFS
                const currentNameGuess = currentFileNameSpan.textContent?.replace('*', '').replace(' (copy)', '').replace(' (new)', '').trim();
                const suggestedName = fixFileName(currentNameGuess || 'new_outline');

                const fileNamePrompt = prompt("Enter filename to save in App Storage:", suggestedName);
                if (fileNamePrompt && fileNamePrompt.trim()) {
                    targetFileName = fixFileName(fileNamePrompt);
                    console.log("Saving new file to OPFS as:", targetFileName);

                    // We need to ensure the handle exists before telling the worker to use it.
                    // The worker will also call getFileHandle with create:true, but doing it here
                    // allows us to store the handle immediately for future saves.
                    const newHandle = await opfsRoot.getFileHandle(targetFileName, { create: true });
                    opfsFileHandle = newHandle; // Store the handle
                    directFileHandle = null; // Clear direct handle if saving as new OPFS
                    currentFileSource = 'opfs'; // Now it's an OPFS file
                    currentFileNameSpan.textContent = targetFileName; // Update display name immediately
                    updateFileStateUI(); // Reflect new state

                    // Send filename and content to worker
                    fileSystemWorker.postMessage({ action: 'saveOpfs', fileName: targetFileName, content: htmlContent });

                } else {
                    console.log("Save to OPFS cancelled by user (no filename).");
                    setSavingIndicator('saveToOpfsButton', false); // Reset indicator
                    return; // Exit early
                }
            }
        } catch (err) {
             console.error("Error preparing OPFS save:", err);
             alert(`Could not prepare file for saving to App Storage: ${err.message}`);
             setSavingIndicator('saveToOpfsButton', false);
        }
    }

    // Handle messages back from the worker
    function handleWorkerMessage(event) {
        const { success, fileName, error } = event.data;
        if (success) {
            console.log(`Worker successfully saved: ${fileName}`);
            // Ensure the handle state matches the saved file
            if (opfsFileHandle?.name === fileName || !opfsFileHandle) {
                 // If the saved file matches the current handle OR if we just saved a new file
                 markAsClean(); // Mark clean after successful save
                 setSavingIndicator('saveToOpfsButton', false, 'Saved!');
                 setTimeout(() => setSavingIndicator('saveToOpfsButton', false, 'Save to App Storage'), 2000);
            } else {
                 // This case should ideally not happen with the current logic
                 console.warn("Worker saved a file, but it doesn't match current OPFS handle state.");
                 setSavingIndicator('saveToOpfsButton', false); // Reset anyway
            }
        } else {
            console.error(`Worker failed to save ${fileName || 'file'}:`, error);
            alert(`Failed to save ${fileName ? `'${fileName}'` : 'file'} to App Storage.\n\n${error}`);
            setSavingIndicator('saveToOpfsButton', false); // Remove saving indicator on failure
        }
    }

     function setSavingIndicator(buttonId, isSaving, message = null) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        if (isSaving) {
            button.textContent = message || 'Saving...';
            button.disabled = true;
             button.style.backgroundColor = '#e9ecef'; // Indicate activity
        } else {
             button.textContent = message || button.title; // Use title as default reset text? Or specific text?
             // Determine correct disabled state based on overall state
             updateFileStateUI(); // Let the main UI updater handle disable state
             if (message === 'Saved!') {
                 button.style.backgroundColor = '#d1e7dd'; // Bootstrap success light
                 setTimeout(() => { button.style.backgroundColor = ''; }, 2000);
             } else {
                  button.style.backgroundColor = ''; // Reset background
             }
        }
    }

    // --- Local Storage (Draft) Functions ---

    function triggerAutoSaveDraft() {
        clearTimeout(autoSaveTimeout);
        // Only save draft if changes are actually made (isDirty)
        if (isDirty) {
             autoSaveTimeout = setTimeout(saveDraftToLocalStorage, AUTOSAVE_DELAY);
        }
    }

    function saveDraftToLocalStorage() {
        if (!isDirty) return; // Don't save if not dirty
        if (rootUlElement && outlineContainer.contains(rootUlElement) && !document.getElementById('initialMessage')) {
            try {
                const bikeHTML = serializeOutlineToHTML();
                if (!bikeHTML) return;
                localStorage.setItem(LOCAL_STORAGE_KEY, bikeHTML);
                // console.log("Draft saved."); // Less verbose
            } catch (error) {
                console.error("Error saving draft:", error);
            }
        } else {
             // If editor is empty, clear the draft instead of saving empty
             localStorage.removeItem(LOCAL_STORAGE_KEY);
             console.log("Editor empty, draft cleared.");
         }
    }

    function loadFromLocalStorage(forcePrompt = false) {
        const storedContent = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (storedContent && storedContent.length > 100 && !storedContent.includes('<div id="initialMessage">')) { // Basic validity check
            console.log("Found draft in local storage.");
            const editorIsEmpty = !rootUlElement || document.getElementById('initialMessage');

            if (editorIsEmpty || forcePrompt) {
                 if (confirm("Load unsaved draft from previous session? (Choosing 'Cancel' will discard the draft)")) {
                     try {
                        console.log("Loading draft.");
                        resetEditorState('draft'); // Reset, mark as draft
                        parseAndRenderBike(storedContent);
                        currentFileNameSpan.textContent = "Unsaved Draft";
                        isDirty = true; // Loaded draft is considered dirty until saved properly
                        updateFileStateUI();
                     } catch (error) {
                        console.error("Error parsing draft:", error);
                        alert("Could not load draft, it might be corrupted. Discarding.");
                        clearLocalStorage(false);
                        resetEditorState('error');
                    }
                } else {
                     console.log("User chose not to load draft. Discarding.");
                    clearLocalStorage(false);
                }
            } else {
                console.log("Editor not empty, ignoring draft.");
            }
        } else if (storedContent) {
            console.log("Invalid/empty draft found, clearing.");
            clearLocalStorage(false); // Clear invalid draft
        } else {
             console.log("No draft found.");
         }
    }

    function clearLocalStorage(promptUser = true) {
        let confirmClear = !promptUser;
        if (promptUser && localStorage.getItem(LOCAL_STORAGE_KEY)) { // Only prompt if draft exists
            confirmClear = confirm("Are you sure you want to clear the temporary draft?");
        }

        if (confirmClear) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            console.log("Local storage draft cleared.");
             if (currentFileSource === "draft") {
                  alert("Draft cleared. Editor reset.");
                  resetEditorState('cleared');
             }
        } else {
             console.log("User cancelled clearing draft.");
         }
    }


    // --- Parsing, Rendering, Serialization ---

    function parseAndRenderBike(htmlString) {
        // try/catch is handled by callers (loadFileContent, loadFromLocalStorage)
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'application/xhtml+xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
             console.error("XML Parse Error:", parseError.textContent);
             throw new Error(`Parse Error: Invalid Bike/XML file.\n${parseError.textContent.split('\n')[0]}`);
        }

        rootUlElement = doc.body?.querySelector('ul');
        if (!rootUlElement) {
            // Check if it's just a body fragment without the ul (less common)
            if (doc.body && doc.body.children.length > 0 && !doc.body.querySelector(':scope > ul')) {
                console.warn("Content seems to be missing root <ul>, wrapping body content.");
                 const tempUl = document.createElement('ul');
                 tempUl.id = generateUniqueId(5);
                 while(doc.body.firstChild) {
                     // Try converting LI elements directly, wrap others
                     if (doc.body.firstChild.tagName?.toUpperCase() === 'LI') {
                         tempUl.appendChild(doc.body.firstChild);
                     } else {
                         const tempLi = document.createElement('li'); tempLi.id = generateUniqueId();
                         tempLi.appendChild(doc.body.firstChild);
                         tempUl.appendChild(tempLi);
                     }
                 }
                 rootUlElement = tempUl;
            } else {
                  throw new Error('Could not find the root <ul> element.');
            }
        }

        outlineContainer.innerHTML = ''; // Clear previous
        outlineContainer.appendChild(document.importNode(rootUlElement, true));
        rootUlElement = outlineContainer.querySelector('ul'); // Re-assign to live element

        makeEditableAndInteractive(outlineContainer);
        initialMessageDiv?.remove();
    }

    function makeEditableAndInteractive(container) {
        container.querySelectorAll('li').forEach(li => {
            if (!li.id) li.id = generateUniqueId();
            const p = li.querySelector(':scope > p');

            if (li.getAttribute('data-type') === 'hr') {
                if (p) p.remove(); // HR should not have a paragraph
                li.tabIndex = -1;
            } else if (!p) {
                // Create P if missing for non-HR items
                const newP = document.createElement('p');
                newP.setAttribute('contenteditable', 'true');
                newP.innerHTML = '<br>'; // Start empty
                li.prepend(newP); // Add to beginning
                setupParagraph(newP, li);
            } else {
                 // Setup existing paragraph
                 setupParagraph(p, li);
            }
        });
        if (rootUlElement && !rootUlElement.id) rootUlElement.id = generateUniqueId(5);
    }

    // Helper to setup paragraph contenteditable and task checkbox if needed
    function setupParagraph(p, li) {
        p.setAttribute('contenteditable', 'true');
        if (li.getAttribute('data-type') === 'task') {
            // Ensure checkbox span exists or create it
            let checkbox = p.querySelector('span.task-checkbox');
            if (!checkbox) {
                 checkbox = document.createElement('span');
                 checkbox.className = 'task-checkbox';
                 checkbox.setAttribute('contenteditable', 'false'); // Not editable itself
                 checkbox.setAttribute('aria-hidden', 'true'); // Hide from screen readers as state is on LI
                 p.prepend(document.createTextNode(' ')); // Add space before text
                 p.prepend(checkbox); // Add checkbox at the beginning
            }
            // Set initial state based on li[data-done]
             checkbox.textContent = li.getAttribute('data-done') === 'true' ? '☑' : '☐';
        } else {
            // Remove checkbox if type is not task
             p.querySelector('span.task-checkbox')?.remove();
        }

         // Ensure empty paragraphs have a placeholder <br> for clickability
         if (!p.textContent.trim() && !p.querySelector('br')) {
             p.innerHTML = '<br>';
         }
    }

     function serializeOutlineToHTML() {
         if (!rootUlElement || !outlineContainer.contains(rootUlElement)) return "";
         if (document.activeElement?.isContentEditable) document.activeElement.blur();

         const contentToSave = rootUlElement.cloneNode(true);

         // Cleanup before saving
         contentToSave.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
         contentToSave.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
         contentToSave.querySelectorAll('[tabindex]').forEach(el => el.removeAttribute('tabindex'));
         contentToSave.querySelectorAll('span.task-checkbox').forEach(el => el.remove()); // Remove visual checkbox span
         contentToSave.querySelectorAll('ul:empty').forEach(ul => ul.remove()); // Remove empty lists
          // Remove placeholder <br> from visually empty paragraphs
          contentToSave.querySelectorAll('p').forEach(p => {
              if (p.innerHTML.trim() === '<br>') p.innerHTML = '';
          });

        // Determine title
        let title = 'Bike Outline';
         const currentName = currentFileNameSpan.textContent?.replace('*', '').replace(' (copy)', '').replace(' (new)', '').trim();
         if (currentName && currentName !== 'No file open' && currentName !== 'Unsaved Draft') {
             title = currentName;
         } else if (directFileHandle?.name) {
             title = directFileHandle.name;
         } else if (opfsFileHandle?.name) {
             title = opfsFileHandle.name;
         }

        // Ensure XML Compatibility: Use XHTML namespace
        const serializer = new XMLSerializer();
        // We need the outerHTML of the cleaned UL
        const ulHtml = serializer.serializeToString(contentToSave);

        // Construct the full document string
        return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(title)}</title>
  </head>
  <body>
    ${ulHtml}
  </body>
</html>`;
    }

     function escapeXml(unsafe) { /* (Keep existing implementation) */
        return unsafe.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'})[c] || c);
     }


    // --- Selection & Focus --- (Mostly unchanged)

    function handleFocusIn(event) { /* (Keep existing implementation) */
        const target = event.target;
        const li = target.closest('li');
        if (li && outlineContainer.contains(li)) {
             if ((target.tagName === 'P' && target.parentElement === li) || (target === li && li.getAttribute('data-type') === 'hr')) {
                selectListItem(li);
             }
        }
    }

    function selectListItem(liElement) { /* (Keep existing implementation) */
        if (!liElement || !outlineContainer.contains(liElement) || currentlySelectedLi === liElement) return;
        if (currentlySelectedLi) {
            currentlySelectedLi.classList.remove('selected');
             if(currentlySelectedLi.getAttribute('data-type') === 'hr') currentlySelectedLi.removeAttribute('tabindex');
        }
        currentlySelectedLi = liElement;
        currentlySelectedLi.classList.add('selected');
         if (currentlySelectedLi.getAttribute('data-type') === 'hr') {
             currentlySelectedLi.tabIndex = -1;
         }
    }

    function getSelectedLi() { /* (Keep existing implementation) */
        if (currentlySelectedLi && outlineContainer.contains(currentlySelectedLi)) return currentlySelectedLi;
        return outlineContainer.querySelector('li.selected');
    }

     function getFocusedP() { /* (Keep existing implementation) */
         const active = document.activeElement;
         if (active?.tagName === 'P' && active.isContentEditable && outlineContainer.contains(active)) return active;
         return null;
     }

    // --- Keyboard Navigation & Editing ---

    function handleKeyDown(event) {
        const selectedLi = getSelectedLi();
        const targetP = getFocusedP();

         // --- Global Shortcuts ---
         if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
             event.preventDefault();
             console.log("Ctrl+S detected");
             // Prioritize saving to the active handle
             if (directFileHandle) saveFileDirectly();
             else if (opfsFileHandle || opfsRoot) saveToOpfs(); // Save existing or prompt new OPFS
             else if (rootUlElement) saveFileAsDownload(); // Fallback download
             return;
         }

         // --- Contextual Shortcuts (require selection/content) ---
         if (!rootUlElement && event.key === 'Enter' && !event.shiftKey) {
             event.preventDefault(); createFirstItem(); return; // Create first item
         }
         if (!selectedLi || !outlineContainer.contains(selectedLi)) return; // Need selection beyond this point

        switch (event.key) {
            case 'Enter':
                if (event.shiftKey) {
                    if (targetP) { event.preventDefault(); document.execCommand('insertLineBreak'); handleContentChange(); }
                } else { event.preventDefault(); createNewItem(selectedLi); }
                break;
            case 'Tab':
                event.preventDefault();
                if (event.shiftKey) outdentItem(selectedLi); else indentItem(selectedLi);
                break;
            case 'ArrowUp':
                 if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
                     const prevLi = findPreviousVisibleLi(selectedLi);
                     if (prevLi) { event.preventDefault(); selectAndFocusItem(prevLi, false); }
                 } else if (event.altKey && event.shiftKey) { event.preventDefault(); moveItemUp(selectedLi); }
                 break;
            case 'ArrowDown':
                 if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
                     const nextLi = findNextVisibleLi(selectedLi);
                     if (nextLi) { event.preventDefault(); selectAndFocusItem(nextLi, false); }
                 } else if (event.altKey && event.shiftKey) { event.preventDefault(); moveItemDown(selectedLi); }
                 break;
             case 'Backspace':
             case 'Delete':
                 const isHrSelected = selectedLi.getAttribute('data-type') === 'hr' && document.activeElement === selectedLi;
                 const isEmptyP = targetP && (!targetP.textContent || targetP.innerHTML === '<br>');
                 if (isEmptyP || (event.key === 'Delete' && isHrSelected)) {
                     event.preventDefault(); deleteItem(selectedLi);
                 }
                 break;
             // Formatting
             case 'b': if (event.ctrlKey || event.metaKey) { event.preventDefault(); formatSelection('bold'); } break;
             case 'i': if (event.ctrlKey || event.metaKey) { event.preventDefault(); formatSelection('italic'); } break;
             case 'k': if (event.ctrlKey || event.metaKey) { event.preventDefault(); handleLinkButtonClick(selectedLi); } break;
             // Add shortcut for code, highlight? Maybe Alt+C, Alt+H?
             // case 'c': if (event.altKey) { event.preventDefault(); formatSelection('code'); } break;
             // case 'h': if (event.altKey) { event.preventDefault(); formatSelection('highlight'); } break;
        }
    }

    function formatSelection(command) {
         const targetP = ensureFocusInEditableParagraph(getSelectedLi());
         if (!targetP) return;
         if (command === 'highlight') wrapSelection('mark');
         else if (command === 'code') wrapSelection('code');
         else document.execCommand(command, false, null);
         handleContentChange();
    }

     function createFirstItem() {
         console.log("Creating first item.");
         resetEditorState('new'); // Reset state, marking as 'new' initially
         createMinimalStructure();
         selectAndFocusItem(rootUlElement.querySelector('li'), true);
         isDirty = true; // New file needs saving
         updateFileStateUI();
         handleContentChange(); // Trigger draft save
     }

     function createMinimalStructure() {
         rootUlElement = document.createElement('ul');
         rootUlElement.id = generateUniqueId(5);
         const firstLi = document.createElement('li'); firstLi.id = generateUniqueId();
         const firstP = document.createElement('p'); firstP.setAttribute('contenteditable', 'true'); firstP.innerHTML = '<br>';
         firstLi.appendChild(firstP);
         rootUlElement.appendChild(firstLi);
         outlineContainer.innerHTML = ''; // Clear placeholder/initial message
         outlineContainer.appendChild(rootUlElement);
         setupParagraph(firstP, firstLi); // Ensure setup (e.g., task checkbox if needed)
         initialMessageDiv?.remove();
     }


    function createNewItem(currentItemLi) { /* (Keep existing, ensure handleContentChange) */
        if (!currentItemLi || !outlineContainer.contains(currentItemLi)) return;
        const newLi = document.createElement('li'); newLi.id = generateUniqueId();
        const newP = document.createElement('p'); newP.setAttribute('contenteditable', 'true'); newP.innerHTML = '<br>';
        newLi.appendChild(newP);
        currentItemLi.after(newLi);
        setupParagraph(newP, newLi); // Ensure setup
        selectAndFocusItem(newLi, true);
        handleContentChange();
    }

    // --- Navigation & Focus Helpers ---

    function selectAndFocusItem(li, focusStart = true) { /* (Keep existing implementation) */
         if (!li) return;
         selectListItem(li);
         const pToFocus = li.querySelector(':scope > p[contenteditable="true"]');
         if (pToFocus) focusAndMoveCursor(pToFocus, focusStart);
         else if (li.getAttribute('data-type') === 'hr') li.focus();
    }

     function focusAndMoveCursor(element, toStart = true) { /* (Keep existing implementation) */
          if (!element) return;
          element.focus();
         // Defer selection manipulation slightly to ensure focus is stable
         requestAnimationFrame(() => {
             const range = document.createRange();
             const selection = window.getSelection();
             // Handle empty element case for cursor placement
             if (element.innerHTML === '<br>' || !element.firstChild) {
                 range.setStart(element, 0);
             } else {
                 range.selectNodeContents(element);
             }
             range.collapse(toStart);
             selection.removeAllRanges();
             selection.addRange(range);
         });
     }

     function findPreviousVisibleLi(li) { /* (Keep existing implementation) */
        let current = li.previousElementSibling;
         if (current) { while (true) { const last = current.querySelector(':scope > ul > li:last-child'); if(last) current=last; else break; } return current; }
         else { const pUl = li.parentElement; if(pUl && pUl !== rootUlElement) return pUl.closest('li'); } return null;
     }
     function findNextVisibleLi(li) { /* (Keep existing implementation) */
          const firstChild = li.querySelector(':scope > ul > li:first-child'); if(firstChild) return firstChild;
         let current = li; while(current){ const sib = current.nextElementSibling; if(sib) return sib;
         const pUl = current.parentElement; if(pUl && pUl !== rootUlElement) current = pUl.closest('li'); else current = null; } return null;
     }


    // --- Toolbar & Click Actions ---

     function handleOutlineClick(event) {
         // Task Checkbox Toggle
         const checkbox = event.target.closest('span.task-checkbox');
         if (checkbox && outlineContainer.contains(checkbox)) {
             const li = checkbox.closest('li');
             if (li && li.getAttribute('data-type') === 'task') {
                 toggleTaskDone(li);
             }
         }
         // Could add other click handlers here (e.g., for links) if needed
     }

     function toggleTaskDone(li) {
          if (!li) return;
          const isDone = li.getAttribute('data-done') === 'true';
          const checkbox = li.querySelector('span.task-checkbox');

          if (isDone) {
              li.removeAttribute('data-done');
              if (checkbox) checkbox.textContent = '☐';
          } else {
              li.setAttribute('data-done', 'true');
              if (checkbox) checkbox.textContent = '☑';
          }
          handleContentChange(); // Mark as dirty, trigger draft save
     }


    function handleToolbarClick(event) {
        const button = event.target.closest('button');
        if (!button) return;

        const selectedLi = getSelectedLi();
        const requiresSelection = button.classList.contains('type-button') ||
                                  ['indentButton', 'outdentButton', 'moveUpButton', 'moveDownButton', 'deleteButton', 'linkButton'].includes(button.id);

        if (requiresSelection && !selectedLi) return alert("Please select an item first.");

        // Formatting
        if (button.classList.contains('format-button')) {
            const command = button.dataset.command;
            formatSelection(command);
        }
        // Link
        else if (button.id === 'linkButton') handleLinkButtonClick(selectedLi);
        // Item Type
        else if (button.classList.contains('type-button')) changeItemType(selectedLi, button.dataset.type);
        // Outline Ops
        else if (button.id === 'indentButton') indentItem(selectedLi);
        else if (button.id === 'outdentButton') outdentItem(selectedLi);
        else if (button.id === 'moveUpButton') moveItemUp(selectedLi);
        else if (button.id === 'moveDownButton') moveItemDown(selectedLi);
        else if (button.id === 'deleteButton') deleteItem(selectedLi);
    }

     function ensureFocusInEditableParagraph(selectedLi) { /* (Keep existing implementation) */
         let targetP = getFocusedP();
         if (!targetP && selectedLi) { targetP = selectedLi.querySelector(':scope > p[contenteditable="true"]'); if (targetP) targetP.focus(); }
          if (!targetP || targetP.contentEditable !== 'true') { alert("Please place cursor inside item text."); return null; }
         return targetP;
     }

     function handleLinkButtonClick(selectedLi = getSelectedLi()) { /* (Keep existing implementation, ensure handleContentChange) */
        const targetP = ensureFocusInEditableParagraph(selectedLi); if (!targetP) return;
        const selection = window.getSelection(); const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const currentLink = range ? findParentLink(range.startContainer) : null;
        const defaultUrl = currentLink ? currentLink.href : "https://";
        const url = prompt("Link URL:", defaultUrl); if (url === null) return;
        if (range) { selection.removeAllRanges(); selection.addRange(range); } // Restore selection
        if (currentLink) document.execCommand('unlink', false, null);
        if (url !== "") {
            if (selection && !selection.isCollapsed) document.execCommand('createLink', false, url);
            else document.execCommand('insertHTML', false, `<a href="${escapeXml(url)}">${escapeXml(url)}</a>`);
        }
        targetP.focus(); handleContentChange();
    }

    function changeItemType(li, type) { /* (Keep existing implementation, ensure handleContentChange) */
         if (!li) return;
         const oldType = li.getAttribute('data-type');
         if (type === oldType) return; // No change

         if (type) li.setAttribute('data-type', type);
         else li.removeAttribute('data-type');

         let p = li.querySelector(':scope > p');

         if (type === 'hr') {
             if (p) p.remove();
             li.tabIndex = -1; li.focus();
         } else {
             if (!p) { p = document.createElement('p'); li.prepend(p); } // Prepend P
             setupParagraph(p, li); // Ensure editable, add/remove checkbox
             li.removeAttribute('tabindex');
             focusAndMoveCursor(p, false);
         }
         handleContentChange();
    }

     function findParentLink(node) { /* (Keep existing implementation) */
        while (node && node !== outlineContainer) { if (node.tagName === 'A') return node; node = node.parentNode; } return null;
    }

    function wrapSelection(tagName) { /* (Keep existing implementation, ensure handleContentChange) */
        const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0); const editorP = range.commonAncestorContainer.closest('p[contenteditable="true"]');
        if (!editorP || !outlineContainer.contains(editorP)) return;
        const wrapper = document.createElement(tagName);
        try {
            if (range.commonAncestorContainer === editorP || range.startContainer.parentNode === range.endContainer.parentNode) {
                 range.surroundContents(wrapper);
            } else {
                 const tempDiv = document.createElement('div'); tempDiv.appendChild(range.extractContents());
                 document.execCommand('insertHTML', false, `<${tagName}>${tempDiv.innerHTML}</${tagName}>`);
            }
        } catch (e) {
             console.warn("Wrap failed, using fallback:", e);
              document.execCommand('insertHTML', false, `<${tagName}>${escapeXml(range.toString())}</${tagName}>`);
        }
        editorP.focus(); handleContentChange();
    }


    // --- Outline Operation Implementations (Ensure handleContentChange) ---

    function indentItem(li) { /* (Keep existing, ensure handleContentChange) */
        if (!li) return; const prevLi = li.previousElementSibling; if (!prevLi || prevLi.getAttribute('data-type') === 'hr') return;
        let targetUl = prevLi.querySelector(':scope > ul'); if (!targetUl) { targetUl = document.createElement('ul'); prevLi.appendChild(targetUl); }
        targetUl.appendChild(li); selectAndFocusItem(li, false); handleContentChange();
    }

    function outdentItem(li) { /* (Keep existing (simplified), ensure handleContentChange) */
        if (!li) return; const parentUl = li.parentElement; if (!parentUl || parentUl === rootUlElement) return;
        const grandparentLi = parentUl.closest('li'); if (!grandparentLi) return; // Should only happen at root level

        // Move subsequent siblings into a new list under the outdented item
        const siblingsToMove = [];
        let next = li.nextElementSibling;
        while(next) {
            siblingsToMove.push(next);
            next = next.nextElementSibling;
        }
        if(siblingsToMove.length > 0) {
            let subUl = li.querySelector(':scope > ul');
            if (!subUl) { subUl = document.createElement('ul'); li.appendChild(subUl); }
            siblingsToMove.forEach(sib => subUl.appendChild(sib)); // Move them under the item
        }


        grandparentLi.after(li); // Move the main item

        if (parentUl.children.length === 0) parentUl.remove(); // Clean up old parent if empty
        selectAndFocusItem(li, false); handleContentChange();
    }

    function moveItemUp(li) { /* (Keep existing, ensure handleContentChange) */
        if (!li) return; const prevLi = li.previousElementSibling;
        if (prevLi) { li.parentElement.insertBefore(li, prevLi); selectListItem(li); ensureFocusInEditableParagraph(li); handleContentChange(); }
    }
    function moveItemDown(li) { /* (Keep existing, ensure handleContentChange) */
        if (!li) return; const nextLi = li.nextElementSibling;
        if (nextLi) { li.parentElement.insertBefore(nextLi, li); selectListItem(li); ensureFocusInEditableParagraph(li); handleContentChange(); }
    }

    function deleteItem(li) { /* (Keep existing, ensure handleContentChange) */
         if (!li || !outlineContainer.contains(li)) return;
         let itemToSelectAfter = findPreviousVisibleLi(li) || findNextVisibleLi(li);
         const parentUl = li.parentElement;
         const wasLastInParent = !li.nextElementSibling && parentUl !== rootUlElement;
         const parentLi = parentUl?.closest('li');
         if(wasLastInParent && parentLi) itemToSelectAfter = parentLi; // Select parent if deleting last child

         li.remove();
         if(currentlySelectedLi === li) currentlySelectedLi = null;
         if (parentUl && parentUl !== rootUlElement && parentUl.children.length === 0) parentUl.remove();

         if (rootUlElement && rootUlElement.children.length === 0) {
             resetEditorState('empty'); // Reset to initial message state
         } else if (itemToSelectAfter && outlineContainer.contains(itemToSelectAfter)) {
             selectAndFocusItem(itemToSelectAfter, false);
         } else if (rootUlElement?.firstElementChild) {
              const firstItem = rootUlElement.querySelector('li');
              if (firstItem) selectAndFocusItem(firstItem, false);
              else resetEditorState('empty');
         } else {
             resetEditorState('empty');
         }
         handleContentChange(); // Mark change, trigger draft
    }

    // --- Utility ---
    function generateUniqueId(length = 4) { /* (Keep existing implementation) */
        const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let id='', attempts=0;
        do { id=''; for(let i=0;i<length;i++) id+=chars.charAt(Math.floor(Math.random()*chars.length)); if(/^[0-9]/.test(id)) continue; attempts++;
        } while(document.getElementById(id) && attempts<100);
        if(attempts>=100) return `gen_${Date.now()}_${Math.random().toString(36).substring(2,7)}`; return id;
    }

});