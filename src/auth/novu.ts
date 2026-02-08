export const NOVU_APP_ID = import.meta.env.VITE_NOVU_APP_ID || '';
export const NOVU_API_URL = import.meta.env.VITE_NOVU_API_URL || 'https://api.novu.co';
export const NOVU_SOCKET_URL = import.meta.env.VITE_NOVU_SOCKET_URL || 'https://ws.novu.co';

/**
 * Novu Subscriber Mapping
 * We use the Supabase User ID as the Novu Subscriber ID.
 */
export function getNovuSubscriberId(supabaseUserId: string | undefined): string {
    return supabaseUserId || '';
}

/**
 * Novu Configuration Object
 */
export const novuConfig = {
    applicationIdentifier: NOVU_APP_ID,
    apiUrl: NOVU_API_URL,
    // Keep backendUrl for backward compatibility (deprecated in Novu SDK).
    backendUrl: NOVU_API_URL,
    socketUrl: NOVU_SOCKET_URL,
};
