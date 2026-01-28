import { isDesktop, isMobile, isTauri, PlatformAPI } from '../lib/platform';

/**
 * Service to handle platform-specific operations
 */
class PlatformService implements PlatformAPI {
    private appDataPath: string = '';

    async initialize() {
        if (isTauri()) {
            try {
                const { appDataDir } = await import('@tauri-apps/api/path');
                this.appDataPath = await appDataDir();
                console.log('[PlatformService] Initialized AppData path:', this.appDataPath);

                // On mobile, proactively request basic permissions if needed
                if (isMobile()) {
                    await this.requestMobilePermissions();
                }
            } catch (e) {
                console.error('[PlatformService] Failed to get AppData path:', e);
            }
        }
    }

    /**
     * Request essential mobile permissions for Tauri plugins
     */
    private async requestMobilePermissions() {
        if (!isMobile()) return;

        try {
            const { invoke } = await import('@tauri-apps/api/core');

            // Check and request permissions for dialog and fs plugins
            // Note: identifiers may vary by plugin, but these are standard for v2 mobile plugins

            const plugins = ['dialog', 'fs'];

            for (const plugin of plugins) {
                try {
                    const state = await invoke<any>(`plugin:${plugin}|checkPermissions`);
                    console.log(`[PlatformService] Permission state for ${plugin}:`, state);

                    // On Android, the keys are usually group names like 'mediaLibrary', 'storage', etc.
                    // We try to request anything that says 'prompt'
                    const toRequest = Object.entries(state)
                        .filter(([_, val]) => val === 'prompt' || val === 'prompt-with-rationale')
                        .map(([key, _]) => key);

                    if (toRequest.length > 0) {
                        console.log(`[PlatformService] Requesting permissions for ${plugin}:`, toRequest);
                        await invoke(`plugin:${plugin}|requestPermissions`, { permissions: toRequest });
                    }
                } catch (e) {
                    console.warn(`[PlatformService] Could not check permissions for ${plugin}:`, e);
                }
            }
        } catch (e) {
            console.error('[PlatformService] Error in requestMobilePermissions:', e);
        }
    }

    convertFileSrc(path: string): string {
        if (isTauri()) {
            try {
                let finalPath = path;

                // 1. Resolve relative paths if we have the cached AppData path
                // This handles "product-images/..." -> "C:/Users/.../AppData/.../product-images/..."
                if (this.appDataPath && !path.startsWith('http') && !path.includes(':') && !path.startsWith('/') && !path.startsWith('\\')) {
                    // Normalize everything to forward slashes
                    const cleanAppData = this.appDataPath.replace(/\\/g, '/');
                    const cleanPath = path.replace(/\\/g, '/');

                    const relPath = cleanPath.startsWith('/') ? cleanPath.substring(1) : cleanPath;
                    const base = cleanAppData.endsWith('/') ? cleanAppData.slice(0, -1) : cleanAppData;

                    finalPath = `${base}/${relPath}`;
                }

                // 2. Use Tauri v2 native converter if available
                const tauri = (window as any).__TAURI__;
                if (tauri?.core?.convertFileSrc) {
                    return tauri.core.convertFileSrc(finalPath);
                }

                // 3. Fallback for older patterns / direct construction
                if ((window as any).__TAURI_INTERNALS__) {
                    const normalizedPath = finalPath.replace(/\\/g, '/');
                    const cleanPath = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;

                    // On Mobile (Android), it usually expects asset://localhost/ or asset://
                    if (isMobile()) {
                        return `asset://localhost/${cleanPath}`;
                    }

                    // In v2 on Windows, the protocol is typically https://asset.localhost/
                    return `https://asset.localhost/${cleanPath}`;
                }
            } catch (error) {
                console.error('Error converting file src:', error);
            }
        }
        return path;
    }

    async getAppDataDir(): Promise<string> {
        if (isTauri()) {
            const { appDataDir } = await import('@tauri-apps/api/path');
            return appDataDir();
        }
        return '';
    }

    async joinPath(...parts: string[]): Promise<string> {
        if (isTauri()) {
            const { join } = await import('@tauri-apps/api/path');
            return join(...parts);
        }
        return parts.join('/');
    }

    async message(message: string, options?: { title?: string; type?: 'info' | 'warning' | 'error' }): Promise<void> {
        if (isTauri()) {
            const { message: tauriMessage } = await import('@tauri-apps/plugin-dialog');
            await tauriMessage(message, {
                title: options?.title || 'ERP System',
                kind: options?.type as any || 'info'
            });
            return;
        }
        alert(message);
    }

    async confirm(message: string, options?: { title?: string; type?: 'info' | 'warning' | 'error' }): Promise<boolean> {
        if (isTauri()) {
            const { ask } = await import('@tauri-apps/plugin-dialog');
            return ask(message, {
                title: options?.title || 'ERP System',
                kind: options?.type as any || 'info'
            });
        }
        return window.confirm(message);
    }

    async getVersion(): Promise<string> {
        try {
            if (isTauri()) {
                const { getVersion } = await import('@tauri-apps/api/app');
                return await getVersion();
            }
        } catch (e) {
            console.error("Failed to get version:", e);
        }
        return '1.1.10'; // Default fallback
    }

    async relaunch(): Promise<void> {
        if (isDesktop()) {
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
        } else if (isMobile()) {
            // Mobile usually doesn't "relaunch" in the same way, but we can exit or reset
        } else {
            window.location.reload();
        }
    }
    async pickAndSaveImage(workspaceId: string, subDir: string = 'product-images'): Promise<string | null> {
        if (isTauri()) {
            try {
                // On mobile, ensure we have permissions before opening dialog
                if (isMobile()) {
                    await this.requestMobilePermissions();
                }

                const { open } = await import('@tauri-apps/plugin-dialog');
                const { mkdir, copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');

                const selected = await open({
                    multiple: false,
                    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
                });

                if (selected && typeof selected === 'string') {
                    const ext = selected.split('.').pop();
                    const fileName = `${Date.now()}.${ext}`;
                    const relativeDir = `${subDir}/${workspaceId}`;

                    await mkdir(relativeDir.replace(/\\/g, '/'), { baseDir: BaseDirectory.AppData, recursive: true });

                    const relativeDest = `${relativeDir}/${fileName}`.replace(/\\/g, '/');
                    await copyFile(selected, relativeDest, { toPathBaseDir: BaseDirectory.AppData });

                    // Return relative path (e.g. product-images/uuid/123.jpg)
                    return relativeDest;
                }
            } catch (error) {
                console.error('Error picking/saving image in Tauri:', error);
            }
        }

        return null;
    }

    /**
     * Save a downloaded file to AppData using BaseDirectory for mobile compatibility
     */
    async saveDownloadedFile(workspaceId: string, filePath: string, content: ArrayBuffer, defaultSubDir: string = 'product-images'): Promise<string | null> {
        if (isTauri()) {
            try {
                const { mkdir, writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
                const { dirname } = await import('@tauri-apps/api/path');

                // Normalize the path early
                const normalizedPath = filePath.replace(/\\/g, '/');
                let relativeDest = normalizedPath;

                // If filePath is just a filename (no slashes), use the default structure
                if (!normalizedPath.includes('/')) {
                    relativeDest = `${defaultSubDir}/${workspaceId}/${normalizedPath}`;
                }

                // Get directory part from the final path
                const dir = await dirname(relativeDest);
                const cleanDir = dir.replace(/\\/g, '/');

                console.log('[PlatformService] Target directory:', cleanDir);

                // Ensure directory exists in AppData
                await mkdir(cleanDir, { baseDir: BaseDirectory.AppData, recursive: true });
                console.log('[PlatformService] Directory ready:', cleanDir);

                // Write file to AppData
                console.log('[PlatformService] Writing file to:', relativeDest);
                await writeFile(relativeDest, new Uint8Array(content), { baseDir: BaseDirectory.AppData });

                console.log('[PlatformService] Saved file successfully:', relativeDest);
                return relativeDest;
            } catch (error) {
                console.error('[PlatformService] Error saving downloaded file:', error);
                throw error;
            }
        }
        return null;
    }

    async resizeImage(filePath: string, maxWidth: number = 512): Promise<string> {
        if (!isTauri()) return filePath;

        try {
            const { readFile, writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');

            // 1. Read the original file
            const fileData = await readFile(filePath, { baseDir: BaseDirectory.AppData });

            // 2. Load into a blob and then an Image object
            const blob = new Blob([fileData]);
            const url = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = async () => {
                    URL.revokeObjectURL(url);

                    // Calculate new dimensions
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (maxWidth / width) * height;
                        width = maxWidth;
                    }

                    // 3. Draw to canvas
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    ctx.drawImage(img, 0, 0, width, height);

                    // 4. Convert back to blob/arraybuffer
                    canvas.toBlob(async (resizedBlob) => {
                        if (!resizedBlob) {
                            reject(new Error('Failed to create blob from canvas'));
                            return;
                        }

                        const resizedBuffer = await resizedBlob.arrayBuffer();

                        // 5. Overwrite the file with resized version
                        // Note: To be safe, we could use a new filename, but for profile pics, overwriting is fine
                        await writeFile(filePath, new Uint8Array(resizedBuffer), { baseDir: BaseDirectory.AppData });

                        console.log(`[PlatformService] Resized image to ${width}x${height}`);
                        resolve(filePath);
                    }, 'image/jpeg', 0.85); // Use JPEG with 85% quality
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error('Failed to load image for resizing'));
                };
                img.src = url;
            });
        } catch (error) {
            console.error('[PlatformService] Resize error:', error);
            return filePath; // Return original on error
        }
    }
}

export const platformService = new PlatformService();
