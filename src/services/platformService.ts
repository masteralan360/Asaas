import { isDesktop, isMobile, isTauri, PlatformAPI } from '../lib/platform';

/**
 * Service to handle platform-specific operations
 */
class PlatformService implements PlatformAPI {

    convertFileSrc(path: string): string {
        if (isTauri()) {
            const tauri = (window as any).__TAURI__;
            if (tauri?.core?.convertFileSrc) {
                return tauri.core.convertFileSrc(path);
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
    async pickAndSaveImage(workspaceId: string): Promise<string | null> {
        if (isTauri()) {
            try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const { mkdir, copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
                const { appDataDir, join } = await import('@tauri-apps/api/path');

                const selected = await open({
                    multiple: false,
                    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
                });

                if (selected && typeof selected === 'string') {
                    const ext = selected.split('.').pop();
                    const fileName = `${Date.now()}.${ext}`;
                    const relativeDir = `product-images/${workspaceId}`;

                    await mkdir(relativeDir, { baseDir: BaseDirectory.AppData, recursive: true });

                    const relativeDest = `${relativeDir}/${fileName}`;
                    await copyFile(selected, relativeDest, { toPathBaseDir: BaseDirectory.AppData });

                    const appData = await appDataDir();
                    const targetDir = await join(appData, relativeDir);
                    const targetPath = await join(targetDir, fileName);

                    return targetPath;
                }
            } catch (error) {
                console.error('Error picking/saving image in Tauri:', error);
            }
        }

        return null;
    }
}

export const platformService = new PlatformService();
