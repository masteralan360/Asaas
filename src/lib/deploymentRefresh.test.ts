import { describe, expect, it } from 'vitest'
import { createDeploymentRefreshUrl, removeDeploymentRefreshParam } from './deploymentRefresh'

describe('deployment refresh URLs', () => {
    it('adds a unique cache-busting parameter without losing the current route', () => {
        expect(createDeploymentRefreshUrl('https://atlas.example/sales?tab=today#summary', 12345))
            .toBe('https://atlas.example/sales?tab=today&__atlas_refresh=12345#summary')
    })

    it('replaces an earlier refresh marker and cleans it from the visible URL', () => {
        expect(createDeploymentRefreshUrl('https://atlas.example/?__atlas_refresh=1', 67890))
            .toBe('https://atlas.example/?__atlas_refresh=67890')
        expect(removeDeploymentRefreshParam('https://atlas.example/sales?tab=today&__atlas_refresh=67890#summary'))
            .toBe('/sales?tab=today#summary')
    })
})
