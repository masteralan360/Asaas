// Utility for robust network status check
// Supplementing navigator.onLine with actual connectivity checks

let isActuallyOnline = navigator.onLine;

// Update the global state
export function setNetworkStatus(online: boolean) {
    isActuallyOnline = online;
}

// Get the current robust status
export function isOnline(): boolean {
    return isActuallyOnline && navigator.onLine;
}
