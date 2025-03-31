// js/fileSystem.js
const FileSystem = (() => {
    const LOCAL_STORAGE_KEY = 'bikeEditorProDraft';
    const PERSISTENT_OPFS_FILENAME = '_current_outline.bike';
    const AUTOSAVE_DELAY = 1500; // ms
    const OPFS_AUTOSAVE_DELAY = 5000; // ms - Auto-save to OPFS every 5 seconds

    let opfsSupported = false;
    let directAccessSupported = false;
    let isInitializing = false; // New flag to track initialization state
    let opfsAutoSaveTimeout = null; // Track OPFS auto-save timer

    // --- Initialization & Feature Detection ---
    const initialize = async () => {
        console.log("Initializing File System...");
        isInitializing = true; // Set initialization flag
        State.setIsLoading(true); // Start in loading state for initialization

        // Setup Worker
        if (window.Worker) {
            try {
                const worker = new Worker('worker.js'); // Path relative to HTML
                worker.onmessage = handleWorkerMessage;
                worker.onerror = (err) => {
                     console.error("Worker Error:", err);
                     // Handle worker loading failure? Maybe disable OPFS save?
                };
                State.setFileSystemWorker(worker);
                console.log("Web Worker initialized.");
            } catch (workerError) {
                 console.error("Failed to initialize Web Worker:", workerError);
                 // Proceed without worker? OPFS might not work.
                 State.setFileSystemWorker(null);
            }
        } else {
            console.warn("Web Workers not supported. OPFS saving might be synchronous or disabled.");
            State.setFileSystemWorker(null);
        }

        // Check for Standard File System Access API (Direct Edit)
        if ('showOpenFilePicker' in window && 'createWritable' in FileSystemFileHandle.prototype) {
            console.log("Standard File System Access API (Direct Edit) supported.");
            directAccessSupported = true;
            UI.showFeatureSection('directFileAccess');
        } else {
             console.warn("Standard File System Access API (Direct Edit) not supported.");
        }

        // Check for OPFS support
        if ('storage' in navigator && 'getDirectory' in navigator.storage) {
            console.log("OPFS API potentially supported.");
            try {
                const opfsRoot = await navigator.storage.getDirectory();
                State.setOpfsRoot(opfsRoot); // Store handle in State
                console.log("OPFS Root Handle obtained.");
                opfsSupported = true;
                UI.showFeatureSection('opfsFileAccess');

                // Check for existing persistent file *without* creating it yet
                console.log(`Checking for existing OPFS file: ${PERSISTENT_OPFS_FILENAME}`);
                try {
                    const fileHandle = await opfsRoot.getFileHandle(PERSISTENT_OPFS_FILENAME, { create: false });
                    State.setPersistentOpfsHandle(fileHandle); // Store handle
                    console.log(`Found existing persistent OPFS file handle: ${PERSISTENT_OPFS_FILENAME}`);
                } catch (e) {
                    if (e.name === 'NotFoundError') {
                        console.log(`Persistent OPFS file (${PERSISTENT_OPFS_FILENAME}) not found.`);
                        State.setPersistentOpfsHandle(null);
                    } else {
                        console.error("Error checking for persistent OPFS file handle:", e);
                        State.setPersistentOpfsHandle(null);
                    }
                }
                State.setOpfsIsInitialized(true);
            } catch (err) {
                console.error("Failed to initialize OPFS:", err);
                State.setOpfsRoot(null);
                opfsSupported = false;
                 State.setOpfsIsInitialized(false);
                 // Hide OPFS UI elements if initialization failed
                 document.getElementById('opfsFileAccess').style.display = 'none';
                 document.getElementById('opfsInfo').style.display = 'none';
                 document.getElementById('opfsInfo2').style.display = 'none';

            }
        } else {
            console.warn("OPFS API not supported in this browser.");
            State.setOpfsRoot(null);
            opfsSupported = false;
            State.setOpfsIsInitialized(false);
        }

        // --- Initial Content Loading Priority ---
         let contentLoaded = false;

         // 1. Try loading from OPFS handle if it was found
         if (State.getPersistentOpfsHandle()) {
             console.log("Attempting initial load from persistent OPFS...");
             contentLoaded = await loadFromPersistentOpfs();
         }

         // 2. If OPFS didn't load, try loading from localStorage draft
         if (!contentLoaded) {
             console.log("OPFS did not load, checking local draft...");
             // Load draft *without* prompting yet, just check if it exists and is valid
             contentLoaded = await loadFromLocalStorage(false); // 'false' means don't force prompt
         }

         // 3. If nothing loaded, ensure initial empty state is set correctly
         if (!contentLoaded) {
             console.log("No content from OPFS or draft, ensuring initial empty state.");
             resetEditorState('empty'); // Ensure clean empty state
         } else {
              console.log("Content loaded from OPFS or draft.");
         }

        isInitializing = false; // Reset initialization flag
        State.setIsLoading(false); // Initialization complete
        UI.updateFileStateUI(); // Update UI based on loaded state/features
        console.log("File System Initialization complete.");
    };

    // --- State Reset ---
     const resetEditorState = (newSource = 'empty') => {
        console.log(`Resetting editor state. New source: ${newSource}`);
        // Don't manage isLoading here, let callers manage if it's part of an async flow

        // Clear any pending auto-saves
        clearTimeout(opfsAutoSaveTimeout);

        UI.resetEditorUI(newSource); // Update UI part first
        State.setCurrentFileSource(newSource);
        State.setIsDirty(newSource === 'draft' || newSource === 'copy' || newSource === 'new'); // Mark dirty appropriately

        UI.updateFileStateUI(); // Update buttons etc. based on new state
        console.log("Editor state reset complete.");
    };

    // --- User Interaction Checks ---
    const checkUnsavedChanges = async (actionDescription = "perform this action") => {
        if (State.getIsDirty()) {
            return confirm(`You have unsaved changes. Are you sure you want to ${actionDescription} and discard them?`);
        }
        return true; // No unsaved changes, proceed
    };


    // --- File Loading ---

    const handleFileLoadFromInput = async (event) => {
        if (State.getIsLoading()) { console.warn("Load copy rejected, already loading."); return; }
        const file = event.target.files[0];
        if (!file) return;

        if (!await checkUnsavedChanges(`load '${file.name}'`)) {
            event.target.value = ''; // Reset file input
            return;
        }

        console.log(`Loading file from input (as copy): ${file.name}, type: ${file.type}`);

        State.setDirectFileHandle(null); // Loading a copy clears direct handle

        const displayName = fixFileName(file.name).replace(/\.(xhtml)$/i, '.bike'); // Normalize display name if needed
        await loadFileContent(file, displayName, 'copy'); // Manages isLoading internally

        event.target.value = ''; // Reset file input after loading
    };

    const loadFileContent = async (fileOrBlob, displayName, source) => {
         console.log(`loadFileContent: START reading content for: ${displayName}, Source: ${source}`);
         
         // Allow loading during initialization even if isLoading is true
         if (State.getIsLoading() && !isInitializing) {
             console.warn("loadFileContent: Load attempt rejected, already loading.");
             return false;
         }
         
         // Only set isLoading if we're not already initializing
         if (!isInitializing) {
             State.setIsLoading(true);
             UI.updateFileStateUI(); // Show loading state in UI
         }
         
         let success = false;

         try {
            const fileContent = await fileOrBlob.text();
            console.log(`loadFileContent: Read ${fileContent.length} characters for ${displayName}.`);

            resetEditorState(source); // Reset state *before* parsing

            if (!fileContent || fileContent.trim().length === 0) {
                 console.warn(`File content for ${displayName} is empty or whitespace only.`);
                 // If loading from OPFS/Direct, an empty file is valid, create minimal structure
                  if (source === 'opfs' || source === 'direct') {
                     console.log(`Loading empty content for ${displayName}. Creating minimal structure.`);
                     Editor.createMinimalStructure();
                     State.markAsClean(); // Empty file is considered clean initially
                 } else if (source === 'copy') {
                     // Optionally, still load copy as empty or throw error
                      alert(`File '${displayName}' is empty. Loading as empty outline.`);
                      Editor.createMinimalStructure();
                      State.setIsDirty(true); // Copied empty file is technically "unsaved"
                 } else {
                      // For 'draft' or other sources, empty might be an error or just reset
                      resetEditorState('empty'); // Reset fully if draft was empty
                 }

             } else {
                 // Parse the actual content
                 Editor.parseAndRenderBike(fileContent); // This will update State.rootUlElement
                 State.markAsClean(); // Freshly loaded/parsed is clean
             }

            State.setCurrentFileSource(source); // Update source state *after* successful load/parse/reset

            console.log(`Successfully processed content for: ${displayName}`);
            success = true;

            // Focus the first item after successful load
            if(State.getRootElement()) {
                const firstLi = State.getRootElement().querySelector('li');
                 if (firstLi) {
                    requestAnimationFrame(() => UI.selectAndFocusItem(firstLi, true));
                 }
            }

        } catch (err) {
            console.error(`Error loading/parsing file ${displayName}:`, err);
            alert(`Failed to load or parse '${displayName}'.\n\nError: ${err.message}`);
            resetEditorState('empty'); // Reset to a safe empty state on error
            success = false;
        } finally {
            // Only reset isLoading if we're not in initialization
            if (!isInitializing) {
                State.setIsLoading(false); // Reset loading flag when this operation finishes
                UI.updateFileStateUI(); // Update UI based on final state
            }
            console.log(`loadFileContent: FINISHED for ${displayName}. Success: ${success}`);
        }
        return success; // Return success status
    };

    // --- Standard File System Access API (Direct Edit) ---

    const openFileDirectly = async () => {
        if (!directAccessSupported) return alert("Direct file editing is not supported by this browser.");
        if (State.getIsLoading()) { console.warn("Open direct rejected, already loading."); return; }

        console.log("Attempting to open file directly (Standard FSA)...");
        if (!await checkUnsavedChanges("open a new direct file")) return;

        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Bike Outline Files',
                    accept: {
                        // Prioritize application/xhtml+xml for .bike
                        'application/xhtml+xml': ['.bike', '.xhtml'],
                        'text/xml': ['.xml'], // Allow generic XML too
                        'text/html': ['.html'] // Allow HTML
                    }
                }],
                multiple: false
            });

            console.log("Direct file handle obtained:", handle.name);
            const file = await handle.getFile();

            State.setDirectFileHandle(handle); // Store handle
            State.setPersistentOpfsHandle(null); // Clear OPFS target when opening direct

            // Use raw filename from handle, normalize display name if needed
            const displayName = fixFileName(handle.name).replace(/\.(xhtml)$/i, '.bike');
            await loadFileContent(file, displayName, 'direct'); // Manages isLoading

        } catch (err) {
            // Handle user cancellation gracefully (AbortError)
            if (err.name === 'AbortError') {
                console.log("User cancelled file open dialog.");
            } else {
                console.error("Error opening file directly:", err);
                alert(`Could not open file: ${err.message}`);
                resetEditorState('empty'); // Reset if opening failed
            }
             UI.updateFileStateUI(); // Ensure UI reflects potential cancellation or error
        }
    };

    const saveFileDirectly = async () => {
        if (!directAccessSupported) return alert("Direct file editing is not supported by this browser.");
        const handle = State.getDirectFileHandle();
        if (!handle) { alert("No direct file handle available. Use 'Open Direct' first."); return; }
        if (State.getIsLoading()) { console.warn("Save direct rejected, already loading."); return; }

        console.log("Attempting to save file directly (Standard FSA)...");

        // Verify write permission
        if (!(await verifyPermission(handle, true))) { // true for readWrite
            alert("Write permission denied. Please try saving again and grant access.");
            return;
        }

        const htmlContent = Editor.serializeOutlineToHTML();
        if (htmlContent === null) { // Check for serialization failure
            alert("Failed to prepare content for saving. Cannot save.");
            return;
        }

        UI.setSavingIndicator('saveDirectButton', true, 'Saving...');
        State.setIsLoading(true); // Prevent other actions during save

        try {
            console.log(`Creating writable stream for ${handle.name}...`);
            const writable = await handle.createWritable();
            await writable.write(htmlContent);
            await writable.close();

            console.log(`File saved successfully via Direct Access: ${handle.name}`);
            State.markAsClean(); // Mark state as clean after successful save
            UI.setSavingIndicator('saveDirectButton', false, 'Saved!');
            setTimeout(() => UI.setSavingIndicator('saveDirectButton', false), 2000); // Reset message

        } catch (err) {
            console.error("Error saving file directly:", err);
            UI.setSavingIndicator('saveDirectButton', false); // Remove indicator on error
            alert(`Failed to save file: ${err.message}`);
            // Keep state dirty on failure
        } finally {
             State.setIsLoading(false); // Allow actions again
             UI.updateFileStateUI(); // Refresh UI state
        }
    };

    const verifyPermission = async (fileHandle, readWrite) => {
        if (!fileHandle || !fileHandle.queryPermission || !fileHandle.requestPermission) {
             console.warn("Permission API not fully supported on this handle or browser.");
             return true; // Or return false to be safe? Let's be optimistic for now.
         }
        const options = { mode: readWrite ? 'readwrite' : 'read' };
        try {
            // Check if permission was already granted
            if ((await fileHandle.queryPermission(options)) === 'granted') {
                return true;
            }
            // Request permission
            if ((await fileHandle.requestPermission(options)) === 'granted') {
                return true;
            }
        } catch (error) {
            console.error("Error verifying/requesting permission:", error);
        }
        return false;
    };

    // --- OPFS (Origin Private File System) ---

    const createNewAppFile = async () => {
        if (!opfsSupported) return alert("App Storage (OPFS) is not available.");
        if (State.getIsLoading()) { console.warn("Create new rejected, already loading."); return; }

        // Check if current content exists and needs confirmation before discarding
        const hasContent = State.getRootElement() && UI.elements.outlineContainer.contains(State.getRootElement());
        if (hasContent) {
             const confirmationMessage = State.getIsDirty()
                ? "You have unsaved changes. Create a new App file and discard them?"
                : "Creating a new file will discard current content. Proceed?";
             if (!await confirm(confirmationMessage)) {
                console.log("New App File cancelled by user.");
                return;
             }
        }

        console.log("Creating new file structure for App Storage...");
        State.setIsLoading(true); // Prevent actions during creation

        resetEditorState('new'); // Reset state, UI shows 'New App File'
        State.setDirectFileHandle(null); // Clear direct file handle

        const firstLi = Editor.createMinimalStructure(); // Create the basic UL/LI/P
        State.setIsDirty(true); // New file starts dirty

        State.setIsLoading(false);
        UI.updateFileStateUI(); // Update buttons

        // Focus the new item after short delay for rendering
        requestAnimationFrame(() => {
             if (firstLi) UI.selectAndFocusItem(firstLi, true);
             else console.error("Failed to find first LI after creating minimal structure for new app file.");
             Editor.handleContentChange(); // Trigger initial draft save for the new structure
        });
        console.log("Prepared new file structure. Ready for editing and 'Save to App'.");
    };

    const loadFromPersistentOpfs = async () => {
        const handle = State.getPersistentOpfsHandle();
        if (!handle) { console.log("loadFromPersistentOpfs: No handle exists."); return false; }
        
        // Allow loading during initialization even if isLoading is true
        if (State.getIsLoading() && !isInitializing) { 
            console.warn("loadFromPersistentOpfs: Already loading, skipping."); 
            return false; 
        }

        console.log(`loadFromPersistentOpfs: Attempting to load from handle: ${handle.name}`);
        
        // Don't set isLoading if we're already initializing to avoid getting stuck
        if (!isInitializing) {
            State.setIsLoading(true); // Set loading specifically for this operation
            UI.updateFileStateUI();
        }
        
        let success = false;

        try {
            console.log("loadFromPersistentOpfs: Getting file object from handle...");
            const file = await handle.getFile();
            console.log(`loadFromPersistentOpfs: Got file object. Name: ${file.name}, Size: ${file.size}, Type: ${file.type}`);

            // Delegate to the main loadFileContent function
             success = await loadFileContent(file, PERSISTENT_OPFS_FILENAME, 'opfs');
             // loadFileContent now manages the isLoading flag internally for its part

        } catch (error) {
            console.error(`Error loading from persistent OPFS file handle (${handle.name}):`, error);
            if (error.name === 'NotFoundError') {
                 alert(`Could not find the file '${PERSISTENT_OPFS_FILENAME}' in App Storage.`);
                 State.setPersistentOpfsHandle(null); // Handle is invalid now
            } else {
                 alert(`Could not load the file from App Storage: ${error.message}`);
            }
            resetEditorState('empty'); // Reset on failure
            success = false;
            // Ensure isLoading is false if the error happened before loadFileContent was called or within it
            if (!isInitializing && State.getIsLoading()) {
                State.setIsLoading(false);
                UI.updateFileStateUI();
            }
        } finally {
             // Only reset isLoading flag if we set it (not during initialization)
             if (!isInitializing && State.getIsLoading()) {
                 State.setIsLoading(false);
                 UI.updateFileStateUI();
             }
             console.log(`loadFromPersistentOpfs finished wrapper. Success: ${success}`);
        }
        return success;
    };

    const saveToOpfs = async () => {
        if (!opfsSupported || !State.getOpfsRoot()) return alert("App Storage (OPFS) is not available/initialized.");
        const worker = State.getFileSystemWorker();
        if (!worker) return alert("Background saving worker is not available.");
        if (State.getIsLoading()) { console.warn("Save OPFS rejected, already loading."); return; }

        console.log("saveToOpfs: Attempting to save to OPFS persistent file...");

        // Allow saving even if empty (to clear content)
        const allowSave = !!State.getRootElement() || State.getCurrentFileSource() === 'empty';
        if (!allowSave && State.getCurrentFileSource() !== 'new') {
             console.log("Saving empty outline to OPFS.");
        }

        const htmlContent = Editor.serializeOutlineToHTML();
        if (htmlContent === null) {
            alert("Failed to prepare content for saving. Cannot save.");
            return;
        }
        console.log(`saveToOpfs: Serialized content length: ${htmlContent.length}`);

        UI.setSavingIndicator('saveToOpfsButton', true, 'Saving...');
        State.setIsLoading(true); // Prevent other actions

        try {
            let handle = State.getPersistentOpfsHandle();
            if (!handle) {
                console.log(`saveToOpfs: Persistent handle for ${PERSISTENT_OPFS_FILENAME} doesn't exist, creating...`);
                handle = await State.getOpfsRoot().getFileHandle(PERSISTENT_OPFS_FILENAME, { create: true });
                State.setPersistentOpfsHandle(handle); // Store the newly created handle
                console.log("saveToOpfs: Persistent handle created/obtained.");
            } else {
                console.log(`saveToOpfs: Using existing persistent handle: ${handle.name}`);
            }

            console.log(`saveToOpfs: Sending content for ${PERSISTENT_OPFS_FILENAME} to worker...`);
            worker.postMessage({
                action: 'saveOpfs',
                fileName: PERSISTENT_OPFS_FILENAME,
                content: htmlContent
            });

            State.setCurrentFileSource('opfs'); // Now editing the OPFS file
            State.setDirectFileHandle(null); // Clear direct handle if saving to OPFS

            // Set a safety timeout to reset loading state in case worker message is missed
            setTimeout(() => {
                if (State.getIsLoading()) {
                    console.warn("Safety timeout: Resetting loading state after OPFS save");
                    State.setIsLoading(false);
                    UI.setSavingIndicator('saveToOpfsButton', false);
                    UI.updateFileStateUI();
                }
            }, 5000); // 5 second timeout

        } catch (err) {
            console.error("Error preparing OPFS save (getting handle):", err);
            alert(`Could not prepare file for saving to App Storage: ${err.message}`);
            UI.setSavingIndicator('saveToOpfsButton', false);
            State.setPersistentOpfsHandle(null); // Reset handle if creation/getting failed
            State.setIsLoading(false);
            UI.updateFileStateUI(); // Update UI to reflect error/state change
        }
    };

    const autoSaveToOpfs = () => {
        clearTimeout(opfsAutoSaveTimeout); // Clear any pending auto-save
        
        // Only proceed if we're not already loading/saving and source is 'opfs'
        if (State.getIsLoading() || State.getCurrentFileSource() !== 'opfs') return;
        
        // Only auto-save if dirty and OPFS is available
        if (State.getIsDirty() && State.getOpfsRoot() && State.getPersistentOpfsHandle()) {
            console.log("Auto-saving to OPFS...");
            quietSaveToOpfs().then(success => {
                if (success) {
                    console.log("OPFS auto-save completed successfully");
                } else {
                    console.warn("OPFS auto-save failed or timed out");
                }
            });
        }
    };

    const quietSaveToOpfs = async () => {
        if (!opfsSupported || !State.getOpfsRoot()) return false;
        const worker = State.getFileSystemWorker();
        if (!worker) return false;
        if (State.getIsLoading()) return false;

        // Save focus state before any operations
        const activeElement = document.activeElement;
        const selectionInfo = saveSelectionState();

        const htmlContent = Editor.serializeOutlineToHTML();
        if (htmlContent === null) return false;

        try {
            let handle = State.getPersistentOpfsHandle();
            if (!handle) {
                handle = await State.getOpfsRoot().getFileHandle(PERSISTENT_OPFS_FILENAME, { create: true });
                State.setPersistentOpfsHandle(handle);
            }

            // Create a unique ID for this save operation
            const saveOperationId = Date.now().toString();

            return new Promise((resolve) => {
                const messageHandler = (event) => {
                    const { success, fileName, error, action, operationId } = event.data;
                    
                    // Only process message if it's for our specific operation or matches our file
                    if ((operationId === saveOperationId) || 
                        ((action === 'saveOpfs' || !action) && fileName === PERSISTENT_OPFS_FILENAME)) {
                        
                        worker.removeEventListener('message', messageHandler);
                        
                        // Always restore focus regardless of save result
                        restoreFocusAndSelection(activeElement, selectionInfo);
                        
                        if (success) {
                            State.markAsClean();
                            resolve(true);
                        } else {
                            console.error(`Quiet OPFS save failed: ${error || 'Unknown error'}`);
                            resolve(false);
                        }
                    }
                };
                
                worker.addEventListener('message', messageHandler);
                
                worker.postMessage({
                    action: 'saveOpfs',
                    fileName: PERSISTENT_OPFS_FILENAME,
                    content: htmlContent,
                    operationId: saveOperationId // Include the ID to track this specific operation
                });
                
                // Increase timeout to 5 seconds for auto-saves
                setTimeout(() => {
                    worker.removeEventListener('message', messageHandler);
                    restoreFocusAndSelection(activeElement, selectionInfo);
                    resolve(false);
                }, 5000);
            });
        } catch (err) {
            console.error("Error in quiet OPFS save:", err);
            // Even if there's an error, restore focus
            restoreFocusAndSelection(activeElement, selectionInfo);
            return false;
        }
    };

    // Helper function to save selection/cursor state
    const saveSelectionState = () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        
        try {
            const range = selection.getRangeAt(0);
            return {
                startContainer: range.startContainer,
                startOffset: range.startOffset,
                endContainer: range.endContainer,
                endOffset: range.endOffset,
                collapsed: range.collapsed
            };
        } catch (e) {
            console.warn("Could not save selection state:", e);
            return null;
        }
    };

    // Helper function to restore focus and selection after operations
    const restoreFocusAndSelection = (activeElement, selectionInfo) => {
        if (!activeElement || !document.body.contains(activeElement)) return;
        
        try {
            // First restore focus to the element
            if (activeElement.focus) {
                activeElement.focus({preventScroll: true}); // Prevent scroll jump
            }
            
            // Then restore the exact cursor position/selection
            if (selectionInfo && window.getSelection) {
                const selection = window.getSelection();
                
                // Verify all parts of the selection still exist in the DOM
                if (!document.body.contains(selectionInfo.startContainer) ||
                    !document.body.contains(selectionInfo.endContainer)) {
                    return;
                }
                
                try {
                    const range = document.createRange();
                    range.setStart(selectionInfo.startContainer, selectionInfo.startOffset);
                    range.setEnd(selectionInfo.endContainer, selectionInfo.endOffset);
                    selection.removeAllRanges();
                    selection.addRange(range);
                } catch (e) {
                    console.warn("Could not restore exact selection:", e);
                }
            }
        } catch (e) {
            console.error("Error during focus restoration:", e);
        }
    };

    const syncSaveAttempt = () => {
        if (!State.getIsDirty() || !opfsSupported || State.getCurrentFileSource() !== 'opfs') return;
        
        try {
            console.log("Attempting synchronous OPFS save before unload");
            const htmlContent = Editor.serializeOutlineToHTML();
            if (htmlContent === null) return;
            
            const worker = State.getFileSystemWorker();
            if (worker) {
                worker.postMessage({
                    action: 'saveOpfs',
                    fileName: PERSISTENT_OPFS_FILENAME,
                    content: htmlContent,
                    isBeforeUnload: true
                });
                console.log("Final save message sent to worker");
            }
        } catch (e) {
            console.error("Error during sync save attempt:", e);
        }
    };

    const handleContentChange = () => {
        if (State.getIsLoading()) return;
        
        if (State.getCurrentFileSource() === 'opfs' && State.getPersistentOpfsHandle()) {
            clearTimeout(opfsAutoSaveTimeout);
            opfsAutoSaveTimeout = setTimeout(autoSaveToOpfs, OPFS_AUTOSAVE_DELAY);
        }
    };

    const handleWorkerMessage = (event) => {
        const { success, fileName, error, action, operationId } = event.data;
        
        // Adding a mention of the operationId if present for debugging
        const opIdMsg = operationId ? `, OperationID=${operationId}` : '';
        console.log(`Worker message received: Action=${action}, Success=${success}, File=${fileName || 'N/A'}${opIdMsg}`);

        if ((action === 'saveOpfs' || (!action && fileName === PERSISTENT_OPFS_FILENAME)) && success) {
            State.setIsLoading(false);
            
            if (success) {
                console.log(`OPFS save successful for: ${fileName}`);
                State.markAsClean();
                UI.setSavingIndicator('saveToOpfsButton', false, 'Saved!');
                setTimeout(() => {
                    UI.setSavingIndicator('saveToOpfsButton', false);
                }, 2000);
            } else {
                console.error(`OPFS save failed for: ${fileName}`, error);
                UI.setSavingIndicator('saveToOpfsButton', false);
                alert(`Failed to save to App Storage: ${error || 'Unknown error'}`);
            }
            return;
        }

        console.log(`Worker message for other action/file:`, event.data);
        
        if (fileName === PERSISTENT_OPFS_FILENAME && State.getIsLoading()) {
            console.warn("Resetting loading state for unhandled OPFS file message");
            State.setIsLoading(false);
            UI.setSavingIndicator('saveToOpfsButton', false);
            UI.updateFileStateUI();
        }
    };

    // --- Download (Save As) ---

    const saveFileAsDownload = () => {
        console.log("Attempting to save file as download...");
        const rootElement = State.getRootElement();
        if (!rootElement || !UI.elements.outlineContainer.contains(rootElement)) {
            alert("Nothing to save. Create some content first.");
            return;
        }

        State.setIsLoading(true);
        UI.updateFileStateUI();

        const htmlContent = Editor.serializeOutlineToHTML();
        if (htmlContent === null) {
            alert("Failed to prepare content for download. Please try again.");
            State.setIsLoading(false);
            UI.updateFileStateUI();
            return;
        }

        let suggestedName = "outline.bike";
        const source = State.getCurrentFileSource();
        const directHandle = State.getDirectFileHandle();
        const filenameSpan = UI.elements.currentFileNameSpan;

        if (source === 'direct' && directHandle?.name) {
            suggestedName = directHandle.name;
        } else if (source === 'opfs') {
             suggestedName = PERSISTENT_OPFS_FILENAME;
        } else if (filenameSpan?.textContent) {
            const currentName = filenameSpan.textContent
                .replace('*', '')
                .replace(' (copy)', '')
                .replace(' (new)', '')
                .replace(' (draft)', '')
                .trim();
            if (currentName && !['No file', 'Unsaved Draft', 'App Storage'].includes(currentName)) {
                suggestedName = currentName;
            }
        }

        suggestedName = fixFileName(suggestedName);
        console.log(`Saving as: ${suggestedName}`);

        const isXHTML = suggestedName.toLowerCase().endsWith('.xhtml');
        const contentType = 'application/xhtml+xml';

        const blob = new Blob([htmlContent], { type: contentType });

        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = suggestedName;

        document.body.appendChild(downloadLink);
        downloadLink.click();

        setTimeout(() => {
            document.body.removeChild(downloadLink);
            URL.revokeObjectURL(downloadLink.href);
            console.log(`Download triggered for: ${suggestedName}`);
            State.setIsLoading(false);
            UI.updateFileStateUI();
        }, 100);
    };

    // --- Local Storage Draft ---

    const saveDraftToLocalStorage = () => {
        if (State.getIsLoading()) return;
        if (!State.getIsDirty()) return;

        const source = State.getCurrentFileSource();
        if (source === 'direct' || source === 'opfs') {
             if (source === 'direct' && !State.getDirectFileHandle()) return;
             if (source === 'opfs' && !State.getPersistentOpfsHandle()) return;

             console.log(`Saving temporary draft for dirty primary source: ${source}`);
        }

        const htmlContent = Editor.serializeOutlineToHTML();
        if (htmlContent !== null && htmlContent.includes('<li')) {
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, htmlContent);
                console.log("Draft saved to local storage.");
            } catch (e) {
                console.error("Error saving draft to local storage:", e);
                if (e.name === 'QuotaExceededError') {
                     alert("Could not save draft: Local storage quota exceeded. Please save your work manually.");
                }
            }
        } else if (htmlContent === null) {
             console.warn("Draft save skipped: Serialization failed.");
        } else {
             console.log("Draft save skipped: Outline appears empty.");
        }
    };

    const loadFromLocalStorage = async (forcePrompt = false) => {
        if (State.getIsLoading() && !isInitializing) { 
            console.warn("Draft load rejected, already loading."); 
            return false; 
        }

        let storedContent = null;
        try {
             storedContent = localStorage.getItem(LOCAL_STORAGE_KEY);
        } catch(e) {
            console.error("Error accessing local storage for draft:", e);
            return false;
        }

        let loaded = false;
        if (storedContent && storedContent.includes('<ul') && storedContent.includes('<li')) {
            console.log("Found potentially valid draft in local storage.");

            const editorIsEmpty = !State.getRootElement() || !!UI.elements.initialMessageDiv && UI.elements.outlineContainer.contains(UI.elements.initialMessageDiv);
            let loadConfirmed = false;

            if (editorIsEmpty) {
                loadConfirmed = confirm("Load unsaved draft from previous session? (Choosing 'Cancel' will discard the draft)");
            } else if (forcePrompt) {
                 loadConfirmed = confirm("Load unsaved draft? This will replace your current content. (Choosing 'Cancel' will discard the draft)");
            }

            if (loadConfirmed) {
                if (!isInitializing) {
                    State.setIsLoading(true);
                    UI.updateFileStateUI();
                }
                try {
                    console.log("Loading draft.");
                    resetEditorState('draft');
                    Editor.parseAndRenderBike(storedContent);
                    State.setIsDirty(true);
                    loaded = true;
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                    console.log("Draft loaded and removed from storage.");
                     if(State.getRootElement()) {
                         const firstLi = State.getRootElement().querySelector('li');
                         if (firstLi) requestAnimationFrame(() => UI.selectAndFocusItem(firstLi, true));
                     }

                 } catch (error) {
                    console.error("Error parsing draft from local storage:", error);
                    alert(`Failed to load draft: ${error.message}\nThe invalid draft will be discarded.`);
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                    resetEditorState('empty');
                    loaded = false;
                 } finally {
                     if (!isInitializing) {
                         State.setIsLoading(false);
                         UI.updateFileStateUI();
                     }
                 }
            } else if (editorIsEmpty || forcePrompt) {
                 console.log("User chose not to load draft. Discarding draft.");
                 localStorage.removeItem(LOCAL_STORAGE_KEY);
                 if(editorIsEmpty) resetEditorState('empty');
                 UI.updateFileStateUI();
            } else {
                console.log("Editor has content, draft load skipped.");
            }
        } else if (storedContent) {
             console.warn("Invalid content found in local storage draft key. Discarding.");
             localStorage.removeItem(LOCAL_STORAGE_KEY);
        } else {
            console.log("No draft found in local storage.");
        }

        return loaded;
    };

    // --- Utility ---
    const fixFileName = (name, defaultExt = '.bike') => {
        if (!name) return `outline${defaultExt}`;
        name = String(name);

        const invalidChars = /[\\/:*?"<>|]/g;
        name = name.replace(invalidChars, '');

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const fileExtension = (isIOS && defaultExt === '.bike') ? '.xhtml' : defaultExt;

        name = name.replace(/\.(bike|xhtml|html|xml|opml)$/i, '');

        if (!name.toLowerCase().endsWith(fileExtension.toLowerCase())) {
            name += fileExtension;
        }

        if (!name || name === fileExtension) {
            name = `outline${fileExtension}`;
        }

        return name;
    };

    // --- Public API ---
    return {
        initialize,
        resetEditorState, 
        checkUnsavedChanges,
        handleFileLoadFromInput,
        openFileDirectly,
        saveFileDirectly,
        createNewAppFile,
        saveToOpfs,
        saveFileAsDownload,
        saveDraftToLocalStorage,
        loadFromLocalStorage, 
        fixFileName,
        autoSaveToOpfs,
        quietSaveToOpfs,
        syncSaveAttempt,
        handleContentChange,
        saveSelectionState,
        restoreFocusAndSelection,
        LOCAL_STORAGE_KEY,
        PERSISTENT_OPFS_FILENAME,
        AUTOSAVE_DELAY,
        OPFS_AUTOSAVE_DELAY,
        isInitializing: () => isInitializing
    };
})();