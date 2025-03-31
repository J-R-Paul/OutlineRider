// worker.js

self.onmessage = async (event) => {
    const { action, fileName, content } = event.data;

    if (action === 'saveOpfs') {
        if (!fileName || typeof content === 'undefined') {
             console.error('Worker: Missing fileName or content for saveOpfs.');
             self.postMessage({ success: false, error: 'Worker: Missing fileName or content.', fileName: fileName });
             return;
        }
        console.log(`Worker: ---- Starting saveOpfs for ${fileName} ----`);

        let accessHandle = null;
        let fileHandle = null; // Keep track of the file handle too
        try {
            // Get root directory *inside worker*
            console.log("Worker: Getting storage directory...");
            const root = await navigator.storage.getDirectory();
            console.log("Worker: Storage directory obtained.");

            // Get file handle *inside worker* - ensure creation if it doesn't exist
            console.log(`Worker: Getting file handle for ${fileName} (create: true)...`);
            fileHandle = await root.getFileHandle(fileName, { create: true });
            console.log(`Worker: File handle for ${fileName} obtained. Kind: ${fileHandle.kind}, Name: ${fileHandle.name}`);

            // Create SyncAccessHandle
            console.log(`Worker: Creating sync access handle for ${fileName}...`);
            accessHandle = await fileHandle.createSyncAccessHandle();
            console.log("Worker: Sync access handle created.");

            // Encode content to buffer
            const encoder = new TextEncoder(); // UTF-8 by default
            const encodedContent = encoder.encode(content);
            const writeSize = encodedContent.byteLength;
            console.log(`Worker: Encoded content size: ${writeSize} bytes.`);

            // Truncate the file to 0 bytes *before* writing new content
            console.log(`Worker: Truncating ${fileName} to 0 bytes...`);
            accessHandle.truncate(0);
            console.log(`Worker: Truncate command issued for ${fileName}.`);

            // Write the new content starting at the beginning
            console.log(`Worker: Writing ${writeSize} bytes to ${fileName} at offset 0...`);
            const bytesWritten = accessHandle.write(encodedContent, { "at": 0 });
            console.log(`Worker: Write command issued for ${fileName}. Reported bytes written: ${bytesWritten}`);
             if (bytesWritten !== writeSize) {
                  console.warn(`Worker: Mismatch between expected write size (${writeSize}) and reported bytes written (${bytesWritten}).`);
             }

            // Persist changes to disk (important!)
            console.log(`Worker: Flushing changes for ${fileName}...`);
            accessHandle.flush();
            console.log(`Worker: Flush command issued for ${fileName}.`);

            // Optional: Get file size *after* flush (though may not be guaranteed sync)
            // try {
            //     const sizeAfterFlush = accessHandle.getSize();
            //     console.log(`Worker: Size after flush reported by access handle: ${sizeAfterFlush}`);
            //     if (sizeAfterFlush !== writeSize) {
            //          console.warn(`Worker: Size mismatch after flush! Expected ${writeSize}, got ${sizeAfterFlush}.`);
            //     }
            // } catch (getSizeError) {
            //     console.warn("Worker: Could not get size from access handle after flush:", getSizeError);
            // }

            // Close the access handle to release the lock
            console.log(`Worker: Closing access handle for ${fileName}...`);
            accessHandle.close();
            accessHandle = null; // Mark as closed
            console.log(`Worker: Access handle for ${fileName} closed.`);

            console.log(`Worker: ---- Successfully completed saveOpfs for ${fileName} ----`);
            // Send success message back
            self.postMessage({
                action: 'saveOpfs',  // Include the action in response
                success: true,
                fileName: fileName
            });

        } catch (error) {
            console.error(`Worker: !!!! Error during saveOpfs for ${fileName}: !!!!`, error);
            console.error(`Worker: Error Name: ${error.name}`);
            console.error(`Worker: Error Message: ${error.message}`);
            // Attempt to close handle even on error
            if (accessHandle) {
                try {
                    console.warn("Worker: Attempting to close access handle after error...");
                    accessHandle.close();
                    console.log("Worker: Access handle closed after error.");
                 } catch (closeError) { console.error("Worker: Error closing access handle after primary error:", closeError); }
            } else {
                 console.warn("Worker: No access handle to close after error.");
            }
            // Try to provide a more specific error message
            let errorMessage = error.message || 'An unknown error occurred during save.';
            if (error.name === 'NoModificationAllowedError') {
                 errorMessage = 'Could not write to file. It might be locked or permissions changed.';
            } else if (error.name === 'QuotaExceededError') {
                errorMessage = 'Storage quota exceeded. Cannot save file.';
            } else if (error.name === 'TypeError' && error.message.includes('detached')) {
                errorMessage = 'Buffer became detached during operation. This might be an internal browser issue.';
            } else if (error.name === 'InvalidStateError') {
                 errorMessage = 'Invalid state, possibly due to rapid operations or closed handle.';
            }
            self.postMessage({ success: false, error: `Worker error saving ${fileName}: ${errorMessage}`, name: error.name, fileName: fileName });
        }
    } else {
        console.warn('Worker: Unknown action received:', action);
        self.postMessage({ success: false, error: `Unknown action: ${action}` });
    }
};