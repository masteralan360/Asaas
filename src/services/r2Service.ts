/**
 * Service to handle Cloudflare R2 storage operations via the proxy worker.
 * This avoids exposing R2 keys in the client and handles CORS/Auth securely.
 */
class R2Service {
    private normalizePath(path: string): string {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        return cleanPath
            .split('/')
            .map(segment => {
                if (!segment) return '';

                // Avoid double-encoding already encoded keys while still supporting raw/unicode chars.
                let decoded = segment;
                try {
                    decoded = decodeURIComponent(segment);
                } catch {
                    decoded = segment;
                }
                return encodeURIComponent(decoded);
            })
            .join('/');
    }

    private readEnvValue(value?: string | null): string | undefined {
        const trimmed = value?.trim();
        return trimmed ? trimmed : undefined;
    }

    private canUseStorage(): boolean {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    }

    private readStorageValue(key: string): string | undefined {
        if (!this.canUseStorage()) return undefined;
        try {
            return this.readEnvValue(window.localStorage.getItem(key));
        } catch {
            return undefined;
        }
    }

    private writeStorageValue(key: string, value?: string): void {
        if (!value || !this.canUseStorage()) return;
        try {
            window.localStorage.setItem(key, value);
        } catch {
            // Ignore storage failures (e.g., disabled storage)
        }
    }

    private get workerUrl(): string | undefined {
        const fromVite = this.readEnvValue(import.meta.env.VITE_R2_WORKER_URL);
        const fromDefine = this.readEnvValue(typeof __R2_WORKER_URL__ !== 'undefined' ? __R2_WORKER_URL__ : undefined);
        const fromStorage = this.readStorageValue('r2_worker_url');
        const resolved = fromVite || fromDefine || fromStorage;
        if (resolved && resolved !== fromStorage) {
            this.writeStorageValue('r2_worker_url', resolved);
        }
        return resolved;
    }

    private get authToken(): string | undefined {
        const fromVite = this.readEnvValue(import.meta.env.VITE_R2_AUTH_TOKEN);
        const fromDefine = this.readEnvValue(typeof __R2_AUTH_TOKEN__ !== 'undefined' ? __R2_AUTH_TOKEN__ : undefined);
        const fromStorage = this.readStorageValue('r2_auth_token');
        const resolved = fromVite || fromDefine || fromStorage;
        if (resolved && resolved !== fromStorage) {
            this.writeStorageValue('r2_auth_token', resolved);
        }
        return resolved;
    }

    /**
     * Get the public URL for an object
     */
    public getUrl(path: string): string {
        if (!this.workerUrl) return '';
        const cleanPath = this.normalizePath(path);
        const baseUrl = this.workerUrl.endsWith('/') ? this.workerUrl : `${this.workerUrl}/`;
        return `${baseUrl}${cleanPath}`;
    }

    /**
     * Upload an object to R2
     */
    public async upload(path: string, data: Blob | ArrayBuffer | string, contentType?: string): Promise<string> {
        if (!this.workerUrl || !this.authToken) {
            throw new Error('R2 configuration missing');
        }

        const url = this.getUrl(path);
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${this.authToken}`,
                'Content-Type': contentType || 'application/octet-stream'
            },
            body: data
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`R2 Upload Failed: ${response.status} ${errorText}`);
        }

        return url;
    }

    /**
     * Delete an object from R2
     */
    public async delete(path: string): Promise<void> {
        if (!this.workerUrl || !this.authToken) {
            throw new Error('R2 configuration missing');
        }

        const url = this.getUrl(path);
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${this.authToken}`
            }
        });

        if (!response.ok && response.status !== 404) {
            const errorText = await response.text();
            throw new Error(`R2 Delete Failed: ${response.status} ${errorText}`);
        }
    }

    /**
     * List object keys by prefix
     */
    public async listObjects(prefix: string): Promise<string[]> {
        if (!this.workerUrl || !this.authToken) {
            throw new Error('R2 configuration missing');
        }

        const baseUrl = this.workerUrl.endsWith('/') ? this.workerUrl : `${this.workerUrl}/`;
        const url = new URL(baseUrl);
        url.searchParams.set('list', '1');
        url.searchParams.set('prefix', prefix);

        let response: Response;
        try {
            response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`R2 List Request Failed: ${message}`);
        }

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            if (response.status === 404 && errorText.toLowerCase().includes('object not found')) {
                throw new Error('R2 List Endpoint Missing: 404 Object Not Found');
            }
            throw new Error(`R2 List Failed: ${response.status}${errorText ? ` ${errorText}` : ''}`);
        }

        const payload = await response.json() as { keys?: unknown };
        if (!Array.isArray(payload.keys)) {
            return [];
        }

        return payload.keys.filter((key): key is string => typeof key === 'string');
    }

    /**
     * Check if R2 is configured
     */
    public isConfigured(): boolean {
        return !!(this.workerUrl && this.authToken);
    }
    /**
     * Download an object from R2
     */
    public async download(path: string): Promise<ArrayBuffer | null> {
        if (!this.workerUrl) return null;

        const url = this.getUrl(path);
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`R2 Download Failed: ${response.status}`);
        }

        return await response.arrayBuffer();
    }
}

export const r2Service = new R2Service();
