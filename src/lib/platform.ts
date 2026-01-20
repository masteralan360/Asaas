/**
 * Platform detection and abstraction for Tauri (Desktop) and Capacitor (Mobile/Android)
 */

export const isDesktop = () => !!(window as any).__TAURI__ || !!(window as any).__TAURI_METADATA__;
export const isMobile = () => !!(window as any).Capacitor;
export const isWeb = () => !isDesktop() && !isMobile();

export type Platform = 'desktop' | 'mobile' | 'web';

export const getPlatform = (): Platform => {
    if (isDesktop()) return 'desktop';
    if (isMobile()) return 'mobile';
    return 'web';
};

/**
 * Common platform interface to abstract away host-specific APIs
 */
export interface PlatformAPI {
    // Filesystem
    convertFileSrc: (path: string) => string;
    getAppDataDir: () => Promise<string>;
    joinPath: (...parts: string[]) => Promise<string>;

    // Dialogs
    message: (message: string, options?: { title?: string; type?: 'info' | 'warning' | 'error' }) => Promise<void>;
    confirm: (message: string, options?: { title?: string; type?: 'info' | 'warning' | 'error' }) => Promise<boolean>;

    // App info
    getVersion: () => Promise<string>;
    relaunch: () => Promise<void>;
}
