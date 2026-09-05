import { describe, expect, it, vi } from 'vitest'
import { isStaticFallback, waitForApiGateway } from './verify-cloudflare-deployment.mjs'

const staticFallback = {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><body>Atlas</body></html>',
}

const apiResponse = {
    status: 401,
    contentType: 'application/json; charset=utf-8',
    body: '{"error":"Workspace authentication is required"}',
}

describe('Cloudflare deployment verification', () => {
    it('recognizes the temporary SPA fallback returned before the Worker API is ready', () => {
        expect(isStaticFallback(staticFallback)).toBe(true)
        expect(isStaticFallback(apiResponse)).toBe(false)
    })

    it('retries a temporary static response until the Worker API returns JSON', async () => {
        const requestApi = vi.fn()
            .mockResolvedValueOnce(staticFallback)
            .mockResolvedValueOnce(apiResponse)
        const sleep = vi.fn().mockResolvedValue(undefined)
        const onRetry = vi.fn()

        await expect(waitForApiGateway(requestApi, {
            attempts: 3,
            delayMs: 1,
            sleep,
            onRetry,
        })).resolves.toEqual(apiResponse)

        expect(requestApi).toHaveBeenCalledTimes(2)
        expect(sleep).toHaveBeenCalledWith(1)
        expect(onRetry).toHaveBeenCalledWith(1, 3, 1)
    })

    it('keeps the static response as a failure after the bounded retry window', async () => {
        const requestApi = vi.fn().mockResolvedValue(staticFallback)
        const sleep = vi.fn().mockResolvedValue(undefined)

        await expect(waitForApiGateway(requestApi, {
            attempts: 3,
            delayMs: 1,
            sleep,
        })).resolves.toEqual(staticFallback)

        expect(requestApi).toHaveBeenCalledTimes(3)
        expect(sleep).toHaveBeenCalledTimes(2)
    })
})
