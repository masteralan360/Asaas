import { supabase } from '@/auth/supabase'
import { runSupabaseAction } from '@/lib/supabaseRequest'
import type { DemoJob } from './demoConfig'
import { buildDemoCode } from './demoConfig'
import type { CurrencyCode } from '@/local-db/models'

export interface CreateDemoResult {
  userId: string
  email: string
  password: string
  workspaceId: string
  workspaceCode: string
  workspaceName: string
}

export async function createDemoWorkspace(
  workspaceName: string,
  job: DemoJob,
  minutes: number,
  currency: CurrencyCode = 'usd',
): Promise<CreateDemoResult> {
  const code = buildDemoCode(job, minutes)

  const result = await runSupabaseAction(
    'demo.create',
    () =>
      supabase.functions.invoke('workspace-access', {
        body: {
          action: 'create-demo',
          workspaceName,
          workspaceCode: code,
          demoJob: job,
          demoMinutes: minutes,
          demoCurrency: currency,
        },
      }),
    { timeoutMs: 30000, platform: 'all' },
  ) as { data?: CreateDemoResult & { error?: string }; error?: unknown }

  const res = result as any

  if (res.error) {
    let detail = res.error?.message ?? 'Failed to create demo workspace'

    if (res.response && typeof res.response.json === 'function') {
      try {
        const body = await res.response.json()
        if (body?.error) {
          detail = body.error
        }
      } catch {
        // response body already consumed
      }
    } else if (res.error?.context && typeof res.error.context.json === 'function') {
      try {
        const body = await (res.error as any).context.json()
        if (body?.error) {
          detail = body.error
        }
      } catch {
        // response body already consumed
      }
    }

    console.error('[Demo] create error:', res.error, 'detail:', detail)
    throw new Error(detail)
  }

  const data = res.data as any
  if (data?.error) {
    throw new Error(data.error)
  }

  return data as CreateDemoResult
}

export async function deleteDemoWorkspace(workspaceId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('workspace-access', {
    body: {
      action: 'delete-demo',
      workspaceId,
    },
  }) as { error?: unknown }

  if (error) {
    console.error('[Demo] Failed to delete demo workspace:', error)
  }
}
