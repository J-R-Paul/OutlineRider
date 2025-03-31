// OutlineRider Web Worker
// This worker handles background file operations for the OPFS (Origin Private File System)

self.onmessage = async (event) => {
    const { action, fileName, content, operationId } = event.data;

    console.log(`Worker: Received message with action: ${action}, fileName: ${fileName || 'N/A'}`);

    try {
        if (action === 'saveOpfs') {
            console.log(`Worker: Saving to OPFS: ${fileName}`);
            
            // Get root directory
            const root = await navigator.storage.getDirectory();
            
            // Get or create the file handle
            const fileHandle = await root.getFileHandle(fileName, { create: true });
            
            // Try multiple approaches to write the file based on available APIs
            try {
                // Method 1: Use modern createWritable API if available
                if (typeof fileHandle.createWritable === 'function') {
                    const writable = await fileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                    console.log(`Worker: File saved using createWritable API: ${fileName}`);
                } 
                // Method 2: Fall back to direct write method
                else {
                    // Create a text encoder to convert string to binary
                    const encoder = new TextEncoder();
                    const encodedContent = encoder.encode(content);
                    
                    // Create a blob of the content
                    const blob = new Blob([encodedContent], { type: 'application/xhtml+xml' });
                    
                    // Open a writable file stream (older API)
                    const file = await fileHandle.createWriter();
                    // Truncate any existing content
                    await file.truncate(0);
                    // Write the new content
                    await file.write(0, blob);
                    // Close the file
                    await file.close();
                    
                    console.log(`Worker: File saved using direct write method: ${fileName}`);
                }
                
                // Send success message back to main thread
                self.postMessage({ 
                    fileName, 
                    success: true, 
                    action,
                    operationId // Echo back the operation ID if provided
                });
            } 
            catch (writeError) {
                console.error(`Worker: Error writing to file ${fileName} using standard APIs:`, writeError);
                
                // Method 3: Last resort - atomic file write
                try {
                    const encoder = new TextEncoder();
                    const encodedContent = encoder.encode(content);
                    
                    // Try to use an atomic write operation
                    await root.removeEntry(fileName).catch(() => {}); // Remove if exists
                    const newFileHandle = await root.getFileHandle(fileName, { create: true });
                    
                    // Get access to the file for writing
                    const accessHandle = await newFileHandle.createSyncAccessHandle();
                    const bytesWritten = accessHandle.write(encodedContent, 0);
                    await accessHandle.flush();
                    accessHandle.close();
                    
                    console.log(`Worker: File saved using atomic write: ${fileName}, bytes: ${bytesWritten}`);
                    
                    self.postMessage({ 
                        fileName, 
                        success: true, 
                        action,
                        operationId
                    });
                }
                catch (atomicError) {
                    console.error(`Worker: All file writing methods failed for ${fileName}:`, atomicError);
                    throw new Error(`Failed to write file after trying multiple methods: ${writeError.message}, then: ${atomicError.message}`);
                }
            }
        } else {
            console.warn(`Worker: Unknown action: ${action}`);
            self.postMessage({ 
                fileName, 
                success: false, 
                error: `Unknown action: ${action}`,
                action,
                operationId
            });
        }
    } catch (error) {
        console.error(`Worker: Error processing ${action} for ${fileName}:`, error);
        self.postMessage({ 
            fileName, 
            success: false, 
            error: error.message || String(error),
            action,
            operationId
        });
    }
};

// Send ready message
self.postMessage({ ready: true, message: 'Worker initialized' });