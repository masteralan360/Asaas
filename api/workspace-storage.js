import {
    WORKSPACE_TRANSFER_LIMIT_MESSAGE,
    copyResponseHeaders,
    getRequiredProxyPath,
    getSupabaseServerConfig,
    isWorkspaceUsageLocked,
    queryWithoutPath,
    readRawBody,
    recordWebLiveUsage,
    requestHeadersForUpstream,
    resolveWorkspaceUsage,
    responseJson
} from './_workspaceUsage.js'

export const config = {
    api: { bodyParser: false }
}

const SUPABASE_STORAGE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH'])

function getStorageUrl(req, path) {
    const { supabaseUrl } = getSupabaseServerConfig()
    const params = queryWithoutPath(req)
    const query = params.toString()
    return `${supabaseUrl}/storage/v1/${path}${query ? `?${query}` : ''}`
}

export default async function handler(req, res) {
    if (!SUPABASE_STORAGE_METHODS.has(req.method || '')) {
        res.setHeader('Allow', Array.from(SUPABASE_STORAGE_METHODS).join(', '))
        return responseJson(res, 405, { error: 'Method not allowed' })
    }

    const path = getRequiredProxyPath(req)
    if (!path) return responseJson(res, 400, { error: 'A valid Storage path is required' })

    let usageContext
    try {
        usageContext = await resolveWorkspaceUsage(req)
    } catch (error) {
        return responseJson(res, 502, { error: error instanceof Error ? error.message : 'Unable to resolve workspace usage' })
    }

    if (!usageContext.workspace) {
        return responseJson(res, 401, { error: 'Workspace authentication is required' })
    }

    if (isWorkspaceUsageLocked(usageContext.workspace)) {
        return responseJson(res, 429, { error: WORKSPACE_TRANSFER_LIMIT_MESSAGE })
    }

    let requestBody
    try {
        requestBody = await readRawBody(req)
    } catch {
        return responseJson(res, 400, { error: 'Unable to read request body' })
    }

    let upstream
    let responseBody
    try {
        const { anonKey } = getSupabaseServerConfig()
        const headers = requestHeadersForUpstream(req, requestBody)
        headers.set('apikey', anonKey)
        upstream = await fetch(getStorageUrl(req, path), {
            method: req.method,
            headers,
            body: requestBody.byteLength > 0 ? requestBody : undefined
        })
        responseBody = Buffer.from(await upstream.arrayBuffer())
    } catch (error) {
        return responseJson(res, 502, { error: error instanceof Error ? error.message : 'Unable to reach Supabase Storage' })
    }

    if (!upstream.ok) {
        copyResponseHeaders(res, upstream.headers)
        res.status(upstream.status).send(responseBody)
        return
    }

    try {
        await recordWebLiveUsage(
            usageContext.workspace.workspace_id,
            requestBody.byteLength + responseBody.byteLength,
            `web_live:storage:${req.method}`
        )
    } catch (error) {
        return responseJson(res, error?.statusCode === 429 ? 429 : 502, {
            error: error instanceof Error ? error.message : 'Workspace usage could not be recorded'
        })
    }

    copyResponseHeaders(res, upstream.headers)
    res.setHeader('Cache-Control', 'no-store')
    res.status(upstream.status).send(responseBody)
}
