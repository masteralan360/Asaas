/// <reference types="vite/client" />

interface Window {
    electronAPI?: {
        selectProductImage: (workspaceId: string) => Promise<string | null>;
        isElectron: () => Promise<boolean>;
        checkForUpdates: () => Promise<void>;
        onUpdateStatus: (callback: (status: any) => void) => () => void;
        fetchExchangeRate: (url: string) => Promise<string>;
    };
}

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
