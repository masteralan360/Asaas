import { pathToFileURL } from 'node:url'

const workerOrigin = process.env.ATLAS_WORKER_ORIGIN ?? 'https://atlas.alanepic360.workers.dev'
const apiPath = '/api-workspace-data/profiles?select=id&limit=1'
const requiredAnonKey = process.env.SUPABASE_ANON_KEY
const maximumReadinessAttempts = 15
const readinessRetryDelayMs = 2_000

function failure(message) {
    console.error(`[cf:verify] ${message}`)
    process.exit(1)
}

async function request(headers = {}) {
    const response = await fetch(new URL(apiPath, workerOrigin), {
        headers,
        redirect: 'error',
    })
    return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: await response.text(),
    }
}

function assertJsonApiResponse(label, response) {
    if (!response.contentType.includes('application/json')) {
        failure(`${label} returned ${response.status} with a non-JSON response. The API gateway may have been replaced by static assets.`)
    }
    if (/<!doctype|<html/i.test(response.body)) {
        failure(`${label} returned an HTML fallback instead of an API response.`)
    }
    if (/Missing required Worker secret/i.test(response.body)) {
        failure(`${label} reports a missing required Worker secret.`)
    }
}

export function isStaticFallback(response) {
    return response.status === 200 && (
        !response.contentType.includes('application/json') || /<!doctype|<html/i.test(response.body)
    )
}

export async function waitForApiGateway(requestApi, {
    attempts = maximumReadinessAttempts,
    delayMs = readinessRetryDelayMs,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    onRetry = () => {},
} = {}) {
    let response

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        response = await requestApi()
        if (!isStaticFallback(response) || attempt === attempts) return response

        onRetry(attempt, attempts, delayMs)
        await sleep(delayMs)
    }

    return response
}

async function main() {
    if (!requiredAnonKey?.trim()) {
        failure('SUPABASE_ANON_KEY is required to verify the Worker runtime bindings.')
    }

    try {
        // A just-deployed edge location can briefly serve the previous SPA-only
        // version. Retry that specific transitional response, but do not hide
        // API, secret, or authentication failures once JSON is available.
        const anonymous = await waitForApiGateway(request, {
            onRetry(attempt, attempts, delayMs) {
                console.log(`[cf:verify] API route is still serving static assets; retrying in ${delayMs / 1_000}s (${attempt}/${attempts - 1}).`)
            },
        })
        assertJsonApiResponse('Unauthenticated API check', anonymous)
        if (anonymous.status !== 401) {
            failure(`Unauthenticated API check returned ${anonymous.status}; expected 401.`)
        }

        // Supplying the public key forces the Worker to read its Supabase runtime
        // values while still using no user data or privileged credentials.
        const configured = await request({
            apikey: requiredAnonKey,
            authorization: `Bearer ${requiredAnonKey}`,
        })
        assertJsonApiResponse('Configured API check', configured)

        console.log('[cf:verify] Worker API routing and Supabase runtime bindings are present.')
    } catch (error) {
        failure(error instanceof Error ? error.message : String(error))
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main()
}
