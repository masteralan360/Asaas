import { db } from '@/local-db/database'
import type { DemoJob } from './demoConfig'
import { buildDemoCode } from './demoConfig'
import type { CurrencyCode } from '@/local-db/models'
import { clearLocalDemoWorkspaceData } from './demoCleanup'

export interface CreateDemoResult {
  userId: string
  email: string
  password: string
  workspaceId: string
  workspaceCode: string
  workspaceName: string
}

function generateId(): string {
  return crypto.randomUUID()
}

function generateDemoEmail(workspaceId: string): string {
  return `demo-${workspaceId.slice(0, 8)}@demo-workspace.com`
}

function generatePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

export async function createDemoWorkspace(
  workspaceName: string,
  job: DemoJob,
  minutes: number,
  currency: CurrencyCode = 'usd',
): Promise<CreateDemoResult> {
  const code = buildDemoCode(job, minutes)
  const workspaceId = generateId()
  const userId = generateId()
  const email = generateDemoEmail(workspaceId)
  const password = generatePassword()
  const now = new Date().toISOString()

  await db.workspaces.put({
    id: workspaceId,
    workspaceId,
    name: workspaceName,
    code,
    data_mode: 'demo',
    plan: 'enterprise',
    default_currency: currency,
    iqd_display_preference: 'د.ع',
    locked_workspace: false,
    is_configured: true,
    subscription_expires_at: new Date(Date.now() + minutes * 60000).toISOString(),
    syncStatus: 'synced',
    lastSyncedAt: null,
    version: 1,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  })

  await db.profiles.put({
    id: userId,
    workspaceId,
    name: 'Demo User',
    role: 'admin',
    profile_url: null,
    created_at: now,
  })

  return {
    userId,
    email,
    password,
    workspaceId,
    workspaceCode: code,
    workspaceName,
  }
}

export async function deleteDemoWorkspace(workspaceId: string): Promise<void> {
  await clearLocalDemoWorkspaceData(workspaceId)
}
