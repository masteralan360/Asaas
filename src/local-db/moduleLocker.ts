import { db } from './database'
import type {
  ModuleLockerAuditAction,
  ModuleLockerAuditEvent,
  ModuleLockerLock,
  ModuleLockerSettings
} from './models'

const PBKDF2_ITERATIONS = 310_000
const PBKDF2_DIGEST = 'SHA-256' as const
const SALT_BYTES = 16
const VERIFIER_BYTES = 32
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 30_000
export const MODULE_LOCKER_AUDIT_LIMIT = 500

const SYSTEM_NAVIGATION_HREFS = new Set(['/', '/help', '/settings'])

export interface ModuleLockerActor {
  userId: string
  name: string
}

export type ModuleLockerPasskeyVerificationResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'invalid' | 'locked'; retryAfterMs?: number }

export interface ModuleLockerSnapshot {
  settings: ModuleLockerSettings | null
  locks: ModuleLockerLock[]
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function deriveVerifier(passkey: string, salt: Uint8Array, iterations: number) {
  const passkeyKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passkey),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: PBKDF2_DIGEST,
      salt,
      iterations
    },
    passkeyKey,
    VERIFIER_BYTES * 8
  )
  return new Uint8Array(bits)
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

function getLockId(workspaceId: string, moduleHref: string) {
  return `${workspaceId}:${moduleHref}`
}

function createAuditId() {
  return crypto.randomUUID()
}

function assertPasskey(passkey: string) {
  if (!passkey.trim()) {
    throw new Error('A module lock passkey is required.')
  }
}

export function isModuleLockerLockableHref(href: string) {
  return href.startsWith('/') && !SYSTEM_NAVIGATION_HREFS.has(href)
}

export function getModuleLockerLockForPath(
  locks: ModuleLockerLock[],
  pathname: string
) {
  return locks.find(
    (lock) => pathname === lock.moduleHref || pathname.startsWith(`${lock.moduleHref}/`)
  ) ?? null
}

export async function getModuleLockerSnapshot(workspaceId: string): Promise<ModuleLockerSnapshot> {
  const [settings, locks] = await Promise.all([
    db.module_locker_settings.get(workspaceId),
    db.module_locker_locks.where('workspaceId').equals(workspaceId).toArray()
  ])

  return { settings: settings ?? null, locks }
}

export async function listModuleLockerAudit(workspaceId: string) {
  const events = await db.module_locker_audit.where('workspaceId').equals(workspaceId).toArray()
  return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
}

function createModuleLockerAuditEvent(input: {
  workspaceId: string
  action: ModuleLockerAuditAction
  actor: ModuleLockerActor
  moduleHref?: string | null
  moduleName?: string | null
}): ModuleLockerAuditEvent {
  return {
    id: createAuditId(),
    workspaceId: input.workspaceId,
    action: input.action,
    moduleHref: input.moduleHref ?? null,
    moduleName: input.moduleName ?? null,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    occurredAt: new Date().toISOString()
  }
}

async function saveModuleLockerAuditEvent(event: ModuleLockerAuditEvent) {
  await db.module_locker_audit.put(event)
  const events = await db.module_locker_audit.where('workspaceId').equals(event.workspaceId).toArray()
  if (events.length <= MODULE_LOCKER_AUDIT_LIMIT) return

  const expired = events
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .slice(0, events.length - MODULE_LOCKER_AUDIT_LIMIT)
  await db.module_locker_audit.bulkDelete(expired.map((item) => item.id))
}

export async function recordModuleLockerAudit(input: {
  workspaceId: string
  action: ModuleLockerAuditAction
  actor: ModuleLockerActor
  moduleHref?: string | null
  moduleName?: string | null
}) {
  const event = createModuleLockerAuditEvent(input)
  await db.transaction('rw', db.module_locker_audit, async () => {
    await saveModuleLockerAuditEvent(event)
  })

  return event
}

export async function setModuleLockerPasskey(input: {
  workspaceId: string
  passkey: string
  actor: ModuleLockerActor
}) {
  assertPasskey(input.passkey)

  const existing = await db.module_locker_settings.get(input.workspaceId)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const verifier = await deriveVerifier(input.passkey, salt, PBKDF2_ITERATIONS)
  const now = new Date().toISOString()
  const settings: ModuleLockerSettings = {
    id: input.workspaceId,
    workspaceId: input.workspaceId,
    salt: bytesToBase64(salt),
    verifier: bytesToBase64(verifier),
    iterations: PBKDF2_ITERATIONS,
    digest: PBKDF2_DIGEST,
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: existing?.createdAt ?? now,
    createdByUserId: existing?.createdByUserId ?? input.actor.userId,
    updatedAt: now,
    updatedByUserId: input.actor.userId
  }

  await db.module_locker_settings.put(settings)
  await recordModuleLockerAudit({
    workspaceId: input.workspaceId,
    action: existing ? 'passkey_changed' : 'passkey_set',
    actor: input.actor
  })
  return settings
}

export async function removeModuleLockerPasskey(input: {
  workspaceId: string
  actor: ModuleLockerActor
}) {
  await db.transaction(
    'rw',
    [db.module_locker_settings, db.module_locker_locks],
    async () => {
      await db.module_locker_locks.where('workspaceId').equals(input.workspaceId).delete()
      await db.module_locker_settings.delete(input.workspaceId)
    }
  )
  await recordModuleLockerAudit({
    workspaceId: input.workspaceId,
    action: 'passkey_removed',
    actor: input.actor
  })
}

export async function verifyModuleLockerPasskey(
  workspaceId: string,
  passkey: string
): Promise<ModuleLockerPasskeyVerificationResult> {
  const settings = await db.module_locker_settings.get(workspaceId)
  if (!settings) return { ok: false, reason: 'missing' }

  const now = Date.now()
  const lockedUntil = settings.lockedUntil ? new Date(settings.lockedUntil).getTime() : 0
  if (lockedUntil > now) {
    return { ok: false, reason: 'locked', retryAfterMs: lockedUntil - now }
  }

  const candidate = await deriveVerifier(passkey, base64ToBytes(settings.salt), settings.iterations)
  const matches = constantTimeEqual(candidate, base64ToBytes(settings.verifier))

  if (matches) {
    await db.module_locker_settings.update(settings.id, {
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date().toISOString()
    })
    return { ok: true }
  }

  const failedAttempts = settings.failedAttempts + 1
  const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS
  await db.module_locker_settings.update(settings.id, {
    failedAttempts: shouldLock ? 0 : failedAttempts,
    lockedUntil: shouldLock ? new Date(now + LOCKOUT_MS).toISOString() : null,
    updatedAt: new Date().toISOString()
  })
  return {
    ok: false,
    reason: shouldLock ? 'locked' : 'invalid',
    retryAfterMs: shouldLock ? LOCKOUT_MS : undefined
  }
}

export async function lockModule(input: {
  workspaceId: string
  moduleHref: string
  moduleName: string
  actor: ModuleLockerActor
}) {
  const lock: ModuleLockerLock = {
    id: getLockId(input.workspaceId, input.moduleHref),
    workspaceId: input.workspaceId,
    moduleHref: input.moduleHref,
    moduleName: input.moduleName,
    lockedAt: new Date().toISOString(),
    lockedByUserId: input.actor.userId,
    lockedByName: input.actor.name
  }
  await db.module_locker_locks.put(lock)
  await recordModuleLockerAudit({
    workspaceId: input.workspaceId,
    action: 'module_locked',
    actor: input.actor,
    moduleHref: input.moduleHref,
    moduleName: input.moduleName
  })
  return lock
}

export async function unlockModule(input: {
  workspaceId: string
  moduleHref: string
  moduleName: string
  actor: ModuleLockerActor
}) {
  await db.module_locker_locks.delete(getLockId(input.workspaceId, input.moduleHref))
  await recordModuleLockerAudit({
    workspaceId: input.workspaceId,
    action: 'module_unlocked',
    actor: input.actor,
    moduleHref: input.moduleHref,
    moduleName: input.moduleName
  })
}

export async function unlockAllModules(input: {
  workspaceId: string
  actor: ModuleLockerActor
}) {
  const locks = await db.module_locker_locks.where('workspaceId').equals(input.workspaceId).toArray()
  if (locks.length === 0) return 0

  const auditEvent = createModuleLockerAuditEvent({
    workspaceId: input.workspaceId,
    action: 'all_modules_unlocked',
    actor: input.actor
  })
  await db.transaction('rw', [db.module_locker_locks, db.module_locker_audit], async () => {
    await db.module_locker_locks.bulkDelete(locks.map((lock) => lock.id))
    await saveModuleLockerAuditEvent(auditEvent)
  })
  return locks.length
}
