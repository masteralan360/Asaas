import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { isOnline } from '@/lib/network'
import { getSupabaseClientForTable } from '@/lib/supabaseSchema'
import { runSupabaseAction } from '@/lib/supabaseRequest'
import { generateId, toSnakeCase } from '@/lib/utils'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import { db } from './database'
import { addToOfflineMutations, fetchTableFromSupabase } from './hooks'
import { getClinicalAppointmentPaymentSummary } from './clinicalAppointmentPayments'
import type {
  ClinicalAppointment,
  ClinicalAppointmentStatus,
  ClinicalAppointmentType,
  ClinicalAppointmentPriority,
  ClinicalConfirmationMethod,
  ClinicalPatient,
  ClinicalAttachment,
  BaseEntity,
} from './models'

const APPOINTMENTS_TABLE = 'clinical_appointments'
const PATIENTS_TABLE = 'clinical_patients'
const ATTACHMENTS_TABLE = 'clinical_attachments'

export function calculateAge(birthYear: number | null | undefined): number | null {
  if (!birthYear) return null
  return new Date().getFullYear() - birthYear
}

type ClinicalTableName =
  | typeof APPOINTMENTS_TABLE
  | typeof PATIENTS_TABLE
  | typeof ATTACHMENTS_TABLE

type ClinicalSyncEntity = Record<string, unknown> & {
  id: string
  workspaceId: string
  version: number
  updatedAt: string
}

const tableByName = {
  [APPOINTMENTS_TABLE]: db.clinical_appointments,
  [PATIENTS_TABLE]: db.clinical_patients,
  [ATTACHMENTS_TABLE]: db.clinical_attachments,
} as const

function shouldUseCloudBusinessData(workspaceId?: string | null) {
  return !!workspaceId && !isLocalWorkspaceMode(workspaceId)
}

function getSyncMetadata(workspaceId: string, timestamp: string) {
  if (!shouldUseCloudBusinessData(workspaceId)) {
    return {
      syncStatus: 'synced' as const,
      lastSyncedAt: timestamp,
    }
  }
  return {
    syncStatus: 'pending' as const,
    lastSyncedAt: null,
  }
}

function prepareEntityForSync<T extends ClinicalAppointment | ClinicalPatient | ClinicalAttachment>(
  entity: T,
  workspaceId: string,
  timestamp: string,
): T {
  const syncMeta = getSyncMetadata(workspaceId, timestamp)
  return {
    ...entity,
    ...syncMeta,
  }
}

async function upsertClinicalEntity<T extends ClinicalAppointment | ClinicalPatient | ClinicalAttachment>(
  tableName: ClinicalTableName,
  entity: T,
  workspaceId: string,
  timestamp: string,
) {
  const prepared = prepareEntityForSync(entity, workspaceId, timestamp)
  const dexieTable = tableByName[tableName]
  await dexieTable.put(prepared as any)
  await queueClinicalUpsert(tableName, prepared as unknown as ClinicalSyncEntity, workspaceId)
}

function sanitizeForSupabase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const exclude = new Set(['syncStatus', 'lastSyncedAt', 'confirmationStatus'])
  const result: Record<string, unknown> = {}
  for (const key in obj) {
    if (obj[key] === undefined || exclude.has(key)) continue
    result[key] = obj[key]
  }
  return result
}

async function queueClinicalUpsert(
  tableName: ClinicalTableName,
  entity: ClinicalSyncEntity,
  workspaceId: string,
) {
  if (shouldUseCloudBusinessData(workspaceId) && isOnline()) {
    const supabaseClient = getSupabaseClientForTable(tableName)
    const { error } = await runSupabaseAction(`clinical.upsert.${tableName}`, () =>
      supabaseClient
        .from(tableName)
        .upsert(toSnakeCase(sanitizeForSupabase(entity)), { onConflict: 'id' })
        .select()
        .single()
    )
    if (error) {
      await addToOfflineMutations(tableName, entity.id, 'update', entity as any, workspaceId)
    }
  } else if (shouldUseCloudBusinessData(workspaceId)) {
    await addToOfflineMutations(tableName, entity.id, 'update', entity as any, workspaceId)
  }
}

async function softDeleteClinicalEntity(
  tableName: ClinicalTableName,
  id: string,
  workspaceId: string,
) {
  const timestamp = new Date().toISOString()
  const dexieTable = tableByName[tableName]
  await dexieTable.update(id, {
    isDeleted: true,
    updatedAt: timestamp,
    syncStatus: 'pending',
  })

  if (shouldUseCloudBusinessData(workspaceId) && isOnline()) {
    const supabaseClient = getSupabaseClientForTable(tableName)
    const { error } = await runSupabaseAction(`clinical.softDelete.${tableName}`, () =>
      supabaseClient
        .from(tableName)
        .update({ is_deleted: true, updated_at: timestamp })
        .eq('id', id)
    )
    if (error) {
      await addToOfflineMutations(tableName, id, 'delete', { id, workspaceId } as any, workspaceId)
    }
  } else if (shouldUseCloudBusinessData(workspaceId)) {
    await addToOfflineMutations(tableName, id, 'delete', { id, workspaceId } as any, workspaceId)
  }
}

function syncEntity<T extends ClinicalSyncEntity>(
  tableName: ClinicalTableName,
  data: T,
  workspaceId: string,
) {
  const dexieTable = tableByName[tableName]
  const prepared = prepareEntityForSync(data as any, workspaceId, data.updatedAt)
  return dexieTable.put(prepared as any)
}

function syncSoftDelete(
  tableName: ClinicalTableName,
  id: string,
) {
  const dexieTable = tableByName[tableName]
  return dexieTable.update(id, {
    isDeleted: true,
    syncStatus: 'synced' as const,
  })
}

function markEntitiesSynced(
  tableName: ClinicalTableName,
  ids: string[],
  timestamp: string,
) {
  if (ids.length === 0) return
  const dexieTable = tableByName[tableName]
  return (dexieTable as any).where('id').anyOf(ids).modify({
    syncStatus: 'synced' as const,
    lastSyncedAt: timestamp,
  })
}

function useGenericClinicalTableFetch(
  tableName: ClinicalTableName,
  workspaceId: string | undefined,
) {
  const isOnlineVal = useNetworkStatus()
  useEffect(() => {
    if (!workspaceId || !isOnlineVal || isLocalWorkspaceMode(workspaceId)) return
    const dexieTable = tableByName[tableName]
    fetchTableFromSupabase(tableName, dexieTable as any, workspaceId)
  }, [workspaceId, isOnlineVal, tableName])
}

export type { ClinicalAppointment, ClinicalPatient, ClinicalAttachment, ClinicalAppointmentStatus, ClinicalAppointmentType, ClinicalAppointmentPriority, ClinicalConfirmationMethod }

export {
  APPOINTMENTS_TABLE,
  PATIENTS_TABLE,
  ATTACHMENTS_TABLE,
  syncEntity as syncClinicalEntity,
  syncSoftDelete as syncClinicalSoftDelete,
  markEntitiesSynced as markClinicalEntitiesSynced,
}

// ── Appointments ──

export function useClinicalAppointments(workspaceId: string | undefined) {
  useGenericClinicalTableFetch(APPOINTMENTS_TABLE, workspaceId)
  return useLiveQuery(async () => {
    if (!workspaceId) return []
    return db.clinical_appointments
      .where('workspaceId')
      .equals(workspaceId)
      .filter((p) => !p.isDeleted)
      .reverse()
      .sortBy('createdAt')
  }, [workspaceId])
}

export function useClinicalAppointment(id: string | undefined) {
  return useLiveQuery(async () => {
    if (!id) return null
    return db.clinical_appointments.get(id)
  }, [id])
}

export function useClinicalAppointmentsByPatient(patientId: string | undefined) {
  return useLiveQuery(async () => {
    if (!patientId) return []
    return db.clinical_appointments
      .where('patientId')
      .equals(patientId)
      .filter((a) => !a.isDeleted)
      .toArray()
  }, [patientId])
}

export async function createClinicalAppointment(
  appointment: Omit<ClinicalAppointment, keyof BaseEntity | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'paidAmount' | 'paymentStatus'>
    & Partial<Pick<ClinicalAppointment, 'paidAmount' | 'paymentStatus'>>,
  workspaceId: string,
) {
  const timestamp = new Date().toISOString()
  const entity: ClinicalAppointment = {
    ...appointment,
    paidAmount: appointment.paidAmount || 0,
    paymentStatus: appointment.paymentStatus || (appointment.consultationFee > 0 ? 'unpaid' : 'no_fee'),
    id: generateId(),
    workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    isDeleted: false,
    syncStatus: 'pending',
    lastSyncedAt: null,
  }
  await upsertClinicalEntity(APPOINTMENTS_TABLE, entity, workspaceId, timestamp)
  return entity
}

export async function updateClinicalAppointment(
  id: string,
  updates: Partial<ClinicalAppointment>,
  workspaceId: string,
) {
  const timestamp = new Date().toISOString()
  const existing = await db.clinical_appointments.get(id)
  if (!existing) return null

  const candidate: ClinicalAppointment = {
    ...existing,
    ...updates,
    id,
    workspaceId,
    updatedAt: timestamp,
    version: existing.version + 1,
    syncStatus: 'pending',
  }
  const paymentTransactions = await db.payment_transactions
    .where('[workspaceId+sourceType+sourceRecordId]')
    .equals([workspaceId, 'clinical_appointment', id])
    .toArray()
  const paymentSummary = getClinicalAppointmentPaymentSummary(candidate, paymentTransactions)
  const updated: ClinicalAppointment = {
    ...candidate,
    paidAmount: paymentSummary.paidAmount,
    paymentStatus: paymentSummary.paymentStatus,
  }
  await upsertClinicalEntity(APPOINTMENTS_TABLE, updated, workspaceId, timestamp)
  return updated
}

export async function deleteClinicalAppointment(id: string, workspaceId: string) {
  await softDeleteClinicalEntity(APPOINTMENTS_TABLE, id, workspaceId)
}

// ── Patients ──

export function useClinicalPatients(workspaceId: string | undefined) {
  useGenericClinicalTableFetch(PATIENTS_TABLE, workspaceId)
  return useLiveQuery(async () => {
    if (!workspaceId) return []
    return db.clinical_patients
      .where('workspaceId')
      .equals(workspaceId)
      .filter((p) => !p.isDeleted)
      .reverse()
      .sortBy('createdAt')
  }, [workspaceId])
}

export function useClinicalPatient(id: string | undefined) {
  return useLiveQuery(async () => {
    if (!id) return null
    return db.clinical_patients.get(id)
  }, [id])
}

export function searchClinicalPatients(workspaceId: string, query: string) {
  const lower = query.toLowerCase()
  return db.clinical_patients
    .where('workspaceId')
    .equals(workspaceId)
    .filter((p) => !p.isDeleted && !!(
      p.name.toLowerCase().includes(lower) ||
      (p.phone != null && p.phone.includes(query))
    ))
    .sortBy('createdAt')
    .then((results) => results.reverse())
}

export async function createClinicalPatient(
  patient: Omit<ClinicalPatient, keyof BaseEntity | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted'>,
  workspaceId: string,
) {
  const timestamp = new Date().toISOString()
  const entity: ClinicalPatient = {
    ...patient,
    id: generateId(),
    workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    isDeleted: false,
    syncStatus: 'pending',
    lastSyncedAt: null,
  }
  await upsertClinicalEntity(PATIENTS_TABLE, entity, workspaceId, timestamp)
  return entity
}

export async function updateClinicalPatient(
  id: string,
  updates: Partial<ClinicalPatient>,
  workspaceId: string,
) {
  const timestamp = new Date().toISOString()
  const existing = await db.clinical_patients.get(id)
  if (!existing) return null

  const updated: ClinicalPatient = {
    ...existing,
    ...updates,
    id,
    workspaceId,
    updatedAt: timestamp,
    version: existing.version + 1,
    syncStatus: 'pending',
  }
  await upsertClinicalEntity(PATIENTS_TABLE, updated, workspaceId, timestamp)
  return updated
}

// ── Attachments ──

export function useClinicalAttachments(appointmentId: string | undefined) {
  return useLiveQuery(async () => {
    if (!appointmentId) return []
    return db.clinical_attachments
      .where('appointmentId')
      .equals(appointmentId)
      .filter((a) => !a.isDeleted)
      .toArray()
  }, [appointmentId])
}

export async function createClinicalAttachment(
  attachment: Omit<ClinicalAttachment, keyof BaseEntity | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted'>,
  workspaceId: string,
) {
  const timestamp = new Date().toISOString()
  const entity: ClinicalAttachment = {
    ...attachment,
    id: generateId(),
    workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    isDeleted: false,
    syncStatus: 'pending',
    lastSyncedAt: null,
  }
  await upsertClinicalEntity(ATTACHMENTS_TABLE, entity, workspaceId, timestamp)
  return entity
}
