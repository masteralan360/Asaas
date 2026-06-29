import { describe, expect, it, vi, beforeEach } from 'vitest'

const testState = vi.hoisted(() => ({
    rpc: vi.fn()
}))

vi.mock('@/auth/supabase', () => ({
    supabase: {
        rpc: testState.rpc
    }
}))

import {
    getTransferBodySize,
    getWorkspaceUsageLimitMessage,
    isWorkspaceUsageLimitError,
    parseContentLength,
    recordWorkspaceDataTransfer
} from './workspaceUsage'

describe('workspace usage helpers', () => {
    beforeEach(() => {
        testState.rpc.mockReset()
    })

    it('measures upload bodies in bytes', () => {
        expect(getTransferBodySize('abc')).toBe(3)
        expect(getTransferBodySize(new ArrayBuffer(8))).toBe(8)
        expect(getTransferBodySize(new Uint8Array([1, 2, 3]))).toBe(3)
        expect(getTransferBodySize(new Blob(['hello']))).toBe(5)
    })

    it('parses valid content length headers', () => {
        expect(parseContentLength('42')).toBe(42)
        expect(parseContentLength('42.9')).toBe(42)
        expect(parseContentLength(null)).toBeNull()
        expect(parseContentLength('-1')).toBeNull()
        expect(parseContentLength('not-a-number')).toBeNull()
    })

    it('detects workspace usage limit errors without vendor language', () => {
        const storageError = new Error('Workspace storage limit exceeded')
        const transferError = new Error('Workspace monthly data transfer limit exceeded')

        expect(isWorkspaceUsageLimitError(storageError)).toBe(true)
        expect(isWorkspaceUsageLimitError(transferError)).toBe(true)
        expect(getWorkspaceUsageLimitMessage(transferError)).toBe('Workspace monthly data transfer limit exceeded')
        expect(isWorkspaceUsageLimitError(new Error('Other failure'))).toBe(false)
    })

    it('records positive data transfer through the workspace usage RPC', async () => {
        const row = {
            workspace_id: 'workspace-1',
            transfer_period_start: '2026-06-01',
            data_transfer_bytes: 128,
            monthly_data_transfer_limit_bytes: 1024
        }

        testState.rpc.mockReturnValue({
            maybeSingle: vi.fn(async () => ({ data: row, error: null }))
        })

        await expect(recordWorkspaceDataTransfer('workspace-1', 128.8, 'test_source')).resolves.toEqual(row)
        expect(testState.rpc).toHaveBeenCalledWith('record_workspace_data_transfer', {
            p_workspace_id: 'workspace-1',
            p_bytes: 128,
            p_source: 'test_source'
        })
    })

    it('skips non-positive data transfer amounts', async () => {
        await expect(recordWorkspaceDataTransfer('workspace-1', 0, 'test_source')).resolves.toBeNull()
        expect(testState.rpc).not.toHaveBeenCalled()
    })
})
