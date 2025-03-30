// script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    // ... (UI elements remain the same) ...
    const fileInput = document.getElementById('fileInput');
    const directFileAccessDiv = document.getElementById('directFileAccess');
    const openDirectButton = document.getElementById('openDirectButton');
    const saveDirectButton = document.getElementById('saveDirectButton');
    const opfsFileAccessDiv = document.getElementById('opfsFileAccess');
    const newAppFileButton = document.getElementById('newAppFileButton');
    const saveToOpfsButton = document.getElementById('saveToOpfsButton');
    const saveAsButton = document.getElementById('saveAsButton');
    const outlineContainer = document.getElementById('outlineContainer');
    const toolbar = document.getElementById('toolbar');
    const currentFileNameSpan = document.getElementById('currentFileName');
    const initialMessageDiv = document.getElementById('initialMessage');
    const directInfoLi = document.getElementById('directInfo');
    const opfsInfoLi = document.getElementById('opfsInfo');
    const opfsInfoLi2 = document.getElementById('opfsInfo2');


    // --- State Variables ---
    // ... (State variables remain the same) ...
    let rootUlElement = null;
    let currentlySelectedLi = null;
    let directFileHandle = null;
    let persistentOpfsHandle = null;
    let currentFileSource = null; // 'direct', 'opfs', 'copy', 'draft', 'new', 'empty'
    let opfsRoot = null;
    let fileSystemWorker = null;
    let autoSaveTimeout = null;
    let isDirty = false;
    let opfsIsInitialized = false;
    let isLoading = false; // Global loading flag
    let currentlyDraggedLi = null;
    let dragDropIndicator = null;
    let lastDropTarget = null;
    let lastDropPosition = null;
    let katexInitialized = typeof katex !== 'undefined'; // Check if KaTeX is available
    let keyboardVisible = false;
    let viewportHandler = null;
    let toolbarOriginalPosition = null;


    // --- Constants ---
    // ... (Constants remain the same) ...
    const LOCAL_STORAGE_KEY = 'bikeEditorProDraft';
    const PERSISTENT_OPFS_FILENAME = '_current_outline.bike';
    const AUTOSAVE_DELAY = 1500;
    const DEFAULT_LATEX = '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}';


    // --- Feature Detection & Initial Setup ---
    async function initialize() {
        console.log("Initializing Bike Editor Pro...");
        // **FIX:** Do NOT set isLoading = true here initially.
        // isLoading = true;

        let opfsSupported = false;
        let directAccessSupported = false;

        // Setup Worker
        if (window.Worker) {
            try {
                fileSystemWorker = new Worker('worker.js');
                fileSystemWorker.onmessage = handleWorkerMessage;
                fileSystemWorker.onerror = (err) => console.error("Worker Error:", err);
                console.log("Web Worker initialized.");
            } catch (workerError) { console.error("Failed to initialize Web Worker:", workerError); }
        } else { console.warn("Web Workers not supported."); }


        // Check for OPFS support
        if ('storage' in navigator && 'getDirectory' in navigator.storage) {
            console.log("OPFS API potentially supported.");
            try {
            opfsRoot = await navigator.storage.getDirectory();
            console.log("OPFS Root Handle obtained.");
            opfsFileAccessDiv.style.display = 'flex'; opfsInfoLi.style.display = 'list-item'; opfsInfoLi2.style.display = 'list-item';
            opfsSupported = true;

            console.log(`Checking for existing OPFS file: ${PERSISTENT_OPFS_FILENAME}`);
            try {
                persistentOpfsHandle = await opfsRoot.getFileHandle(PERSISTENT_OPFS_FILENAME, { create: false });
                console.log(`Found existing persistent OPFS file handle: ${PERSISTENT_OPFS_FILENAME}`);
            } catch (e) {
                if (e.name === 'NotFoundError') { console.log(`Persistent OPFS file (${PERSISTENT_OPFS_FILENAME}) not found.`); persistentOpfsHandle = null; }
                else { console.error("Error checking for persistent OPFS file handle:", e); persistentOpfsHandle = null; }
            }
            opfsIsInitialized = true;

            } catch (err) { 
            console.error("Failed to initialize OPFS:", err);
            opfsRoot = null;
            opfsSupported = false;
            opfsIsInitialized = false;
            persistentOpfsHandle = null;
            opfsFileAccessDiv.style.display = 'none';
            opfsInfoLi.style.display = 'none';
            opfsInfoLi2.style.display = 'none';
            }
        } else { 
            console.warn("OPFS API not supported in this browser.");
            opfsRoot = null;
            opfsSupported = false;
            opfsIsInitialized = false;
            opfsFileAccessDiv.style.display = 'none';
            opfsInfoLi.style.display = 'none';
            opfsInfoLi2.style.display = 'none';
        }

        // Check for Standard File System Access API
        if ('showOpenFilePicker' in window && 'createWritable' in FileSystemFileHandle.prototype) {
            console.log("Standard File System Access API (with Write) supported.");
            directFileAccessDiv.style.display = 'flex'; directInfoLi.style.display = 'list-item';
            directAccessSupported = true;
        } else { /* ... FSA not supported ... */ }

        // --- Initial Content Loading Priority ---
        let contentLoaded = false;
        // ** Important: Only proceed if NOT already loading from another source (shouldn't happen here, but safety check)
        if (!isLoading && persistentOpfsHandle) {
            console.log("Attempting to auto-load from persistent OPFS file...");
            contentLoaded = await loadFromPersistentOpfs(); // This function manages isLoading internally now
        } else if (isLoading) {
             console.warn("Initialize: Skipping OPFS load check as isLoading is already true.");
        } else {
            console.log("Initialize: No initial persistent OPFS handle found or check skipped.");
        }

        // Check draft ONLY if OPFS didn't load and we're not currently loading
        if (!contentLoaded && !isLoading) {
            console.log("Initialize: OPFS did not load content, checking local draft...");
            contentLoaded = await loadFromLocalStorage(false); // This function manages isLoading internally
        } else if (contentLoaded) { console.log("Initialize: Content already loaded from OPFS, skipping draft check."); }
        else if (isLoading) { console.log("Initialize: App is currently loading (from OPFS/Draft), skipping further checks."); }


        // Final state check: Ensure editor isn't left in a loading state or empty without message
        if (!contentLoaded && !isLoading) {
            console.log("Initialize: No content loaded from OPFS or draft, ensuring initial empty state.");
            resetEditorState('empty'); // Reset to empty state
        } else if (!contentLoaded && isLoading) {
            // This case *shouldn't* happen if load functions manage isLoading correctly, but log if it does.
            console.warn("Initialize: Finished, but no content loaded AND isLoading is still true! Investigate.");
            isLoading = false; // Force reset
            resetEditorState('empty'); // Reset to safe state
        } else {
             console.log("Initialize: Finished, content was loaded or state is being handled.");
             // isLoading should have been reset by the successful load function
             // If isLoading is somehow still true here, log a warning
              if (isLoading) {
                  console.warn("Initialize: Finished with content, but isLoading is still true! Resetting.");
                  isLoading = false;
              }
        }

        // Set up keyboard detection and toolbar positioning
        setupViewportHandling();

         updateFileStateUI(); // Final UI update

         window.addEventListener('beforeunload', (event) => { 
             /* ... beforeunload logic ... */ 
             cleanupViewportHandling();
         });
         console.log("Initialization complete.");
    }

    // --- Mobile Keyboard Detection and Toolbar Positioning ---
    function setupViewportHandling() {
        const toolbar = document.getElementById('toolbar');
        // Store original CSS position for restoring later
        toolbarOriginalPosition = {
            position: window.getComputedStyle(toolbar).position,
            bottom: window.getComputedStyle(toolbar).bottom
        };
        
        if ('visualViewport' in window) {
            console.log('Visual Viewport API detected, setting up keyboard detection');
            
            // Create handler function
            viewportHandler = () => {
                // On mobile devices, when keyboard appears, the visual viewport height becomes smaller
                // than the layout viewport height (window.innerHeight)
                const viewportHeight = window.visualViewport.height;
                const windowHeight = window.innerHeight;
                
                // If visual viewport is significantly smaller than window height, keyboard is likely visible
                const heightDifference = windowHeight - viewportHeight;
                const threshold = windowHeight * 0.15; // 15% difference threshold
                
                const keyboardIsVisible = heightDifference > threshold;
                
                if (keyboardIsVisible !== keyboardVisible) {
                    keyboardVisible = keyboardIsVisible;
                    adjustToolbarPosition(keyboardIsVisible);
                }
            };
            
            // Register handler for resize and scroll events on visualViewport
            window.visualViewport.addEventListener('resize', viewportHandler);
            window.visualViewport.addEventListener('scroll', viewportHandler);
            
            // Run once on initialization
            viewportHandler();
        } else {
            console.log('Visual Viewport API not supported, using fallback method');
            // Fallback for browsers without visualViewport API
            document.body.addEventListener('focusin', event => {
                if (event.target.isContentEditable || event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                    document.body.classList.add('keyboard-open');
                    adjustToolbarPosition(true);
                }
            });
            
            document.body.addEventListener('focusout', event => {
                if (event.target.isContentEditable || event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                    // Small delay to ensure we're not just focusing on another input
                    setTimeout(() => {
                        const activeElement = document.activeElement;
                        if (!(activeElement.isContentEditable || activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                            document.body.classList.remove('keyboard-open');
                            adjustToolbarPosition(false);
                        }
                    }, 100);
                }
            });
        }

        // Additional detection for iOS Safari keyboard
        window.addEventListener('resize', () => {
            if (window.innerWidth === document.documentElement.clientWidth) {
                // No change in width but height changed - likely keyboard
                const heightChanged = window.innerHeight !== document.documentElement.clientHeight;
                if (heightChanged) {
                    const keyboardLikelyVisible = window.innerHeight < window.outerHeight * 0.8;
                    if (keyboardLikelyVisible !== keyboardVisible) {
                        keyboardVisible = keyboardLikelyVisible;
                        adjustToolbarPosition(keyboardLikelyVisible);
                    }
                }
            }
        });
    }

    // Function to adjust toolbar position based on keyboard visibility
    function adjustToolbarPosition(keyboardIsVisible) {
        const toolbar = document.getElementById('toolbar');
        
        if (keyboardIsVisible) {
            document.body.classList.add('keyboard-open');
            
            if (window.visualViewport) {
                // Position toolbar at the bottom of the current visual viewport
                toolbar.style.position = 'fixed';
                toolbar.style.bottom = '0px';
                // Add iOS safe area inset if available
                if (window.CSS && CSS.supports('padding-bottom: env(safe-area-inset-bottom)')) {
                    toolbar.style.paddingBottom = 'env(safe-area-inset-bottom, 8px)';
                }
            }
            
            console.log('Keyboard detected as open, repositioning toolbar');
        } else {
            document.body.classList.remove('keyboard-open');
            
            // Restore original position
            if (toolbarOriginalPosition) {
                toolbar.style.position = toolbarOriginalPosition.position;
                toolbar.style.bottom = toolbarOriginalPosition.bottom;
            } else {
                toolbar.style.position = '';
                toolbar.style.bottom = '';
            }
            
            console.log('Keyboard detected as closed, resetting toolbar position');
        }
    }

    // Add cleanup function
    function cleanupViewportHandling() {
        if (viewportHandler && 'visualViewport' in window) {
            window.visualViewport.removeEventListener('resize', viewportHandler);
            window.visualViewport.removeEventListener('scroll', viewportHandler);
            viewportHandler = null;
        }
    }

    // --- Event Listeners ---
    // ... (listeners remain the same) ...
    fileInput.addEventListener('change', handleFileLoadFromInput);
    openDirectButton.addEventListener('click', openFileDirectly);
    saveDirectButton.addEventListener('click', saveFileDirectly);
    newAppFileButton.addEventListener('click', createNewAppFile);
    saveToOpfsButton.addEventListener('click', saveToOpfs);
    saveAsButton.addEventListener('click', saveFileAsDownload);
    toolbar.addEventListener('click', handleToolbarClick);
    outlineContainer.addEventListener('keydown', handleKeyDown);
    outlineContainer.addEventListener('focusin', handleFocusIn);
    outlineContainer.addEventListener('input', handleContentChange);
    outlineContainer.addEventListener('click', handleOutlineClick);


    // --- Initial Load ---
    initialize();

    // --- State Management ---
    // ... handleContentChange, markAsClean, updateFileStateUI, resetEditorState ...
    // (No changes needed in these core state functions for this fix)
    function handleContentChange(event) {
        if (event?.target?.classList.contains('fold-toggle')) return; // Ignore folding
        if (isLoading) return; // Ignore during load
        
        // Special handling for LaTeX blocks
        if (event?.target?.tagName === 'P' && 
            event.target.parentElement?.getAttribute('data-type') === 'latex') {
            // Debounce LaTeX rendering to avoid re-rendering during typing
            const latexP = event.target;
            const latexLi = latexP.parentElement;
            
            clearTimeout(latexP.dataset.latexTimer);
            latexP.dataset.latexTimer = setTimeout(() => {
                renderLaTeXBlock(latexP, latexLi);
            }, 800); // Delay LaTeX rendering for performance
        }
        
        if (!isDirty) {
            console.log("Content changed, marking as dirty.");
            isDirty = true;
            updateFileStateUI();
        }
        triggerAutoSaveDraft();
    }

    function markAsClean() {
        if (isDirty) {
            console.log("Marking content as clean (saved).");
            isDirty = false;
            updateFileStateUI();
             if (currentFileSource === 'direct' || currentFileSource === 'opfs') {
                 localStorage.removeItem(LOCAL_STORAGE_KEY);
                 console.log("Primary file saved, temporary draft cleared.");
             }
        }
    }

    function updateFileStateUI() {
        let fileNameDisplay = "No file";
        let fileTitle = "Current working file source";
        let saveDirectEnabled = false;
        let saveOpfsEnabled = false;

        switch (currentFileSource) {
            case 'direct':
                fileNameDisplay = directFileHandle?.name || "Direct File";
                fileTitle = `Editing direct file: ${fileNameDisplay}`;
                saveDirectEnabled = directFileHandle && !!rootUlElement;
                saveOpfsEnabled = opfsRoot && fileSystemWorker && !!rootUlElement;
                break;
            case 'opfs':
                fileNameDisplay = "App Storage";
                fileTitle = `Editing persistent file in App Storage (${PERSISTENT_OPFS_FILENAME})`;
                saveDirectEnabled = false;
                saveOpfsEnabled = opfsRoot && fileSystemWorker && (!!rootUlElement || currentFileSource === 'empty');
                break;
            case 'copy':
                const tempName = currentFileNameSpan.textContent?.replace('*', '').replace(' (copy)', '').trim() || "Loaded Copy";
                fileNameDisplay = `${tempName} (copy)`;
                fileTitle = `Editing content loaded from: ${tempName}. Save to App or Save As.`;
                saveDirectEnabled = false;
                saveOpfsEnabled = opfsRoot && fileSystemWorker && !!rootUlElement;
                break;
            case 'new':
            case 'draft':
                fileNameDisplay = (currentFileSource === 'draft') ? "Unsaved Draft" : "New App File";
                fileTitle = (currentFileSource === 'draft') ? "Editing temporary draft." : "Editing new file for App Storage.";
                saveDirectEnabled = false;
                saveOpfsEnabled = opfsRoot && fileSystemWorker && !!rootUlElement;
                break;
            case 'empty':
            default:
                fileNameDisplay = "No file";
                fileTitle = "No file open. Create new or load.";
                saveDirectEnabled = false;
                saveOpfsEnabled = opfsRoot && fileSystemWorker;
                break;
        }

        if (isDirty && currentFileSource !== 'empty') {
            fileNameDisplay += "*";
        }

        currentFileNameSpan.textContent = fileNameDisplay;
        currentFileNameSpan.title = fileTitle;

        saveDirectButton.disabled = !saveDirectEnabled;
        saveToOpfsButton.disabled = !saveOpfsEnabled;

        if (rootUlElement && outlineContainer.contains(rootUlElement)) {
            initialMessageDiv?.remove();
        } else if (!document.getElementById('initialMessage') && initialMessageDiv) {
            outlineContainer.prepend(initialMessageDiv);
            initialMessageDiv.style.display = 'block';
        } else if (initialMessageDiv && currentFileSource === 'empty') { // Ensure visible if state is empty
             initialMessageDiv.style.display = 'block';
        }
    }

    function resetEditorState(newSource = 'empty') {
        console.log(`Resetting editor state. New source: ${newSource}`);
        // Do not set isLoading here, let caller manage if needed for async ops

        outlineContainer.innerHTML = '';
        if (initialMessageDiv && !document.getElementById('initialMessage')) {
             outlineContainer.prepend(initialMessageDiv);
        }
         // Show message only if truly empty *and* not during an active load operation elsewhere
        if (initialMessageDiv) {
             initialMessageDiv.style.display = (newSource === 'empty' && !isLoading) ? 'block' : 'none';
        }

        rootUlElement = null;
        currentlySelectedLi = null;
        currentFileSource = newSource;
        clearTimeout(autoSaveTimeout);

        isDirty = (newSource === 'draft' || newSource === 'copy' || newSource === 'new');

        updateFileStateUI();
        console.log("Editor state reset complete.");
    }


    // --- File Handling (Input & Download) ---

    async function checkUnsavedChanges(actionDescription = "perform this action") {
        if (isDirty) {
            return confirm(`You have unsaved changes. Are you sure you want to ${actionDescription} and discard them?`);
        }
        return true;
    }

    async function handleFileLoadFromInput(event) {
        if (isLoading) { console.warn("Load copy rejected, already loading."); return; } // Prevent overlap
        const file = event.target.files[0];
        if (!file) return;
        if (!await checkUnsavedChanges(`load '${file.name}'`)) {
            fileInput.value = ''; return;
        }
        
        // Log filename and type for debugging
        console.log(`Loading file from input (as copy): ${file.name}, type: ${file.type}`);
        
        directFileHandle = null;
        persistentOpfsHandle = null;
        
        // Check for .xhtml extension for iOS compatibility
        const displayName = file.name.replace(/\.xhtml$/, '.bike');
        await loadFileContent(file, displayName, 'copy'); // Manages isLoading
        fileInput.value = '';
    }

    // loadFileContent now manages its own isLoading state
    async function loadFileContent(fileOrBlob, displayName, source) {
         console.log(`loadFileContent: START reading content for: ${displayName}, Source: ${source}`);
         if (isLoading) {
             console.warn("loadFileContent: Load attempt rejected, already loading.");
             return false;
         }
         isLoading = true; // Set loading flag for this operation
         let success = false;
         try {
            const fileContent = await fileOrBlob.text();
            console.log(`loadFileContent: Read ${fileContent.length} characters for ${displayName}.`);

            if (!fileContent || fileContent.trim().length === 0) {
                 console.warn(`File content for ${displayName} is empty or whitespace only.`);
                 if (source === 'copy') {
                    throw new Error("File content is empty.");
                 } else {
                     console.log(`Loading empty content for ${displayName} (Source: ${source}).`);
                     resetEditorState(source);
                     if(source === 'opfs' || source === 'direct') {
                         createMinimalStructure();
                     }
                     markAsClean();
                 }
             } else {
                 resetEditorState(source);
                 parseAndRenderBike(fileContent);
             }

            currentFileSource = source; // Set source after reset/parse
            markAsClean(); // Freshly loaded/parsed is clean

            console.log(`Successfully processed content for: ${displayName}`);
            success = true;

            if(rootUlElement) {
                const firstLi = rootUlElement.querySelector('li');
                 if (firstLi) {
                     selectAndFocusItem(firstLi, true);
                 }
                 initialMessageDiv?.remove();
            } else {
                 if (initialMessageDiv && !document.getElementById('initialMessage')) {
                     outlineContainer.prepend(initialMessageDiv);
                     initialMessageDiv.style.display = 'block';
                 }
            }

        } catch (err) { /* ... error handling ... */ }
        finally {
            isLoading = false; // Reset loading flag when this operation finishes
            updateFileStateUI();
            console.log(`loadFileContent: FINISHED for ${displayName}. Success: ${success}`);
        }
        return success;
    }

    function fixFileName(name, defaultExt = '.bike') {
        if (!name) return `outline${defaultExt}`;
        
        // Make sure we have a string
        name = String(name);
        
        // Remove invalid filename characters
        const invalidChars = /[\\/:*?"<>|]/g;
        name = name.replace(invalidChars, '');
        
        // iOS handling - detect if we're on iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        
        // For iOS, use .xhtml extension instead of .bike to avoid double extension
        const fileExtension = isIOS ? '.xhtml' : defaultExt;
        
        // Remove any existing extensions (.bike, .xhtml, etc.)
        name = name.replace(/\.(bike|xhtml|html|xml)$/i, '');
        
        // Add the appropriate extension
        if (!name.toLowerCase().endsWith(fileExtension.toLowerCase())) {
            name += fileExtension;
        }
        
        // Provide a fallback if name is empty after cleaning
        if (!name || name === fileExtension) {
            name = `outline${fileExtension}`;
        }
        
        return name;
    }

    function saveFileAsDownload() {
        console.log("Attempting to save file as download...");
        if (!rootUlElement) {
            alert("Nothing to save. Create some content first.");
            return;
        }
        
        // Get content and filename
        const htmlContent = serializeOutlineToHTML();
        if (!htmlContent) {
            alert("Failed to prepare content for download. Please try again.");
            return;
        }
        
        // Determine a sensible filename
        let suggestedName = "outline.bike";
        if (currentFileSource === 'direct' && directFileHandle?.name) {
            suggestedName = directFileHandle.name;
        } else if (currentFileNameSpan.textContent) {
            const currentName = currentFileNameSpan.textContent
                .replace('*', '')
                .replace(' (copy)', '')
                .replace(' (new)', '')
                .trim();
            
            if (currentName && currentName !== 'No file' && currentName !== 'Unsaved Draft' && currentName !== 'App Storage') {
                suggestedName = currentName;
            }
        }
        
        // Ensure proper extension using the updated fixFileName function
        suggestedName = fixFileName(suggestedName);
        console.log(`Saving as: ${suggestedName}`);
        
        // Detect content type based on filename extension
        const isXHTML = suggestedName.toLowerCase().endsWith('.xhtml');
        
        // Create blob for download - use correct MIME type
        const contentType = isXHTML ? 'application/xhtml+xml' : 'application/xhtml+xml';
        const blob = new Blob([htmlContent], { type: contentType });
        
        // Use download attribute for modern browsers
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = suggestedName;
        
        // Append to body, click, and remove (for browser compatibility)
        document.body.appendChild(downloadLink);
        downloadLink.click();
        
        // Clean up
        setTimeout(() => {
            document.body.removeChild(downloadLink);
            URL.revokeObjectURL(downloadLink.href);
            console.log(`Download triggered for: ${suggestedName}`);
        }, 100);
    }

    // --- Standard File System Access API ---

    async function openFileDirectly() {
        if (isLoading) { console.warn("Open direct rejected, already loading."); return; }
        console.log("Attempting to open file directly (Standard FSA)...");
        if (!('showOpenFilePicker' in window)) return alert("Direct file editing is not supported by this browser.");
        if (!await checkUnsavedChanges("open a new direct file")) return;

        try {
            // Update types to include .xhtml files
            const [handle] = await window.showOpenFilePicker({
                types: [
                    {
                        description: 'Bike Outline Files',
                        accept: {
                            'application/xhtml+xml': ['.bike', '.xhtml'],
                            'text/xml': ['.bike', '.xhtml']
                        }
                    }
                ]
            });
            console.log("Direct file handle obtained:", handle.name);
            const file = await handle.getFile();
            directFileHandle = handle; // Store handle
            persistentOpfsHandle = null; // Clear OPFS target
            
            // Use the raw filename from the handle but normalize display if needed
            const displayName = handle.name.replace(/\.xhtml$/, '.bike');
            await loadFileContent(file, displayName, 'direct'); // Manages isLoading
            updateFileStateUI();
        } catch (err) { /* ... error handling ... */ }
    }

    async function saveFileDirectly() {
        if (isLoading) { console.warn("Save direct rejected, already loading."); return; }
        console.log("Attempting to save file directly (Standard FSA)...");
        if (!directFileHandle) { alert("No file handle available. Use 'Open File' first or 'Save As'."); return; }
        if (!('createWritable' in FileSystemFileHandle.prototype)) { alert("Write access is not supported by this browser."); return; }
        
        // Ensure we have permission to write to the file
        if (!(await verifyPermission(directFileHandle, true))) {
            alert("Write permission denied. Please try again and allow access.");
            return;
        }
        
        const htmlContent = serializeOutlineToHTML();
        if (htmlContent === null) {
            alert("Failed to prepare content for saving. Please try again.");
            return;
        }
        
        setSavingIndicator('saveDirectButton', true, 'Saving...');
        
        try {
            console.log(`Creating writable for ${directFileHandle.name}...`);
            const writable = await directFileHandle.createWritable();
            await writable.write(htmlContent);
            await writable.close();
            
            console.log(`File saved successfully: ${directFileHandle.name}`);
            markAsClean();
            
            // Show success message briefly
            setSavingIndicator('saveDirectButton', false, 'Saved!');
            setTimeout(() => {
                setSavingIndicator('saveDirectButton', false);
            }, 2000);
        } catch (err) {
            console.error("Error saving file:", err);
            setSavingIndicator('saveDirectButton', false);
            alert(`Failed to save file: ${err.message}`);
        }
    }

    async function verifyPermission(fileHandle, readWrite) {
        if (!fileHandle) {
            console.error("No file handle provided for permission check");
            return false;
        }

        // Check if we already have permission
        let options = {};
        if (readWrite) {
            options = { mode: 'readwrite' };
        } else {
            options = { mode: 'read' };
        }

        // Check if permission was already granted
        if ((await fileHandle.queryPermission(options)) === 'granted') {
            console.log("Permission already granted for this file handle");
            return true;
        }

        // Request permission if not already granted
        try {
            console.log(`Requesting ${readWrite ? 'read/write' : 'read'} permission for file handle`);
            if ((await fileHandle.requestPermission(options)) === 'granted') {
                console.log("Permission granted");
                return true;
            } else {
                console.warn("Permission denied by user");
                return false;
            }
        } catch (error) {
            console.error("Error requesting permission:", error);
            return false;
        }
    }

    // --- OPFS File Handling ---

    async function createNewAppFile() {
        console.log("Creating new file structure for App Storage...");
        if (!opfsRoot) return alert("App Storage (OPFS) is not available.");
        if (isLoading) { console.warn("Create new rejected, already loading."); return; }

        // Check if we have content loaded that would be discarded
        const hasContent = rootUlElement && outlineContainer.contains(rootUlElement);
        
        // Always warn if we have any content, not just unsaved changes
        if (hasContent) {
            const message = isDirty 
                ? "You have unsaved changes. Are you sure you want to create a new file in App Storage and discard them?"
                : "Creating a new file will discard your current content. Are you sure you want to proceed?";
                
            if (!confirm(message)) {
                console.log("New App File cancelled due to user choice.");
                return;
            }
        }

        isLoading = true; // Set loading flag for this operation
        resetEditorState('new');
        createMinimalStructure();
        directFileHandle = null;
        isDirty = true;
        updateFileStateUI();

        requestAnimationFrame(() => {
            const firstLi = rootUlElement?.querySelector('li');
            if (firstLi) {
                selectAndFocusItem(firstLi, true);
                // Reset loading flag *after* potential focus
                isLoading = false;
                handleContentChange(); // Trigger draft save
                console.log("Prepared new file structure. Ready to save to App Storage.");
            } else {
                 console.error("Failed to find first LI after creating minimal structure.");
                 isLoading = false; // Reset loading even on error
            }
        });
    }

    // loadFromPersistentOpfs manages isLoading flag
    async function loadFromPersistentOpfs() {
         if (!persistentOpfsHandle) { console.log("loadFromPersistentOpfs: No handle exists."); return false; }
         // Check isLoading at the start
         if (isLoading) { console.warn("loadFromPersistentOpfs: Already loading, skipping."); return false; }

         console.log(`loadFromPersistentOpfs: Attempting to load from handle: ${persistentOpfsHandle.name}`);
         isLoading = true; // Set flag for THIS operation
         let success = false;

         try {
            console.log("loadFromPersistentOpfs: Getting file object from handle...");
            const file = await persistentOpfsHandle.getFile();
            console.log(`loadFromPersistentOpfs: Got file object. Name: ${file.name}, Size: ${file.size}, Type: ${file.type}`);

            // Reset isLoading before calling loadFileContent, which will manage it internally
            isLoading = false;
            success = await loadFileContent(file, PERSISTENT_OPFS_FILENAME, 'opfs');
            // loadFileContent now sets/unsets isLoading during its own async operations

         } catch (error) {
            console.error(`Error loading from persistent OPFS file handle (${persistentOpfsHandle.name}):`, error);
            if (error.name === 'NotFoundError') alert(`Could not find the file in App Storage...`);
            else alert(`Could not load the file from App Storage...\n\n${error.message}`);
            persistentOpfsHandle = null;
            resetEditorState('empty');
            success = false;
             // Ensure isLoading is false if error happened before loadFileContent call
             isLoading = false;
         }
         // isLoading should be false here because loadFileContent resets it in its finally block.
         console.log(`loadFromPersistentOpfs finished wrapper. Success: ${success}`);
         updateFileStateUI();
         return success;
    }


    async function saveToOpfs() {
         if (isLoading) { console.warn("Save OPFS rejected, already loading."); return; }
         console.log("saveToOpfs: Attempting to save to OPFS persistent file...");
         // ... (rest of saveToOpfs remains the same) ...
        if (!opfsRoot || !fileSystemWorker) return alert("App Storage (OPFS) or Worker is not available/initialized.");
        const allowSave = !!rootUlElement || currentFileSource === 'empty'; if (!allowSave) { alert("Nothing to save."); return; }
        const htmlContent = serializeOutlineToHTML(); if (htmlContent === null) return alert("Serialization failed, cannot save content.");
        console.log(`saveToOpfs: Serialized content length: ${htmlContent.length}`);
        setSavingIndicator('saveToOpfsButton', true, 'Saving...');
        try {
            if (!persistentOpfsHandle) { console.log(`saveToOpfs: Persistent handle for ${PERSISTENT_OPFS_FILENAME} doesn't exist, creating...`); persistentOpfsHandle = await opfsRoot.getFileHandle(PERSISTENT_OPFS_FILENAME, { create: true }); console.log("saveToOpfs: Persistent handle created/obtained."); }
            else { console.log(`saveToOpfs: Using existing persistent handle: ${persistentOpfsHandle.name}`); }
            console.log(`saveToOpfs: Sending content for ${PERSISTENT_OPFS_FILENAME} to worker...`);
            fileSystemWorker.postMessage({ action: 'saveOpfs', fileName: PERSISTENT_OPFS_FILENAME, content: htmlContent });
            currentFileSource = 'opfs'; directFileHandle = null; updateFileStateUI();
        } catch (err) { console.error("Error preparing OPFS save (getting handle):", err); alert(`Could not prepare file for saving to App Storage: ${err.message}`); setSavingIndicator('saveToOpfsButton', false); persistentOpfsHandle = null; updateFileStateUI(); }
    }

    function handleWorkerMessage(event) {
        const { success, fileName, error, name } = event.data;
        console.log(`Worker message received. Success: ${success}, File: ${fileName || 'unknown'}`);
        
        if (fileName === PERSISTENT_OPFS_FILENAME) {
            if (success) {
                console.log(`Worker reported success saving ${fileName}`);
                markAsClean();
                // Show success message on button for a brief period
                setSavingIndicator('saveToOpfsButton', false, 'Saved!');
                // Reset button to normal after a delay
                setTimeout(() => {
                    setSavingIndicator('saveToOpfsButton', false);
                }, 2000);
            } else {
                console.error(`Worker reported error saving ${fileName}:`, error, name);
                setSavingIndicator('saveToOpfsButton', false);
                alert(`Failed to save to App Storage:\n${error}`);
            }
        } else {
            console.log(`Worker message for unknown file: ${fileName}`);
        }
    }

    function setSavingIndicator(buttonId, isSaving, message = null) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        
        const originalText = button.getAttribute('data-original-text') || button.textContent;
        
        if (isSaving) {
            button.setAttribute('data-original-text', originalText);
            button.textContent = message || 'Saving...';
            button.disabled = true;
        } else {
            if (message) {
                // If message provided, show it temporarily
                button.textContent = message;
                button.classList.add('save-success');
            } else {
                // Otherwise restore original text
                button.textContent = originalText;
                button.classList.remove('save-success');
            }
            button.disabled = false;
        }
    }

    // --- Local Storage (Draft) Functions ---

    function triggerAutoSaveDraft() { /* ... (no changes) ... */ }
    function saveDraftToLocalStorage() { /* ... (no changes) ... */ }

    // loadFromLocalStorage manages isLoading flag
    async function loadFromLocalStorage(forcePrompt = false) {
        if (isLoading) { console.warn("Draft load rejected, already loading."); return false; }

        const storedContent = localStorage.getItem(LOCAL_STORAGE_KEY);
        let loaded = false;
        if (storedContent && storedContent.trim().length > 50 && storedContent.includes('<ul') && storedContent.includes('<li')) {
            console.log("Found potentially valid draft in local storage.");
            const editorIsEmpty = !rootUlElement || !!document.getElementById('initialMessage'); // Correct check

            if (editorIsEmpty || forcePrompt) {
                 if (confirm("Load unsaved draft from previous session? (Choosing 'Cancel' will discard the draft)")) {
                     isLoading = true; // Set loading flag for this operation
                     try {
                        console.log("Loading draft.");
                        resetEditorState('draft');
                        parseAndRenderBike(storedContent);
                        isDirty = true;
                        updateFileStateUI();
                        loaded = true;
                     } catch (error) { /* ... error handling ... */ }
                     finally {
                         isLoading = false; // Reset loading flag
                     }
                } else { /* ... discard draft ... */ }
            } else { /* ... editor not empty ... */ }
        } else { /* ... no valid draft ... */ }
        return loaded;
    }

    // --- Parsing, Rendering, Serialization ---
    // ... (No changes needed in parseAndRenderBike, makeEditableAndInteractive, addFoldingToggle, setupParagraph, serializeOutlineToHTML, escapeXml) ...
    function parseAndRenderBike(htmlString) {
        console.log("Parsing HTML string...");
        if (!htmlString || typeof htmlString !== 'string' || htmlString.trim().length === 0) {
             throw new Error("Parse Error: Input content is empty or invalid.");
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'application/xhtml+xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
             console.error("XML Parse Error:", parseError.textContent);
             const specificError = parseError.textContent.split('\n')[2] || parseError.textContent.split('\n')[0];
             throw new Error(`Parse Error: Invalid Bike/XML file.\n${specificError}`);
        }
        rootUlElement = doc.body?.querySelector('ul');
        if (!rootUlElement) {
            if (doc.body && doc.body.querySelector('li')) {
                 console.warn("Content seems to be missing a root <ul>, attempting to wrap body LIs.");
                 const tempUl = document.createElement('ul'); tempUl.id = generateUniqueId(5);
                 Array.from(doc.body.children).forEach(node => { if (node.tagName?.toUpperCase() === 'LI') tempUl.appendChild(node); });
                 if (tempUl.children.length > 0) rootUlElement = tempUl;
                 else throw new Error('Parse Error: Could not find root <ul> and no valid <li> elements found in body.');
            } else {
                throw new Error('Parse Error: Could not find the root <ul> element in the provided content.');
            }
        }
        outlineContainer.innerHTML = '';
        const importedNode = document.importNode(rootUlElement, true);
        outlineContainer.appendChild(importedNode);
        rootUlElement = outlineContainer.querySelector('ul');
        if (!rootUlElement) throw new Error("Internal Error: Failed to attach parsed content.");
        makeEditableAndInteractive(rootUlElement);
        
        // Render any LaTeX blocks after parsing
        rootUlElement.querySelectorAll('li[data-type="latex"] > p').forEach(p => {
            renderLaTeXBlock(p, p.parentElement);
        });
        
        initialMessageDiv?.remove();
        console.log("Parsing and rendering complete.");
    }

    function makeEditableAndInteractive(container) {
        container.querySelectorAll(':scope > li').forEach(li => {
            if (!li.id) li.id = generateUniqueId();
            const p = li.querySelector(':scope > p');
            const childUl = li.querySelector(':scope > ul');
            addFoldingToggle(li, !!childUl);

            // Make the item draggable (excluding horizontal rules)
            if (li.getAttribute('data-type') !== 'hr') {
                li.setAttribute('draggable', 'true');
                setupDragListeners(li);
            }

            if (li.getAttribute('data-type') === 'hr') {
                if (p) p.remove(); li.tabIndex = -1;
            } else if (!p) {
                const newP = document.createElement('p'); newP.setAttribute('contenteditable', 'true'); newP.innerHTML = '<br>';
                li.prepend(newP); setupParagraph(newP, li);
            } else {
                 setupParagraph(p, li);
            }
            if (childUl) makeEditableAndInteractive(childUl);
        });
        if (container === rootUlElement && !rootUlElement.id) rootUlElement.id = generateUniqueId(5);
    }

    function addFoldingToggle(li, hasChildren) {
        li.querySelector(':scope > .fold-toggle')?.remove();
         if (li.getAttribute('data-type') !== 'hr' && hasChildren) {
            const toggle = document.createElement('span'); toggle.className = 'fold-toggle';
            toggle.setAttribute('aria-hidden', 'true'); toggle.title = "Fold/Unfold";
            li.prepend(toggle);
         }
    }

    function setupParagraph(p, li) {
        p.setAttribute('contenteditable', 'true');
        const dataType = li.getAttribute('data-type');
        if (dataType === 'task') {
            let checkbox = p.querySelector('span.task-checkbox');
            if (!checkbox) {
                checkbox = document.createElement('span'); 
                checkbox.className = 'task-checkbox';
                checkbox.setAttribute('contenteditable', 'false'); 
                checkbox.setAttribute('aria-hidden', 'true');
                
                // Ensure there's always a space after the checkbox
                const space = document.createTextNode(' ');
                
                // Clear any leading spaces from text nodes
                const firstText = Array.from(p.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
                if (firstText) {
                    // Remove leading space if it exists
                    if (/^\s/.test(firstText.textContent)) {
                        firstText.textContent = firstText.textContent.substring(1);
                        if (!firstText.textContent) firstText.remove();
                    }
                }
                
                // Add checkbox then space
                p.prepend(space);
                p.prepend(checkbox);
            }
            checkbox.textContent = li.getAttribute('data-done') === 'true' ? '☑' : '☐';
        } else if (dataType === 'latex') {
            // Set up LaTeX block
            if (!p.textContent.trim()) {
                p.textContent = DEFAULT_LATEX;
            }
            renderLaTeXBlock(p, li);
        } else {
            p.querySelector('span.task-checkbox')?.remove();
            if (p.firstChild?.nodeType === Node.TEXT_NODE && p.firstChild.textContent.startsWith(' ')) {
                p.firstChild.textContent = p.firstChild.textContent.substring(1);
                if (!p.firstChild.textContent) p.firstChild.remove();
            }
        }
        
        const hasVisibleContent = p.textContent.trim() || p.querySelector('img, br');
        if (!hasVisibleContent && !p.querySelector('br')) {
            p.appendChild(document.createElement('br'));
        } else if (p.innerHTML.trim() === '<br>' && p.textContent.trim()) {
            const br = p.querySelector('br');
            if(br && !br.previousSibling && !br.nextSibling) br.remove();
        }
    }

    function renderLaTeXBlock(p, li) {
        if (!katexInitialized && typeof katex === 'undefined') {
            // Try to initialize KaTeX if it's loaded after our script
            katexInitialized = typeof katex !== 'undefined';
            
            if (!katexInitialized) {
                console.warn('KaTeX library not loaded, cannot render LaTeX');
                return;
            }
        }
        
        // Remove any previous rendered math
        li.querySelector('.rendered-math')?.remove();
        
        // Get LaTeX content from paragraph
        const latexContent = p.textContent.trim();
        if (!latexContent) return;
        
        // Create container for rendered math
        const mathContainer = document.createElement('div');
        mathContainer.className = 'rendered-math';
        mathContainer.setAttribute('aria-hidden', 'true'); // Accessibility: math is decorative, source is the real content
        
        try {
            // Render the math using KaTeX
            katex.render(latexContent, mathContainer, {
                displayMode: true,
                throwOnError: false,
                output: 'html'
            });
            
            // Add rendered math after the paragraph
            p.after(mathContainer);
        } catch (error) {
            console.error('LaTeX rendering error:', error);
            
            // Create error message
            const errorContainer = document.createElement('div');
            errorContainer.className = 'katex-error';
            errorContainer.textContent = `LaTeX Error: ${error.message || 'Unknown error'}`;
            
            // Add error after paragraph
            p.after(errorContainer);
        }
    }

    function serializeOutlineToHTML() {
        if (!rootUlElement) {
            const emptyTitle = "Empty Outline";
            return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml">\n  <head>\n    <meta charset="utf-8"/>\n    <title>${escapeXml(emptyTitle)}</title>\n  </head>\n  <body>\n    <ul id="root"></ul>\n  </body>\n</html>`;
        }
        
        if (document.activeElement?.isContentEditable) document.activeElement.blur();
        const contentToSave = rootUlElement.cloneNode(true);
        
        try {
            contentToSave.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
            contentToSave.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
            contentToSave.querySelectorAll('[tabindex]').forEach(el => el.removeAttribute('tabindex'));
            contentToSave.querySelectorAll('span.task-checkbox').forEach(el => el.remove());
            contentToSave.querySelectorAll('.fold-toggle').forEach(el => el.remove());
            
            // Remove rendered math containers but leave the LaTeX source
            contentToSave.querySelectorAll('.rendered-math, .katex-error').forEach(el => el.remove());
            
            contentToSave.querySelectorAll('li[data-type="task"] > p').forEach(p => {
                if (p.firstChild?.nodeType === Node.TEXT_NODE && p.firstChild.textContent.startsWith(' ')) {
                    p.firstChild.textContent = p.firstChild.textContent.substring(1); 
                    if (!p.firstChild.textContent) p.firstChild.remove();
                }
            });
            contentToSave.querySelectorAll('ul:empty').forEach(ul => ul.remove());
            contentToSave.querySelectorAll('p').forEach(p => {
                const brs = p.querySelectorAll(':scope > br');
                if (brs.length === 1 && p.childNodes.length === 1 && p.textContent.trim() === '') p.innerHTML = '';
                else if (p.textContent.trim() !== '') brs.forEach(br => br.remove());
            });
        } catch (cleanupError) { console.error("Error during serialization cleanup:", cleanupError); }

        let title = 'Bike Outline';
        if (currentFileSource === 'direct' && directFileHandle?.name) title = directFileHandle.name.replace(/\.[^/.]+$/, "");
        else if (currentFileSource === 'opfs') title = "App Storage Outline";
        else if (currentFileNameSpan.textContent) {
            const currentDisplay = currentFileNameSpan.textContent.replace('*', '').replace(' (copy)', '').replace(' (new)', '').trim();
            if (currentDisplay && currentDisplay !== 'No file' && currentDisplay !== 'Unsaved Draft') title = currentDisplay.replace(/\.[^/.]+$/, "");
        }

        const serializer = new XMLSerializer();
        const ulHtml = serializer.serializeToString(contentToSave);
        const finalHtml = `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml">\n  <head>\n    <meta charset="utf-8"/>\n    <title>${escapeXml(title)}</title>\n  </head>\n  <body>\n    ${ulHtml}\n  </body>\n</html>`;

        try {
            const parser = new DOMParser(); const checkDoc = parser.parseFromString(finalHtml, 'application/xhtml+xml');
            if (checkDoc.querySelector('parsererror')) { console.error("Serialization resulted in invalid XML:", checkDoc.querySelector('parsererror').textContent); return null; }
        } catch(validationError) { console.error("Error during serialization validation:", validationError); return null; }
        return finalHtml;
    }

    function escapeXml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'})[c] || c);
    }


    // --- Selection & Focus ---
    // ... (No changes needed in handleFocusIn, selectListItem, getSelectedLi, getFocusedP) ...
    function handleFocusIn(event) {
        const target = event.target;
        const li = target.closest('li');
        if (li && outlineContainer.contains(li)) {
             if ((target.tagName === 'P' && target.parentElement === li) || (target === li && li.getAttribute('data-type') === 'hr')) {
                selectListItem(li);
             }
        }
    }

    function selectListItem(liElement) {
        if (!liElement || !outlineContainer.contains(liElement) || currentlySelectedLi === liElement) return;
        if (currentlySelectedLi) {
            currentlySelectedLi.classList.remove('selected');
             if(currentlySelectedLi.getAttribute('data-type') === 'hr') currentlySelectedLi.removeAttribute('tabindex');
        }
        currentlySelectedLi = liElement;
        currentlySelectedLi.classList.add('selected');
         if (currentlySelectedLi.getAttribute('data-type') === 'hr') {
             currentlySelectedLi.tabIndex = 0;
         }
    }

    function getSelectedLi() {
        if (currentlySelectedLi && outlineContainer.contains(currentlySelectedLi)) return currentlySelectedLi;
        return outlineContainer.querySelector('li.selected');
    }

    function getFocusedP() {
         const active = document.activeElement;
         if (active?.tagName === 'P' && active.isContentEditable && outlineContainer.contains(active)) {
             return active;
         }
         return null;
     }

    // --- Keyboard Navigation & Editing ---
    function handleKeyDown(event) {
        const selectedLi = getSelectedLi();
        const targetP = getFocusedP();

        // Global Shortcuts (Save)
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
             event.preventDefault(); console.log("Ctrl+S detected");
             if (currentFileSource === 'direct' && directFileHandle && !saveDirectButton.disabled) saveFileDirectly();
             else if ((currentFileSource === 'opfs' || currentFileSource === 'copy' || currentFileSource === 'draft' || currentFileSource === 'new') && opfsRoot && !saveToOpfsButton.disabled) saveToOpfs();
             else if (rootUlElement) console.log("Ctrl+S: No primary save target, consider Save As.");
             return;
        }

        // Create first item logic refinement
        const isEditorEffectivelyEmpty = (!rootUlElement || !outlineContainer.contains(rootUlElement) || !!document.getElementById('initialMessage'));
        if (isEditorEffectivelyEmpty && event.key === 'Enter' && !event.shiftKey) {
             event.preventDefault(); console.log("Enter pressed on empty editor, creating first item.");
             if (opfsRoot) createNewAppFile(); else createFirstItemBare();
             return;
        }

        // Actions requiring a selected LI beyond this point
        if (!selectedLi || !outlineContainer.contains(selectedLi)) {
             return;
        }

        switch (event.key) {
            case 'Enter':
                if (event.shiftKey) {
                    if (targetP) {
                         event.preventDefault(); document.execCommand('insertLineBreak'); handleContentChange();
                     }
                } else {
                     event.preventDefault();
                     
                     // Check if current item is not plain type and is empty
                     const currentType = selectedLi.getAttribute('data-type');
                     
                     // Skip horizontal rules and don't convert LaTeX blocks
                     if (currentType && currentType !== '' && currentType !== 'hr' && currentType !== 'latex' && targetP) {
                         // Check if paragraph is empty (considering special cases like task checkboxes)
                         let textContent = targetP.textContent.trim();
                         
                         // For tasks, the checkbox text (☐/☑) shouldn't count as content
                         if (currentType === 'task' && (textContent.startsWith('☐') || textContent.startsWith('☑'))) {
                             textContent = textContent.substring(1).trim();
                         }
                         
                         const isEmptyP = !textContent || targetP.innerHTML.trim() === '<br>';
                         
                         if (isEmptyP) {
                             // Convert to plain type instead of creating new item
                             console.log(`Converting empty ${currentType} item to plain on Enter: ${selectedLi.id}`);
                             changeItemType(selectedLi, '');
                             return;
                         }
                     }
                     
                     // If we didn't convert to plain, create a new item
                     createNewItem(selectedLi);
                 }
                break;
            
            case 'Tab':
                event.preventDefault();
                if (event.shiftKey) outdentItem(selectedLi); else indentItem(selectedLi);
                break;
            case 'ArrowUp':
                 if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
                      event.preventDefault(); const prevLi = findPreviousVisibleLi(selectedLi); if (prevLi) selectAndFocusItem(prevLi, false);
                 } else if (event.altKey && event.shiftKey) { event.preventDefault(); moveItemUp(selectedLi); }
                 break;
            case 'ArrowDown':
                 if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
                      event.preventDefault(); const nextLi = findNextVisibleLi(selectedLi); if (nextLi) selectAndFocusItem(nextLi, true);
                 } else if (event.altKey && event.shiftKey) { event.preventDefault(); moveItemDown(selectedLi); }
                 break;
             case 'Backspace':
                 // Handle converting formatted blocks to plain when cursor is at start
                 if (targetP && targetP === selectedLi.querySelector(':scope > p')) {
                     const selection = window.getSelection();
                     const cursorAtStartOfP = selection?.rangeCount > 0 && 
                                             selection.getRangeAt(0).startOffset === 0 && 
                                             selection.getRangeAt(0).collapsed;
                     
                     if (cursorAtStartOfP) {
                         const dataType = selectedLi.getAttribute('data-type');
                         
                         // If it's a non-plain, non-empty block, convert to plain
                         if (dataType && dataType !== 'hr' && dataType !== 'latex') {
                             // Check if the paragraph is truly empty
                             // For tasks, we need to ignore the checkbox when determining emptiness
                             let textContent = targetP.textContent.trim();
                             const isTaskBlock = dataType === 'task';
                             
                             // For tasks, the checkbox text (☐/☑) shouldn't count as content
                             if (isTaskBlock && textContent.startsWith('☐') || textContent.startsWith('☑')) {
                                 textContent = textContent.substring(1).trim();
                             }
                             
                             const isEmptyP = !textContent || (targetP.innerHTML.trim() === '<br>');
                             
                             if (isEmptyP) {
                                 event.preventDefault(); 
                                 deleteItem(selectedLi);
                             } else {
                                 // If paragraph has content, just change type to plain
                                 event.preventDefault();
                                 console.log(`Converting item ${selectedLi.id} from ${dataType} to plain`);
                                 changeItemType(selectedLi, '');  // Empty string for plain type
                                 
                                 // Make sure cursor stays at the start of the paragraph
                                 const p = selectedLi.querySelector(':scope > p');
                                 if (p) {
                                     requestAnimationFrame(() => {
                                         focusAndMoveCursor(p, true);
                                     });
                                 }
                             }
                             return;
                         }
                         
                         // Handle normal deletion if cursor at start of a plain block
                         const isEmptyP = !targetP.textContent.trim() || targetP.innerHTML.trim() === '<br>';
                         if (isEmptyP) {
                             event.preventDefault(); 
                             deleteItem(selectedLi);
                         }
                     }
                 }
                 break;
             case 'Delete':
                 const isHrSelectedAndFocused = selectedLi.getAttribute('data-type') === 'hr' && document.activeElement === selectedLi;
                 const p = selectedLi.querySelector(':scope > p');
                 const isEmptyP = p && p.getAttribute('contenteditable') === 'true' && 
                                 (!p.textContent.trim() && p.querySelectorAll('*').length === 0 || p.innerHTML.trim() === '<br>');
                 
                 if (isHrSelectedAndFocused || (isEmptyP && targetP === p)) {
                     event.preventDefault(); 
                     deleteItem(selectedLi);
                 }
                 break;
             case 'b': if (event.ctrlKey || event.metaKey) { event.preventDefault(); formatSelection('bold'); } break;
             case 'i': if (event.ctrlKey || event.metaKey) { event.preventDefault(); formatSelection('italic'); } break;
             case 'k': if (event.ctrlKey || event.metaKey) { event.preventDefault(); handleLinkButtonClick(selectedLi); } break;
        }
    }

    function formatSelection(command) {
         const targetP = ensureFocusInEditableParagraph(getSelectedLi()); if (!targetP) return;
         switch (command) {
             case 'highlight': wrapSelection('mark'); break;
             case 'code': wrapSelection('code'); break;
             case 'bold': case 'italic': document.execCommand(command, false, null); break;
             default: console.warn("Unknown format command:", command); return;
         }
          targetP.focus(); handleContentChange();
    }

    function createFirstItemBare() {
        console.log("Creating first bare item (no persistent source).");
        if (isLoading) { console.warn("Create bare rejected, already loading."); return; }
        isLoading = true;
        resetEditorState('new');
        createMinimalStructure();
        isDirty = true;
        updateFileStateUI();
         requestAnimationFrame(() => {
             const firstLi = rootUlElement?.querySelector('li');
             if(firstLi) selectAndFocusItem(firstLi, true);
             else console.error("Failed to find first LI for focus in createFirstItemBare");
             isLoading = false;
             handleContentChange();
         });
    }

    function createMinimalStructure() {
         rootUlElement = document.createElement('ul'); rootUlElement.id = generateUniqueId(5);
         const firstLi = document.createElement('li'); firstLi.id = generateUniqueId();
         const firstP = document.createElement('p'); firstP.setAttribute('contenteditable', 'true'); firstP.innerHTML = '<br>';
         firstLi.appendChild(firstP); rootUlElement.appendChild(firstLi);
         outlineContainer.innerHTML = ''; outlineContainer.appendChild(rootUlElement);
         makeEditableAndInteractive(rootUlElement);
         initialMessageDiv?.remove();
     }

    function createNewItem(currentItemLi) {
        if (!currentItemLi || !outlineContainer.contains(currentItemLi)) return;
        
        // Create new LI element with unique ID
        const newLi = document.createElement('li');
        newLi.id = generateUniqueId();
        
        // Get the data-type of the current item to inherit it
        const currentType = currentItemLi.getAttribute('data-type');
        
        // Horizontal rules and LaTeX blocks should not be inherited
        const inheritableTypes = ['heading', 'note', 'task', 'ordered', 'unordered'];
        
        // Only inherit certain types, not horizontal rules or LaTeX
        if (currentType && inheritableTypes.includes(currentType)) {
            // Inherit the data-type
            newLi.setAttribute('data-type', currentType);
            
            // For tasks, don't inherit the "done" status
            if (currentType === 'task') {
                // Don't copy data-done="true" attribute
                newLi.removeAttribute('data-done');
            }
        }
        
        // Create paragraph for the new item
        const newP = document.createElement('p');
        newP.setAttribute('contenteditable', 'true');
        newP.innerHTML = '<br>';
        newLi.appendChild(newP);
        
        // Insert the new item after the current one
        currentItemLi.after(newLi);
        
        // Apply interactive features to the new list
        makeEditableAndInteractive(newLi.parentElement);
        
        // Select and focus the new item
        selectAndFocusItem(newLi, true);
        
        // For task items, need to ensure cursor is placed after checkbox
        if (currentType === 'task') {
            // Give the DOM time to update with the task checkbox
            requestAnimationFrame(() => {
                const taskP = newLi.querySelector(':scope > p');
                if (taskP && taskP.firstChild) {
                    // Place cursor after the checkbox or at first text node
                    const textNode = Array.from(taskP.childNodes).find(node => 
                        node.nodeType === Node.TEXT_NODE);
                        
                    if (textNode) {
                        const range = document.createRange();
                        const selection = window.getSelection();
                        // Position cursor at start of text node
                        range.setStart(textNode, 0);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                        taskP.focus();
                    }
                }
            });
        }
        
        // Mark content as changed
        handleContentChange();
    }

    // --- Navigation & Focus Helpers ---
    // ... (selectAndFocusItem, focusAndMoveCursor, findPreviousVisibleLi, findNextVisibleLi - no changes needed) ...
    function selectAndFocusItem(li, focusStart = true) {
         if (!li || !outlineContainer.contains(li)) return;
         selectListItem(li);
         const pToFocus = li.querySelector(':scope > p[contenteditable="true"]');
         if (pToFocus) focusAndMoveCursor(pToFocus, focusStart);
         else if (li.getAttribute('data-type') === 'hr') li.focus();
         // Scroll into view might be needed, consider adding:
         // li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function focusAndMoveCursor(element, toStart = true) {
          if (!element || element.contentEditable !== 'true') return;
          element.focus();
         requestAnimationFrame(() => {
              if (document.activeElement !== element) return;
              const selection = window.getSelection(); if (!selection) return; const range = document.createRange();
             if (element.innerHTML.trim() === '<br>') range.setStart(element, 0);
             else { range.selectNodeContents(element); range.collapse(toStart); }
             selection.removeAllRanges(); selection.addRange(range);
         });
     }

     function findPreviousVisibleLi(li) {
        if (!li) return null; let current = li.previousElementSibling;
         if (current) { while (true) { const lastChildUl = current.querySelector(':scope > ul'); const lastLi = lastChildUl?.querySelector(':scope > li:last-child'); if(lastLi) current = lastLi; else break; } return current; }
         else { const parentUl = li.parentElement; if(parentUl && parentUl !== rootUlElement) return parentUl.closest('li'); } return null;
     }

     function findNextVisibleLi(li) {
        if (!li) return null; const firstChildUl = li.querySelector(':scope > ul'); const firstChildLi = firstChildUl?.querySelector(':scope > li:first-child'); if(firstChildLi) return firstChildLi;
         let current = li; while(current){ const nextSiblingLi = current.nextElementSibling; if(nextSiblingLi) return nextSiblingLi;
             const parentUl = current.parentElement; if(parentUl && parentUl !== rootUlElement) current = parentUl.closest('li'); else current = null; } return null;
     }

    // --- Toolbar & Click Actions ---
    // ... (handleOutlineClick, toggleTaskDone, toggleFold, handleToolbarClick, ensureFocusInEditableParagraph, handleLinkButtonClick, changeItemType, findParentLink, wrapSelection - no changes needed) ...
    function handleOutlineClick(event) {
         const target = event.target;
         const foldToggle = target.closest('.fold-toggle');
         if (foldToggle && outlineContainer.contains(foldToggle)) { event.stopPropagation(); const li = foldToggle.closest('li'); if (li) toggleFold(li); return; }
         const checkbox = target.closest('span.task-checkbox');
         if (checkbox && outlineContainer.contains(checkbox)) { event.stopPropagation(); const li = checkbox.closest('li'); if (li && li.getAttribute('data-type') === 'task') toggleTaskDone(li); return; }
         const link = target.closest('a'); if (link && outlineContainer.contains(link)) return;
         const clickedLi = target.closest('li');
          if (clickedLi && outlineContainer.contains(clickedLi) && currentlySelectedLi !== clickedLi) {
              selectListItem(clickedLi);
              if (target.tagName === 'P' && target.closest('li') === clickedLi) focusAndMoveCursor(target, false);
              else if (clickedLi.getAttribute('data-type') === 'hr') clickedLi.focus();
          }
     }

     function toggleTaskDone(li) {
          if (!li || li.getAttribute('data-type') !== 'task') return;
          const isDone = li.getAttribute('data-done') === 'true'; const checkbox = li.querySelector('span.task-checkbox');
          if (isDone) { li.removeAttribute('data-done'); if (checkbox) checkbox.textContent = '☐'; console.log(`Task unmarked: ${li.id}`); }
          else { li.setAttribute('data-done', 'true'); if (checkbox) checkbox.textContent = '☑'; console.log(`Task marked done: ${li.id}`); }
          handleContentChange();
     }

     function toggleFold(li) {
         if (!li || !outlineContainer.contains(li) || li.getAttribute('data-type') === 'hr') return;
         const isFolded = li.getAttribute('data-folded') === 'true';
         if (isFolded) { li.removeAttribute('data-folded'); console.log(`Unfolded: ${li.id}`); }
         else { if (li.querySelector(':scope > ul > li')) { li.setAttribute('data-folded', 'true'); console.log(`Folded: ${li.id}`); } else { console.log(`Item ${li.id} has no children to fold.`); } }
     }


    function handleToolbarClick(event) {
        const button = event.target.closest('button'); if (!button || button.disabled) return;
        const selectedLi = getSelectedLi(); const command = button.dataset.command; const type = button.dataset.type; const id = button.id;
        const requiresSelection = button.classList.contains('type-button') || button.classList.contains('format-button') || ['indentButton', 'outdentButton', 'moveUpButton', 'moveDownButton', 'deleteButton', 'linkButton'].includes(id);
        if (requiresSelection && !selectedLi) { alert("Please select an item in the outline first."); return; }

        if (command) formatSelection(command);
        else if (type !== undefined) changeItemType(selectedLi, type);
        else { switch (id) { case 'linkButton': handleLinkButtonClick(selectedLi); break; case 'indentButton': indentItem(selectedLi); break; case 'outdentButton': outdentItem(selectedLi); break; case 'moveUpButton': moveItemUp(selectedLi); break; case 'moveDownButton': moveItemDown(selectedLi); break; case 'deleteButton': deleteItem(selectedLi); break; } }
    }

     function ensureFocusInEditableParagraph(selectedLi) {
         if (!selectedLi) return null; let targetP = getFocusedP();
          if (!targetP || targetP.closest('li') !== selectedLi) {
              targetP = selectedLi.querySelector(':scope > p[contenteditable="true"]');
              if (targetP) { console.log("Focusing paragraph programmatically."); focusAndMoveCursor(targetP, false); }
              else { if (selectedLi.getAttribute('data-type') === 'hr') alert("Cannot perform text formatting on a horizontal rule."); else alert("Cannot find editable text for this item."); return null; }
          }
           if (!targetP || targetP.contentEditable !== 'true') { console.warn("Target paragraph not found or not editable."); return null; }
         return targetP;
     }

     function handleLinkButtonClick(selectedLi = getSelectedLi()) {
        const targetP = ensureFocusInEditableParagraph(selectedLi); if (!targetP) return;
        const selection = window.getSelection(); if (!selection) return;
        const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const parentLink = currentRange ? findParentLink(currentRange.commonAncestorContainer) : null;
        const defaultUrl = parentLink ? parentLink.getAttribute('href') || "https://" : "https://";
        const url = prompt("Enter link URL:", defaultUrl); if (url === null) { console.log("Link creation cancelled."); return; }
        if (currentRange) { selection.removeAllRanges(); selection.addRange(currentRange); } else { focusAndMoveCursor(targetP, false); }
        if (parentLink) { document.execCommand('unlink', false, null); console.log("Unlinked previous URL."); }
        if (url !== "") { const selectionIsCollapsed = selection.isCollapsed; if (!selectionIsCollapsed) { document.execCommand('createLink', false, url); console.log(`Applied link ${url} to selection.`); } else { const safeUrl = escapeXml(url); document.execCommand('insertHTML', false, `<a href="${safeUrl}">${safeUrl}</a>`); console.log(`Inserted new link: ${url}`); } }
        else { console.log("URL cleared, only unlink performed."); }
        targetP.focus(); handleContentChange();
    }

    function changeItemType(li, type) {
         if (!li) return; 
         const oldType = li.getAttribute('data-type') || ""; 
         if (type === oldType) return;
         
         console.log(`Changing type of ${li.id} from '${oldType || 'default'}' to '${type || 'default'}'`);
         
         // Remove any rendered LaTeX container if it exists
         if (oldType === 'latex') {
             li.querySelector('.rendered-math')?.remove();
             li.querySelector('.katex-error')?.remove();
         }
         
         if (type) li.setAttribute('data-type', type); 
         else li.removeAttribute('data-type');
         
         let p = li.querySelector(':scope > p');
         
         if (type === 'hr') {
             if (p) p.remove();
             li.tabIndex = 0;
             li.focus();
         } else if (type === 'latex') {
             // Special handling for latex type
             if (!p) {
                 p = document.createElement('p');
                 p.setAttribute('contenteditable', 'true');
                 p.textContent = DEFAULT_LATEX;
                 li.prepend(p);
             } else if (!p.textContent.trim()) {
                 // If paragraph is empty, add default LaTeX
                 p.textContent = DEFAULT_LATEX;
             }
             setupParagraph(p, li);
             focusAndMoveCursor(p, false);
         } else {
             if (!p) {
                 p = document.createElement('p');
                 p.setAttribute('contenteditable', 'true');
                 p.innerHTML = '<br>';
                 li.prepend(p);
             }
             setupParagraph(p, li);
             li.removeAttribute('tabindex');
             focusAndMoveCursor(p, false);
         }
         
         handleContentChange();
         
         if (li.parentElement) makeEditableAndInteractive(li.parentElement);
    }

     function findParentLink(node) {
        while (node && node !== outlineContainer) { if (node.tagName === 'A') return node; node = node.parentNode; } return null;
    }

    function wrapSelection(tagName) {
        const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) { alert(`Please select the text you want to wrap with ${tagName}.`); return; }
        const range = selection.getRangeAt(0); const editorP = range.commonAncestorContainer.closest('p[contenteditable="true"]');
        if (!editorP || !outlineContainer.contains(editorP)) { console.warn("Selection is not within an editable paragraph."); return; }
        const wrapper = document.createElement(tagName);
        try { let parentElement = range.commonAncestorContainer; if (parentElement.nodeType !== Node.ELEMENT_NODE) parentElement = parentElement.parentElement; if (parentElement?.tagName.toLowerCase() === tagName && range.toString() === parentElement.textContent) { console.log(`Unwrapping ${tagName}`); let content = range.extractContents(); parentElement.replaceWith(content); } else { console.log(`Wrapping selection with ${tagName}`); range.surroundContents(wrapper); } }
        catch (e) { console.warn("Wrap failed, using insertHTML fallback:", e); const selectedHtml = range.toString(); document.execCommand('insertHTML', false, `<${tagName}>${escapeXml(selectedHtml)}</${tagName}>`); }
        editorP.focus(); handleContentChange();
    }


    // --- Outline Operation Implementations ---
    // ... (indentItem, outdentItem, moveItemUp, moveItemDown, deleteItem - no changes needed) ...
    function indentItem(li) {
        if (!li) return; const prevLi = li.previousElementSibling; if (!prevLi || prevLi.getAttribute('data-type') === 'hr') { console.log("Indent prevented: No valid previous sibling."); return; }
        console.log(`Indenting ${li.id} under ${prevLi.id}`);
        let targetUl = prevLi.querySelector(':scope > ul'); if (!targetUl) { targetUl = document.createElement('ul'); prevLi.appendChild(targetUl); }
        const oldParentUl = li.parentElement;
        targetUl.appendChild(li);
        selectAndFocusItem(li, false); handleContentChange();
        addFoldingToggle(prevLi, true);
        if (oldParentUl) makeEditableAndInteractive(oldParentUl);
        if (prevLi.parentElement) makeEditableAndInteractive(prevLi.parentElement);
    }

    function outdentItem(li) {
        if (!li) return; const parentUl = li.parentElement; if (!parentUl || parentUl === rootUlElement) { console.log("Outdent prevented: Item is already at top level."); return; }
        const grandparentLi = parentUl.closest('li'); if (!grandparentLi) { console.error("Outdent error: Could not find grandparent LI."); return; }
        console.log(`Outdenting ${li.id} from under ${grandparentLi.id}`);
        let subUl = li.querySelector(':scope > ul'); const siblingsToMove = []; let nextSibling = li.nextElementSibling;
        while (nextSibling) { siblingsToMove.push(nextSibling); nextSibling = nextSibling.nextElementSibling; }
        if (siblingsToMove.length > 0) { if (!subUl) { subUl = document.createElement('ul'); li.appendChild(subUl); } siblingsToMove.forEach(sib => subUl.appendChild(sib)); console.log(`Moved ${siblingsToMove.length} subsequent siblings under ${li.id}`); }
        const originalGrandparentUl = grandparentLi.parentElement;
        grandparentLi.after(li);
        addFoldingToggle(li, !!li.querySelector(':scope > ul > li'));
        const oldParentIsEmpty = parentUl.children.length === 0;
        if (oldParentIsEmpty) { console.log(`Removing empty parent UL from ${grandparentLi.id}`); parentUl.remove(); addFoldingToggle(grandparentLi, false);
        }
        addFoldingToggle(grandparentLi, !!grandparentLi.querySelector(':scope > ul > li'));
        selectAndFocusItem(li, false); handleContentChange();
        if (originalGrandparentUl) makeEditableAndInteractive(originalGrandparentUl);
        if (li.parentElement) makeEditableAndInteractive(li.parentElement);
    }

    function moveItemUp(li) {
        if (!li) return; const prevLi = li.previousElementSibling;
        if (prevLi) { console.log(`Moving ${li.id} up above ${prevLi.id}`); li.parentElement.insertBefore(li, prevLi); selectListItem(li); ensureFocusInEditableParagraph(li); handleContentChange(); }
        else { console.log("Move up prevented: Already first item in its list."); }
    }
    function moveItemDown(li) {
        if (!li) return; const nextLi = li.nextElementSibling;
        if (nextLi) { console.log(`Moving ${li.id} down below ${nextLi.id}`); li.parentElement.insertBefore(nextLi, li); selectListItem(li); ensureFocusInEditableParagraph(li); handleContentChange(); }
        else { console.log("Move down prevented: Already last item in its list."); }
    }

    function deleteItem(li) {
         if (!li || !outlineContainer.contains(li)) return;
         console.log(`Attempting to delete item: ${li.id}`);
         let itemToSelectAfter = findPreviousVisibleLi(li) || findNextVisibleLi(li);
         const parentUl = li.parentElement; const parentLi = parentUl?.closest('li');
         const wasLastInParent = !li.nextElementSibling && parentUl !== rootUlElement;
         if(wasLastInParent && parentLi) itemToSelectAfter = parentLi;

         li.remove();
         if(currentlySelectedLi === li) currentlySelectedLi = null;

         if (parentLi && parentUl && parentUl !== rootUlElement && parentUl.children.length === 0) {
              console.log("Removing empty parent UL and checking parent fold toggle."); parentUl.remove(); addFoldingToggle(parentLi, false);
         } else if (parentLi && parentUl && parentUl !== rootUlElement) { makeEditableAndInteractive(parentUl); }

         if (rootUlElement && rootUlElement.children.length === 0) { console.log("Outline is now empty, resetting state."); resetEditorState('empty'); }
         else if (itemToSelectAfter && outlineContainer.contains(itemToSelectAfter)) { console.log(`Selecting item ${itemToSelectAfter.id} after deletion.`); selectAndFocusItem(itemToSelectAfter, false); }
         else if (rootUlElement?.firstElementChild) { const firstItem = rootUlElement.querySelector('li'); if (firstItem) { console.log("Selecting first item as fallback after deletion."); selectAndFocusItem(firstItem, true); } else { console.warn("Outline not empty but couldn't find item to select, resetting."); resetEditorState('empty'); } }
         else { console.warn("Root UL not found after deletion, resetting."); resetEditorState('empty'); }
         handleContentChange();
    }

    // --- Drag and Drop Implementation ---
    function setupDragListeners(li) {
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragend', handleDragEnd);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragleave', handleDragLeave);
        li.addEventListener('drop', handleDrop);
    }
    
    function handleDragStart(e) {
        if (isLoading || !outlineContainer.contains(e.target) || e.target.getAttribute('data-type') === 'hr') {
            e.preventDefault();
            return false;
        }
        
        currentlyDraggedLi = e.target.closest('li');
        if (!currentlyDraggedLi) {
            e.preventDefault();
            return false;
        }
        
        // Create a simple drag image
        const ghost = currentlyDraggedLi.cloneNode(true);
        ghost.style.opacity = '0.5';
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        
        // Clean up the ghost element after a short delay
        setTimeout(() => {
            document.body.removeChild(ghost);
        }, 0);
        
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', currentlyDraggedLi.id);
        currentlyDraggedLi.classList.add('dragging');
        
        // Create a drop indicator if it doesn't exist yet
        if (!dragDropIndicator) {
            dragDropIndicator = document.createElement('div');
            dragDropIndicator.className = 'drop-indicator';
            dragDropIndicator.style.position = 'absolute';
            dragDropIndicator.style.height = '3px';
            dragDropIndicator.style.backgroundColor = '#0d6efd';
            dragDropIndicator.style.zIndex = '1000';
            dragDropIndicator.style.pointerEvents = 'none';
            dragDropIndicator.style.display = 'none';
            document.body.appendChild(dragDropIndicator);
        }
        
        console.log(`Started dragging: ${currentlyDraggedLi.id}`);
    }
    
    function handleDragOver(e) {
        if (!currentlyDraggedLi) return;
        e.preventDefault(); // Allow drop
        e.dataTransfer.dropEffect = 'move';
        
        const dropTarget = e.target.closest('li');
        if (!dropTarget || !outlineContainer.contains(dropTarget) || dropTarget === currentlyDraggedLi) {
            hideDropIndicator();
            return;
        }
        
        // Calculate drop position (before, after, inside)
        const rect = dropTarget.getBoundingClientRect();
        const mouseY = e.clientY;
        const relativeY = mouseY - rect.top;
        const height = rect.height;
        
        let dropPosition;
        if (relativeY < height * 0.25) {
            // Drop before
            dropPosition = 'before';
        } else if (relativeY > height * 0.75) {
            // Drop after
            dropPosition = 'after';
        } else {
            // Drop inside as child
            dropPosition = 'inside';
        }
        
        // Check if we're trying to drop an item inside itself or its descendants
        if (dropPosition === 'inside' && isDescendantOf(dropTarget, currentlyDraggedLi)) {
            hideDropIndicator();
            return;
        }
        
        // Update the last target and position
        lastDropTarget = dropTarget;
        lastDropPosition = dropPosition;
        
        // Show visual indicator based on drop position
        showDropIndicator(dropTarget, dropPosition);
    }
    
    function handleDragEnter(e) {
        if (!currentlyDraggedLi) return;
        e.preventDefault();
    }
    
    function handleDragLeave(e) {
        if (!currentlyDraggedLi) return;
        const relatedTarget = e.relatedTarget;
        if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
            hideDropIndicator();
        }
    }
    
    function handleDrop(e) {
        if (!currentlyDraggedLi) return;
        e.preventDefault();
        e.stopPropagation();
        
        const dropTarget = lastDropTarget;
        const dropPosition = lastDropPosition;
        
        if (!dropTarget || !outlineContainer.contains(dropTarget) || !dropPosition) {
            hideDropIndicator();
            return;
        }
        
        // Don't drop on self or if trying to drop parent inside child
        if (dropTarget === currentlyDraggedLi || 
            (dropPosition === 'inside' && isDescendantOf(dropTarget, currentlyDraggedLi))) {
            hideDropIndicator();
            return;
        }
        
        console.log(`Dropping ${currentlyDraggedLi.id} ${dropPosition} ${dropTarget.id}`);
        
        // Perform the move
        const moved = moveItemToTarget(currentlyDraggedLi, dropTarget, dropPosition);
        
        // Clean up
        hideDropIndicator();
        
        if (moved) {
            selectAndFocusItem(currentlyDraggedLi, false);
            handleContentChange(); // Mark as dirty
        }
    }
    
    function handleDragEnd(e) {
        if (!currentlyDraggedLi) return;
        currentlyDraggedLi.classList.remove('dragging');
        hideDropIndicator();
        currentlyDraggedLi = null;
        lastDropTarget = null;
        lastDropPosition = null;
    }
    
    function moveItemToTarget(draggedItem, targetItem, position) {
        if (!draggedItem || !targetItem || !outlineContainer.contains(draggedItem) || 
            !outlineContainer.contains(targetItem)) {
            return false;
        }
        
        try {
            const parentUl = draggedItem.parentElement;
            
            switch (position) {
                case 'before':
                    targetItem.parentElement.insertBefore(draggedItem, targetItem);
                    break;
                case 'after':
                    if (targetItem.nextElementSibling) {
                        targetItem.parentElement.insertBefore(draggedItem, targetItem.nextElementSibling);
                    } else {
                        targetItem.parentElement.appendChild(draggedItem);
                    }
                    break;
                case 'inside':
                    // Need to add as first child
                    let targetUl = targetItem.querySelector(':scope > ul');
                    if (!targetUl) {
                        targetUl = document.createElement('ul');
                        targetItem.appendChild(targetUl);
                    }
                    targetUl.insertBefore(draggedItem, targetUl.firstChild);
                    
                    // Add folding toggle if not already there
                    addFoldingToggle(targetItem, true);
                    
                    // Unfold the target if it was folded
                    if (targetItem.getAttribute('data-folded') === 'true') {
                        targetItem.removeAttribute('data-folded');
                    }
                    break;
            }
            
            // Check if old parent UL is now empty and clean up if needed
            if (parentUl && parentUl !== rootUlElement && parentUl.children.length === 0) {
                const parentLi = parentUl.closest('li');
                if (parentLi) {
                    parentUl.remove();
                    addFoldingToggle(parentLi, false);
                }
            }
            
            return true;
            
        } catch (err) {
            console.error('Error during drag and drop move:', err);
            return false;
        }
    }
    
    function showDropIndicator(target, position) {
        if (!dragDropIndicator || !target) return;
        
        const rect = target.getBoundingClientRect();
        dragDropIndicator.style.width = `${rect.width}px`;
        
        switch (position) {
            case 'before':
                dragDropIndicator.style.left = `${rect.left}px`;
                dragDropIndicator.style.top = `${rect.top - 2}px`;
                dragDropIndicator.style.display = 'block';
                break;
            case 'after':
                dragDropIndicator.style.left = `${rect.left}px`;
                dragDropIndicator.style.top = `${rect.bottom - 1}px`;
                dragDropIndicator.style.display = 'block';
                break;
            case 'inside':
                dragDropIndicator.style.display = 'none';
                target.classList.add('drop-target-inside');
                break;
        }
        
        // Remove inside highlighting from previous targets
        document.querySelectorAll('.drop-target-inside').forEach(el => {
            if (el !== target) el.classList.remove('drop-target-inside');
        });
    }
    
    function hideDropIndicator() {
        if (dragDropIndicator) {
            dragDropIndicator.style.display = 'none';
        }
        // Remove any inside highlighting
        document.querySelectorAll('.drop-target-inside').forEach(el => {
            el.classList.remove('drop-target-inside');
        });
        lastDropTarget = null;
        lastDropPosition = null;
    }
    
    function isDescendantOf(child, parent) {
        let node = child.parentElement;
        while (node) {
            if (node === parent) return true;
            node = node.parentElement;
        }
        return false;
    }

    // --- Utility ---
    // ... (generateUniqueId - no changes needed) ...
    function generateUniqueId(length = 4) {
        const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        let id='', attempts=0; const maxAttempts = 100;
        do { id = chars.charAt(Math.floor(Math.random()*chars.length)); for(let i=1; i<length; i++) id += (chars+'0123456789').charAt(Math.floor(Math.random()*(chars.length+10))); attempts++; } while(document.getElementById(id) && attempts < maxAttempts);
        if(attempts >= maxAttempts) { console.warn("Could not generate unique ID, using fallback."); return `gen_${Date.now()}_${Math.random().toString(36).substring(2,7)}`; }
        return id;
    }

});