import {
    WORKSPACE_TRANSFER_LIMIT_MESSAGE,
    copyResponseHeaders,
    getRequiredProxyPath,
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

const R2_METHODS = new Set(['GET', 'PUT', 'DELETE'])

function getR2WorkerUrl(req, path) {
    const workerUrl = process.env.R2_WORKER_URL?.trim()?.replace(/\/+$/, '')
    if (!workerUrl) throw new Error('Missing required server environment variable: R2_WORKER_URL')

    const params = queryWithoutPath(req)
    // The gateway owns the web charge, so the worker must not apply its Tauri
    // fallback charge to the same request.
    params.set('usage_client_recorded', '1')
    const query = params.toString()
    return `${workerUrl}/${path}${query ? `?${query}` : ''}`
}

function shouldMeter(method, request) {
    if (method === 'PUT') return true
    return method === 'GET' && request.query.list !== '1'
}

export default async function handler(req, res) {
    if (!R2_METHODS.has(req.method || '')) {
        res.setHeader('Allow', Array.from(R2_METHODS).join(', '))
        return responseJson(res, 405, { error: 'Method not allowed' })
    }

    const path = getRequiredProxyPath(req)
    if (!path) return responseJson(res, 400, { error: 'A valid R2 path is required' })

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
        const headers = requestHeadersForUpstream(req, requestBody)
        upstream = await fetch(getR2WorkerUrl(req, path), {
            method: req.method,
            headers,
            body: requestBody.byteLength > 0 ? requestBody : undefined
        })
        responseBody = Buffer.from(await upstream.arrayBuffer())
    } catch (error) {
        return responseJson(res, 502, { error: error instanceof Error ? error.message : 'Unable to reach R2' })
    }

    if (!upstream.ok || !shouldMeter(req.method, req)) {
        copyResponseHeaders(res, upstream.headers)
        res.status(upstream.status).send(responseBody)
        return
    }

    try {
        await recordWebLiveUsage(
            usageContext.workspace.workspace_id,
            requestBody.byteLength + responseBody.byteLength,
            `web_live:r2:${req.method}:${path}`
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
