// js/editor.js
const Editor = (() => {
    let autoSaveTimeout = null; // Specific to editor content changes

    // --- Initialization (called by App.js) ---
    const initialize = () => {
        // Editor-specific setup if any (e.g., observers)
        console.log("Editor Initialized.");
    };

    // --- Parsing & Serialization ---

    const parseAndRenderBike = (htmlString) => {
        console.log("Parsing HTML string...");
        if (!htmlString || typeof htmlString !== 'string' || htmlString.trim().length === 0) {
             throw new Error("Parse Error: Input content is empty or invalid.");
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'application/xhtml+xml');

        // Robust error checking
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
             console.error("XML Parse Error:", parseError.textContent);
             // Try to extract a more specific error message
             const specificError = parseError.textContent.split('\n').find(line => line.trim() && !line.includes('parsererror')) || parseError.textContent.split('\n')[0];
             throw new Error(`Parse Error: Invalid Bike/XML file.\n${specificError || 'Unknown parsing issue'}`);
        }

        let rootUl = doc.body?.querySelector('ul'); // Prefer direct UL in body

        // Handle cases where content might be just LIs directly in body (less standard but possible)
        if (!rootUl && doc.body && doc.body.querySelector('li')) {
            console.warn("Content seems to be missing a root <ul>, attempting to wrap body LIs.");
            const tempUl = document.createElement('ul');
            tempUl.id = Utils.generateUniqueId(5); // Root ID
            // Move only direct LI children of body to the new UL
            Array.from(doc.body.children).forEach(node => {
                if (node.tagName?.toUpperCase() === 'LI') {
                    tempUl.appendChild(node); // Moves the node
                }
            });
            if (tempUl.children.length > 0) {
                rootUl = tempUl;
                // Prepend the wrapped UL to the body for structure (though we only use the UL itself)
                doc.body.prepend(rootUl);
            }
        }

        if (!rootUl) {
            // Check if body is completely empty but structure is valid
             if(doc.body && doc.body.innerHTML.trim() === '') {
                console.warn("Parsed document body is empty. Creating minimal structure.");
                // Create a minimal structure if parsing succeeds but content is empty
                 rootUl = document.createElement('ul');
                 rootUl.id = Utils.generateUniqueId(5);
             } else {
                throw new Error('Parse Error: Could not find or construct a root <ul> element from the provided content.');
             }
        }


        UI.elements.outlineContainer.innerHTML = ''; // Clear current content
        const importedNode = document.importNode(rootUl, true); // Deep clone
        UI.elements.outlineContainer.appendChild(importedNode);

        const newRootElement = UI.elements.outlineContainer.querySelector('ul');
        if (!newRootElement) {
            throw new Error("Internal Error: Failed to attach parsed content to the container.");
        }
        State.setRootElement(newRootElement); // Update state

        makeEditableAndInteractive(newRootElement); // Make the new content interactive

        // Render LaTeX after the main structure is in place
        newRootElement.querySelectorAll('li[data-type="latex"] > p').forEach(p => {
            LaTeX.renderLaTeXBlock(p, p.parentElement);
        });

        // Remove initial message if it's still present
        UI.elements.initialMessageDiv?.remove();

        console.log("Parsing and rendering complete.");
        // Return the root element if needed elsewhere immediately after parsing
        return newRootElement;
    };

    const serializeOutlineToHTML = () => {
        const rootElement = State.getRootElement();

        // Handle empty outline case
        if (!rootElement || !UI.elements.outlineContainer.contains(rootElement) || rootElement.children.length === 0) {
            console.log("Serializing an empty outline.");
            const emptyTitle = "Empty Outline"; // Or derive from filename if possible/desired
             return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8"/>
    <title>${Utils.escapeXml(emptyTitle)}</title>
  </head>
  <body>
    <ul id="root"></ul>
  </body>
</html>`;
        }

        // Ensure focus is removed from editable elements before cloning
        if (document.activeElement?.isContentEditable) {
             document.activeElement.blur();
        }

        const contentToSave = rootElement.cloneNode(true);

        // --- Cleanup for Serialization ---
        try {
            contentToSave.querySelectorAll('.selected, .dragging, .drop-target-inside').forEach(el => {
                 el.classList.remove('selected', 'dragging', 'drop-target-inside');
            });
            contentToSave.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
            contentToSave.querySelectorAll('[tabindex]').forEach(el => el.removeAttribute('tabindex')); // Remove tabindex added for focus
            contentToSave.querySelectorAll('span.task-checkbox').forEach(el => el.remove()); // Remove visual checkboxes
            contentToSave.querySelectorAll('.fold-toggle').forEach(el => el.remove()); // Remove fold toggles
            contentToSave.querySelectorAll('.rendered-math, .katex-error').forEach(el => el.remove()); // Remove rendered LaTeX/errors

            // Clean up task item paragraphs (remove leading space added after checkbox)
            contentToSave.querySelectorAll('li[data-type="task"] > p').forEach(p => {
                if (p.firstChild?.nodeType === Node.TEXT_NODE && p.firstChild.textContent.startsWith(' ')) {
                    p.firstChild.textContent = p.firstChild.textContent.substring(1);
                    if (!p.firstChild.textContent) p.firstChild.remove(); // Remove empty text node
                }
            });

            // Remove empty UL elements (often left after outdenting/deleting)
            contentToSave.querySelectorAll('ul:empty').forEach(ul => ul.remove());

            // Clean up paragraphs: remove placeholder <br> if content exists, or ensure empty P is truly empty
            contentToSave.querySelectorAll('p').forEach(p => {
                const hasText = p.textContent.trim();
                const hasNonBrChild = Array.from(p.childNodes).some(node => !(node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR'));

                if (hasText || hasNonBrChild) {
                    // Remove all BRs if there's other content
                    p.querySelectorAll('br').forEach(br => br.remove());
                } else {
                     // If no text and no other children, ensure it's just empty
                     p.innerHTML = '';
                }

                // If after cleanup, it's empty, make it truly empty (Bike format prefers this)
                 if (p.innerHTML.trim() === '' && p.closest('li')?.getAttribute('data-type') !== 'hr') {
                     p.innerHTML = '';
                 }
            });

            // Remove LI IDs? Optional, but Bike format doesn't require them. Reduces file size slightly.
            // contentToSave.querySelectorAll('li[id]').forEach(li => li.removeAttribute('id'));
             // Keep root UL ID? Bike format often has <ul id="root">
             if(contentToSave.id !== 'root') contentToSave.id = 'root';


        } catch (cleanupError) {
            console.error("Error during serialization cleanup:", cleanupError);
            // Decide if you want to proceed with potentially unclean data or return null
            // return null;
        }
        // --- End Cleanup ---

        // Determine Title
        let title = 'Bike Outline';
        const source = State.getCurrentFileSource();
        const handle = State.getDirectFileHandle();
        const filenameSpan = UI.elements.currentFileNameSpan;

        if (source === 'direct' && handle?.name) {
            title = handle.name.replace(/\.(bike|xhtml|html|xml)$/i, "");
        } else if (source === 'opfs') {
            title = FileSystem.PERSISTENT_OPFS_FILENAME.replace(/\.(bike|xhtml|html|xml)$/i, ""); // Use constant
        } else if (filenameSpan?.textContent) {
            const currentDisplay = filenameSpan.textContent.replace('*', '').replace(' (copy)', '').replace(' (new)', '').replace(' (draft)', '').trim();
            if (currentDisplay && !['No file', 'Unsaved Draft', 'App Storage'].includes(currentDisplay)) {
                title = currentDisplay.replace(/\.(bike|xhtml|html|xml)$/i, "");
            }
        }

        const serializer = new XMLSerializer();
        let ulHtml = '';
        try {
             ulHtml = serializer.serializeToString(contentToSave);
             // Basic check for self-closing tags which might indicate issues
             if(/<p\/>|<li\/>|<ul\/>/.test(ulHtml)) {
                  console.warn("Serialization produced potentially problematic self-closing tags. Attempting recovery.");
                  // Simple recovery attempt (might not cover all cases)
                  ulHtml = ulHtml.replace(/<p\/>/g, '<p></p>')
                                 .replace(/<li([^>]*)?\/>/g, '<li$1></li>')
                                 .replace(/<ul([^>]*)?\/>/g, '<ul$1></ul>');
             }

        } catch (serializeError) {
             console.error("XML Serialization Error:", serializeError);
             alert("Failed to serialize outline content to XML.");
             return null; // Indicate failure
        }


        const finalHtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8"/>
    <title>${Utils.escapeXml(title)}</title>
  </head>
  <body>
    ${ulHtml}
  </body>
</html>`;

        // Optional: Validate the final output
        try {
            const parser = new DOMParser();
            const checkDoc = parser.parseFromString(finalHtml, 'application/xhtml+xml');
            if (checkDoc.querySelector('parsererror')) {
                console.error("Serialization resulted in invalid XML:", checkDoc.querySelector('parsererror').textContent);
                 alert("Failed to create a valid Bike/XML file during saving. Please check content for issues.");
                return null; // Indicate validation failure
            }
        } catch (validationError) {
            console.error("Error during serialization validation:", validationError);
            // Allow saving even if validation throws an error, but log it.
        }

        return finalHtml;
    };


    // --- DOM Manipulation & Interactivity ---

    const makeEditableAndInteractive = (containerElement) => {
        if (!containerElement || !containerElement.querySelectorAll) {
             console.warn("makeEditableAndInteractive called with invalid container:", containerElement);
             return;
        }
        // Process direct children LI elements
        containerElement.querySelectorAll(':scope > li').forEach(li => {
            if (!li.id) li.id = Utils.generateUniqueId(); // Ensure every item has an ID

            const p = li.querySelector(':scope > p');
            const childUl = li.querySelector(':scope > ul');
            const dataType = li.getAttribute('data-type');

            // Add folding toggle if it has children (and isn't HR)
            addFoldingToggle(li, !!childUl && dataType !== 'hr');

            // Setup draggable attribute (exclude HR)
            if (dataType !== 'hr') {
                li.setAttribute('draggable', 'true');
                setupDragListeners(li); // Attach drag listeners
            } else {
                li.removeAttribute('draggable'); // Ensure HR is not draggable
            }

            // Setup Paragraph or handle HR
            if (dataType === 'hr') {
                if (p) p.remove(); // HR shouldn't have a paragraph
                li.tabIndex = -1; // Make it focusable only via selection/programmatically initially
            } else if (p) {
                // Existing paragraph
                 setupParagraph(p, li); // Make editable, add checkbox etc.
            } else {
                // Missing paragraph, create one
                const newP = document.createElement('p');
                newP.setAttribute('contenteditable', 'true');
                newP.innerHTML = '<br>'; // Start with a placeholder break
                li.prepend(newP); // Add it to the start of the LI
                setupParagraph(newP, li);
            }

            // Recursively process child ULs
            if (childUl) {
                makeEditableAndInteractive(childUl);
            }
        });

         // Ensure root UL has an ID if it's the container being processed
         if (containerElement === State.getRootElement() && !containerElement.id) {
             containerElement.id = Utils.generateUniqueId(5); // e.g., "root" or generated
         }
    };

    const addFoldingToggle = (li, hasChildren) => {
        // Remove existing toggle first to prevent duplicates
        li.querySelector(':scope > .fold-toggle')?.remove();

        if (hasChildren) { // Only add if it actually has children now
            const toggle = document.createElement('span');
            toggle.className = 'fold-toggle';
            toggle.setAttribute('aria-hidden', 'true'); // Decorative
            toggle.title = "Fold/Unfold";
            // Insert the toggle before the first element child (usually the P)
             li.prepend(toggle);
        }
        // No need for an 'else remove' here because we remove it at the start
    };

    const setupParagraph = (p, li) => {
        p.setAttribute('contenteditable', 'true');
        const dataType = li.getAttribute('data-type');

        // Handle Task Checkbox
        if (dataType === 'task') {
            let checkbox = p.querySelector('span.task-checkbox');
            if (!checkbox) {
                checkbox = document.createElement('span');
                checkbox.className = 'task-checkbox';
                checkbox.setAttribute('contenteditable', 'false'); // Not editable itself
                checkbox.setAttribute('aria-hidden', 'true');
                // Insert checkbox at the beginning, followed by a non-breaking space for spacing
                p.prepend('\u00A0'); // Non-breaking space
                p.prepend(checkbox);
            }
            // Update checkbox state based on li attribute
            checkbox.textContent = li.getAttribute('data-done') === 'true' ? '☑' : '☐';
        } else {
            // Remove checkbox if type changed from task
            p.querySelector('span.task-checkbox')?.remove();
             // Clean up leading space potentially left from checkbox removal
             if (p.firstChild?.nodeType === Node.TEXT_NODE && p.firstChild.textContent.startsWith('\u00A0')) {
                 p.firstChild.textContent = p.firstChild.textContent.substring(1);
                 if (!p.firstChild.textContent) p.firstChild.remove(); // Remove empty text node
             }
        }

        // Handle LaTeX Block setup
         if (dataType === 'latex') {
             // Ensure content or add default
             if (!p.textContent.trim()) {
                 p.textContent = LaTeX.DEFAULT_LATEX;
             }
             // Render (initial render or re-render if type changed to latex)
              LaTeX.renderLaTeXBlock(p, li);
         } else {
             // Remove rendered math if type changed FROM latex
             li.querySelector('.rendered-math')?.remove();
             li.querySelector('.katex-error')?.remove();
         }


        // Ensure paragraph isn't visually empty in the editor without content
        // Add a <br> if it's empty, remove it if content is added.
        const hasVisibleContent = p.textContent.trim() || p.querySelector('img, a, code, mark, b, i, u, s'); // Check common content tags too
        const hasOnlyBr = p.innerHTML.trim() === '<br>';

        if (!hasVisibleContent && !hasOnlyBr) {
            p.innerHTML = '<br>'; // Add placeholder BR
        } else if (hasVisibleContent && hasOnlyBr) {
             // If content was added (e.g., typing), remove the placeholder BR
             // This is often handled by the browser, but can be done explicitly on input/blur if needed.
             // For now, let's assume browser handles removing <br> when text is typed.
             // We might need cleanup here if empty paragraphs retain `<br>` inappropriately.
        }
    };

    // --- Content Change Handling ---
    const handleContentChange = (event) => {
        if (State.getIsLoading()) return; // Ignore changes during loading

        const target = event?.target;
        const li = target?.closest('li');

        // Ignore changes triggered by folding/unfolding clicks
        if (target?.classList.contains('fold-toggle')) return;

        // Handle LaTeX block updates with debounce
        if (li && li.getAttribute('data-type') === 'latex' && target?.tagName === 'P') {
            LaTeX.debouncedRenderLaTeXBlock(target, li);
        }

        // Mark state as dirty and trigger autosave
        State.markAsDirty();
        UI.updateFileStateUI(); // Update UI immediately on content change
        triggerAutoSaveDraft(); // Save draft shortly after
    };

    const triggerAutoSaveDraft = () => {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
            // Only save draft if dirty and not currently saving a primary source
            if (State.getIsDirty() && !State.getIsLoading()) {
                 FileSystem.saveDraftToLocalStorage();
            }
        }, FileSystem.AUTOSAVE_DELAY);
    };

    // --- Item Creation & Deletion ---
     const createMinimalStructure = () => {
         const rootUl = document.createElement('ul');
         rootUl.id = Utils.generateUniqueId(5); // Ensure root has ID
         const firstLi = document.createElement('li');
         firstLi.id = Utils.generateUniqueId();
         const firstP = document.createElement('p');
         firstP.setAttribute('contenteditable', 'true');
         firstP.innerHTML = '<br>'; // Start empty
         firstLi.appendChild(firstP);
         rootUl.appendChild(firstLi);

         UI.elements.outlineContainer.innerHTML = ''; // Clear previous
         UI.elements.outlineContainer.appendChild(rootUl);
         State.setRootElement(rootUl); // Update state

         makeEditableAndInteractive(rootUl); // Make the new structure interactive
         UI.elements.initialMessageDiv?.remove();

         return firstLi; // Return the created LI for focusing
     };

    const createNewItem = (currentItemLi) => {
        if (!currentItemLi || !UI.elements.outlineContainer.contains(currentItemLi)) return;

        const newLi = document.createElement('li');
        newLi.id = Utils.generateUniqueId();

        // Inherit type from current item, unless it's HR or LaTeX
        const currentType = currentItemLi.getAttribute('data-type');
        const inheritableTypes = ['heading', 'note', 'task', 'ordered', 'unordered']; // Add others if needed
        if (currentType && inheritableTypes.includes(currentType)) {
            newLi.setAttribute('data-type', currentType);
            // Ensure 'done' status is NOT inherited for tasks
            if (currentType === 'task') {
                newLi.removeAttribute('data-done');
            }
        } // Otherwise, it defaults to plain text (no data-type)

        // Create the paragraph
        const newP = document.createElement('p');
        newP.setAttribute('contenteditable', 'true');
        newP.innerHTML = '<br>';
        newLi.appendChild(newP);

        // Insert after the current item
        currentItemLi.after(newLi);

        // Re-run makeEditable on the parent UL to ensure checkboxes/etc are correct
        // Note: This might be slightly inefficient but ensures consistency.
        if (newLi.parentElement) {
             makeEditableAndInteractive(newLi.parentElement);
        }

        // Select and focus the new item
        UI.selectAndFocusItem(newLi, true); // Focus at the start

         // Special focus handling for tasks (after checkbox) - wait for DOM update
         if (newLi.getAttribute('data-type') === 'task') {
            requestAnimationFrame(() => {
                const taskP = newLi.querySelector(':scope > p');
                const checkbox = taskP?.querySelector('.task-checkbox');
                const firstTextNode = Array.from(taskP?.childNodes || []).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');

                if (taskP) {
                     const range = document.createRange();
                     const sel = window.getSelection();
                     if(firstTextNode) { // Move cursor to start of text after checkbox + space
                          range.setStart(firstTextNode, 0);
                     } else { // If no text, place cursor after the space following checkbox
                         const spaceNode = checkbox?.nextSibling;
                         if(spaceNode && spaceNode.nodeType === Node.TEXT_NODE) {
                              range.setStart(spaceNode, spaceNode.length); // End of space
                         } else {
                              range.setStart(taskP, taskP.childNodes.length); // Fallback to end of P
                         }
                     }
                     range.collapse(true);
                     sel.removeAllRanges();
                     sel.addRange(range);
                     taskP.focus(); // Ensure paragraph has focus
                }
            });
        }


        handleContentChange({ target: newP }); // Mark as dirty, trigger autosave
    };

    const deleteItem = (liToDelete) => {
         if (!liToDelete || !UI.elements.outlineContainer.contains(liToDelete)) return;
         console.log(`Attempting to delete item: ${liToDelete.id}`);

         const parentUl = liToDelete.parentElement;
         const parentLi = parentUl?.closest('li'); // The LI containing the UL liToDelete is in
         const wasLastInSublist = !liToDelete.nextElementSibling && parentUl !== State.getRootElement();

         // Determine which item to select after deletion
         let itemToSelectAfter = findPreviousVisibleLi(liToDelete);
         if (!itemToSelectAfter) {
             itemToSelectAfter = findNextVisibleLi(liToDelete);
         }
         // If deleting the last item in a sublist, select the parent item
         if (!itemToSelectAfter && wasLastInSublist && parentLi) {
             itemToSelectAfter = parentLi;
         }
         // If still nothing, try the first item in the whole outline
         if (!itemToSelectAfter && State.getRootElement()?.firstElementChild) {
             itemToSelectAfter = State.getRootElement().querySelector('li');
         }


         const currentSelectedLi = State.getSelectedLi();
         liToDelete.remove();

         // Clear selection if the deleted item was selected
         if (currentSelectedLi === liToDelete) {
             State.setSelectedLi(null);
         }

         // If the parent UL is now empty (and it's not the root), remove it and update parent's fold toggle
         if (parentLi && parentUl && parentUl !== State.getRootElement() && parentUl.children.length === 0) {
             console.log(`Removing empty parent UL from ${parentLi.id}`);
             parentUl.remove();
             addFoldingToggle(parentLi, false); // Parent no longer has children
         } else if (parentLi && parentUl && parentUl !== State.getRootElement()) {
              // Refresh parent UL interactivity if it still exists and has items
              // makeEditableAndInteractive(parentUl); // Might be needed if IDs/listeners get stale, test first
         } else if (parentLi) {
             // If parentLi exists, ensure its fold toggle is updated even if parentUl was root or not removed
             addFoldingToggle(parentLi, !!parentLi.querySelector(':scope > ul > li'));
         }


         // Check if the entire outline is now empty
         if (State.getRootElement() && State.getRootElement().children.length === 0) {
             console.log("Outline is now empty, resetting state.");
             FileSystem.resetEditorState('empty'); // Use FileSystem's reset which handles UI too
         } else if (itemToSelectAfter && UI.elements.outlineContainer.contains(itemToSelectAfter)) {
              // Select the determined item
              console.log(`Selecting item ${itemToSelectAfter.id} after deletion.`);
              UI.selectAndFocusItem(itemToSelectAfter, false); // Focus at end usually makes sense after delete
         } else {
             // Fallback if something went wrong finding the next item
             console.warn("Outline not empty but couldn't find item to select, resetting might be needed or select first.");
             const firstItem = State.getRootElement()?.querySelector('li');
             if (firstItem) {
                 UI.selectAndFocusItem(firstItem, true);
             } else {
                 FileSystem.resetEditorState('empty'); // Reset if truly messed up
             }
         }

         handleContentChange(); // Mark changes
    };

    // --- Item Manipulation (Indent, Outdent, Move, Type Change, Format) ---

    const indentItem = (li) => {
        if (!li) return;
        const prevLi = li.previousElementSibling;
        // Cannot indent if it's the first item or the previous is a horizontal rule
        if (!prevLi || prevLi.getAttribute('data-type') === 'hr') {
            console.log("Indent prevented: No valid previous sibling.");
            return;
        }

        console.log(`Indenting ${li.id} under ${prevLi.id}`);
        const oldParentUl = li.parentElement;

        // Find or create the target UL in the previous sibling
        let targetUl = prevLi.querySelector(':scope > ul');
        if (!targetUl) {
            targetUl = document.createElement('ul');
            prevLi.appendChild(targetUl);
        }

        // Move the item
        targetUl.appendChild(li);

        // Update folding toggles
        addFoldingToggle(prevLi, true); // Previous sibling now definitely has children
        // Check if old parent LI (if exists) needs its toggle updated
        const oldParentLi = oldParentUl?.closest('li');
         if (oldParentLi && oldParentUl !== State.getRootElement()) {
              addFoldingToggle(oldParentLi, !!oldParentUl.querySelector(':scope > li'));
         }


        // Rescan parent elements for interactivity (safer) - might be optional
         if (prevLi.parentElement) makeEditableAndInteractive(prevLi.parentElement);

        UI.selectAndFocusItem(li, false); // Keep focus on the moved item
        handleContentChange();
    };

    const outdentItem = (li) => {
        if (!li) return;
        const parentUl = li.parentElement;
        // Cannot outdent if already at the root level
        if (!parentUl || parentUl === State.getRootElement()) {
            console.log("Outdent prevented: Item is already at top level.");
            return;
        }

        const grandparentLi = parentUl.closest('li');
        if (!grandparentLi) {
            console.error("Outdent error: Could not find grandparent LI. Structure issue?");
            return;
        }

        console.log(`Outdenting ${li.id} from under ${grandparentLi.id}`);

        // Elements to move: the item itself and any subsequent siblings at the same level
        const itemsToMove = [li];
        let nextSibling = li.nextElementSibling;
        while (nextSibling) {
            itemsToMove.push(nextSibling);
            nextSibling = nextSibling.nextElementSibling;
        }

        // Get the UL where the item will be inserted (grandparent's UL)
        const targetUl = grandparentLi.parentElement;
        if(!targetUl) {
             console.error("Outdent error: Could not find target UL (grandparent's parent).");
             return;
        }

        // Move the item(s) after the grandparent LI
        itemsToMove.forEach(item => targetUl.insertBefore(item, grandparentLi.nextSibling)); // Inserts one after another

        // Update folding toggle for the original parent LI
        addFoldingToggle(grandparentLi, !!parentUl.querySelector(':scope > li'));

        // If the original parent UL is now empty, remove it
        if (parentUl.children.length === 0) {
            console.log(`Removing empty parent UL from ${grandparentLi.id}`);
            parentUl.remove();
             addFoldingToggle(grandparentLi, false); // Ensure toggle removed if now childless
        }

        // Rescan relevant parents
        makeEditableAndInteractive(targetUl);


        UI.selectAndFocusItem(li, false); // Keep focus on the moved item
        handleContentChange();
    };

    const moveItemUp = (li) => {
        if (!li) return;
        const prevLi = li.previousElementSibling;
        if (prevLi) {
            console.log(`Moving ${li.id} up above ${prevLi.id}`);
            li.parentElement.insertBefore(li, prevLi);
            UI.selectAndFocusItem(li, false); // Maintain selection and focus
            handleContentChange();
        } else {
            console.log("Move up prevented: Already first item in its list.");
        }
    };

    const moveItemDown = (li) => {
        if (!li) return;
        const nextLi = li.nextElementSibling;
        if (nextLi) {
            console.log(`Moving ${li.id} down below ${nextLi.id}`);
            // insertBefore(nodeToInsert, referenceNode)
            // If referenceNode is the node itself, it moves it after the next one effectively.
            li.parentElement.insertBefore(nextLi, li);
            UI.selectAndFocusItem(li, false); // Maintain selection and focus
            handleContentChange();
        } else {
            console.log("Move down prevented: Already last item in its list.");
        }
    };

    const changeItemType = (li, newType) => {
         if (!li) return;
         const oldType = li.getAttribute('data-type') || ""; // Default to empty string for plain
         if (newType === oldType) return; // No change needed

         console.log(`Changing type of ${li.id} from '${oldType || 'plain'}' to '${newType || 'plain'}'`);

         // --- Type-Specific Cleanup (Before Changing Attribute) ---
         if (oldType === 'latex') {
             li.querySelector('.rendered-math')?.remove();
             li.querySelector('.katex-error')?.remove();
         }
         if (oldType === 'task') {
              // Remove checkbox and potentially leading space
              const p = li.querySelector(':scope > p');
              p?.querySelector('span.task-checkbox')?.remove();
              if (p?.firstChild?.nodeType === Node.TEXT_NODE && p.firstChild.textContent.startsWith('\u00A0')) {
                  p.firstChild.textContent = p.firstChild.textContent.substring(1);
                  if (!p.firstChild.textContent) p.firstChild.remove();
              }
         }
         if (oldType === 'hr') {
            // If changing *from* HR, ensure a paragraph exists
            if (!li.querySelector(':scope > p')) {
                 const p = document.createElement('p');
                 p.setAttribute('contenteditable', 'true');
                 p.innerHTML = '<br>';
                 li.prepend(p);
            }
            li.removeAttribute('tabindex'); // Remove direct focusability
         }

         // --- Set New Type Attribute ---
         if (newType) {
             li.setAttribute('data-type', newType);
         } else {
             li.removeAttribute('data-type'); // Plain text
         }

         // --- Type-Specific Setup (After Changing Attribute) ---
         let p = li.querySelector(':scope > p'); // Get paragraph reference (might have been created)

         if (newType === 'hr') {
             if (p) p.remove(); // Remove paragraph for HR
             li.removeAttribute('draggable'); // HR not draggable
             li.tabIndex = 0; // Make focusable via selection
             li.focus(); // Focus the LI itself
         } else {
             // Ensure paragraph exists for non-HR types
             if (!p) {
                 p = document.createElement('p');
                 p.setAttribute('contenteditable', 'true');
                 p.innerHTML = '<br>';
                 li.prepend(p);
             }
             // General setup (adds checkbox for task, renders LaTeX, etc.)
             setupParagraph(p, li);
             // Ensure draggable if not HR
             li.setAttribute('draggable', 'true');
             setupDragListeners(li); // Ensure listeners are attached
             // Focus the paragraph
             UI.focusAndMoveCursor(p, false); // Focus at end after type change
         }

         handleContentChange({ target: p || li }); // Trigger state update
    };

    const formatSelection = (command) => {
         const targetP = UI.ensureFocusInEditableParagraph(); // Ensures focus is in selected LI's P
         if (!targetP) return;

         switch (command) {
             case 'bold':
             case 'italic':
                 document.execCommand(command, false, null);
                 break;
             case 'code':
                 wrapSelection('code', targetP);
                 break;
             case 'highlight': // Use <mark> for highlighting
                 wrapSelection('mark', targetP);
                 break;
             default:
                 console.warn("Unknown format command:", command);
                 return;
         }
          targetP.focus(); // Refocus after command
          handleContentChange({ target: targetP }); // Mark changes
    };

    const wrapSelection = (tagName, targetP) => {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return; // No selection

        const range = selection.getRangeAt(0);
        if (range.collapsed) {
            // Maybe insert empty tags and place cursor inside? For now, require selection.
             alert(`Please select the text you want to format as ${tagName}.`);
             return;
        }

        // Check if selection is fully contained within the target paragraph
        if (!targetP.contains(range.commonAncestorContainer)) {
             console.warn("Selection spans outside the target paragraph.");
             // Could try to apply formatting only to the part within the paragraph,
             // but document.execCommand might be more reliable for complex cases.
             // Using execCommand as a fallback or primary method might be safer.
             // For simplicity here, we proceed but it might have edge cases.
        }

        const wrapper = document.createElement(tagName);

        try {
            // More robust check: Check if the exact selection is already wrapped
            let parentElement = range.commonAncestorContainer;
            if (parentElement.nodeType !== Node.ELEMENT_NODE) {
                parentElement = parentElement.parentElement;
            }

            // If the direct parent matches the tag AND the selection spans the entire parent's content
            if (parentElement?.tagName.toLowerCase() === tagName && range.toString() === parentElement.textContent) {
                console.log(`Unwrapping ${tagName}`);
                const content = range.extractContents(); // Get the content
                parentElement.replaceWith(content); // Replace the wrapper with its content
            } else {
                 // Check if selection start or end is already wrapped in the SAME tag type
                 const startNodeParent = range.startContainer.parentElement;
                 const endNodeParent = range.endContainer.parentElement;
                 if (startNodeParent?.tagName.toLowerCase() === tagName || endNodeParent?.tagName.toLowerCase() === tagName) {
                      // Selection overlaps existing tag of same type - unwrap using formatBlock or similar might be better
                      // For now, attempt basic unwrap via execCommand (might be less precise)
                       console.log(`Attempting to unwrap overlapping ${tagName} using execCommand`);
                       document.execCommand('removeFormat', false, null); // Generic unwrap
                       // Might need to re-apply to parts if only partially overlapped - complex.
                       // Or, more simply, just re-wrap the whole selection, potentially creating nested tags (undesirable).
                       // Let's stick to the simple wrap/unwrap based on direct parent for now.

                       // Alternative: Use execCommand for these simple tags?
                       // document.execCommand('formatBlock', false, tagName); // Doesn't work for inline like code/mark
                       // Let's stick to surroundContents for wrapping for now.
                       console.log(`Wrapping selection with ${tagName}`);
                       range.surroundContents(wrapper);

                 } else {
                     console.log(`Wrapping selection with ${tagName}`);
                     range.surroundContents(wrapper); // Wrap the selected content
                 }
            }
            // Restore selection around the modified content
             selection.removeAllRanges();
             selection.addRange(range);

        } catch (e) {
            console.warn(`Wrap/Unwrap with ${tagName} failed, potentially due to complex selection (e.g., across block elements). Error:`, e);
            // Fallback using insertHTML (loses original nodes, less ideal but might work)
            // const selectedHtml = range.toString();
            // document.execCommand('insertHTML', false, `<${tagName}>${Utils.escapeXml(selectedHtml)}</${tagName}>`);
            alert(`Could not apply ${tagName} formatting due to complex selection.`);
        }
    };

     const handleLinkButtonClick = () => {
        const targetP = UI.ensureFocusInEditableParagraph();
        if (!targetP) return;

        const selection = window.getSelection();
        if (!selection) return;

        const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

        // Find if the current selection or cursor is inside an existing link
        let parentLink = null;
        if (currentRange) {
            let container = currentRange.commonAncestorContainer;
            parentLink = container.nodeType === Node.ELEMENT_NODE ? container.closest('a') : container.parentElement?.closest('a');
             // If selection spans multiple nodes, check start and end containers too
             if (!parentLink) parentLink = currentRange.startContainer.parentElement?.closest('a');
             if (!parentLink) parentLink = currentRange.endContainer.parentElement?.closest('a');
        }


        const defaultUrl = parentLink ? parentLink.getAttribute('href') || "" : "https://";
        const url = prompt("Enter link URL (leave empty to remove link):", defaultUrl);

        if (url === null) { // User cancelled
            console.log("Link creation/modification cancelled.");
            return;
        }

        // Restore selection before executing commands
        if (currentRange) {
            selection.removeAllRanges();
            selection.addRange(currentRange);
        } else {
            // If no range, ensure focus is back in the paragraph
             UI.focusAndMoveCursor(targetP, false);
        }


        // If inside a link, always unlink first to handle modification correctly
        if (parentLink) {
             console.log("Unlinking existing link first.");
              // Select the link element itself to ensure unlink works reliably
              const linkRange = document.createRange();
              linkRange.selectNode(parentLink);
              selection.removeAllRanges();
              selection.addRange(linkRange);
             document.execCommand('unlink', false, null);
             // Restore original selection *after* unlinking
              if (currentRange) {
                  selection.removeAllRanges();
                  selection.addRange(currentRange);
              }
        }


        // Apply new link if URL is provided
        if (url !== "") {
            const safeUrl = Utils.escapeXml(url); // Basic sanitization
            if (currentRange && !currentRange.collapsed) {
                 // Apply link to existing selection
                 document.execCommand('createLink', false, safeUrl);
                 console.log(`Applied link ${safeUrl} to selection.`);
            } else {
                 // Insert new link text if selection was collapsed
                 // Create a link node manually for better control
                  const newLink = document.createElement('a');
                  newLink.href = safeUrl;
                  newLink.textContent = url; // Display the URL as text initially

                 if (currentRange) {
                      currentRange.insertNode(newLink);
                      // Move cursor after the inserted link
                       currentRange.setStartAfter(newLink);
                       currentRange.collapse(true);
                       selection.removeAllRanges();
                       selection.addRange(currentRange);

                 } else { // Fallback if no range somehow
                      targetP.appendChild(newLink);
                 }

                 console.log(`Inserted new link: ${url}`);
            }
        } else {
            console.log("URL cleared, only unlink performed (if applicable).");
        }

        targetP.focus(); // Ensure focus remains in the paragraph
        handleContentChange({ target: targetP });
    };

    // --- Drag and Drop ---

    const setupDragListeners = (li) => {
        // Remove existing listeners first to prevent duplicates if called multiple times
        li.removeEventListener('dragstart', handleDragStart);
        li.removeEventListener('dragend', handleDragEnd);
        li.removeEventListener('dragover', handleDragOver);
        li.removeEventListener('dragenter', handleDragEnter);
        li.removeEventListener('dragleave', handleDragLeave);
        li.removeEventListener('drop', handleDrop);
        // Add new listeners
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragend', handleDragEnd);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('dragenter', handleDragEnter);
        li.addEventListener('dragleave', handleDragLeave);
        li.addEventListener('drop', handleDrop);
    };

    function handleDragStart(e) {
        // Allow drag only on the LI itself, not inner elements like links or the fold toggle
        if (e.target !== this || e.target.classList.contains('fold-toggle') || e.target.closest('a')) {
             // Check common non-draggable elements inside LI
              if(!e.target.closest('p')) { // Allow drag if started on P element within LI
                   e.preventDefault();
                   console.log("Drag prevented on inner element.");
                   return false;
              }
        }

        // Don't drag HR items
        if (this.getAttribute('data-type') === 'hr') {
            e.preventDefault();
            return false;
        }

        // Prevent drag if loading
        if (State.getIsLoading()) {
            e.preventDefault();
            return false;
        }

        State.setCurrentlyDraggedLi(this); // 'this' is the LI element
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.id); // Use ID for identification

        // Custom drag image (optional, but nice)
        const ghost = this.cloneNode(true);
        ghost.style.opacity = '0.6';
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px'; // Position offscreen
        ghost.style.width = `${this.offsetWidth}px`; // Match width
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 20, 10); // Offset slightly

        // Cleanup ghost after drag starts
        setTimeout(() => ghost.remove(), 0);

        // Add dragging class *after* setting drag image
        requestAnimationFrame(() => {
             this.classList.add('dragging');
        });


        UI.createDropIndicator(); // Ensure indicator exists
        console.log(`Drag Start: ${this.id}`);
    }

     function handleDragOver(e) {
        const draggedLi = State.getCurrentlyDraggedLi();
        if (!draggedLi) return;

        e.preventDefault(); // Necessary to allow dropping
        e.dataTransfer.dropEffect = 'move';

        const dropTargetLi = this; // 'this' is the LI being dragged over

        // Basic validation: Must be a valid LI in the container, not the item being dragged, and not a descendant of the dragged item
        if (!dropTargetLi || !UI.elements.outlineContainer.contains(dropTargetLi) || dropTargetLi === draggedLi || draggedLi.contains(dropTargetLi)) {
            UI.hideDropIndicator();
            State.setLastDropTarget(null);
            State.setLastDropPosition(null);
            return;
        }

        // Determine drop position (before, after, inside) based on cursor Y relative to target LI
        const rect = dropTargetLi.getBoundingClientRect();
        const mouseY = e.clientY;
        const relativeY = mouseY - rect.top;
        const threshold = rect.height * 0.25; // Top 25% = before, Bottom 25% = after
        const indentThreshold = rect.height * 0.75; // Allow dropping 'inside' in the middle 50%

        let dropPosition;
        if (relativeY < threshold) {
            dropPosition = 'before';
        } else if (relativeY > indentThreshold) {
            dropPosition = 'after';
        } else {
             // Only allow 'inside' drop if the target is not an HR
             dropPosition = (dropTargetLi.getAttribute('data-type') !== 'hr') ? 'inside' : 'after'; // Default to 'after' for HR
        }


        // Update state and show indicator
        State.setLastDropTarget(dropTargetLi);
        State.setLastDropPosition(dropPosition);
        UI.showDropIndicator(dropTargetLi, dropPosition);
    }


    function handleDragEnter(e) {
        // Can add highlighting on the potential drop target LI if desired
         if (!State.getCurrentlyDraggedLi() || this === State.getCurrentlyDraggedLi()) return;
         e.preventDefault(); // Allow drop
         // this.classList.add('drag-over-target'); // Example highlight
    }

    function handleDragLeave(e) {
         if (!State.getCurrentlyDraggedLi()) return;
         // Remove highlighting when leaving the LI element boundary
         // Check relatedTarget to ensure we haven't just moved onto a child element
         if (!this.contains(e.relatedTarget)) {
             // this.classList.remove('drag-over-target');
             // Hide indicator only if leaving the *current* potential drop target
              if(State.getLastDropTarget() === this) {
                 UI.hideDropIndicator();
                 State.setLastDropTarget(null);
                 State.setLastDropPosition(null);
              }
         }
    }

    function handleDrop(e) {
        const draggedLi = State.getCurrentlyDraggedLi();
        const dropTargetLi = State.getLastDropTarget();
        const dropPosition = State.getLastDropPosition();

        if (!draggedLi || !dropTargetLi || !dropPosition || dropTargetLi === draggedLi || draggedLi.contains(dropTargetLi)) {
             console.log("Drop cancelled - invalid target or position.");
             handleDragEnd.call(draggedLi); // Clean up state as if drag ended normally
             return;
        }

        e.preventDefault(); // Prevent default browser drop behavior
        e.stopPropagation(); // Prevent drop event from bubbling up (e.g., to parent LIs)

        console.log(`Drop: Moving ${draggedLi.id} ${dropPosition} ${dropTargetLi.id}`);

        // Perform the actual move in the DOM
        moveItemToTarget(draggedLi, dropTargetLi, dropPosition);

        // Select the moved item and mark changes
        UI.selectAndFocusItem(draggedLi, false);
        handleContentChange({target: draggedLi}); // Mark dirty

        // Clean up happens in handleDragEnd, which is called automatically after drop
    }

     function handleDragEnd(e) {
        const draggedLi = State.getCurrentlyDraggedLi();
        if (!draggedLi) return; // Should have the LI reference here ('this' or from state)

        if (draggedLi && UI.elements.outlineContainer.contains(draggedLi)) { // Check if still in DOM
            draggedLi.classList.remove('dragging');
        }

        // General cleanup regardless of drop success
        UI.hideDropIndicator();
        State.setCurrentlyDraggedLi(null);
        State.setLastDropTarget(null);
        State.setLastDropPosition(null);
        // document.querySelectorAll('.drag-over-target').forEach(el => el.classList.remove('drag-over-target')); // Remove any lingering highlights
        console.log("Drag End");
    }

    function moveItemToTarget(draggedItem, targetItem, position) {
        if (!draggedItem || !targetItem || !position) return false;

        const originalParentUl = draggedItem.parentElement;
        const originalParentLi = originalParentUl?.closest('li'); // Parent before move

        try {
            switch (position) {
                case 'before':
                    targetItem.parentElement.insertBefore(draggedItem, targetItem);
                    break;
                case 'after':
                    // insertBefore(newNode, referenceNode) - if referenceNode is null, appends to end
                    targetItem.parentElement.insertBefore(draggedItem, targetItem.nextSibling);
                    break;
                case 'inside':
                    let targetUl = targetItem.querySelector(':scope > ul');
                    if (!targetUl) {
                        targetUl = document.createElement('ul');
                        targetItem.appendChild(targetUl);
                    }
                    targetUl.appendChild(draggedItem); // Append as last child inside
                    addFoldingToggle(targetItem, true); // Ensure target has fold toggle
                    // Unfold target if necessary
                     if (targetItem.getAttribute('data-folded') === 'true') {
                         targetItem.removeAttribute('data-folded');
                     }
                    break;
                default:
                     console.error("Invalid drop position:", position);
                     return false;
            }

            // --- Cleanup and Toggle Updates ---
            // 1. Check if the original parent UL (if not root) is now empty
            if (originalParentUl && originalParentUl !== State.getRootElement() && originalParentUl.children.length === 0) {
                if (originalParentLi) {
                    originalParentUl.remove();
                    addFoldingToggle(originalParentLi, false); // Original parent LI no longer has children
                }
            }
            // 2. Update toggle of original parent LI if it still exists and has other children
            else if (originalParentLi) {
                 addFoldingToggle(originalParentLi, !!originalParentUl.querySelector(':scope > li'));
            }

            // 3. Ensure the new parent LI (if dropped inside) has toggle updated (already done in 'inside' case)

            // 4. Rescan interactivity? Might be needed if structure changes significantly.
            // makeEditableAndInteractive(draggedItem.parentElement); // Rescan new parent UL
             if(originalParentUl && document.body.contains(originalParentUl)) {
                 // makeEditableAndInteractive(originalParentUl); // Rescan old parent UL if still exists
             }

            return true;

        } catch (err) {
            console.error('Error during DOM move in drag and drop:', err);
            // Attempt to revert? Complex. For now, just log the error.
            return false;
        }
    }


    // --- Navigation Helpers ---

    const findPreviousVisibleLi = (li) => {
        if (!li) return null;

        // 1. Try previous sibling
        let current = li.previousElementSibling;
        if (current) {
            // If previous sibling is folded and has children, go to its last visible descendant
             while (current && current.getAttribute('data-folded') !== 'true' && current.querySelector(':scope > ul > li:last-child')) {
                  const lastChildLi = current.querySelector(':scope > ul > li:last-child');
                  if (!lastChildLi) break; // Should not happen if selector worked
                  current = lastChildLi;
                  // Keep going down until we find the absolute last visible item
                  while(current.getAttribute('data-folded') !== 'true' && current.querySelector(':scope > ul > li:last-child')) {
                       const evenLastChild = current.querySelector(':scope > ul > li:last-child');
                       if (!evenLastChild) break;
                       current = evenLastChild;
                  }

             }
             // Filter out HR items if direct navigation lands on one (can still be selected)
             // return (current?.getAttribute('data-type') === 'hr') ? findPreviousVisibleLi(current) : current;
             return current; // Allow selecting HR for consistency
        } else {
             // 2. Try parent LI
             const parentUl = li.parentElement;
             const parentLi = parentUl?.closest('li');
             // Return parent LI only if it's not the root UL's container (i.e., not null)
             // return (parentLi && parentUl !== State.getRootElement()) ? parentLi : null;
              if (parentLi && parentUl !== State.getRootElement()) {
                 // return (parentLi.getAttribute('data-type') === 'hr') ? findPreviousVisibleLi(parentLi) : parentLi;
                 return parentLi; // Allow selecting HR
              }
        }
        return null; // No previous visible item
    };

    const findNextVisibleLi = (li) => {
        if (!li) return null;

        // 1. Try first child (if not folded)
         const isFolded = li.getAttribute('data-folded') === 'true';
         if (!isFolded) {
             const firstChildLi = li.querySelector(':scope > ul > li:first-child');
             if (firstChildLi) {
                 // return (firstChildLi.getAttribute('data-type') === 'hr') ? findNextVisibleLi(firstChildLi) : firstChildLi;
                 return firstChildLi; // Allow selecting HR
             }
         }


        // 2. Try next sibling
        let current = li;
        while (current) {
            const nextSiblingLi = current.nextElementSibling;
            if (nextSiblingLi) {
                 // return (nextSiblingLi.getAttribute('data-type') === 'hr') ? findNextVisibleLi(nextSiblingLi) : nextSiblingLi;
                 return nextSiblingLi; // Allow selecting HR
            }

            // 3. Try parent's next sibling
            const parentUl = current.parentElement;
            if (parentUl === State.getRootElement()) break; // Reached top level
            current = parentUl?.closest('li'); // Move up to the parent LI
            // Loop continues to check the parent's next sibling
        }

        return null; // No next visible item
    };


    // --- Public API ---
    return {
        initialize,
        parseAndRenderBike,
        serializeOutlineToHTML,
        makeEditableAndInteractive, // Expose if needed externally (e.g., after direct DOM changes)
        handleContentChange,        // Called by event listeners
        triggerAutoSaveDraft,       // Called by handleContentChange
        createMinimalStructure,     // Called by fileSystem for 'new'
        createNewItem,              // Called by keyboard handler
        deleteItem,                 // Called by keyboard handler / toolbar
        indentItem,                 // Called by keyboard handler / toolbar
        outdentItem,                // Called by keyboard handler / toolbar
        moveItemUp,                 // Called by keyboard handler / toolbar
        moveItemDown,               // Called by keyboard handler / toolbar
        changeItemType,             // Called by keyboard handler / toolbar
        formatSelection,            // Called by keyboard handler / toolbar
        handleLinkButtonClick,      // Called by keyboard handler / toolbar
        findPreviousVisibleLi,      // Called by keyboard handler
        findNextVisibleLi,          // Called by keyboard handler
        // Drag & Drop handlers are internal to setupDragListeners
        addFoldingToggle, // Might be needed if dynamically adding children externally
        setupParagraph // Might be useful externally?
    };
})();