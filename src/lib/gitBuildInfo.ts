declare const __ATLAS_GIT_COMMIT_MESSAGE__: string | undefined
declare const __ATLAS_GIT_COMMIT_HASH__: string | undefined
declare const __ATLAS_GIT_COMMIT_DATE__: string | undefined

/**
 * Git commit metadata injected at build time via Vite `define`.
 * Used to display the latest GitHub commit on the web/PWA sidebar
 * in place of the Tauri app version.
 */
export const gitCommitMessage = __ATLAS_GIT_COMMIT_MESSAGE__ ?? ''
export const gitCommitHash = __ATLAS_GIT_COMMIT_HASH__ ?? ''
export const gitCommitDate = __ATLAS_GIT_COMMIT_DATE__ ?? ''
