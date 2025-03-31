// js/latex.js
const LaTeX = (() => {
    let katexInitialized = typeof katex !== 'undefined';
    const DEFAULT_LATEX = '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}'; // Keep default here

    const initialize = () => {
        if (!katexInitialized && typeof katex !== 'undefined') {
            katexInitialized = true;
            console.log("KaTeX library initialized.");
        } else if (!katexInitialized) {
             console.warn('KaTeX library not loaded at initialization.');
        }
        // Could add a listener here to check if KaTeX loads later, if needed.
    };

    const renderLaTeXBlock = (pElement, liElement) => {
        if (!katexInitialized && typeof katex !== 'undefined') {
            katexInitialized = true; // Lazy initialization if loaded late
        }
        if (!katexInitialized) {
            console.warn('KaTeX library not loaded, cannot render LaTeX');
            // Maybe display a placeholder message in the UI?
            return;
        }

        // Ensure elements are valid
        if (!pElement || !liElement || liElement.getAttribute('data-type') !== 'latex') {
            console.warn("RenderLaTeXBlock called with invalid elements or non-LaTeX item.");
            return;
        }

        // Remove any previously rendered math or error messages
        liElement.querySelector('.rendered-math')?.remove();
        liElement.querySelector('.katex-error')?.remove();

        const latexContent = pElement.textContent?.trim(); // Use optional chaining

        if (!latexContent) {
            console.log("No LaTeX content to render.");
            return; // Nothing to render
        }

        // Create container for rendered math
        const mathContainer = document.createElement('div');
        mathContainer.className = 'rendered-math';
        mathContainer.setAttribute('aria-hidden', 'true'); // Decorative content

        try {
            // Render the math using KaTeX
            katex.render(latexContent, mathContainer, {
                displayMode: true, // Render as a block element
                throwOnError: false, // Don't throw exceptions, display errors inline
                output: 'html' // Ensure HTML output
            });

            // Add the rendered math container right after the source paragraph
            pElement.after(mathContainer);

        } catch (error) {
            console.error('LaTeX rendering error:', error);

            // Create and display an error message container
            const errorContainer = document.createElement('div');
            errorContainer.className = 'katex-error'; // Use for styling errors
            errorContainer.textContent = `LaTeX Error: ${error.message || 'Unknown error'}`;

            // Add error message after the paragraph
            pElement.after(errorContainer);
        }
    };

     // Debounced version for use during input
     const debouncedRenderLaTeXBlock = Utils.debounce(renderLaTeXBlock, 800);

    return {
        initialize,
        renderLaTeXBlock,
        debouncedRenderLaTeXBlock,
        DEFAULT_LATEX // Expose default if needed elsewhere (e.g., creating new latex item)
    };
})();