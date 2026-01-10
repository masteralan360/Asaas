/// <reference types="vite/client" />

interface Window {
    electronAPI?: {
        selectProductImage: (workspaceId: string) => Promise<string | null>;
        isElectron: () => Promise<boolean>;
    };
}

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
