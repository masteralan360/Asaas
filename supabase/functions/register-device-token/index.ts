import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Novu } from 'npm:@novu/api'
import { ChatOrPushProviderEnum } from 'npm:@novu/api/models/components'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
const novuApiKeyRaw = Deno.env.get('NOVU_API_KEY') || ''

const novuApiKey = novuApiKeyRaw.startsWith('ApiKey ')
    ? novuApiKeyRaw
    : `ApiKey ${novuApiKeyRaw}`

const novu = new Novu({ secretKey: novuApiKey })

Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
        }

        if (!supabaseUrl || !supabaseAnonKey || !novuApiKeyRaw) {
            return new Response(JSON.stringify({ error: 'Missing server configuration' }), { status: 500 })
        }

        const authHeader = req.headers.get('authorization') || ''
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 })
        }

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: {
                headers: {
                    Authorization: authHeader
                }
            }
        })

        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError || !userData?.user) {
            return new Response(JSON.stringify({ error: userError?.message || 'Unauthorized' }), { status: 401 })
        }

        const { token, platform } = await req.json()
        const resolvedToken = typeof token === 'string' ? token.trim() : ''
        if (!resolvedToken) {
            return new Response(JSON.stringify({ error: 'Missing token' }), { status: 400 })
        }

        const user = userData.user
        let workspaceId = (user.user_metadata as any)?.workspace_id as string | undefined

        if (!workspaceId) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('workspace_id')
                .eq('id', user.id)
                .single()
            workspaceId = profile?.workspace_id
        }

        if (!workspaceId) {
            return new Response(JSON.stringify({ error: 'Missing workspace' }), { status: 400 })
        }

        const { error: upsertError } = await supabase
            .schema('notifications')
            .from('device_tokens')
            .upsert(
                {
                    user_id: user.id,
                    workspace_id: workspaceId,
                    platform: platform || 'android',
                    device_token: resolvedToken,
                    updated_at: new Date().toISOString()
                },
                {
                    onConflict: 'user_id,platform,device_token'
                }
            )

        if (upsertError) {
            return new Response(JSON.stringify({ error: upsertError.message }), { status: 500 })
        }

        try {
            await novu.subscribers.create({
                subscriberId: user.id
            })
            await novu.subscribers.credentials.update(
                {
                    providerId: ChatOrPushProviderEnum.Fcm,
                    credentials: {
                        deviceTokens: [resolvedToken]
                    }
                },
                user.id
            )
        } catch (novuError: any) {
            return new Response(JSON.stringify({ error: novuError?.message || String(novuError) }), { status: 500 })
        }

        return new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json' }
        })
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error?.message || String(error) }), { status: 500 })
    }
})
