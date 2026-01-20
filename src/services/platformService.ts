import { isDesktop, isMobile, PlatformAPI } from '../lib/platform';

/**
 * Service to handle platform-specific operations
 */
class PlatformService implements PlatformAPI {

    convertFileSrc(path: string): string {
        if (isDesktop()) {
            const tauri = (window as any).__TAURI__;
            if (tauri?.core?.convertFileSrc) {
                return tauri.core.convertFileSrc(path);
            }
        }
        if (isMobile()) {
            const cap = (window as any).Capacitor;
            if (cap?.convertFileSrc) {
                return cap.convertFileSrc(path);
            }
        }
        return path;
    }

    async getAppDataDir(): Promise<string> {
        if (isDesktop()) {
            const { appDataDir } = await import('@tauri-apps/api/path');
            return appDataDir();
        }
        if (isMobile()) {
            // Capacitor Filesystem usually defaults to app internal storage if not specified
            return '';
        }
        return '';
    }

    async joinPath(...parts: string[]): Promise<string> {
        if (isDesktop()) {
            const { join } = await import('@tauri-apps/api/path');
            return join(...parts);
        }
        return parts.join('/');
    }

    async message(message: string, options?: { title?: string; type?: 'info' | 'warning' | 'error' }): Promise<void> {
        if (isDesktop()) {
            const { message: tauriMessage } = await import('@tauri-apps/plugin-dialog');
            await tauriMessage(message, {
                title: options?.title || 'ERP System',
                kind: options?.type as any || 'info'
            });
            return;
        }
        if (isMobile()) {
            const { Dialog } = await import('@capacitor/dialog');
            await Dialog.alert({
                title: options?.title || 'ERP System',
                message: message
            });
            return;
        }
        alert(message);
    }

    async confirm(message: string, options?: { title?: string; type?: 'info' | 'warning' | 'error' }): Promise<boolean> {
        if (isDesktop()) {
            const { ask } = await import('@tauri-apps/plugin-dialog');
            return ask(message, {
                title: options?.title || 'ERP System',
                kind: options?.type as any || 'info'
            });
        }
        if (isMobile()) {
            const { Dialog } = await import('@capacitor/dialog');
            const { value } = await Dialog.confirm({
                title: options?.title || 'ERP System',
                message: message
            });
            return value;
        }
        return window.confirm(message);
    }

    async getVersion(): Promise<string> {
        try {
            if (isDesktop()) {
                const { getVersion } = await import('@tauri-apps/api/app');
                return await getVersion();
            }
            if (isMobile()) {
                const { App } = await import('@capacitor/app');
                const info = await App.getInfo();
                return info.version;
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
        if (isDesktop()) {
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
                console.error('Error picking/saving image on Desktop:', error);
            }
        }

        if (isMobile()) {
            // Capacitor Camera/Filesystem implementation would go here
            return null;
        }

        return null;
    }
}

export const platformService = new PlatformService();
