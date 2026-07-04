import { db } from '@/local-db/database'
import type { DemoTutorialMode, DemoTutorialProgress } from './demoTutorialTypes'

const DEMO_TUTORIAL_SETTING_PREFIX = 'demo_tutorial'

export function getDemoTutorialSettingKey(workspaceId: string) {
  return `${DEMO_TUTORIAL_SETTING_PREFIX}:${workspaceId}`
}

export function createInitialDemoTutorialState(
  workspaceId: string,
  mode: DemoTutorialMode,
  options: { advancedAutoGuide?: boolean } = {},
): DemoTutorialProgress {
  const now = new Date().toISOString()

  return {
    mode,
    status: mode === 'none' ? 'inactive' : 'active',
    currentTask: mode === 'advanced' ? 'storage' : mode === 'basic' ? 'basic-overview' : null,
    workspaceId,
    advancedAutoGuide: mode === 'advanced' ? options.advancedAutoGuide ?? true : false,
    startedAt: now,
  }
}

export async function readDemoTutorialState(workspaceId: string): Promise<DemoTutorialProgress | null> {
  const row = await db.app_settings.get(getDemoTutorialSettingKey(workspaceId))
  if (!row?.value) return null

  try {
    return JSON.parse(row.value) as DemoTutorialProgress
  } catch {
    return null
  }
}

export async function saveDemoTutorialState(state: DemoTutorialProgress): Promise<void> {
  await db.app_settings.put({
    key: getDemoTutorialSettingKey(state.workspaceId),
    value: JSON.stringify(state),
  })
}

export async function initializeDemoTutorialState(
  workspaceId: string,
  mode: DemoTutorialMode,
  options: { advancedAutoGuide?: boolean } = {},
): Promise<void> {
  if (mode === 'none') {
    await db.app_settings.delete(getDemoTutorialSettingKey(workspaceId))
    return
  }

  await saveDemoTutorialState(createInitialDemoTutorialState(workspaceId, mode, options))
}
