export const NOVU_APP_ID = import.meta.env.VITE_NOVU_APP_ID || '';

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
    backendUrl: 'https://api.novu.co', // Default Cloud URL
    socketUrl: 'https://ws.novu.co',   // Default Cloud URL
};
