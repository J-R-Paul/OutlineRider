document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const fileInput = document.getElementById('fileInput');
    const directFileAccessDiv = document.getElementById('directFileAccess');
    const openDirectButton = document.getElementById('openDirectButton');
    const saveDirectButton = document.getElementById('saveDirectButton');
    const newButton = document.getElementById('newButton');
    const saveAsButton = document.getElementById('saveAsButton');
    const outlineContainer = document.getElementById('outlineContainer');
    const toolbar = document.getElementById('toolbar');
    const currentFileNameSpan = document.getElementById('currentFileName');
    const clearLocalButton = document.getElementById('clearLocalButton');
    const initialMessageDiv = document.getElementById('initialMessage');

    // --- State Variables ---
    let rootUlElement = null;
    let currentlySelectedLi = null;
    let directFileHandle = null; // Standard FSA handle
    let fileSystemWorker = null; // Web Worker
    let opfsRoot = null; // OPFS root handle cache
    let isOpfsAvailable = false;
    let currentFileSource = 'loading'; // 'loading', 'direct', 'opfs', 'copy', 'new', 'draft', 'empty'
    let autoSaveOpfsTimeout = null;
    let autoSaveDraftTimeout = null;
    let isDirty = false;
    let opfsSaveInProgress = false;
    let lastFocusedElement = null; // Track last focused paragraph for restoration

    // --- Constants ---
    const OPFS_FILENAME = 'current_session.bike';
    const LOCAL_STORAGE_KEY = 'bikeEditorProDraft_v3'; // Increment key version
    const AUTOSAVE_OPFS_DELAY = 2500;
    const AUTOSAVE_DRAFT_DELAY = 750; // Slightly longer draft delay

    // --- Feature Detection & Initial Setup ---
    async function initialize() {
        console.log("Initializing Bike Editor Pro v3...");

        // Check Direct Access API
        if ('showOpenFilePicker' in window && 'createWritable' in FileSystemFileHandle.prototype) {
            console.log("Direct File Access API supported.");
            directFileAccessDiv.style.display = 'flex';
        } else {
            console.warn("Direct File Access API not supported.");
            directFileAccessDiv.style.display = 'none';
        }

        // Check OPFS & Init Worker
        if ('storage' in navigator && 'getDirectory' in navigator.storage) {
            try {
                opfsRoot = await navigator.storage.getDirectory();
                fileSystemWorker = new Worker('worker.js');
                fileSystemWorker.onmessage = handleWorkerMessage;
                fileSystemWorker.onerror = (err) => console.error("Worker Error:", err);
                isOpfsAvailable = true;
                console.log("OPFS Initialized & Worker Started.");
            } catch (err) {
                console.error("OPFS Initialization Failed:", err); isOpfsAvailable = false;
                // Non-blocking alert, initialization continues
                setTimeout(() => alert(`Could not initialize App Storage (OPFS): ${err.message}\nDrafts will use temporary browser storage.`), 100);
            }
        } else {
            console.warn("OPFS API not supported."); isOpfsAvailable = false;
        }

        // --- Load Initial Content ---
        let loadedContent = false;
        if (isOpfsAvailable) {
            try {
                const handle = await opfsRoot.getFileHandle(OPFS_FILENAME);
                const file = await handle.getFile();
                const content = await file.text();
                // Basic validation: Check for <html> tag and non-empty content
                if (content && content.trim().length > 10 && content.includes('<html')) {
                    parseAndRenderBike(content);
                    currentFileSource = 'opfs';
                    console.log(`Loaded from OPFS: ${OPFS_FILENAME}`);
                    loadedContent = true; markAsClean();
                } else if (content) {
                     console.warn(`OPFS file ${OPFS_FILENAME} content seems invalid/empty.`);
                }
            } catch (err) {
                if (err.name !== 'NotFoundError') {
                    console.error(`Error loading initial OPFS file ${OPFS_FILENAME}:`, err);
                    alert(`Error loading saved session: ${err.message}`);
                } else { console.log(`OPFS file ${OPFS_FILENAME} not found.`); }
            }
        }

        // Try draft if OPFS load failed
        if (!loadedContent) {
            const storedDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (storedDraft && storedDraft.length > 100 && storedDraft.includes('<html')) {
                 console.log("Found potentially valid draft.");
                 if (confirm("Load unsaved draft from temporary storage?")) {
                    try {
                        parseAndRenderBike(storedDraft);
                        currentFileSource = 'draft'; isDirty = true; loadedContent = true;
                        console.log("Loaded draft from localStorage.");
                    } catch (draftError) {
                        console.error("Error parsing draft:", draftError); alert("Could not load draft, it might be corrupted.");
                        clearLocalStorage(false);
                    }
                 } else { console.log("User chose not to load draft."); clearLocalStorage(false); }
            }
        }

        // Start empty if nothing loaded
        if (!loadedContent) {
            console.log("Starting empty.");
            currentFileSource = 'empty';
            resetEditorContent(); // Show initial message
            markAsClean();
        }

        // Ensure initial UI state is correct *after* loading attempts
        updateFileStateUI();
        if (loadedContent) selectFirstItem(); // Select first item if content loaded

        // Add beforeunload listener
         window.addEventListener('beforeunload', (event) => {
             // Force a final draft save attempt synchronously if dirty
             if (isDirty) saveDraftToLocalStorage();
             // Warn only if proper saving is possible and changes exist
             if (isDirty && (currentFileSource === 'direct' || isOpfsAvailable)) {
                 const message = "You have unsaved changes. Leave page?";
                 event.returnValue = message; return message;
             }
         });

        console.log("Initialization complete. Source:", currentFileSource);
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoadFromInput);
    openDirectButton.addEventListener('click', openFileDirectly);
    saveDirectButton.addEventListener('click', saveFileDirectly);
    newButton.addEventListener('click', () => createNew(false)); // Explicitly pass false
    saveAsButton.addEventListener('click', saveFileAsDownload);
    clearLocalButton.addEventListener('click', clearLocalStorage);
    toolbar.addEventListener('click', handleToolbarClick);
    outlineContainer.addEventListener('keydown', handleKeyDown);
    // Track focus changes more carefully
    outlineContainer.addEventListener('focusout', (e) => {
         if (e.target.isContentEditable) {
             lastFocusedElement = e.target;
             // console.log('Focus out:', lastFocusedElement);
         }
    });
    outlineContainer.addEventListener('focusin', (e) => {
         if (e.target.isContentEditable) {
             lastFocusedElement = e.target;
              // console.log('Focus in:', lastFocusedElement);
              handleFocusIn(e); // Call existing selection logic
         }
    });
    outlineContainer.addEventListener('input', handleContentChange);
    outlineContainer.addEventListener('click', handleOutlineClick);

    // --- Initial Load ---
    initialize();

    // --- State Management & UI Updates ---

    function handleContentChange(event) {
        if (event?.target?.isContentEditable === false) return; // Ignore non-editable changes
        if (!isDirty) { isDirty = true; updateFileStateUI(); }
        triggerOpfsAutoSave();
        triggerLocalStorageDraftSave();
    }

    function markAsClean() {
        if (isDirty) { isDirty = false; opfsSaveInProgress = false; updateFileStateUI(); }
        // Clear draft AFTER successful primary save (handled in save functions)
    }

    function updateFileStateUI() {
        let statusText = "";
        let saveDirectEnabled = false;
        const hasContent = !!rootUlElement && outlineContainer.contains(rootUlElement);

        switch (currentFileSource) {
            case 'loading': statusText = "Loading..."; break;
            case 'direct': statusText = directFileHandle?.name || "Direct File"; saveDirectEnabled = true; break;
            case 'opfs': case 'copy': case 'new': case 'draft':
                 statusText = isOpfsAvailable ? "App Session" : "Unsaved (Draft)"; break;
            case 'empty': statusText = "Empty Document"; break;
            default: statusText = "No file open";
        }
        if (isDirty && (currentFileSource === 'direct' || isOpfsAvailable)) statusText += "*";

        currentFileNameSpan.textContent = statusText; currentFileNameSpan.title = statusText;
        saveDirectButton.disabled = !saveDirectEnabled;

        // Show initial message only if editor is truly empty
        if (hasContent && initialMessageDiv.parentNode === outlineContainer) {
            initialMessageDiv.remove();
        } else if (!hasContent && !document.getElementById('initialMessage')) {
            outlineContainer.innerHTML = ''; // Clear remnants
            outlineContainer.prepend(initialMessageDiv);
            initialMessageDiv.style.display = 'block';
            // Fix: Ensure "Loading..." changes after init if empty
            if (currentFileSource === 'empty' || currentFileSource === 'loading') {
                 initialMessageDiv.querySelector('p').textContent = "Editor is empty. Start typing or load a file.";
            }
        }
        // Fix: Update initial text if loading finished but resulted in empty
         if (currentFileSource === 'empty' && document.getElementById('initialMessage')) {
             initialMessageDiv.querySelector('p').textContent = "Editor is empty. Start typing or load a file.";
         }
    }

    function resetEditorContent() {
        outlineContainer.innerHTML = '';
        if (!document.getElementById('initialMessage') && initialMessageDiv) {
            outlineContainer.prepend(initialMessageDiv);
        }
        initialMessageDiv.style.display = 'block';
        initialMessageDiv.querySelector('p').textContent = "Editor is empty. Start typing or load a file."; // Set default empty message
        rootUlElement = null; currentlySelectedLi = null; lastFocusedElement = null;
        clearTimeout(autoSaveOpfsTimeout); clearTimeout(autoSaveDraftTimeout);
    }

    // --- File Handling ---

    async function checkUnsavedChanges(actionDescription = "perform this action") {
        if (isDirty && (currentFileSource === 'direct' || isOpfsAvailable)) {
            // Try a quick final save before prompting
             saveDraftToLocalStorage(); // Always save draft just in case
            if (currentFileSource === 'direct') await saveFileDirectly(true);
            else if (isOpfsAvailable) await saveCurrentToOpfs(true);
             // Re-check after save attempt
             if (!isDirty) return true;
            return confirm(`You have unsaved changes. ${actionDescription} anyway?`);
        }
        return true;
    }

    async function handleFileLoadFromInput(event) {
        const file = event.target.files[0]; if (!file) return;
        if (!await checkUnsavedChanges(`Load '${file.name}' and overwrite current session`)) { fileInput.value = ''; return; }
        console.log(`Loading file from input: ${file.name}`);
        try {
            const fileContent = await file.text();
            resetEditorContent(); parseAndRenderBike(fileContent);
            directFileHandle = null; currentFileSource = 'copy'; isDirty = true;
            updateFileStateUI();
            if (isOpfsAvailable) {
                 console.log("Saving loaded copy to OPFS...");
                 await saveCurrentToOpfs(true);
                 if (!isDirty) currentFileSource = 'opfs'; // Update source only if save succeeded
            } else { triggerLocalStorageDraftSave(); }
             console.log(`Loaded '${file.name}' as new session.`); selectFirstItem();
        } catch (err) {
            console.error(`Error processing loaded file ${file.name}:`, err); alert(`Error loading file: ${err.message}`);
            createNew(true); // Start fresh after error
        } finally { fileInput.value = ''; }
    }

    async function createNew(skipConfirm = false) {
        if (!skipConfirm && !await checkUnsavedChanges("Start a new document")) return;
        console.log("Creating new document.");
        resetEditorContent(); createMinimalStructure();
        directFileHandle = null; currentFileSource = 'new'; isDirty = true;
        updateFileStateUI();
        if (isOpfsAvailable) {
            console.log("Saving empty structure to OPFS...");
             await saveCurrentToOpfs(true);
             if (!isDirty) currentFileSource = 'opfs';
        } else { triggerLocalStorageDraftSave(); }
        selectFirstItem();
    }

    function saveFileAsDownload() { /* (Keep existing implementation) */
        if (!rootUlElement) return alert("Nothing to download.");
        try {
            const bikeHTML = serializeOutlineToHTML(); if (!bikeHTML) throw new Error("Serialization failed.");
            const blob = new Blob([bikeHTML], { type: 'application/xhtml+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url;
            let filename = 'outline';
            if (directFileHandle?.name) filename = directFileHandle.name;
            else if (currentFileSource === 'opfs') filename = "App Session";
            a.download = fixFileName(filename); document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            console.log("Download initiated:", a.download);
        } catch (err) { console.error("Save As failed:", err); alert(`Download failed: ${err.message}`); }
    }
    function fixFileName(name, defaultExt = '.bike') { /* (Keep existing) */
        let n = name.trim() || "untitled"; n = n.replace(/[.\/]+$/, '');
        const exts = ['.bike','.html','.xhtml','.xml']; if (!exts.some(e=>n.toLowerCase().endsWith(e))) n+=defaultExt; return n;
    }

    // --- Standard File System Access API (Direct Edit) ---

    async function openFileDirectly() { /* (Keep existing implementation) */
        if (!('showOpenFilePicker' in window)) return;
        if (!await checkUnsavedChanges("open a new file directly")) return;
        try {
            const [handle] = await window.showOpenFilePicker({ types: [{ description:'Bike Files', accept:{'application/xhtml+xml':['.bike','.html','.xhtml'],'text/xml':['.xml']}}] });
            const file = await handle.getFile(); const content = await file.text();
            resetEditorContent(); parseAndRenderBike(content);
            directFileHandle = handle; currentFileSource = 'direct'; markAsClean();
            updateFileStateUI(); console.log("Opened directly:", handle.name); selectFirstItem();
        } catch (err) {
            if(err.name !== 'AbortError') { console.error("Error opening directly:", err); alert(`Direct open failed: ${err.message}`); createNew(true); }
            else { console.log("User cancelled direct open."); }
        }
    }

    async function saveFileDirectly(suppressErrors = false) { /* (Keep existing implementation) */
        if (!directFileHandle || currentFileSource !== 'direct') { if (!suppressErrors) alert("No direct file active."); return false; }
        if (!isDirty && !suppressErrors) { console.log("Save Direct: No changes."); return true; }
        if (!rootUlElement && !suppressErrors) { alert("Cannot save empty content directly."); return false; }
        setSavingIndicator('saveDirectButton', true, 'Saving...'); let success = false;
        try {
            const bikeHTML = serializeOutlineToHTML(); if (!bikeHTML) throw new Error("Serialization failed.");
            if (await directFileHandle.queryPermission({ mode:'readwrite'}) !== 'granted') { if (await directFileHandle.requestPermission({ mode:'readwrite'}) !== 'granted') throw new Error("Write permission denied."); }
            const writable = await directFileHandle.createWritable(); await writable.write(bikeHTML); await writable.close();
            console.log("Saved directly:", directFileHandle.name); markAsClean(); clearLocalStorage(false); // Clear draft after direct save
            setSavingIndicator('saveDirectButton', false, 'Saved!'); setTimeout(() => setSavingIndicator('saveDirectButton', false, 'Save Direct'), 2000); success = true;
        } catch (err) {
            console.error("Save Direct failed:", err); if (!suppressErrors) alert(`Direct save failed: ${err.message}`);
            setSavingIndicator('saveDirectButton', false, 'Save Failed'); setTimeout(() => setSavingIndicator('saveDirectButton', false, 'Save Direct'), 2000); success = false;
        } return success;
    }

    // --- OPFS Auto-Save ---

    function triggerOpfsAutoSave() {
        if (!isOpfsAvailable || currentFileSource === 'direct' || !isDirty) return;
        clearTimeout(autoSaveOpfsTimeout);
        autoSaveOpfsTimeout = setTimeout(() => saveCurrentToOpfs(false), AUTOSAVE_OPFS_DELAY);
    }

    async function saveCurrentToOpfs(forceSave = false) {
        if (!isOpfsAvailable || currentFileSource === 'direct') return false;
        if (opfsSaveInProgress && !forceSave) { console.log("OPFS Save: Skipped, already saving."); return false; }
        if (!rootUlElement && !forceSave) { console.log("OPFS Save: Skipped empty content."); return true; }

        console.log(`OPFS: Preparing save ${OPFS_FILENAME}...`);
        opfsSaveInProgress = true; let success = false;
        try {
            const htmlContent = serializeOutlineToHTML();
            if (!htmlContent && !forceSave) { console.warn("OPFS Save: Empty serialization, skipping."); opfsSaveInProgress = false; return true; }
            if (!fileSystemWorker) throw new Error("Worker not available.");
            fileSystemWorker.postMessage({ action: 'save', fileName: OPFS_FILENAME, content: htmlContent }); // Use action 'save'
            success = true; // Message sent (actual save is async)
        } catch (err) {
            console.error(`OPFS: Error preparing save:`, err); alert(`Could not save session: ${err.message}`);
            opfsSaveInProgress = false; success = false;
        }
        return success;
    }

    function handleWorkerMessage(event) {
        const { success, fileName, error, skipped } = event.data;
        opfsSaveInProgress = false; // Release lock
        if (skipped) { console.log(`OPFS Save skipped by worker: ${fileName}.`); return; }
        if (success && fileName === OPFS_FILENAME) {
            console.log(`OPFS: Worker saved ${fileName}.`);
            if (currentFileSource !== 'direct') { markAsClean(); clearLocalStorage(false); } // Clear draft after OPFS save
        } else if (!success) {
            console.error(`OPFS: Worker failed to save ${fileName || 'file'}:`, error);
            alert(`App Storage save failed: ${error}\nChanges might only be in temporary draft.`);
        }
    }

    // --- Local Storage (Short-Term Draft) ---

    function triggerLocalStorageDraftSave() {
        clearTimeout(autoSaveDraftTimeout);
        if (isDirty) autoSaveDraftTimeout = setTimeout(saveDraftToLocalStorage, AUTOSAVE_DRAFT_DELAY);
    }
    function saveDraftToLocalStorage() {
        if (!isDirty) return;
        if (rootUlElement && outlineContainer.contains(rootUlElement) && !document.getElementById('initialMessage')) {
            try { const bikeHTML = serializeOutlineToHTML(); if (bikeHTML) localStorage.setItem(LOCAL_STORAGE_KEY, bikeHTML); }
            catch (error) { console.error("Error saving draft:", error); }
        } else { localStorage.removeItem(LOCAL_STORAGE_KEY); } // Clear draft if editor is empty
    }
    function clearLocalStorage(promptUser = true) { /* (Keep existing implementation) */
        let confirmClear = !promptUser; const draftExists = !!localStorage.getItem(LOCAL_STORAGE_KEY);
        if (promptUser && draftExists) confirmClear = confirm("Clear temporary browser draft?");
        if (confirmClear && draftExists) { localStorage.removeItem(LOCAL_STORAGE_KEY); console.log("Draft cleared."); }
        else if (confirmClear && !draftExists) console.log("No draft to clear.");
        else console.log("User cancelled clearing draft.");
    }

    // --- Parsing, Rendering, Serialization --- (Keep existing functions)
    function parseAndRenderBike(htmlString) { /* ... (same as before) ... */
        const parser = new DOMParser(); const doc = parser.parseFromString(htmlString, 'application/xhtml+xml');
        const parseError = doc.querySelector('parsererror'); if (parseError) throw new Error(`Parse Error: Invalid Bike/XML file.\n${parseError.textContent.split('\n')[0]}`);
        rootUlElement = doc.body?.querySelector('ul'); if (!rootUlElement) { /* ... (recovery logic) ... */ if (!rootUlElement) throw new Error('Could not find root <ul>.'); }
        outlineContainer.innerHTML = ''; outlineContainer.appendChild(document.importNode(rootUlElement, true));
        rootUlElement = outlineContainer.querySelector('ul'); makeEditableAndInteractive(outlineContainer); initialMessageDiv?.remove();
    }
    function makeEditableAndInteractive(container) { /* ... (same as before) ... */
        container.querySelectorAll('li').forEach(li => { if (!li.id) li.id = generateUniqueId(); const p = li.querySelector(':scope > p');
        if (li.getAttribute('data-type') === 'hr') { if (p) p.remove(); li.tabIndex = -1; } else if (!p) { const nP=document.createElement('p'); nP.setAttribute('contenteditable','true'); nP.innerHTML='<br>'; li.prepend(nP); setupParagraph(nP, li); } else { setupParagraph(p, li); } });
        if (rootUlElement && !rootUlElement.id) rootUlElement.id = generateUniqueId(5);
    }
    function setupParagraph(p, li) { /* ... (same as before) ... */
        p.setAttribute('contenteditable', 'true'); const taskType = li.getAttribute('data-type') === 'task'; let checkbox = p.querySelector('span.task-checkbox');
        if (taskType) { if (!checkbox) { checkbox = document.createElement('span'); checkbox.className = 'task-checkbox'; checkbox.setAttribute('contenteditable', 'false'); checkbox.setAttribute('aria-hidden', 'true'); p.prepend(document.createTextNode(' ')); p.prepend(checkbox); } checkbox.textContent = li.getAttribute('data-done') === 'true' ? '☑' : '☐'; }
        else { if (checkbox) checkbox.remove(); } if (!p.textContent.trim() && !p.querySelector('br') && !p.querySelector('img')) { p.innerHTML = '<br>'; }
    }
    function serializeOutlineToHTML() { /* ... (same as before) ... */
        if (!rootUlElement) return ""; if (document.activeElement?.isContentEditable) document.activeElement.blur(); const content = rootUlElement.cloneNode(true);
        content.querySelectorAll('.selected,[contenteditable],[tabindex],span.task-checkbox').forEach(el=>{el.classList.remove('selected');el.removeAttribute('contenteditable');el.removeAttribute('tabindex');if(el.classList.contains('task-checkbox'))el.remove();});
        content.querySelectorAll('ul:empty').forEach(ul=>ul.remove()); content.querySelectorAll('p').forEach(p=>{if(p.innerHTML.trim()==='<br>')p.innerHTML='';});
        let title='Bike Outline'; if(currentFileSource==='direct'&&directFileHandle?.name)title=directFileHandle.name; else if(isOpfsAvailable)title="App Session";
        const serializer=new XMLSerializer(); const ulHtml=serializer.serializeToString(content);
        return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml">\n  <head>\n    <meta charset="utf-8"/>\n    <title>${escapeXml(title)}</title>\n  </head>\n  <body>\n    ${ulHtml}\n  </body>\n</html>`;
    }
    function escapeXml(unsafe) { return unsafe.replace(/[<>&'"]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'})[c]||c); }

    // --- Selection & Focus ---
    function handleFocusIn(event) {
        const target = event.target; const li = target.closest('li');
        if (li && outlineContainer.contains(li)) { if ((target.tagName==='P'&&target.parentElement===li)||(target===li&&li.getAttribute('data-type')==='hr')) selectListItem(li); }
    }
    function selectListItem(liElement) {
        if (!liElement || !outlineContainer.contains(liElement) || currentlySelectedLi === liElement) return;
        if (currentlySelectedLi) { currentlySelectedLi.classList.remove('selected'); if(currentlySelectedLi.getAttribute('data-type')==='hr') currentlySelectedLi.removeAttribute('tabindex'); }
        currentlySelectedLi = liElement; currentlySelectedLi.classList.add('selected');
        if (currentlySelectedLi.getAttribute('data-type')==='hr') currentlySelectedLi.tabIndex = -1;
    }
    function getSelectedLi() { if (currentlySelectedLi && outlineContainer.contains(currentlySelectedLi)) return currentlySelectedLi; return outlineContainer.querySelector('li.selected'); }
    function getFocusedP() { const a = document.activeElement; if (a?.tagName === 'P' && a.isContentEditable && outlineContainer.contains(a)) return a; return null; }

    // --- Robust Focus Restoration ---
    function focusAndMoveCursor(element, toStart = true) {
         if (!element || !outlineContainer.contains(element)) {
             console.warn("focusAndMoveCursor: Target element not found or not in container.");
             // Fallback: try focusing the container itself
             outlineContainer.focus();
             return;
         }
         // Use rAF to ensure focus happens after potential browser layout/paint
         requestAnimationFrame(() => {
             // Double-check element still exists after async delay
             if (!document.body.contains(element)) {
                 console.warn("focusAndMoveCursor: Target element removed before focus could be set.");
                 outlineContainer.focus(); // Focus container as fallback
                 return;
             }

             element.focus(); // Set focus first
             try {
                 const selection = window.getSelection();
                 if (!selection) return; // Exit if no selection object (shouldn't happen)
                 const range = document.createRange();

                 // Handle empty element or element with just <br>
                 if (!element.firstChild || (element.firstChild === element.lastChild && element.firstChild.nodeName === 'BR')) {
                     range.setStart(element, 0);
                 } else {
                     // Select contents for non-empty elements
                     range.selectNodeContents(element);
                 }
                 range.collapse(toStart); // Collapse to start or end
                 selection.removeAllRanges(); // Clear existing selection
                 selection.addRange(range); // Apply new selection
             } catch (err) {
                 console.error("Error setting cursor position:", err);
                  // As a fallback, ensure the element still has focus
                 if (document.activeElement !== element) {
                      element.focus();
                 }
             }
         });
     }
     // Helper function to restore focus to the last known editable element
     function restoreFocus(preferStart = false) {
         const li = getSelectedLi(); // Get current selection
         let target = lastFocusedElement;

          // If lastFocusedElement isn't valid anymore, try the selected LI's P
         if (!target || !outlineContainer.contains(target)) {
             target = li?.querySelector(':scope > p[contenteditable="true"]');
         }
          // If still no target, maybe focus selected LI (for HR) or container
         if (!target && li && outlineContainer.contains(li)) {
              if(li.getAttribute('data-type') === 'hr') li.focus();
              else outlineContainer.focus(); // Fallback to container
         } else if (target) {
              focusAndMoveCursor(target, preferStart);
         } else {
             outlineContainer.focus(); // Absolute fallback
         }
     }

     // --- Keyboard Navigation & Editing ---
     function handleKeyDown(event) { /* (Keep existing case logic from previous response, ensure restoreFocus is used appropriately) */
        const selectedLi = getSelectedLi();
        const targetP = getFocusedP();

         if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { /* ... (save logic) ... */ event.preventDefault(); if(currentFileSource==='direct'&&directFileHandle)saveFileDirectly(); else if(isOpfsAvailable)saveCurrentToOpfs(true); else if(rootUlElement)saveFileAsDownload(); return; }
         if (!rootUlElement && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); createFirstItem(); return; }
         if (!selectedLi && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) { if(outlineContainer===document.activeElement&&event.key==='Enter'){event.preventDefault();createFirstItem();return;} return; }

        switch (event.key) {
            case 'Enter': /* ... (create new item/line break logic) ... */ if (!selectedLi) { event.preventDefault(); createFirstItem(); return; } if (event.shiftKey) { if (targetP) { event.preventDefault(); document.execCommand('insertLineBreak'); handleContentChange(); } } else { event.preventDefault(); createNewItem(selectedLi); } break;
            case 'Tab': /* ... (indent/outdent logic, call restoreFocus if needed) ... */ if (!selectedLi) return; event.preventDefault(); if (event.shiftKey) outdentItem(selectedLi); else indentItem(selectedLi); break;
            case 'ArrowUp': /* ... (nav/move logic) ... */ if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) { const prev = selectedLi ? findPreviousVisibleLi(selectedLi) : rootUlElement?.querySelector('li:last-child'); if (prev) { event.preventDefault(); selectAndFocusItem(prev, false); } } else if (event.altKey && event.shiftKey && selectedLi) { event.preventDefault(); moveItemUp(selectedLi); } break;
            case 'ArrowDown': /* ... (nav/move logic) ... */ if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) { const next = selectedLi ? findNextVisibleLi(selectedLi) : rootUlElement?.querySelector('li:first-child'); if (next) { event.preventDefault(); selectAndFocusItem(next, false); } } else if (event.altKey && event.shiftKey && selectedLi) { event.preventDefault(); moveItemDown(selectedLi); } break;
            case 'Backspace': case 'Delete': /* ... (delete logic) ... */ if (!selectedLi) return; const isHr=selectedLi.getAttribute('data-type')==='hr'&&document.activeElement===selectedLi; const isEmpty=targetP&&(!targetP.textContent||targetP.innerHTML==='<br>'); if(isEmpty||(event.key==='Delete'&&isHr)){ event.preventDefault(); deleteItem(selectedLi); } break;
            case 'b': if ((event.ctrlKey || event.metaKey) && selectedLi) { event.preventDefault(); formatSelection('bold'); } break;
            case 'i': if ((event.ctrlKey || event.metaKey) && selectedLi) { event.preventDefault(); formatSelection('italic'); } break;
            case 'k': if ((event.ctrlKey || event.metaKey) && selectedLi) { event.preventDefault(); handleLinkButtonClick(selectedLi); } break;
        }
    }
    function formatSelection(command) { /* (Ensure restoreFocus(false) is called after execCommand) */
         const targetP = ensureFocusInEditableParagraph(getSelectedLi()); if (!targetP) return;
         const selState = saveSelection(targetP); // Save selection before command
         if (command === 'highlight') wrapSelection('mark');
         else if (command === 'code') wrapSelection('code');
         else document.execCommand(command, false, null);
         handleContentChange();
         restoreSelection(targetP, selState); // Restore selection after command
         // restoreFocus(false); // No, restoreSelection handles focus
    }
     function createFirstItem() { /* (Keep existing) */ if (rootUlElement) return; createMinimalStructure(); currentFileSource='empty'; isDirty=false; updateFileStateUI(); selectAndFocusItem(rootUlElement.querySelector('li'),true); }
     function createMinimalStructure() { /* (Keep existing) */ rootUlElement = document.createElement('ul'); rootUlElement.id=generateUniqueId(5); const li=document.createElement('li'); li.id=generateUniqueId(); const p=document.createElement('p'); p.setAttribute('contenteditable','true'); p.innerHTML='<br>'; li.appendChild(p); rootUlElement.appendChild(li); outlineContainer.innerHTML=''; outlineContainer.appendChild(rootUlElement); setupParagraph(p, li); initialMessageDiv?.remove(); }
     function createNewItem(currentItemLi) { /* (Ensure restoreFocus(true) is called) */ if (!currentItemLi) return; const li = document.createElement('li'); li.id=generateUniqueId(); const p=document.createElement('p'); p.setAttribute('contenteditable','true'); p.innerHTML='<br>'; li.appendChild(p); currentItemLi.after(li); setupParagraph(p, li); selectAndFocusItem(li, true); handleContentChange(); }

    // --- Navigation & Focus Helpers ---
     function selectAndFocusItem(li, focusStart = true) { /* (Keep existing) */ if (!li) return; selectListItem(li); const p = li.querySelector(':scope > p[contenteditable="true"]'); if (p) focusAndMoveCursor(p, focusStart); else if (li.getAttribute('data-type') === 'hr') li.focus(); }
     // focusAndMoveCursor is updated above
     function findPreviousVisibleLi(li) { /* (Keep existing) */ let c = li?.previousElementSibling; if (c) { while(true){ const l=c.querySelector(':scope > ul > li:last-child'); if(l)c=l; else break;} return c;} else if(li){ const p=li.parentElement; if(p&&p!==rootUlElement) return p.closest('li');} return null; }
     function findNextVisibleLi(li) { /* (Keep existing) */ if (!li) return rootUlElement?.querySelector('li:first-child'); const fc=li.querySelector(':scope > ul > li:first-child'); if(fc) return fc; let c=li; while(c){ const s=c.nextElementSibling; if(s) return s; const p=c.parentElement; if(p&&p!==rootUlElement) c=p.closest('li'); else c=null;} return null; }

    // --- Toolbar & Click Actions ---
     function handleOutlineClick(event) { /* (Keep existing) */ const cb=event.target.closest('span.task-checkbox'); if(cb&&outlineContainer.contains(cb)){const li=cb.closest('li'); if(li&&li.getAttribute('data-type')==='task')toggleTaskDone(li);} }
     function toggleTaskDone(li) { /* (Keep existing) */ if(!li) return; const d=li.getAttribute('data-done')==='true'; const cb=li.querySelector('span.task-checkbox'); if(d){li.removeAttribute('data-done');if(cb)cb.textContent='☐';} else {li.setAttribute('data-done','true');if(cb)cb.textContent='☑';} handleContentChange(); }
     function handleToolbarClick(event) { /* (Ensure functions called handle focus/selection) */
        const button = event.target.closest('button'); if (!button) return;
        const selectedLi = getSelectedLi(); const needsSel = button.classList.contains('type-button')||['indentButton','outdentButton','moveUpButton','moveDownButton','deleteButton','linkButton'].includes(button.id);
        if (needsSel && !selectedLi) return alert("Please select an item first.");
        // Formatting
        if (button.classList.contains('format-button')) { formatSelection(button.dataset.command); } // formatSelection handles focus
        else if (button.id === 'linkButton') handleLinkButtonClick(selectedLi); // handleLinkButton handles focus
        else if (button.classList.contains('type-button')) changeItemType(selectedLi, button.dataset.type); // changeItemType handles focus
        else if (button.id === 'indentButton') indentItem(selectedLi); // These handle focus inside
        else if (button.id === 'outdentButton') outdentItem(selectedLi);
        else if (button.id === 'moveUpButton') moveItemUp(selectedLi);
        else if (button.id === 'moveDownButton') moveItemDown(selectedLi);
        else if (button.id === 'deleteButton') deleteItem(selectedLi); // deleteItem handles focus
    }
     function ensureFocusInEditableParagraph(selectedLi) { /* (Keep existing) */ let p=getFocusedP(); if(!p&&selectedLi){p=selectedLi.querySelector(':scope > p[contenteditable="true"]'); if(p) p.focus();} if(!p||p.contentEditable!=='true'){alert("Please place cursor inside item text.");return null;} return p; }
     function handleLinkButtonClick(selectedLi = getSelectedLi()) { /* (Ensure restoreFocus/Selection) */
        const targetP = ensureFocusInEditableParagraph(selectedLi); if (!targetP) return;
        const selState = saveSelection(targetP); // Save selection
        const selection = window.getSelection(); const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const currentLink = range ? findParentLink(range.startContainer) : null;
        const defaultUrl = currentLink ? currentLink.href : "https://";
        const url = prompt("Link URL:", defaultUrl); if (url === null) { restoreSelection(targetP, selState); return; } // Restore selection on cancel
        // Restore selection before execCommand (needed after prompt)
        restoreSelection(targetP, selState);
        if (currentLink) document.execCommand('unlink', false, null);
        if (url !== "") {
            if (selection && !selection.isCollapsed) document.execCommand('createLink', false, url);
            else document.execCommand('insertHTML', false, `<a href="${escapeXml(url)}">${escapeXml(url)}</a>`);
        }
        handleContentChange();
        // Focus/selection should be okay after execCommand, but maybe restore again?
        restoreFocus(false); // Restore focus to end of modification
    }
    function changeItemType(li, type) { /* (Ensure restoreFocus) */
         if (!li) return; const oldType = li.getAttribute('data-type'); if (type === oldType) return;
         const targetP = li.querySelector(':scope > p');
         const hadFocus = targetP && document.activeElement === targetP;
         const selState = hadFocus ? saveSelection(targetP) : null;

         if (type) li.setAttribute('data-type', type); else li.removeAttribute('data-type');
         let p = li.querySelector(':scope > p'); // Re-query in case it was removed/added

         if (type === 'hr') { if (p) p.remove(); li.tabIndex = -1; li.focus(); }
         else { if (!p) { p = document.createElement('p'); li.prepend(p); } setupParagraph(p, li); li.removeAttribute('tabindex');
            // Restore focus only if it was there before, otherwise focus end
            if (hadFocus && selState) restoreSelection(p, selState);
            else focusAndMoveCursor(p, false);
         }
         handleContentChange();
    }
     function findParentLink(node) { /* (Keep existing) */ while(node&&node!==outlineContainer){if(node.tagName==='A')return node;node=node.parentNode;}return null; }
     function wrapSelection(tagName) { /* (Ensure restoreFocus/Selection) */
        const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0); const editorP = range.commonAncestorContainer.closest('p[contenteditable="true"]');
        if (!editorP || !outlineContainer.contains(editorP)) return;
        const selState = saveSelection(editorP); // Save selection
        const wrapper = document.createElement(tagName);
        try { if (range.commonAncestorContainer === editorP || range.startContainer.parentNode === range.endContainer.parentNode) range.surroundContents(wrapper); else { const t=document.createElement('div');t.appendChild(range.extractContents());document.execCommand('insertHTML',false,`<${tagName}>${t.innerHTML}</${tagName}>`);} }
        catch (e) { document.execCommand('insertHTML', false, `<${tagName}>${escapeXml(range.toString())}</${tagName}>`); }
        handleContentChange();
        restoreSelection(editorP, selState); // Restore selection
    }

    // --- Outline Operation Implementations ---
    function indentItem(li) { /* (Ensure restoreFocus) */
        if (!li) return; const prevLi = li.previousElementSibling; if (!prevLi || prevLi.getAttribute('data-type') === 'hr') return;
        const targetP = li.querySelector(':scope > p'); const selState = saveSelection(targetP); // Save selection state
        let targetUl = prevLi.querySelector(':scope > ul'); if (!targetUl) { targetUl = document.createElement('ul'); prevLi.appendChild(targetUl); }
        targetUl.appendChild(li); selectListItem(li); handleContentChange(); restoreSelection(targetP, selState); // Restore selection
    }
    // *** Corrected Outdent Logic ***
    function outdentItem(li) {
        if (!li) return; const parentUl = li.parentElement; if (!parentUl || parentUl === rootUlElement) return; // Cannot outdent top-level items
        const parentLi = parentUl.closest('li'); if (!parentLi) { console.warn("Cannot outdent item with no parent LI"); return; } // Should be inside another LI if not top-level

        const targetP = li.querySelector(':scope > p');
        const selState = saveSelection(targetP); // Save selection state relative to the item being moved

        // Move the item to be after its parent LI
        parentLi.after(li);

        // Clean up the old parent UL if it's now empty
        if (parentUl.children.length === 0) parentUl.remove();

        selectListItem(li); // Reselect the moved item
        handleContentChange();
        restoreSelection(targetP, selState); // Restore selection within the moved item
    }
    function moveItemUp(li) { /* (Ensure restoreFocus) */
        if (!li) return; const prevLi = li.previousElementSibling; if (prevLi) { const p=li.querySelector(':scope>p'); const s=saveSelection(p); li.parentElement.insertBefore(li, prevLi); selectListItem(li); handleContentChange(); restoreSelection(p,s); }
    }
    function moveItemDown(li) { /* (Ensure restoreFocus) */
        if (!li) return; const nextLi = li.nextElementSibling; if (nextLi) { const p=li.querySelector(':scope>p'); const s=saveSelection(p); li.parentElement.insertBefore(nextLi, li); selectListItem(li); handleContentChange(); restoreSelection(p,s); }
    }
    function deleteItem(li) { /* (Ensure focus is handled after delete) */
         if (!li || !outlineContainer.contains(li)) return;
         let itemToSelectAfter = findPreviousVisibleLi(li) || findNextVisibleLi(li);
         const parentUl = li.parentElement; const wasLastInParent = !li.nextElementSibling && parentUl !== rootUlElement;
         const parentLi = parentUl?.closest('li'); if(wasLastInParent && parentLi) itemToSelectAfter = parentLi;
         li.remove(); if(currentlySelectedLi === li) currentlySelectedLi = null;
         if (parentUl && parentUl !== rootUlElement && parentUl.children.length === 0) parentUl.remove();
         if (rootUlElement && rootUlElement.children.length === 0) { rootUlElement.remove(); rootUlElement = null; currentFileSource = 'empty'; resetEditorContent(); updateFileStateUI(); }
         else if (itemToSelectAfter && outlineContainer.contains(itemToSelectAfter)) { selectAndFocusItem(itemToSelectAfter, false); } // Focus end of prev/next
         else if (rootUlElement?.firstElementChild) { const first = rootUlElement.querySelector('li'); if(first) selectAndFocusItem(first, false); else { currentFileSource = 'empty'; resetEditorContent(); updateFileStateUI(); } }
         else { currentFileSource = 'empty'; resetEditorContent(); updateFileStateUI(); }
         handleContentChange(); // Mark change after deletion
    }

     // --- Selection Saving/Restoring ---
     function saveSelection(contextNode) {
         if (!contextNode) return null;
         const selection = window.getSelection();
         if (selection && selection.rangeCount > 0) {
             const range = selection.getRangeAt(0);
             // Check if the selection is actually within the context node
             if (contextNode.contains(range.startContainer) && contextNode.contains(range.endContainer)) {
                 return {
                     startContainer: range.startContainer,
                     startOffset: range.startOffset,
                     endContainer: range.endContainer,
                     endOffset: range.endOffset
                 };
             }
         }
         return null; // Return null if no valid selection in context
     }

     function restoreSelection(contextNode, savedSelection) {
          if (!savedSelection || !contextNode || !document.body.contains(contextNode)) {
              // If no saved state or context is gone, try focusing context or container
               if(contextNode && document.body.contains(contextNode)) focusAndMoveCursor(contextNode, false); // Focus end of context
               else restoreFocus(false); // Use general focus restoration
              return;
          }
          // Ensure containers still exist
          if (!contextNode.contains(savedSelection.startContainer) || !contextNode.contains(savedSelection.endContainer)) {
               console.warn("Restore selection: Containers no longer valid.");
               focusAndMoveCursor(contextNode, false); // Focus end of context as fallback
               return;
          }

         requestAnimationFrame(() => { // Defer to ensure DOM is stable
             const selection = window.getSelection();
             if (!selection) return;
             const range = document.createRange();
             try {
                 range.setStart(savedSelection.startContainer, savedSelection.startOffset);
                 range.setEnd(savedSelection.endContainer, savedSelection.endOffset);
                 selection.removeAllRanges();
                 selection.addRange(range);
                 // Ensure the context node (or its parent LI) is visible/scrolled into view if needed
                 contextNode.focus(); // Re-focus the element containing the selection
             } catch(e) {
                 console.error("Error restoring selection:", e);
                  // Fallback: focus end of context node
                 focusAndMoveCursor(contextNode, false);
             }
         });
     }


    // --- Utility ---
    function generateUniqueId(length = 4) { /* (Keep existing) */ const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';let i='',a=0;do{i='';for(let k=0;k<length;k++)i+=c.charAt(Math.floor(Math.random()*c.length));if(/^[0-9]/.test(i))continue;a++;}while(document.getElementById(i)&&a<100);if(a>=100)return`gen_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;return i; }
    function selectFirstItem() { const f=rootUlElement?.querySelector('li'); if(f) selectAndFocusItem(f, true); }
    function setSavingIndicator(buttonId, isSaving, message = null) { /* (Keep existing) */ const b = document.getElementById(buttonId); if (!b) return; const d = b.title||b.textContent; if(isSaving){b.textContent=message||'Saving...';b.disabled=true;b.style.backgroundColor='#e9ecef';} else {b.textContent=message||d; updateFileStateUI(); if(message==='Saved!'||message==='Save Failed'){b.style.backgroundColor=message==='Saved!'?'#d1e7dd':'#f8d7da'; setTimeout(()=>{b.style.backgroundColor='';b.textContent=d;updateFileStateUI();},2500);} else {b.style.backgroundColor='';}} }

}); // End DOMContentLoaded