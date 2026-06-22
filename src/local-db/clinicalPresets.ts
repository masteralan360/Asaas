import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './database'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { generateId, toSnakeCase } from '@/lib/utils'
import { getSupabaseClientForTable } from '@/lib/supabaseSchema'
import { isOnline } from '@/lib/network'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import { runSupabaseAction } from '@/lib/supabaseRequest'
import { fetchTableFromSupabase } from './hooks'
import { addToOfflineMutations } from './offlineMutations'
import type { ClinicalPreset, BaseEntity, ClinicalRegistryType, UserSelectableClinicalRegistryType } from './models'
import {
  CLINICAL_REGISTRY_PRESET_CATEGORY,
  DEFAULT_CLINICAL_REGISTRY_TYPE,
  getClinicalRegistryPresetId,
  normalizeClinicalRegistryType,
} from './clinicalRegistryPreset'

const PRESETS_TABLE = 'clinical_presets'

type ClinicalPresetsSyncEntity = Record<string, unknown> & {
  id: string
  workspaceId: string
  version: number
  updatedAt: string
}

const tableByName = {
  [PRESETS_TABLE]: db.clinical_presets,
} as const

function shouldUseCloudBusinessData(workspaceId?: string | null) {
  return !!workspaceId && !isLocalWorkspaceMode(workspaceId)
}

function getSyncMetadata(workspaceId: string, timestamp: string) {
  if (!shouldUseCloudBusinessData(workspaceId)) {
    return { syncStatus: 'synced' as const, lastSyncedAt: timestamp }
  }
  return { syncStatus: 'pending' as const, lastSyncedAt: null }
}

function prepareEntityForSync<T extends ClinicalPreset>(entity: T, workspaceId: string, timestamp: string): T {
  const syncMeta = getSyncMetadata(workspaceId, timestamp)
  return { ...entity, ...syncMeta }
}

async function upsertClinicalPresetEntity<T extends ClinicalPreset>(entity: T, workspaceId: string, timestamp: string) {
  const prepared = prepareEntityForSync(entity, workspaceId, timestamp)
  const dexieTable = tableByName[PRESETS_TABLE]
  await dexieTable.put(prepared as any)
  await queueClinicalPresetsUpsert(prepared as unknown as ClinicalPresetsSyncEntity, workspaceId)
}

function sanitizeForSupabase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const exclude = new Set(['syncStatus', 'lastSyncedAt'])
  const result: Record<string, unknown> = {}
  for (const key in obj) {
    if (obj[key] === undefined || exclude.has(key)) continue
    result[key] = obj[key]
  }
  return result
}

async function queueClinicalPresetsUpsert(entity: ClinicalPresetsSyncEntity, workspaceId: string) {
  if (shouldUseCloudBusinessData(workspaceId) && isOnline()) {
    const supabaseClient = getSupabaseClientForTable(PRESETS_TABLE)
    const { error } = await runSupabaseAction(`clinical.upsert.${PRESETS_TABLE}`, () =>
      supabaseClient
        .from(PRESETS_TABLE)
        .upsert(toSnakeCase(sanitizeForSupabase(entity)), { onConflict: 'id' })
        .select()
        .single()
    )
    if (error) {
      await addToOfflineMutations(PRESETS_TABLE, entity.id, 'update', entity as any, workspaceId)
    }
  } else if (shouldUseCloudBusinessData(workspaceId)) {
    await addToOfflineMutations(PRESETS_TABLE, entity.id, 'update', entity as any, workspaceId)
  }
}

async function softDeleteClinicalPresetEntity(id: string, workspaceId: string) {
  const timestamp = new Date().toISOString()
  const dexieTable = tableByName[PRESETS_TABLE]
  await dexieTable.update(id, {
    isDeleted: true,
    updatedAt: timestamp,
    syncStatus: 'pending',
  })

  if (shouldUseCloudBusinessData(workspaceId) && isOnline()) {
    const supabaseClient = getSupabaseClientForTable(PRESETS_TABLE)
    const { error } = await runSupabaseAction(`clinical.softDelete.${PRESETS_TABLE}`, () =>
      supabaseClient
        .from(PRESETS_TABLE)
        .update({ is_deleted: true, updated_at: timestamp })
        .eq('id', id)
    )
    if (error) {
      await addToOfflineMutations(PRESETS_TABLE, id, 'delete', { id, workspaceId } as any, workspaceId)
    }
  } else if (shouldUseCloudBusinessData(workspaceId)) {
    await addToOfflineMutations(PRESETS_TABLE, id, 'delete', { id, workspaceId } as any, workspaceId)
  }
}

export function syncClinicalPreset(data: ClinicalPresetsSyncEntity, _workspaceId: string) {
  const timestamp = new Date().toISOString()
  const dexieTable = tableByName[PRESETS_TABLE]
  return dexieTable.put({ ...data, syncStatus: 'synced', lastSyncedAt: timestamp } as any)
}

export function syncClinicalPresetSoftDelete(id: string) {
  const timestamp = new Date().toISOString()
  const dexieTable = tableByName[PRESETS_TABLE]
  return dexieTable.update(id, { isDeleted: true, updatedAt: timestamp, syncStatus: 'synced' })
}

export function markClinicalPresetsSynced(ids: string[], timestamp: string) {
  const dexieTable = tableByName[PRESETS_TABLE]
  return Promise.all(ids.map((id) => dexieTable.update(id, { syncStatus: 'synced', lastSyncedAt: timestamp })))
}

function useGenericClinicalPresetsTableFetch(workspaceId: string | undefined) {
  const isOnlineVal = useNetworkStatus()
  useEffect(() => {
    if (!workspaceId || !isOnlineVal || isLocalWorkspaceMode(workspaceId)) return
    const dexieTable = tableByName[PRESETS_TABLE]
    fetchTableFromSupabase(PRESETS_TABLE, dexieTable as any, workspaceId)
  }, [workspaceId, isOnlineVal])
}

export function useClinicalPresets(workspaceId: string | undefined) {
  useGenericClinicalPresetsTableFetch(workspaceId)
  return useLiveQuery(async () => {
    if (!workspaceId) return []
    return db.clinical_presets
      .where('workspaceId').equals(workspaceId)
      .filter((p) => !p.isDeleted && p.category !== CLINICAL_REGISTRY_PRESET_CATEGORY)
      .sortBy('sortOrder')
  }, [workspaceId])
}

export function useClinicalRegistryType(workspaceId: string | undefined): ClinicalRegistryType {
  useGenericClinicalPresetsTableFetch(workspaceId)
  const registryType = useLiveQuery(async () => {
    if (!workspaceId) return DEFAULT_CLINICAL_REGISTRY_TYPE

    const preset = await db.clinical_presets
      .where('[workspaceId+category]')
      .equals([workspaceId, CLINICAL_REGISTRY_PRESET_CATEGORY])
      .filter((item) => !item.isDeleted && item.isActive)
      .first()

    return normalizeClinicalRegistryType(preset?.name)
  }, [workspaceId])

  return registryType ?? DEFAULT_CLINICAL_REGISTRY_TYPE
}

export function useClinicalPreset(id: string | undefined) {
  return useLiveQuery(async () => {
    if (!id) return null
    return db.clinical_presets.get(id)
  }, [id])
}

export function useClinicalPresetsByCategory(workspaceId: string | undefined, category: string | undefined) {
  useGenericClinicalPresetsTableFetch(workspaceId)
  return useLiveQuery(async () => {
    if (!workspaceId || !category) return []
    return db.clinical_presets
      .where('workspaceId').equals(workspaceId)
      .filter((p) => !p.isDeleted && p.category === category)
      .sortBy('sortOrder')
  }, [workspaceId, category])
}

export async function createClinicalPreset(
  preset: Omit<ClinicalPreset, keyof BaseEntity | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted'>,
  workspaceId: string,
) {
  const timestamp = new Date().toISOString()
  const entity: ClinicalPreset = {
    ...preset,
    id: generateId(),
    workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    isDeleted: false,
    syncStatus: 'pending',
    lastSyncedAt: null,
  }
  await upsertClinicalPresetEntity(entity, workspaceId, timestamp)
  return entity
}

export async function setClinicalRegistryType(
  workspaceId: string,
  registryType: UserSelectableClinicalRegistryType,
  createdBy?: string | null,
) {
  const timestamp = new Date().toISOString()
  const existing = await db.clinical_presets
    .where('[workspaceId+category]')
    .equals([workspaceId, CLINICAL_REGISTRY_PRESET_CATEGORY])
    .filter((item) => !item.isDeleted)
    .first()

  const entity: ClinicalPreset = {
    id: existing?.id ?? getClinicalRegistryPresetId(workspaceId),
    workspaceId,
    category: CLINICAL_REGISTRY_PRESET_CATEGORY,
    name: registryType,
    consultationFee: 0,
    sortOrder: 0,
    isActive: true,
    createdBy: existing?.createdBy ?? createdBy ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    isDeleted: false,
    syncStatus: 'pending',
    lastSyncedAt: existing?.lastSyncedAt ?? null,
  }

  await upsertClinicalPresetEntity(entity, workspaceId, timestamp)
  return entity
}

export async function updateClinicalPreset(id: string, updates: Partial<ClinicalPreset>, workspaceId: string) {
  const timestamp = new Date().toISOString()
  const existing = await db.clinical_presets.get(id)
  if (!existing) return null
  const updated: ClinicalPreset = {
    ...existing,
    ...updates,
    id,
    workspaceId,
    updatedAt: timestamp,
    version: existing.version + 1,
    syncStatus: 'pending',
  }
  await upsertClinicalPresetEntity(updated, workspaceId, timestamp)
  return updated
}

export async function deleteClinicalPreset(id: string, workspaceId: string) {
  await softDeleteClinicalPresetEntity(id, workspaceId)
}
