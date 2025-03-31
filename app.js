// app.js
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded. Initializing App...");

    // --- Initialize Modules ---
    // Initialize UI first to cache elements
    UI.initialize();
    // Initialize State (mostly setup, no async needed here)
    // Initialize LaTeX (checks for KaTeX library)
    LaTeX.initialize();
    // Initialize Editor (sets up internal state, no async)
    Editor.initialize();
    // Initialize Mobile viewport handling
    Mobile.initialize();
    // Initialize Keyboard handlers
    Keyboard.initialize();
    // Initialize FileSystem (this is async and handles feature detection & initial load)
    FileSystem.initialize().then(() => {
        console.log("App Initialization Sequence Complete.");
        // Any actions to take after async initialization finishes
        UI.updateFileStateUI(); // Final UI state update after loading attempts
    }).catch(err => {
        console.error("Error during FileSystem initialization:", err);
        alert("Error initializing application file system features. Some functions may not work.");
        // Ensure UI is in a reasonable state even if FS init fails
        State.setIsLoading(false); // Ensure loading state is off
        UI.updateFileStateUI();
    });


    // --- Setup Global Event Listeners (using UI module for element access) ---

    // File Input Change
    UI.elements.fileInput.addEventListener('change', FileSystem.handleFileLoadFromInput);

    // Direct File Access Buttons
    UI.elements.openDirectButton.addEventListener('click', FileSystem.openFileDirectly);
    UI.elements.saveDirectButton.addEventListener('click', FileSystem.saveFileDirectly);

    // OPFS Buttons
    UI.elements.newAppFileButton.addEventListener('click', FileSystem.createNewAppFile);
    UI.elements.saveToOpfsButton.addEventListener('click', FileSystem.saveToOpfs);

    // General Load/Save Buttons
    UI.elements.saveAsButton.addEventListener('click', FileSystem.saveFileAsDownload);

    // Toolbar Actions (Event Delegation)
    UI.elements.toolbar.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button || button.disabled) return;

        const selectedLi = State.getSelectedLi();
        const command = button.dataset.command;
        const type = button.dataset.type;
        const id = button.id;

        // Check if action requires a selected item
        const requiresSelection = button.classList.contains('type-button') ||
                                  button.classList.contains('format-button') ||
                                  ['indentButton', 'outdentButton', 'moveUpButton', 'moveDownButton', 'deleteButton', 'linkButton'].includes(id);

        if (requiresSelection && !selectedLi) {
            alert("Please select an item in the outline first.");
            return;
        }

        // --- Delegate to Editor Module ---
        if (command) { // Formatting commands
            Editor.formatSelection(command);
        } else if (type !== undefined) { // Change item type
            Editor.changeItemType(selectedLi, type);
        } else { // Outline operations
            switch (id) {
                case 'linkButton':   Editor.handleLinkButtonClick(); break;
                case 'indentButton': Editor.indentItem(selectedLi); break;
                case 'outdentButton':Editor.outdentItem(selectedLi); break;
                case 'moveUpButton': Editor.moveItemUp(selectedLi); break;
                case 'moveDownButton':Editor.moveItemDown(selectedLi); break;
                case 'deleteButton': Editor.deleteItem(selectedLi); break;
                default: console.warn("Unhandled toolbar button click:", id);
            }
        }
    });

    // Outline Container Actions (Event Delegation for clicks, focus, input)
    UI.elements.outlineContainer.addEventListener('click', (event) => {
        const target = event.target;

        // Click on Fold Toggle
        const foldToggle = target.closest('.fold-toggle');
        if (foldToggle && UI.elements.outlineContainer.contains(foldToggle)) {
             event.stopPropagation(); // Prevent LI selection when clicking toggle
             const li = foldToggle.closest('li');
             if (li) {
                const isFolded = li.getAttribute('data-folded') === 'true';
                 li.classList.toggle('folded', !isFolded); // Optional visual class
                 if (isFolded) {
                     li.removeAttribute('data-folded');
                     console.log(`Unfolded: ${li.id}`);
                 } else {
                     li.setAttribute('data-folded', 'true');
                     console.log(`Folded: ${li.id}`);
                 }
             }
             return;
        }

        // Click on Task Checkbox
        const checkbox = target.closest('span.task-checkbox');
        if (checkbox && UI.elements.outlineContainer.contains(checkbox)) {
             event.stopPropagation(); // Prevent LI selection
             const li = checkbox.closest('li');
             if (li && li.getAttribute('data-type') === 'task') {
                 const isDone = li.getAttribute('data-done') === 'true';
                 if (isDone) {
                     li.removeAttribute('data-done');
                     checkbox.textContent = '☐';
                     console.log(`Task unmarked: ${li.id}`);
                 } else {
                     li.setAttribute('data-done', 'true');
                     checkbox.textContent = '☑';
                     console.log(`Task marked done: ${li.id}`);
                 }
                 Editor.handleContentChange({target: li}); // Mark changes
             }
             return;
        }

         // Click on Link - Allow default navigation
         if (target.closest('a')) {
              console.log("Link clicked - allowing default action.");
              // Optionally add logic here (e.g., confirm external links)
              return;
         }

        // Click on LI or P for Selection
        const clickedLi = target.closest('li');
        if (clickedLi && UI.elements.outlineContainer.contains(clickedLi)) {
             // Select LI if it's not already selected
             if (State.getSelectedLi() !== clickedLi) {
                 UI.selectAndFocusItem(clickedLi, false); // Selects and focuses (end usually for clicks)
             }
             // If click was directly on paragraph, ensure cursor goes there (handled by focusin?)
             // Need to be careful not to interfere with text selection
        }
    });

    // Handle focus moving into the outline or its items
    UI.elements.outlineContainer.addEventListener('focusin', (event) => {
        const target = event.target;
        const li = target.closest('li');

        if (li && UI.elements.outlineContainer.contains(li)) {
             // Select the LI if focus moves to its P element or the LI itself (for HR)
             if ((target.tagName === 'P' && target.parentElement === li) ||
                 (target === li && li.getAttribute('data-type') === 'hr'))
             {
                  if (State.getSelectedLi() !== li) {
                       State.setSelectedLi(li); // Use state setter, UI.selectAndFocusItem handles visuals/focus
                       UI.updateFileStateUI(); // Update based on selection change potentially
                  }
             }
        }
    });

    // Handle content changes within the outline
    UI.elements.outlineContainer.addEventListener('input', (event) => {
        // Delegate directly to the Editor's handler
        Editor.handleContentChange(event);
    });


    // --- Window Events ---
    window.addEventListener('beforeunload', (event) => {
        // Clean up mobile handlers
        Mobile.cleanup();

        // Warn user about unsaved changes
        if (State.getIsDirty()) {
            event.preventDefault(); // Standard practice
            event.returnValue = 'You have unsaved changes. Are you sure you want to leave?'; // For older browsers
            return 'You have unsaved changes. Are you sure you want to leave?'; // For modern browsers
        }
    });

    console.log("App main script executed, event listeners attached.");
});
