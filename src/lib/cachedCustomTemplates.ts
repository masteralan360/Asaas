import { db } from '@/local-db/database'
import {
  listLocalCustomTemplates,
  type ListLocalCustomTemplatesOptions,
  type LocalCustomTemplateRow,
} from '@/local-db'
import { supabase } from '@/auth'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

const CACHE_PREFIX = 'custom_template_cache:'

function getCachePrefix(workspaceId: string) {
  return `${CACHE_PREFIX}${workspaceId}:`
}

function getCacheKey(workspaceId: string, templateId: string) {
  return `${getCachePrefix(workspaceId)}${templateId}`
}

async function listDexieCachedTemplates(workspaceId: string) {
  const prefix = getCachePrefix(workspaceId)
  const settings = await db.app_settings
    .filter((setting) => setting.key.startsWith(prefix))
    .toArray()

  return settings.flatMap((setting) => {
    try {
      const row = JSON.parse(setting.value) as LocalCustomTemplateRow
      return row.workspace_id === workspaceId ? [row] : []
    } catch {
      return []
    }
  })
}

async function persistDexieCacheTemplates(rows: LocalCustomTemplateRow[]) {
  if (rows.length === 0) return
  await db.app_settings.bulkPut(
    rows.map((row) => ({
      key: getCacheKey(row.workspace_id, row.id),
      value: JSON.stringify(row),
    })),
  )
}

function matchesCachedOptions(
  row: LocalCustomTemplateRow,
  options: ListLocalCustomTemplatesOptions,
) {
  if (options.moduleTypeKey && row.module_type_key !== options.moduleTypeKey) {
    return false
  }
  if (
    options.moduleTypePrefix &&
    !row.module_type_key.startsWith(options.moduleTypePrefix)
  ) {
    return false
  }
  if (options.activeOnly && !row.active) {
    return false
  }
  if (options.primaryOnly && !row.primary) {
    return false
  }
  return true
}

export async function fetchCachedCustomTemplates(
  workspaceId: string,
  options: ListLocalCustomTemplatesOptions = {},
): Promise<LocalCustomTemplateRow[]> {
  if (isLocalWorkspaceMode(workspaceId)) {
    return listLocalCustomTemplates(workspaceId, options)
  }

  const cachedTemplates = await listDexieCachedTemplates(workspaceId)

  let versionQuery = supabase
    .from('custom_templates')
    .select('id, version, updated_at')
    .eq('workspace_id', workspaceId)

  if (options.moduleTypeKey) {
    versionQuery = versionQuery.eq('module_type_key', options.moduleTypeKey)
  }
  if (options.moduleTypePrefix) {
    versionQuery = versionQuery.like(
      'module_type_key',
      `${options.moduleTypePrefix}%`,
    )
  }

  const { data: remoteChecks, error: versionError } =
    await runSupabaseAction('customTemplates.cachedVersionCheck', () =>
      versionQuery,
    )

  if (versionError) {
    const fallback = cachedTemplates.filter((t) =>
      matchesCachedOptions(t, options),
    )
    if (fallback.length > 0) return fallback
    throw normalizeSupabaseActionError(versionError)
  }

  type RemoteCheck = { id: string; version: number; updated_at: string }
  const remoteMap = new Map<string, RemoteCheck>(
    (remoteChecks || []).map((v) => [v.id, v as RemoteCheck]),
  )
  const validCache: LocalCustomTemplateRow[] = []
  const staleIds: string[] = []

  for (const cached of cachedTemplates) {
    const remote = remoteMap.get(cached.id)
    if (remote) {
      if (
        remote.version === cached.version &&
        remote.updated_at === cached.updated_at
      ) {
        validCache.push(cached)
      } else {
        staleIds.push(cached.id)
      }
      remoteMap.delete(cached.id)
    }
  }

  const missingIds = [...remoteMap.keys()]
  const idsToFetch = [...staleIds, ...missingIds]

  if (idsToFetch.length === 0) {
    return validCache.filter((t) => matchesCachedOptions(t, options))
  }

  const { data: freshData, error: fetchError } = await runSupabaseAction(
    'customTemplates.cachedFullFetch',
    () =>
      supabase
        .from('custom_templates')
        .select(
          'id, workspace_id, module_type_key, label, layout_json, active, primary, version, created_by, updated_by, created_at, updated_at',
        )
        .in('id', idsToFetch),
  )

  if (fetchError) {
    const fallback = cachedTemplates.filter((t) =>
      matchesCachedOptions(t, options),
    )
    if (fallback.length > 0) return fallback
    throw normalizeSupabaseActionError(fetchError)
  }

  const freshRows = (freshData || []) as LocalCustomTemplateRow[]

  await persistDexieCacheTemplates(freshRows)

  const result = [...validCache, ...freshRows]
  return result.filter((t) => matchesCachedOptions(t, options))
}
