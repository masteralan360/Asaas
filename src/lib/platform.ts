/**
 * Platform detection and abstraction for Tauri (Desktop) and Capacitor (Mobile/Android)
 */

export const isTauri = () =>
    !!(window as any).__TAURI__ ||
    !!(window as any).__TAURI_METADATA__ ||
    !!(window as any).__TAURI_INTERNALS__;
export const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
export const isDesktop = () => isTauri() && !isMobile();
export const isWeb = () => !isTauri();

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

    // Media
    pickAndSaveImage: (workspaceId: string, subDir?: string) => Promise<string | null>;
    resizeImage: (filePath: string, maxWidth?: number) => Promise<string>;
    saveAs: (content: Uint8Array, fileName: string, extensions: { name: string, extensions: string[] }[]) => Promise<string | null>;
}
