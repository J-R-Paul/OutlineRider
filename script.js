document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const fileInput = document.getElementById('fileInput');
    const openDirectButton = document.getElementById('openDirectButton');
    const saveDirectButton = document.getElementById('saveDirectButton');
    const saveAsButton = document.getElementById('saveAsButton'); // Renamed
    const outlineContainer = document.getElementById('outlineContainer');
    const toolbar = document.getElementById('toolbar');
    const directFileAccessDiv = document.getElementById('directFileAccess');
    const currentFileNameSpan = document.getElementById('currentFileName');

    // State Variables
    let rootUlElement = null;
    let currentlySelectedLi = null;
    let fileHandle = null; // For File System Access API

    // --- Feature Detection & Initial Setup ---
    if ('showOpenFilePicker' in window) {
        directFileAccessDiv.style.display = 'block'; // Show direct access buttons
    } else {
        console.warn("File System Access API not supported. Direct file editing disabled.");
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileLoadFromInput);
    openDirectButton.addEventListener('click', openFileDirectly);
    saveDirectButton.addEventListener('click', saveFileDirectly);
    saveAsButton.addEventListener('click', saveFileAs); // Changed from saveBikeFile
    toolbar.addEventListener('click', handleToolbarClick);
    outlineContainer.addEventListener('keydown', handleKeyDown); // Listen for keyboard events on the container
    outlineContainer.addEventListener('focusin', handleFocusIn); // Track focus entering editable elements

    // --- File Handling ---

    function handleFileLoadFromInput(event) {
        const file = event.target.files[0];
        if (!file) return;
        resetEditorState(); // Clear previous file handle etc.
        loadFileContent(file);
        currentFileNameSpan.textContent = `${file.name} (loaded copy)`;
        fileInput.value = ''; // Clear input to allow reloading same file
    }

    async function openFileDirectly() {
        try {
            [fileHandle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Bike Outline Files',
                    accept: { 'application/xhtml+xml': ['.bike', '.html'] }
                }],
            });
            resetEditorState(false); // Keep file handle, reset rest
            const file = await fileHandle.getFile();
            await loadFileContent(file);
            currentFileNameSpan.textContent = file.name;
            saveDirectButton.disabled = false;

        } catch (err) {
            if (err.name !== 'AbortError') { // Ignore user cancellation
                console.error("Error opening file directly:", err);
                alert("Could not open file. See console for details.");
            }
             resetEditorState(); // Ensure clean state if opening failed
        }
    }

    async function loadFileContent(file) {
         try {
            const fileContent = await file.text();
            parseAndRenderBike(fileContent);
        } catch (err) {
            console.error("Error reading file content:", err);
            alert("Error reading file content.");
            resetEditorState();
        }
    }

    async function saveFileDirectly() {
        if (!fileHandle) {
            alert("No file open for direct saving. Use 'Save As' or 'Open File (Direct Edit)' first.");
            return;
        }
        if (!rootUlElement) {
             alert("Nothing to save.");
             return;
         }

        try {
            const writable = await fileHandle.createWritable();
            const bikeHTML = serializeOutlineToHTML();
            await writable.write(bikeHTML);
            await writable.close();
            // Maybe add a visual cue for successful save
            console.log("File saved directly.");
            // Optionally add a small temporary "Saved!" message near the button

        } catch (err) {
            console.error("Error saving file directly:", err);
            alert(`Could not save file directly. ${err.message}. Try 'Save As'.`);
             // Consider disabling direct save if permissions seem revoked
             // saveDirectButton.disabled = true;
             // fileHandle = null;
             // currentFileNameSpan.textContent = "Save failed - use Save As";
        }
    }

    function saveFileAs() {
        if (!rootUlElement) {
             alert("Nothing to save.");
             return;
         }
        try {
             const bikeHTML = serializeOutlineToHTML();
            const blob = new Blob([bikeHTML], { type: 'application/xhtml+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const filename = fileHandle?.name || 'edited_outline.bike'; // Use original name if available
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Error preparing file for download:", err);
            alert("Could not prepare file for download.");
        }
    }

    function serializeOutlineToHTML() {
         // Ensure active element changes are captured
         if (document.activeElement && document.activeElement.isContentEditable) {
            document.activeElement.blur();
            // Re-focus might be needed depending on UX preference, but blur ensures content update
         }

         // Clone the root UL to avoid modifying the live DOM
         const contentToSave = rootUlElement.cloneNode(true);

         // Clean up internal classes, attributes etc. from the clone
         contentToSave.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
         contentToSave.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
         // Potentially remove other temporary attributes if added

        // Reconstruct the full Bike HTML structure
        return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8"/>
    <!-- Add title from fileHandle.name? <title>${fileHandle?.name || 'Bike Outline'}</title> -->
  </head>
  <body>
    ${contentToSave.outerHTML}
  </body>
</html>`;
    }


    function resetEditorState(clearHandle = true) {
        outlineContainer.innerHTML = '<p>Load or Open a .bike file to start editing.</p><p>Use <b>Enter</b> for new item, <b>Shift+Enter</b> for line break, <b>Tab</b> to indent, <b>Shift+Tab</b> to outdent.</p>';
        rootUlElement = null;
        currentlySelectedLi = null;
        if (clearHandle) {
            fileHandle = null;
            saveDirectButton.disabled = true;
            currentFileNameSpan.textContent = 'No file open';
        }
         // Reset other UI states if necessary
    }


    // --- Parsing & Rendering ---

    function parseAndRenderBike(htmlString) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'application/xhtml+xml');
            const parseError = doc.querySelector('parsererror');
            if (parseError) throw new Error(`Parse Error: ${parseError.textContent}`);

            rootUlElement = doc.body.querySelector('ul');
            if (!rootUlElement) throw new Error('Could not find the root <ul> element.');

            outlineContainer.innerHTML = ''; // Clear previous content/instructions
            outlineContainer.appendChild(document.adoptNode(rootUlElement, true));
            makeEditableAndInteractive(outlineContainer);

            // Select the first item automatically
            const firstLi = rootUlElement.querySelector('li');
            if (firstLi) {
                selectListItem(firstLi);
                // Don't auto-focus on load, let user click/tap
            }

        } catch (error) {
            console.error("Error parsing/rendering:", error);
            alert(`Error loading outline: ${error.message}`);
            resetEditorState(); // Clear failed load
        }
    }

    function makeEditableAndInteractive(container) {
        container.querySelectorAll('li').forEach(li => {
            const p = li.querySelector('p');
            if (p) {
                p.setAttribute('contenteditable', 'true');
                 // Focus handling moved to delegated listener handleFocusIn
            } else if (li.getAttribute('data-type') === 'hr') {
                 // HR might not have <p>, allow selection via click on LI itself (handled by focusin)
            }

            if (!li.id) li.id = generateUniqueId();
        });
        if (rootUlElement && !rootUlElement.id) {
            rootUlElement.id = generateUniqueId(5);
        }
    }

    // --- Selection & Focus Handling ---

    function handleFocusIn(event) {
        // When focus enters a P element (or the LI itself for HR), select the parent LI
        const target = event.target;
        if (target.tagName === 'P' && target.closest('li')) {
            selectListItem(target.closest('li'));
        } else if (target.tagName === 'LI' && target.getAttribute('data-type') === 'hr') {
             selectListItem(target); // Allow selecting HR LIs directly
        }
    }

    function selectListItem(liElement) {
        if (!liElement || !outlineContainer.contains(liElement)) return; // Ensure element is valid and part of the outline
        if (currentlySelectedLi === liElement) return; // Already selected

        if (currentlySelectedLi) {
            currentlySelectedLi.classList.remove('selected');
        }
        currentlySelectedLi = liElement;
        currentlySelectedLi.classList.add('selected');
        // console.log("Selected:", currentlySelectedLi?.id);
    }

    function getSelectedLi() {
        // Return the state variable if valid, fallback to querySelector (safer)
        if (currentlySelectedLi && outlineContainer.contains(currentlySelectedLi)) {
            return currentlySelectedLi;
        }
        return outlineContainer.querySelector('li.selected'); // Might be slightly slower but more robust
    }

     // Get the currently focused P element if any
     function getFocusedP() {
         const active = document.activeElement;
         if (active && active.tagName === 'P' && active.isContentEditable && outlineContainer.contains(active)) {
             return active;
         }
         return null;
     }


    // --- Keyboard Navigation & Editing ---

    function handleKeyDown(event) {
        const targetP = getFocusedP(); // Is editing happening inside a P?
        const selectedLi = getSelectedLi(); // What LI is conceptually selected?

         // Ensure we have context before acting
        if (!selectedLi || !outlineContainer.contains(selectedLi)) {
            // If no LI selected, but focus is somehow in container, maybe allow basic navigation?
            // For now, require an LI to be selected for most actions.
            return;
        }

        switch (event.key) {
            case 'Enter':
                if (event.shiftKey) {
                    // Shift+Enter: Insert line break (Default behaviour might work, but execCommand is safer)
                     if (targetP) {
                         event.preventDefault(); // Prevent potential default block creation
                         document.execCommand('insertLineBreak');
                         // Alternative: document.execCommand('insertHTML', false, '<br>');
                     }
                } else {
                    // Enter: Create new item at the same level
                    event.preventDefault(); // Stop default newline/div insertion
                    createNewItem(selectedLi);
                }
                break;

            case 'Tab':
                event.preventDefault(); // Prevent focus change
                if (event.shiftKey) {
                    // Shift+Tab: Outdent
                    outdentItem(selectedLi);
                } else {
                    // Tab: Indent
                    indentItem(selectedLi);
                }
                break;

            case 'ArrowUp':
                 // Basic up navigation (can be improved)
                 if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                     // Prevent cursor moving to beginning if possible, try moving LI selection
                     const prevLi = findPreviousVisibleLi(selectedLi);
                     if (prevLi) {
                         event.preventDefault();
                         selectListItem(prevLi);
                         prevLi.querySelector('p')?.focus(); // Focus the P in the newly selected LI
                     }
                 }
                 break;

            case 'ArrowDown':
                 // Basic down navigation (can be improved)
                 if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                     const nextLi = findNextVisibleLi(selectedLi);
                     if (nextLi) {
                         event.preventDefault();
                         selectListItem(nextLi);
                         nextLi.querySelector('p')?.focus(); // Focus the P
                     }
                 }
                 break;

             case 'Backspace':
                 // Delete empty item? (More complex logic needed)
                 // if (selectedLi && targetP && targetP.textContent === '') {
                 //     // Potentially delete the item if backspace is pressed in an empty P
                 //     event.preventDefault();
                 //     deleteItem(selectedLi);
                 // }
                 break;

             // Add other shortcuts (e.g., Ctrl+B for bold) here if desired
        }
    }

    function createNewItem(currentItemLi) {
        if (!currentItemLi) return;

        const newLi = document.createElement('li');
        newLi.id = generateUniqueId();
        const newP = document.createElement('p');
        newP.setAttribute('contenteditable', 'true');
        // Add a zero-width space to make empty paragraphs focusable reliably? (Optional)
        // newP.innerHTML = '​';
        newLi.appendChild(newP);

        // Insert after the current item
        currentItemLi.after(newLi);

        // Select and focus the new item
        selectListItem(newLi);
        newP.focus();

        // Ensure the new empty P is focusable right away
        // Force focus might be needed on some browsers
        requestAnimationFrame(() => newP.focus());
    }

     // Helper functions for Arrow navigation (basic version)
     function findPreviousVisibleLi(li) {
         let sibling = li.previousElementSibling;
         if (sibling) {
             // If previous sibling has children, navigate to the last child of the last child...
             while (sibling.querySelector(':scope > ul > li:last-child')) {
                  const lastChildUl = sibling.querySelector(':scope > ul');
                  if(lastChildUl && lastChildUl.lastElementChild) {
                        sibling = lastChildUl.lastElementChild;
                  } else {
                      break; // Should not happen if selector worked
                  }
             }
             return sibling;
         } else {
             // Move up to parent LI if possible
             const parentUl = li.parentElement;
             if (parentUl && parentUl !== rootUlElement) {
                 return parentUl.closest('li');
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

         // Then, check for next sibling
         let current = li;
         while (current) {
             const sibling = current.nextElementSibling;
             if (sibling) {
                 return sibling;
             }
             // If no more siblings, move up to parent's next sibling
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
             // Ensure focus is in an editable area for execCommand
             let targetP = getFocusedP() || selectedLi?.querySelector('p'); // Fallback to selected LI's P
             if (!targetP || !targetP.isContentEditable) {
                 if (selectedLi && selectedLi.querySelector('p')) {
                      selectedLi.querySelector('p').focus(); // Try to focus the P of the selected LI
                      targetP = getFocusedP(); // Update targetP after focus attempt
                 }
             }
             // If still no editable focus, abort formatting
              if (!targetP || !document.queryCommandSupported) { // Check if execCommand is likely to work
                  console.warn("Cannot format: No editable paragraph focused.");
                  return;
              }

            const command = button.dataset.command;
            if (command === 'highlight') wrapSelection('mark');
            else if (command === 'code') wrapSelection('code');
            else document.execCommand(command, false, null);
            targetP?.focus(); // Re-focus

        } else if (button.id === 'linkButton') {
             let targetP = getFocusedP() || selectedLi?.querySelector('p');
             if (!targetP) return alert("Select text or place cursor in an item to create a link.");
             targetP.focus(); // Ensure focus before prompt

             const url = prompt("Enter link URL:", "https://");
             if (url) {
                 // Ensure some text is selected or use prompt for text?
                 // execCommand createLink works best with existing selection
                 const selection = window.getSelection();
                 if (selection && selection.toString().length > 0) {
                     document.execCommand('createLink', false, url);
                 } else {
                     // If no text selected, insert URL as text and link it (basic)
                     document.execCommand('insertHTML', false, `<a href="${url}">${url}</a>`);
                 }
             }
              targetP?.focus(); // Re-focus

        // --- Item Type ---
        } else if (button.classList.contains('type-button')) {
            if (!selectedLi) return alert("Select an item first.");
            const type = button.dataset.type;
            // Handle type change (same logic as before)
             if (type) selectedLi.setAttribute('data-type', type);
             else selectedLi.removeAttribute('data-type');
             if (type === 'hr') {
                 let p = selectedLi.querySelector('p');
                 if (!p) { p = document.createElement('p'); selectedLi.insertBefore(p, selectedLi.firstChild); }
                 p.innerHTML = ''; p.removeAttribute('contenteditable'); // HR P shouldn't be editable
             } else {
                  let p = selectedLi.querySelector('p');
                  if (!p) { p = document.createElement('p'); selectedLi.insertBefore(p, selectedLi.firstChild); }
                  p.setAttribute('contenteditable', 'true'); // Ensure P is editable for non-HR
             }

        // --- Outline Operations ---
        } else if (button.id === 'indentButton') indentItem(selectedLi);
        else if (button.id === 'outdentButton') outdentItem(selectedLi);
        else if (button.id === 'moveUpButton') moveItemUp(selectedLi);
        else if (button.id === 'moveDownButton') moveItemDown(selectedLi);
        else if (button.id === 'deleteButton') deleteItem(selectedLi);
    }

    // --- Selection Wrapping Helper (Minor adjustments maybe needed for robustness) ---
    function wrapSelection(tagName) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) {
             console.warn("WrapSelection: No text selected.");
             return;
        }

        const range = selection.getRangeAt(0);
        const selectedText = range.toString();
        const container = range.commonAncestorContainer;

        // Ensure the selection is actually within our editable container
        if (!container || !outlineContainer.contains(container)) {
             console.warn("WrapSelection: Selection outside editor.");
             return;
         }
          // Check if the focus is within a contenteditable element, needed for execCommand fallback
         let editorP = getFocusedP();
         if(!editorP) {
              console.warn("WrapSelection: No P element focused for potential fallback.");
              // Maybe try focusing the container of the selection start?
              let focusTarget = (container.nodeType === Node.ELEMENT_NODE) ? container : container.parentNode;
              focusTarget = focusTarget.closest('p[contenteditable="true"]');
              focusTarget?.focus();
              editorP = getFocusedP(); // try again
              if (!editorP) return; // Still no editable target
         }


        const wrapper = document.createElement(tagName);

        try {
            // Try the cleaner method first
            range.surroundContents(wrapper);
            selection.removeAllRanges(); // Deselect or place cursor after?
             // range.selectNode(wrapper); range.collapse(false); selection.addRange(range); // Cursor after
        } catch (e) {
            console.warn("surroundContents failed, using execCommand insertHTML fallback:", e);
             // Fallback using insertHTML (less clean, might mess up structure slightly)
             // Ensure selectedText is HTML-escaped if inserting as raw HTML? Usually not needed here.
             document.execCommand('insertHTML', false, `<${tagName}>${selectedText}</${tagName}>`);
        }
        editorP?.focus(); // Re-focus the paragraph
    }


    // --- Outline Operation Implementations (Mostly Unchanged, add focus calls) ---

    function indentItem(li) {
        if (!li) return; // No alert, just return if called without target
        const previousLi = li.previousElementSibling;
        if (!previousLi || previousLi.getAttribute('data-type') === 'hr') return;

        let targetUl = previousLi.querySelector(':scope > ul');
        if (!targetUl) {
            targetUl = document.createElement('ul');
            // Ensure ID on new UL? Bike format doesn't seem to require it.
            previousLi.appendChild(targetUl);
        }
        targetUl.appendChild(li); // Move the item
        selectListItem(li); // Ensure it remains selected
        li.querySelector('p')?.focus();
    }

    function outdentItem(li) {
        if (!li) return;
        const parentUl = li.parentElement;
        // Check if it's nested (not the root UL directly under outlineContainer)
        if (!parentUl || parentUl === rootUlElement || !parentUl.closest('li')) {
             console.warn("Cannot outdent: Item is at the top level or structure is unexpected.");
             return;
         }

        const grandparentLi = parentUl.closest('li');
        if (!grandparentLi) return; // Should have found one based on above check

        // Find the position *after* the grandparent li to insert
        grandparentLi.after(li);

        // Move subsequent siblings from the old UL as well?
        // Standard outliner behavior: subsequent siblings at the same level *remain children* of the parent.
        // Bike format doesn't explicitly define this, but typically outdent only moves the single item.

        // Remove the parent UL if it's now empty
        if (parentUl.children.length === 0) {
            parentUl.remove();
        }
        selectListItem(li);
        li.querySelector('p')?.focus();
    }

    function moveItemUp(li) {
        if (!li) return;
        const previousLi = li.previousElementSibling;
        if (previousLi) {
            li.parentElement.insertBefore(li, previousLi);
            selectListItem(li); // Keep selection
            li.querySelector('p')?.focus(); // Keep focus within item if possible
        }
    }

    function moveItemDown(li) {
        if (!li) return;
        const nextLi = li.nextElementSibling;
        if (nextLi) {
            li.parentElement.insertBefore(nextLi, li); // Insert next before current
             selectListItem(li);
             li.querySelector('p')?.focus();
        }
    }

    function deleteItem(li) {
        if (!li) return;

         // Check if it's the last item in the entire outline
         const isOnlyItem = !li.previousElementSibling && !li.nextElementSibling && li.parentElement === rootUlElement && rootUlElement.children.length === 1;


         // More user friendly to not confirm? Or only confirm if it has content?
        const pText = li.querySelector('p')?.textContent || '';
        if (pText.length > 0 && !confirm(`Delete item "${pText.substring(0, 30)}..."?`)) {
            return; // User cancelled
        }

         // Determine what to select next
         let siblingToSelect = findPreviousVisibleLi(li) || findNextVisibleLi(li);
         const parentUl = li.parentElement;

        li.remove();
        currentlySelectedLi = null; // Clear selection state variable

         // Remove parent UL if it becomes empty and isn't the root
         if (parentUl && parentUl !== rootUlElement && parentUl.children.length === 0 && parentUl.closest('li')) {
            parentUl.remove();
        }


         // If it was the very last item, create a new empty item
         if (isOnlyItem) {
              const newItem = createNewItem(null); // Special call? Needs adjustment
               // Need to handle creating item when the target is gone
               rootUlElement.appendChild(document.createElement('li')); // Add placeholder LI
               createNewItem(rootUlElement.firstElementChild); // Create properly
               rootUlElement.firstElementChild.remove(); // Remove placeholder
         } else if (siblingToSelect) {
             selectListItem(siblingToSelect);
             siblingToSelect.querySelector('p')?.focus();
         } else if (rootUlElement && rootUlElement.firstElementChild){
              // Fallback: select first item if something went wrong finding sibling
              selectListItem(rootUlElement.firstElementChild);
              rootUlElement.firstElementChild.querySelector('p')?.focus();
         } else {
             // Outline is now completely empty? Should be handled by isOnlyItem case?
              resetEditorState(false); // Reset display keeping file handle
              outlineContainer.innerHTML = '<p>Outline empty. Press Enter to add an item.</p>';
              outlineContainer.focus(); // Focus container to allow Enter key
         }
    }

    // --- Utility ---
    function generateUniqueId(length = 3) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        let id = '';
        do {
             id = '';
            for (let i = 0; i < length; i++) {
                id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
         // Ensure ID is unique within the current document fragment
         // Check against existing IDs in the outlineContainer (might be slow on huge docs)
        } while (document.getElementById(id) && outlineContainer.contains(document.getElementById(id)));
        return id;
    }

});