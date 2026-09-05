import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'

const require = createRequire(import.meta.url)
const workspaceRoot = process.cwd()
const environmentPath = path.join(workspaceRoot, '.env')
const wranglerCli = path.join(
    path.dirname(require.resolve('wrangler/package.json')),
    'bin',
    'wrangler.js',
)
const requiredSecrets = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'R2_WORKER_URL',
]

function parseSecretsBundle(encodedSecrets) {
    try {
        const parsed = JSON.parse(Buffer.from(encodedSecrets, 'base64').toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('the decoded value is not a secrets object')
        }
        return parsed
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[cf:deploy] Invalid CLOUDFLARE_WORKER_SECRETS_B64: ${message}`)
        process.exit(1)
    }
}

// Local deployments source the complete Worker-secret inventory from `.env`.
// CI has no `.env`, so it reads the encrypted production bundle from GitHub
// Actions. The bundle is never logged or written outside a short-lived,
// permission-restricted Wrangler secrets file.
// This wrapper always deploys the Worker configuration rather than a bare
// assets directory; a bare assets deployment would remove the API handler.
const secrets = existsSync(environmentPath)
    ? dotenv.parse(readFileSync(environmentPath))
    : process.env.CLOUDFLARE_WORKER_SECRETS_B64
        ? parseSecretsBundle(process.env.CLOUDFLARE_WORKER_SECRETS_B64)
        : Object.fromEntries(requiredSecrets.map((name) => [name, process.env[name]]))

if (secrets) {
    // The existing web build uses the Vite-prefixed R2 endpoint. The Worker
    // receives the same value under its server-only binding name.
    secrets.R2_WORKER_URL ||= secrets.VITE_R2_WORKER_URL

    const missingSecrets = requiredSecrets.filter((name) => !secrets[name]?.trim())
    if (missingSecrets.length > 0) {
        console.error(`[cf:deploy] Missing required .env values: ${missingSecrets.join(', ')}`)
        process.exit(1)
    }
}

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'atlas-wrangler-secrets-'))
const secretsFile = path.join(temporaryDirectory, 'secrets.json')
let exitCode = 1

try {
    // npm exposes its JavaScript entry point while running a package script.
    // Invoking it through Node avoids Windows' .cmd-shell semantics.
    const npmCli = process.env.npm_execpath
    if (!npmCli) {
        console.error('[cf:deploy] npm_execpath is required to run the web build.')
        process.exit(1)
    }
    const build = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
        cwd: workspaceRoot,
        stdio: 'inherit',
        shell: false,
        env: {
            ...process.env,
            ...Object.fromEntries(
                Object.entries(secrets).filter(([name]) => name.startsWith('VITE_')),
            ),
        },
    })
    if (build.error) {
        console.error('[cf:deploy] Could not start the web build:', build.error.message)
        process.exit(1)
    }
    if (build.status !== 0) {
        process.exit(build.status ?? 1)
    }

    // JSON avoids shell interpolation. Wrangler sends these values as
    // encrypted secret bindings; neither values nor the temporary file
    // are committed.
    writeFileSync(secretsFile, JSON.stringify(secrets), { encoding: 'utf8', mode: 0o600 })

    const args = [
        wranglerCli,
        'deploy',
        '--config',
        'cloudflare-web/wrangler.toml',
    ]
    args.push('--secrets-file', secretsFile)

    const result = spawnSync(
        process.execPath,
        args,
        { cwd: workspaceRoot, stdio: 'inherit', shell: false },
    )

    if (result.error) {
        console.error('[cf:deploy] Could not start Wrangler:', result.error.message)
    } else {
        exitCode = result.status ?? 1
    }
} finally {
    if (temporaryDirectory) {
        rmSync(temporaryDirectory, { recursive: true, force: true })
    }
}

process.exit(exitCode)
