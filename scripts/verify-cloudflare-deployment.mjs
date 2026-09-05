const workerOrigin = process.env.ATLAS_WORKER_ORIGIN ?? 'https://atlas.alanepic360.workers.dev'
const apiPath = '/api-workspace-data/profiles?select=id&limit=1'
const requiredAnonKey = process.env.SUPABASE_ANON_KEY

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

if (!requiredAnonKey?.trim()) {
    failure('SUPABASE_ANON_KEY is required to verify the Worker runtime bindings.')
}

try {
    // The unauthenticated request confirms the Worker handler owns the route.
    // A static-only Worker instead returns the SPA HTML with a 200 response.
    const anonymous = await request()
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
