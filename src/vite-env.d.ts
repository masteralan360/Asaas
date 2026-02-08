/// <reference types="vite/client" />



interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
    readonly VITE_R2_WORKER_URL?: string
    readonly VITE_R2_AUTH_TOKEN?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare const __R2_WORKER_URL__: string
declare const __R2_AUTH_TOKEN__: string
