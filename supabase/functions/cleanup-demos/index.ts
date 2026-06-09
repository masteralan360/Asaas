import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const { data: workspaces, error: wsError } = await adminClient
    .from('workspaces')
    .select('id')
    .like('code', 'demo.%')
    .lt('subscription_expires_at', new Date().toISOString())

  if (wsError) {
    console.error('[Cleanup] Query failed:', wsError.message)
    return new Response(JSON.stringify({ error: wsError.message }), { status: 500 })
  }

  if (!workspaces || workspaces.length === 0) {
    return new Response(JSON.stringify({ cleaned: 0 }), { status: 200 })
  }

  const workspaceIds = workspaces.map((w) => w.id)
  let cleaned = 0

  for (const workspaceId of workspaceIds) {
    const { data: profiles } = await adminClient
      .from('profiles')
      .select('id')
      .eq('workspace_id', workspaceId)

    const { error: cascadeError } = await adminClient.rpc('delete_demo_cascade', {
      p_workspace_id: workspaceId,
    })

    if (cascadeError) {
      console.error(`[Cleanup] Cascade failed for ${workspaceId}:`, cascadeError.message)
      continue
    }

    if (profiles) {
      for (const profile of profiles) {
        const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(profile.id)
        if (deleteUserError) {
          console.error(`[Cleanup] Failed to delete user ${profile.id}:`, deleteUserError.message)
        }
      }
    }

    cleaned++
  }

  console.log(`[Cleanup] Cleaned ${cleaned} expired demo(s)`)
  return new Response(JSON.stringify({ cleaned }), { status: 200 })
})
