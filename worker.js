// worker.js

self.onmessage = async (event) => {
    // Expect action: 'save', fileName: fixed_filename, content: html_string
    const { action, fileName, content } = event.data;

    if (action === 'save') {
        if (!fileName || typeof content === 'undefined') {
             self.postMessage({ success: false, error: 'Worker: Missing fileName or content.', fileName: fileName });
             return;
        }

        let accessHandle = null;
        let root = null;
        try {
            // Get root directory *inside worker*
             // Check if storage foundation APIs are available
             if (!self.navigator?.storage?.getDirectory) {
                  throw new Error("OPFS API (navigator.storage.getDirectory) not available in this worker context.");
             }
             root = await self.navigator.storage.getDirectory();

             // Get file handle *inside worker*, ensure creation
             const handle = await root.getFileHandle(fileName, { create: true });

            // --- File Locking Simulation (Basic) ---
            // This is a very basic attempt to prevent simultaneous writes.
            // A more robust solution might use Web Locks API if available.
            if (self.isSaving) {
                console.warn("Worker: Save already in progress, skipping this request for:", fileName);
                // Optionally notify main thread it was skipped?
                // self.postMessage({ success: false, error: 'Save skipped, already in progress.', fileName: fileName, skipped: true });
                return;
            }
            self.isSaving = true;
            // --- End Locking ---


            // Request exclusive access for writing
            accessHandle = await handle.createSyncAccessHandle();
            console.log(`Worker: Acquired sync access handle for ${fileName}`);

            // Encode content to buffer
            const encoder = new TextEncoder(); // UTF-8
            const encodedContent = encoder.encode(content);
            const writeSize = encodedContent.byteLength;

             console.log(`Worker: Writing ${writeSize} bytes to ${fileName}`);
            // Write the new content starting at the beginning
            const writtenBytes = accessHandle.write(encodedContent, { "at": 0 });
            if (writtenBytes !== writeSize) {
                 console.warn(`Worker: Bytes written (${writtenBytes}) does not match expected size (${writeSize}) for ${fileName}`);
                 // Might still be okay if underlying system handles it, but worth noting.
            }

            // Truncate the file to the exact size of the new content
             console.log(`Worker: Truncating ${fileName} to ${writeSize} bytes`);
            accessHandle.truncate(writeSize);

            // Persist changes to disk
             console.log(`Worker: Flushing changes for ${fileName}`);
            accessHandle.flush();

            // Close the access handle to release the lock
             console.log(`Worker: Closing handle for ${fileName}`);
            accessHandle.close();
            accessHandle = null; // Mark as closed

            // Send success message back
            self.postMessage({ success: true, fileName: fileName });
             console.log(`Worker: Successfully saved ${fileName}`);

        } catch (error) {
            console.error(`Worker: Error saving ${fileName}:`, error.name, error.message, error.stack);
            let userMessage = `Worker error: ${error.message || 'An unknown error occurred during save.'}`;
             if (error.name === 'NoModificationAllowedError') {
                 userMessage = 'Worker error: Could not write to file. It might be locked or permissions changed.';
            } else if (error.name === 'QuotaExceededError') {
                userMessage = 'Worker error: Storage quota exceeded. Cannot save file.';
            } else if (error.name === 'TypeError' && error.message.includes('getDirectory')) {
                 userMessage = 'Worker error: OPFS API is not available or accessible.';
            }
             // Ensure handle is closed even on error
            if (accessHandle) {
                try {
                     console.warn(`Worker: Attempting to close handle for ${fileName} after error.`);
                     accessHandle.close();
                } catch (closeError) { console.error("Worker: Error closing handle after error:", closeError); }
            }
            self.postMessage({ success: false, error: userMessage, fileName: fileName });
        } finally {
             // --- Release Lock ---
             self.isSaving = false;
             // --- End Release Lock ---
        }
    } else {
        console.warn('Worker: Unknown action received:', action);
        self.postMessage({ success: false, error: `Unknown action: ${action}` });
    }
};