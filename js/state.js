// js/state.js
const State = (() => {
    let rootUlElement = null;
    let currentlySelectedLi = null;
    let directFileHandle = null;
    let persistentOpfsHandle = null;
    let currentFileSource = 'empty'; // 'direct', 'opfs', 'copy', 'draft', 'new', 'empty'
    let opfsRoot = null;
    let fileSystemWorker = null;
    let isDirty = false;
    let opfsIsInitialized = false;
    let isLoading = false;
    let currentlyDraggedLi = null; // For drag & drop state
    let lastDropTarget = null;    // For drag & drop state
    let lastDropPosition = null;  // For drag & drop state

    // --- Getters ---
    const getRootElement = () => rootUlElement;
    const getSelectedLi = () => (currentlySelectedLi && document.body.contains(currentlySelectedLi)) ? currentlySelectedLi : null; // Ensure it's still in DOM
    const getDirectFileHandle = () => directFileHandle;
    const getPersistentOpfsHandle = () => persistentOpfsHandle;
    const getCurrentFileSource = () => currentFileSource;
    const getOpfsRoot = () => opfsRoot;
    const getFileSystemWorker = () => fileSystemWorker;
    const getIsDirty = () => isDirty;
    const getOpfsIsInitialized = () => opfsIsInitialized;
    const getIsLoading = () => isLoading;
    const getCurrentlyDraggedLi = () => currentlyDraggedLi;
    const getLastDropTarget = () => lastDropTarget;
    const getLastDropPosition = () => lastDropPosition;

    // --- Setters ---
    const setRootElement = (element) => { rootUlElement = element; };
    const setSelectedLi = (liElement) => {
        if (currentlySelectedLi && document.body.contains(currentlySelectedLi)) {
             currentlySelectedLi.classList.remove('selected');
             if (currentlySelectedLi.getAttribute('data-type') === 'hr') currentlySelectedLi.removeAttribute('tabindex');
        }
        currentlySelectedLi = (liElement && document.body.contains(liElement)) ? liElement : null;
        if (currentlySelectedLi) {
             currentlySelectedLi.classList.add('selected');
             if (currentlySelectedLi.getAttribute('data-type') === 'hr') currentlySelectedLi.tabIndex = 0;
        }
    };
    const setDirectFileHandle = (handle) => { directFileHandle = handle; };
    const setPersistentOpfsHandle = (handle) => { persistentOpfsHandle = handle; };
    const setCurrentFileSource = (source) => { currentFileSource = source; };
    const setOpfsRoot = (root) => { opfsRoot = root; };
    const setFileSystemWorker = (worker) => { fileSystemWorker = worker; };
    const setIsDirty = (dirty) => { isDirty = dirty; };
    const setOpfsIsInitialized = (initialized) => { opfsIsInitialized = initialized; };
    const setIsLoading = (loading) => { isLoading = loading; };
    const setCurrentlyDraggedLi = (li) => { currentlyDraggedLi = li; };
    const setLastDropTarget = (li) => { lastDropTarget = li; };
    const setLastDropPosition = (pos) => { lastDropPosition = pos; };

    // --- State Change Actions ---
    const markAsClean = () => {
        if (isDirty) {
            console.log("Marking content as clean (saved).");
            setIsDirty(false);
            // Clear draft only if a primary source was successfully saved
            if (currentFileSource === 'direct' || currentFileSource === 'opfs') {
                localStorage.removeItem(FileSystem.LOCAL_STORAGE_KEY); // Access constant via FileSystem module
                console.log("Primary file saved, temporary draft cleared.");
            }
        }
    };

    const markAsDirty = () => {
        if (!isLoading && !isDirty) {
            console.log("Content changed, marking as dirty.");
            setIsDirty(true);
            // Trigger auto-save draft might be called elsewhere after this
        }
    };

    return {
        // Constants (moved to specific modules where primarily used, or stay here if truly global)

        // Getters
        getRootElement,
        getSelectedLi,
        getDirectFileHandle,
        getPersistentOpfsHandle,
        getCurrentFileSource,
        getOpfsRoot,
        getFileSystemWorker,
        getIsDirty,
        getOpfsIsInitialized,
        getIsLoading,
        getCurrentlyDraggedLi,
        getLastDropTarget,
        getLastDropPosition,

        // Setters
        setRootElement,
        setSelectedLi,
        setDirectFileHandle,
        setPersistentOpfsHandle,
        setCurrentFileSource,
        setOpfsRoot,
        setFileSystemWorker,
        setIsDirty,
        setOpfsIsInitialized,
        setIsLoading,
        setCurrentlyDraggedLi,
        setLastDropTarget,
        setLastDropPosition,

        // Actions
        markAsClean,
        markAsDirty
    };
})();