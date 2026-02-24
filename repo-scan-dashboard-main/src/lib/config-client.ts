// Client-side configuration (no sensitive data)
// Default to same-origin for production deployments (e.g., Vercel)
// In Electron, if the file protocol is used, connect to the local internal Node backend
export const API_URL = (() => {
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
        return 'http://localhost:3001';
    }
    return (import.meta.env.VITE_API_URL ?? '').trim();
})();
