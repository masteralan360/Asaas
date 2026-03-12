import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Novu } from 'npm:@novu/api'

type NotificationEvent = {
    id: string
    user_id: string
    entity_type: string
    entity_id: string
    payload: Record<string, unknown>
    attempt_count: number
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const novuApiKeyRaw = Deno.env.get('NOVU_API_KEY') || ''
const workflowBudget = Deno.env.get('NOVU_WORKFLOW_BUDGET_OVERDUE') || ''
const workflowLoan = Deno.env.get('NOVU_WORKFLOW_LOAN_OVERDUE') || ''
const workflowDividend = Deno.env.get('NOVU_WORKFLOW_DIVIDEND_OVERDUE') || ''

const novuApiKey = novuApiKeyRaw.startsWith('ApiKey ')
    ? novuApiKeyRaw
    : `ApiKey ${novuApiKeyRaw}`

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false }
})

const novu = new Novu({ secretKey: novuApiKey })

function resolveWorkflowId(entityType: string) {
    if (entityType === 'loan_overdue') return workflowLoan
    if (entityType === 'budget_dividend' && workflowDividend) return workflowDividend
    return workflowBudget
}

async function markEvent(
    eventId: string,
    data: { status: 'sent' | 'failed'; attempt_count: number; error?: string | null }
) {
    await supabase.rpc('update_notification_event_status', {
        p_event_id: eventId,
        p_status: data.status,
        p_error: data.error,
        p_attempt_count: data.attempt_count
    })
}

Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
        }

        const cronSecret = Deno.env.get('NOTIFICATION_CRON_SECRET') || ''
        const incomingSecret = req.headers.get('x-cron-secret') || ''
        
        if (!cronSecret || incomingSecret !== cronSecret) {
            console.error('Unauthorized attempt to dispatch notifications')
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        }

        if (!supabaseUrl || !supabaseServiceRoleKey || !novuApiKeyRaw) {
            return new Response(JSON.stringify({ error: 'Missing server configuration' }), { status: 500 })
        }

        // Fetch pending events via RPC to bypass schema exposure issues
        const { data: events, error: fetchError } = await supabase
            .rpc('get_pending_notification_events')

        if (fetchError) {
            console.error('Fetch error:', fetchError)
            return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 })
        }

        if (!events || events.length === 0) {
            return new Response(JSON.stringify({ processed: 0 }), { status: 200 })
        }

        let processed = 0
        for (const event of events as NotificationEvent[]) {
            const workflowId = resolveWorkflowId(event.entity_type)
            if (!workflowId) {
                await markEvent(event.id, {
                    status: 'failed',
                    attempt_count: (event.attempt_count || 0) + 1,
                    error: 'Missing workflow ID'
                })
                processed += 1
                continue
            }

            try {
                // Ensure subscriber exists in Novu
                await novu.subscribers.create({
                    subscriberId: event.user_id
                }).catch(() => {/* Ignore if already exists */})

                // Trigger Novu workflow
                await novu.trigger({
                    workflowId,
                    transactionId: event.id,
                    to: {
                        subscriberId: event.user_id
                    },
                    payload: event.payload || {}
                })

                await markEvent(event.id, {
                    status: 'sent',
                    attempt_count: (event.attempt_count || 0) + 1,
                    error: null
                })
            } catch (err: any) {
                console.error(`Error processing event ${event.id}:`, err)
                await markEvent(event.id, {
                    status: 'failed',
                    attempt_count: (event.attempt_count || 0) + 1,
                    error: err?.message || String(err)
                })
            }

            processed += 1
        }

        return new Response(JSON.stringify({ processed }), {
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (error: any) {
        console.error('Global dispatch error:', error)
        return new Response(JSON.stringify({ error: error?.message || String(error) }), { status: 500 })
    }
})
