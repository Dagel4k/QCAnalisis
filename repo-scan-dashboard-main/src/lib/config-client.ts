// Client-side configuration (no sensitive data)
// Default to same-origin for production deployments (e.g., Vercel)
export const API_URL = (import.meta.env.VITE_API_URL ?? '').trim();
