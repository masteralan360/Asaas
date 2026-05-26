import { createAdminClient } from '../_shared/supabase.ts'
import { corsHeaders, errorResponse, jsonResponse, readJson } from '../_shared/http.ts'

type VerifyRequest = {
    action: 'verify'
    passkey?: string
}

type ListUsersRequest = {
    action: 'listUsers'
    passkey?: string
}

type ListWorkspacesRequest = {
    action: 'listWorkspaces'
    passkey?: string
}

type DeleteUserRequest = {
    action: 'deleteUser'
    passkey?: string
    targetUserId?: string
}

type UpdateWorkspaceFeaturesRequest = {
    action: 'updateWorkspaceFeatures'
    passkey?: string
    workspaceId?: string
    locked_workspace?: boolean
}

type UpdateWorkspaceSubscriptionRequest = {
    action: 'updateWorkspaceSubscription'
    passkey?: string
    workspaceId?: string
    newExpiry?: string
}

type ListOverridesRequest = {
    action: 'listOverrides'
    passkey?: string
    workspaceId?: string
}

type UpsertOverrideRequest = {
    action: 'upsertOverride'
    passkey?: string
    workspaceId?: string
    type?: string
    key?: string
    value?: string | null
}

type DeleteOverrideRequest = {
    action: 'deleteOverride'
    passkey?: string
    overrideId?: string
}

type AdminConsoleRequest =
    | VerifyRequest
    | ListUsersRequest
    | ListWorkspacesRequest
    | DeleteUserRequest
    | UpdateWorkspaceFeaturesRequest
    | UpdateWorkspaceSubscriptionRequest
    | ListOverridesRequest
    | UpsertOverrideRequest
    | DeleteOverrideRequest

async function isValidAdminPasskey(adminClient: ReturnType<typeof createAdminClient>, passkey: string) {
    const { data, error } = await adminClient
        .from('app_permissions')
        .select('key_value')
        .eq('key_name', 'super_admin_passkey')
        .maybeSingle()

    if (error) {
        throw error
    }

    return passkey === (data?.key_value ?? '')
}

async function requireValidPasskey(adminClient: ReturnType<typeof createAdminClient>, passkey?: string) {
    const normalizedPasskey = passkey?.trim() ?? ''
    if (!normalizedPasskey) {
        return { ok: false, response: errorResponse('Admin passkey is required', 403) }
    }

    const valid = await isValidAdminPasskey(adminClient, normalizedPasskey)
    if (!valid) {
        return { ok: false, response: errorResponse('Unauthorized: Invalid admin passkey', 403) }
    }

    return { ok: true, response: null }
}

async function listUsers(adminClient: ReturnType<typeof createAdminClient>) {
    const { data: authData, error: authError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000
    })

    if (authError) {
        return errorResponse(authError.message, 500)
    }

    const { data: profiles, error: profilesError } = await adminClient
        .from('profiles')
        .select('id, name, role, workspace_id')

    if (profilesError) {
        return errorResponse(profilesError.message, 500)
    }

    const { data: workspaces, error: workspacesError } = await adminClient
        .from('workspaces')
        .select('id, name')

    if (workspacesError) {
        return errorResponse(workspacesError.message, 500)
    }

    const profilesById = new Map<string, { name?: string | null; role?: string | null; workspace_id?: string | null }>()
    for (const profile of profiles ?? []) {
        profilesById.set(String(profile.id), profile)
    }

    const workspaceNamesById = new Map<string, string>()
    for (const workspace of workspaces ?? []) {
        workspaceNamesById.set(String(workspace.id), String(workspace.name))
    }

    const rows = (authData.users ?? []).map((authUser) => {
        const profile = profilesById.get(authUser.id)
        const workspaceId = profile?.workspace_id ?? null
        return {
            id: authUser.id,
            name: profile?.name ?? String(authUser.user_metadata?.name ?? authUser.email ?? 'Unknown'),
            role: profile?.role ?? String(authUser.user_metadata?.role ?? 'viewer'),
            workspace_id: workspaceId,
            workspace_name: workspaceId ? (workspaceNamesById.get(workspaceId) ?? null) : null,
            created_at: authUser.created_at,
            email: authUser.email ?? null,
            phone: authUser.user_metadata?.phone ?? null
        }
    })

    return jsonResponse(rows)
}

async function listWorkspaces(adminClient: ReturnType<typeof createAdminClient>) {
    const { data, error } = await adminClient
        .from('workspaces')
        .select('id, name, code, created_at, data_mode, plan, is_configured, locked_workspace, deleted_at, coordination, logo_url, subscription_expires_at')
        .order('created_at', { ascending: false })

    if (error) {
        return errorResponse(error.message, 500)
    }

    const { data: branchRows, error: branchError } = await adminClient
        .from('workspace_branches')
        .select('source_workspace_id, branch_workspace_id, name')

    if (branchError) {
        return errorResponse(branchError.message, 500)
    }

    const workspaceNamesById = new Map(
        (data ?? []).map((workspace) => [String(workspace.id), String(workspace.name)])
    )
    const branchesByWorkspaceId = new Map(
        (branchRows ?? []).map((branch) => [String(branch.branch_workspace_id), branch])
    )

    return jsonResponse((data ?? []).map((workspace) => {
        const branch = branchesByWorkspaceId.get(String(workspace.id))
        return {
            ...workspace,
            is_branch: Boolean(branch),
            source_workspace_id: branch?.source_workspace_id ?? null,
            source_workspace_name: branch?.source_workspace_id
                ? workspaceNamesById.get(String(branch.source_workspace_id)) ?? null
                : null,
            branch_name: branch?.name ?? null
        }
    }))
}

async function deleteUser(adminClient: ReturnType<typeof createAdminClient>, body: DeleteUserRequest) {
    const targetUserId = body.targetUserId?.trim() ?? ''
    if (!targetUserId) {
        return errorResponse('Target user is required')
    }

    const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .select('role, workspace_id')
        .eq('id', targetUserId)
        .maybeSingle()

    if (profileError) {
        return errorResponse(profileError.message, 500)
    }

    if (profile?.role === 'admin' && profile.workspace_id) {
        const { error: workspaceError } = await adminClient
            .from('workspaces')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', profile.workspace_id)

        if (workspaceError) {
            return errorResponse(workspaceError.message, 500)
        }
    }

    const { error: deleteProfileError } = await adminClient
        .from('profiles')
        .delete()
        .eq('id', targetUserId)

    if (deleteProfileError) {
        return errorResponse(deleteProfileError.message, 500)
    }

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(targetUserId)
    if (deleteUserError) {
        return errorResponse(deleteUserError.message, 500)
    }

    return jsonResponse({ success: true })
}

async function updateWorkspaceFeatures(
    adminClient: ReturnType<typeof createAdminClient>,
    body: UpdateWorkspaceFeaturesRequest
) {
    const workspaceId = body.workspaceId?.trim() ?? ''
    if (!workspaceId) {
        return errorResponse('Workspace is required')
    }

    if (
        typeof body.locked_workspace !== 'boolean'
    ) {
        return errorResponse('Workspace feature payload is invalid')
    }

    const { error: statusError } = await adminClient
        .from('workspaces')
        .update({
            locked_workspace: body.locked_workspace
        })
        .eq('id', workspaceId)

    if (statusError) {
        return errorResponse(statusError.message, 500)
    }

    return jsonResponse({ success: true })
}

async function updateWorkspaceSubscription(
    adminClient: ReturnType<typeof createAdminClient>,
    body: UpdateWorkspaceSubscriptionRequest
) {
    const workspaceId = body.workspaceId?.trim() ?? ''
    const newExpiry = body.newExpiry?.trim() ?? ''

    if (!workspaceId) {
        return errorResponse('Workspace is required')
    }

    if (!newExpiry) {
        return errorResponse('New expiry date is required')
    }

    const parsedExpiry = new Date(newExpiry)
    if (Number.isNaN(parsedExpiry.getTime())) {
        return errorResponse('Invalid expiry date')
    }

    const { error } = await adminClient
        .from('workspaces')
        .update({
            subscription_expires_at: parsedExpiry.toISOString(),
            locked_workspace: parsedExpiry.getTime() < Date.now()
        })
        .eq('id', workspaceId)

    if (error) {
        return errorResponse(error.message, 500)
    }

    return jsonResponse({ success: true })
}

async function listOverrides(
    adminClient: ReturnType<typeof createAdminClient>,
    body: ListOverridesRequest
) {
    const workspaceId = body.workspaceId?.trim() ?? ''
    if (!workspaceId) return errorResponse('Workspace is required')

    const { data, error } = await adminClient
        .from('workspace_access_overrides')
        .select('id, workspace_id, type, key, value, created_by, created_at')
        .eq('workspace_id', workspaceId)
        .order('type', { ascending: true })

    if (error) return errorResponse(error.message, 500)
    return jsonResponse(data ?? [])
}

async function upsertOverride(
    adminClient: ReturnType<typeof createAdminClient>,
    body: UpsertOverrideRequest
) {
    const workspaceId = body.workspaceId?.trim() ?? ''
    const type = body.type?.trim() ?? ''
    const key = body.key?.trim() ?? ''

    if (!workspaceId || !type || !key) {
        return errorResponse('workspaceId, type, and key are required')
    }

    if (!['module', 'capability', 'currency', 'limit'].includes(type)) {
        return errorResponse('Invalid type. Must be module, capability, currency, or limit')
    }

    const { data, error } = await adminClient
        .from('workspace_access_overrides')
        .upsert({
            workspace_id: workspaceId,
            type,
            key,
            value: body.value ?? null
        }, { onConflict: 'workspace_id,type,key' })
        .select('id, workspace_id, type, key, value, created_by, created_at')
        .maybeSingle()

    if (error) return errorResponse(error.message, 500)
    return jsonResponse(data ?? {})
}

async function deleteOverride(
    adminClient: ReturnType<typeof createAdminClient>,
    body: DeleteOverrideRequest
) {
    const overrideId = body.overrideId?.trim() ?? ''
    if (!overrideId) return errorResponse('overrideId is required')

    const { error } = await adminClient
        .from('workspace_access_overrides')
        .delete()
        .eq('id', overrideId)

    if (error) return errorResponse(error.message, 500)
    return jsonResponse({ success: true })
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    if (req.method !== 'POST') {
        return errorResponse('Method not allowed', 405)
    }

    const body = await readJson<AdminConsoleRequest>(req)
    if (!body?.action) {
        return errorResponse('Invalid request body')
    }

    try {
        const adminClient = createAdminClient()

        if (body.action === 'verify') {
            const valid = await isValidAdminPasskey(adminClient, body.passkey?.trim() ?? '')
            return jsonResponse({ valid })
        }

        const access = await requireValidPasskey(adminClient, body.passkey)
        if (!access.ok) {
            return access.response
        }

        if (body.action === 'listUsers') {
            return await listUsers(adminClient)
        }

        if (body.action === 'listWorkspaces') {
            return await listWorkspaces(adminClient)
        }

        if (body.action === 'deleteUser') {
            return await deleteUser(adminClient, body)
        }

        if (body.action === 'updateWorkspaceFeatures') {
            return await updateWorkspaceFeatures(adminClient, body)
        }

        if (body.action === 'updateWorkspaceSubscription') {
            return await updateWorkspaceSubscription(adminClient, body)
        }

        if (body.action === 'listOverrides') {
            return await listOverrides(adminClient, body)
        }

        if (body.action === 'upsertOverride') {
            return await upsertOverride(adminClient, body)
        }

        if (body.action === 'deleteOverride') {
            return await deleteOverride(adminClient, body)
        }

        return errorResponse('Unsupported action', 400)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error'
        return errorResponse(message, 500)
    }
})
