import { describe, expect, it } from 'vitest'

import {
  resolveFetchedWorkspaceLogo,
  resolvePersistedWorkspaceLogo,
} from './workspaceLogo'

describe('Local Mode workspace logos', () => {
  it('keeps the durable local logo when a refresh has no logo value', () => {
    expect(resolveFetchedWorkspaceLogo({
      workspaceMode: 'local',
      persistedWorkspaceMode: 'local',
      persistedLogoUrl: 'workspace-logos/logo.jpeg',
      remoteLogoUrl: null,
    })).toBe('workspace-logos/logo.jpeg')
  })

  it('does not overwrite a local logo with a null feature refresh', () => {
    expect(resolvePersistedWorkspaceLogo({
      nextWorkspaceMode: 'local',
      existingWorkspaceMode: 'local',
      nextLogoUrl: null,
      existingLogoUrl: 'workspace-logos/logo.jpeg',
    })).toBe('workspace-logos/logo.jpeg')
  })

  it('keeps an explicit local logo removal', () => {
    expect(resolvePersistedWorkspaceLogo({
      nextWorkspaceMode: 'local',
      existingWorkspaceMode: 'local',
      nextLogoUrl: '',
      existingLogoUrl: 'workspace-logos/logo.jpeg',
    })).toBe('')
  })
})
