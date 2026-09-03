import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/local-db/database'
import {
  MODULE_LOCKER_AUDIT_LIMIT,
  getModuleLockerLockForPath,
  getModuleLockerSnapshot,
  lockModule,
  recordModuleLockerAudit,
  removeModuleLockerPasskey,
  setModuleLockerPasskey,
  unlockAllModules,
  unlockModule,
  verifyModuleLockerPasskey
} from './moduleLocker'

const actor = { userId: 'admin-1', name: 'Admin One' }
const workspaceId = 'workspace-1'

describe('module locker', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('stores only a verifier and validates the shared passkey', async () => {
    const settings = await setModuleLockerPasskey({
      workspaceId,
      passkey: 'shared module key',
      actor
    })

    expect(settings.verifier).not.toContain('shared module key')
    await expect(verifyModuleLockerPasskey(workspaceId, 'shared module key')).resolves.toEqual({ ok: true })
    await expect(verifyModuleLockerPasskey(workspaceId, 'incorrect key')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid'
    })
  })

  it('temporarily locks verification after five invalid passkeys', async () => {
    await setModuleLockerPasskey({
      workspaceId,
      passkey: 'shared module key',
      actor
    })

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(verifyModuleLockerPasskey(workspaceId, 'incorrect key')).resolves.toMatchObject({
        ok: false,
        reason: 'invalid'
      })
    }

    await expect(verifyModuleLockerPasskey(workspaceId, 'incorrect key')).resolves.toMatchObject({
      ok: false,
      reason: 'locked',
      retryAfterMs: expect.any(Number)
    })
    await expect(verifyModuleLockerPasskey(workspaceId, 'shared module key')).resolves.toMatchObject({
      ok: false,
      reason: 'locked'
    })
  })

  it('covers descendants when a parent module is locked', async () => {
    const lock = await lockModule({
      workspaceId,
      moduleHref: '/orders',
      moduleName: 'Orders',
      actor
    })

    const snapshot = await getModuleLockerSnapshot(workspaceId)
    expect(getModuleLockerLockForPath(snapshot.locks, '/orders/purchase')).toEqual(lock)
    expect(getModuleLockerLockForPath(snapshot.locks, '/sales')).toBeNull()
  })

  it('removes a lock and records a successful unlock', async () => {
    await lockModule({ workspaceId, moduleHref: '/orders', moduleName: 'Orders', actor })

    await unlockModule({ workspaceId, moduleHref: '/orders', moduleName: 'Orders', actor })

    await expect(getModuleLockerSnapshot(workspaceId)).resolves.toEqual({ settings: null, locks: [] })
    await expect(db.module_locker_audit.where('workspaceId').equals(workspaceId).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'module_unlocked', moduleHref: '/orders' })])
    )
  })

  it('unlocks every locked module with one local operation and audit event', async () => {
    await lockModule({ workspaceId, moduleHref: '/orders', moduleName: 'Orders', actor })
    await lockModule({ workspaceId, moduleHref: '/sales', moduleName: 'Sales', actor })

    await expect(unlockAllModules({ workspaceId, actor })).resolves.toBe(2)
    await expect(getModuleLockerSnapshot(workspaceId)).resolves.toEqual({ settings: null, locks: [] })
    await expect(db.module_locker_audit.where('workspaceId').equals(workspaceId).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'all_modules_unlocked' })])
    )
  })

  it('clears locks immediately when the passkey is removed', async () => {
    await setModuleLockerPasskey({ workspaceId, passkey: 'shared module key', actor })
    await lockModule({ workspaceId, moduleHref: '/orders', moduleName: 'Orders', actor })

    await removeModuleLockerPasskey({ workspaceId, actor })

    await expect(getModuleLockerSnapshot(workspaceId)).resolves.toEqual({ settings: null, locks: [] })
    await expect(db.module_locker_audit.where('workspaceId').equals(workspaceId).toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'passkey_removed' })])
    )
  })

  it('keeps the local audit bounded to the newest events', async () => {
    for (let index = 0; index <= MODULE_LOCKER_AUDIT_LIMIT; index += 1) {
      await recordModuleLockerAudit({
        workspaceId,
        action: 'module_locked',
        actor,
        moduleHref: `/module-${index}`,
        moduleName: `Module ${index}`
      })
    }

    const events = await db.module_locker_audit.where('workspaceId').equals(workspaceId).toArray()
    expect(events).toHaveLength(MODULE_LOCKER_AUDIT_LIMIT)
    expect(events.some((event) => event.moduleHref === '/module-500')).toBe(true)
  })
})
