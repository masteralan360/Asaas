import { Webview } from '@tauri-apps/api/webview'
import { Window } from '@tauri-apps/api/window'

/**
 * Global WhatsApp Webview Manager
 * Keeps the webview alive across page navigations
 */
class WhatsAppWebviewManager {
    private webview: Webview | null = null;
    private isCreating = false;
    private creationPromise: Promise<Webview | null> | null = null;
    private lastBounds = { x: 0, y: 0, width: 0, height: 0 };
    private notificationOffset = 0;
    private enabled = true; // Session-based enabled state

    async getOrCreate(x: number, y: number, width: number, height: number): Promise<Webview | null> {
        this.lastBounds = { x, y, width, height };

        // If disabled, don't create or return anything
        if (!this.enabled) {
            console.log('[WhatsApp Manager] getOrCreate called while disabled, returning null');
            return null;
        }

        // If already exists, just return it
        if (this.webview) {
            return this.webview;
        }

        // If currently creating, wait for that to finish
        if (this.isCreating && this.creationPromise) {
            return this.creationPromise;
        }

        // Create new webview
        this.isCreating = true;
        this.creationPromise = this.createWebview(x, y, width, height);

        const result = await this.creationPromise;
        this.isCreating = false;
        this.creationPromise = null;

        return result;
    }

    private async createWebview(x: number, y: number, width: number, height: number): Promise<Webview | null> {
        try {
            const appWindow = Window.getCurrent();
            const label = 'whatsapp-persistent';

            // Check if it already exists in the native layer (from a previous JS session/refresh)
            const existing = await Webview.getByLabel(label);
            if (existing) {
                console.log('[WhatsApp Manager] Re-hooked existing native webview');
                this.webview = existing;
                return existing;
            }

            console.log('[WhatsApp Manager] Creating persistent webview...');

            const webview = new Webview(appWindow, label, {
                url: 'https://web.whatsapp.com',
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height),
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });

            // Wait for creation
            await new Promise<void>((resolve, reject) => {
                webview.once('tauri://created', () => {
                    console.log('[WhatsApp Manager] Webview created successfully');
                    resolve();
                });
                webview.once('tauri://error', (e) => {
                    console.error('[WhatsApp Manager] Webview error:', e);
                    reject(e);
                });
            });

            this.webview = webview;
            return webview;

        } catch (err) {
            console.error('[WhatsApp Manager] Failed to create webview:', err);
            return null;
        }
    }

    async show() {
        if (this.webview) {
            try {
                await this.webview.show();
                await this.webview.setFocus();
            } catch (e) {
                console.warn('[WhatsApp Manager] Show failed:', e);
            }
        }
    }

    async hide() {
        if (this.webview) {
            try {
                await this.webview.hide();
            } catch (e) {
                console.warn('[WhatsApp Manager] Hide failed (probably not created yet):', e);
            }
        }
    }

    async setEnabled(val: boolean) {
        if (this.enabled === val) return; // Idempotency

        console.log(`[WhatsApp Manager] Setting enabled: ${val}`);
        this.enabled = val;

        if (!val && this.webview) {
            try {
                // Completely terminate the webview process
                await this.webview.close();
                this.webview = null;
                console.log('[WhatsApp Manager] Webview terminated completely');
            } catch (e) {
                console.warn('[WhatsApp Manager] Failed to close webview:', e);
                // Fallback: null it anyway so we re-create later
                this.webview = null;
            }
        }
        // Broadcast change for UI components
        window.dispatchEvent(new CustomEvent('whatsapp-enabled-change', { detail: { enabled: val } }));
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    async reload() {
        if (this.webview) {
            try {
                // @ts-ignore - Tauri v2 JS API might not have direct reload on the class yet, 
                // but we can re-evaluate location or use the eval method
                await this.webview.clearAllBrowsingData(); // Optional cleanup
            } catch (e) {
                // Ignore
            }
        }
    }

    async updatePosition(x: number, y: number, width: number, height: number) {
        this.lastBounds = { x, y, width, height };

        if (this.webview) {
            try {
                // Apply notification offset to leave room at bottom for toasts
                const adjustedHeight = Math.max(100, height - this.notificationOffset);

                await this.webview.setPosition({ type: 'Logical', x: Math.round(x), y: Math.round(y) } as any);
                await this.webview.setSize({ type: 'Logical', width: Math.round(width), height: Math.round(adjustedHeight) } as any);
            } catch (e) {
                // Silent fail
            }
        }
    }

    /**
     * Temporarily shrink webview to make room for notifications at the bottom
     */
    setNotificationSpace(heightPx: number) {
        this.notificationOffset = heightPx;
        // Immediately apply the offset
        if (this.webview && this.lastBounds.height > 0) {
            this.updatePosition(
                this.lastBounds.x,
                this.lastBounds.y,
                this.lastBounds.width,
                this.lastBounds.height
            );
        }
    }

    /**
     * Clear the notification space (webview returns to full height)
     */
    clearNotificationSpace() {
        this.notificationOffset = 0;
        if (this.webview && this.lastBounds.height > 0) {
            this.updatePosition(
                this.lastBounds.x,
                this.lastBounds.y,
                this.lastBounds.width,
                this.lastBounds.height
            );
        }
    }

    isActive(): boolean {
        return this.webview !== null;
    }
}

// Singleton export
export const whatsappManager = new WhatsAppWebviewManager();
