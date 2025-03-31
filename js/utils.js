// js/utils.js
const Utils = (() => {
    // Generates a pseudo-unique ID for DOM elements
    function generateUniqueId(length = 4) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        let id = '', attempts = 0;
        const maxAttempts = 100;
        do {
            id = chars.charAt(Math.floor(Math.random() * chars.length));
            for (let i = 1; i < length; i++) {
                id += (chars + '0123456789').charAt(Math.floor(Math.random() * (chars.length + 10)));
            }
            attempts++;
        } while (document.getElementById(id) && attempts < maxAttempts);

        if (attempts >= maxAttempts) {
            console.warn("Could not generate unique ID, using fallback.");
            return `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        }
        return id;
    }

    // Escapes XML special characters for safe inclusion in XML/HTML content
    function escapeXml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe.replace(/[<>&'"]/g, c => ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '\'': '&apos;',
            '"': '&quot;'
        })[c] || c);
    }

    // Debounce function
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    return {
        generateUniqueId,
        escapeXml,
        debounce
    };
})();