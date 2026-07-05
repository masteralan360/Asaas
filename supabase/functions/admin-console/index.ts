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

type ListWorkspaceUsageRequest = {
    action: 'listWorkspaceUsage'
    passkey?: string
}

type UpdateWorkspaceUsageRequest = {
    action: 'updateWorkspaceUsage'
    passkey?: string
    workspaceId?: string
    storageUnits?: string | number | null
    dataTransferBytes?: string | number | null
    transferPeriodStart?: string | null
    storageUnitLimit?: string | number | null
    monthlyDataTransferLimitBytes?: string | number | null
    notes?: string | null
}

type RefreshWorkspaceUsageRequest = {
    action: 'refreshWorkspaceUsage'
    passkey?: string
    workspaceId?: string | null
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
    | ListWorkspaceUsageRequest
    | UpdateWorkspaceUsageRequest
    | RefreshWorkspaceUsageRequest

function currentUsagePeriodStart() {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10)
}

function normalizeNullableBigint(value: unknown, field: string): { value: string | null; error?: string } {
    if (value === null || value === undefined || value === '') {
        return { value: null }
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
            return { value: null, error: `${field} must be a non-negative integer` }
        }
        return { value: String(value) }
    }

    if (typeof value === 'string') {
        const normalized = value.trim()
        if (!normalized) {
            return { value: null }
        }
        if (!/^\d+$/.test(normalized)) {
            return { value: null, error: `${field} must be a non-negative integer` }
        }
        return { value: BigInt(normalized).toString() }
    }

    return { value: null, error: `${field} must be a non-negative integer` }
}

function normalizeUsagePeriodStart(value: unknown): { value: string; error?: string } {
    if (value === null || value === undefined || value === '') {
        return { value: currentUsagePeriodStart() }
    }

    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { value: currentUsagePeriodStart(), error: 'Transfer period must be a YYYY-MM-DD date' }
    }

    const parsed = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        return { value: currentUsagePeriodStart(), error: 'Transfer period is invalid' }
    }

    if (!value.endsWith('-01')) {
        return { value: currentUsagePeriodStart(), error: 'Transfer period must be the first day of a month' }
    }

    return { value }
}

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
        .select('source_workspace_id, branch_workspace_id, name, archived_at')

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
            branch_name: branch?.name ?? null,
            branch_archived_at: branch?.archived_at ?? null
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

async function getLimitedWorkspaceIds(adminClient: ReturnType<typeof createAdminClient>) {
    const { data, error } = await adminClient
        .from('workspace_usage_limits')
        .select('workspace_id')

    if (error) {
        throw error
    }

    const workspaceIds = (data ?? []).map((row) => String(row.workspace_id))
    if (workspaceIds.length === 0) {
        return []
    }

    const { data: branchRows, error: branchError } = await adminClient
        .from('workspace_branches')
        .select('branch_workspace_id, source_workspace_id')
        .in('branch_workspace_id', workspaceIds)

    if (branchError) {
        throw branchError
    }

    const sourceByBranchId = new Map(
        (branchRows ?? []).map((row) => [String(row.branch_workspace_id), String(row.source_workspace_id)])
    )

    return Array.from(new Set(workspaceIds.map((workspaceId) => sourceByBranchId.get(workspaceId) ?? workspaceId)))
}

async function resolveUsageOwnerWorkspaceId(
    adminClient: ReturnType<typeof createAdminClient>,
    workspaceId: string
) {
    const { data, error } = await adminClient
        .from('workspace_branches')
        .select('source_workspace_id')
        .eq('branch_workspace_id', workspaceId)
        .maybeSingle()

    if (error) {
        throw error
    }

    return data?.source_workspace_id ? String(data.source_workspace_id) : workspaceId
}

async function syncWorkspaceUsagePeriod(
    adminClient: ReturnType<typeof createAdminClient>,
    limitedWorkspaceIds: string[]
) {
    const periodStart = currentUsagePeriodStart()
    const now = new Date().toISOString()

    if (limitedWorkspaceIds.length === 0) {
        const { error: deleteAllError } = await adminClient
            .from('workspace_usage')
            .delete()
            .gte('storage_units', '0')

        if (deleteAllError) {
            throw deleteAllError
        }

        return
    }

    const { error: cleanupError } = await adminClient
        .from('workspace_usage')
        .delete()
        .not('workspace_id', 'in', `(${limitedWorkspaceIds.join(',')})`)

    if (cleanupError) {
        throw cleanupError
    }

    if (limitedWorkspaceIds.length > 0) {
        const { error: insertError } = await adminClient
            .from('workspace_usage')
            .upsert(
                limitedWorkspaceIds.map((workspaceId) => ({
                    workspace_id: workspaceId,
                    transfer_period_start: periodStart,
                    storage_updated_at: now,
                    transfer_updated_at: now,
                    updated_at: now
                })),
                { onConflict: 'workspace_id', ignoreDuplicates: true }
            )

        if (insertError) {
            throw insertError
        }
    }

    const { error: resetError } = await adminClient
        .from('workspace_usage')
        .update({
            data_transfer_bytes: '0',
            transfer_period_start: periodStart,
            transfer_updated_at: now,
            updated_at: now
        })
        .neq('transfer_period_start', periodStart)

    if (resetError) {
        throw resetError
    }
}

async function listWorkspaceUsage(adminClient: ReturnType<typeof createAdminClient>) {
    try {
        const limitedWorkspaceIds = await getLimitedWorkspaceIds(adminClient)
        await syncWorkspaceUsagePeriod(adminClient, limitedWorkspaceIds)

        if (limitedWorkspaceIds.length === 0) {
            return jsonResponse([])
        }

        const { data: usageRows, error: usageError } = await adminClient
            .from('workspace_usage')
            .select('workspace_id, storage_units, data_transfer_bytes, transfer_period_start, storage_updated_at, transfer_updated_at, updated_at')
            .in('workspace_id', limitedWorkspaceIds)

        if (usageError) {
            return errorResponse(usageError.message, 500)
        }

        const { data: limitRows, error: limitError } = await adminClient
            .from('workspace_usage_limits')
            .select('workspace_id, storage_unit_limit, monthly_data_transfer_limit_bytes, notes, created_at, updated_at')
            .in('workspace_id', limitedWorkspaceIds)

        if (limitError) {
            return errorResponse(limitError.message, 500)
        }

        const usageByWorkspaceId = new Map((usageRows ?? []).map((row) => [String(row.workspace_id), row]))
        const limitsByWorkspaceId = new Map((limitRows ?? []).map((row) => [String(row.workspace_id), row]))
        const periodStart = currentUsagePeriodStart()

        return jsonResponse(limitedWorkspaceIds.map((workspaceId) => {
            const usage = usageByWorkspaceId.get(workspaceId)
            const limits = limitsByWorkspaceId.get(workspaceId)

            return {
                workspace_id: workspaceId,
                storage_units: String(usage?.storage_units ?? 0),
                data_transfer_bytes: String(usage?.data_transfer_bytes ?? 0),
                transfer_period_start: String(usage?.transfer_period_start ?? periodStart),
                storage_updated_at: usage?.storage_updated_at ?? null,
                transfer_updated_at: usage?.transfer_updated_at ?? null,
                updated_at: usage?.updated_at ?? null,
                has_limits: Boolean(limits),
                storage_unit_limit: limits?.storage_unit_limit === null || limits?.storage_unit_limit === undefined
                    ? null
                    : String(limits.storage_unit_limit),
                monthly_data_transfer_limit_bytes: limits?.monthly_data_transfer_limit_bytes === null || limits?.monthly_data_transfer_limit_bytes === undefined
                    ? null
                    : String(limits.monthly_data_transfer_limit_bytes),
                notes: limits?.notes ?? null,
                limits_created_at: limits?.created_at ?? null,
                limits_updated_at: limits?.updated_at ?? null
            }
        }))
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list workspace usage'
        return errorResponse(message, 500)
    }
}

async function updateWorkspaceUsage(
    adminClient: ReturnType<typeof createAdminClient>,
    body: UpdateWorkspaceUsageRequest
) {
    const workspaceId = body.workspaceId?.trim() ?? ''
    if (!workspaceId) {
        return errorResponse('Workspace is required')
    }

    const { data: workspace, error: workspaceError } = await adminClient
        .from('workspaces')
        .select('id')
        .eq('id', workspaceId)
        .maybeSingle()

    if (workspaceError) {
        return errorResponse(workspaceError.message, 500)
    }

    if (!workspace) {
        return errorResponse('Workspace not found', 404)
    }

    let usageWorkspaceId = workspaceId
    try {
        usageWorkspaceId = await resolveUsageOwnerWorkspaceId(adminClient, workspaceId)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to resolve usage workspace'
        return errorResponse(message, 500)
    }

    const storageUnits = normalizeNullableBigint(body.storageUnits, 'Storage usage')
    const dataTransferBytes = normalizeNullableBigint(body.dataTransferBytes, 'Monthly data transfer')
    const storageUnitLimit = normalizeNullableBigint(body.storageUnitLimit, 'Storage limit')
    const monthlyDataTransferLimitBytes = normalizeNullableBigint(body.monthlyDataTransferLimitBytes, 'Monthly data transfer limit')
    const periodStart = normalizeUsagePeriodStart(body.transferPeriodStart)

    const validationError = storageUnits.error
        ?? dataTransferBytes.error
        ?? storageUnitLimit.error
        ?? monthlyDataTransferLimitBytes.error
        ?? periodStart.error

    if (validationError) {
        return errorResponse(validationError)
    }

    if (storageUnits.value === null || dataTransferBytes.value === null) {
        return errorResponse('Usage counters are required')
    }

    const now = new Date().toISOString()
    const notes = typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.trim().slice(0, 500)
        : null

    if (storageUnitLimit.value === null && monthlyDataTransferLimitBytes.value === null) {
        const { error: usageDeleteError } = await adminClient
            .from('workspace_usage')
            .delete()
            .eq('workspace_id', usageWorkspaceId)

        if (usageDeleteError) {
            return errorResponse(usageDeleteError.message, 500)
        }

        const { error } = await adminClient
            .from('workspace_usage_limits')
            .delete()
            .eq('workspace_id', usageWorkspaceId)

        if (error) {
            return errorResponse(error.message, 500)
        }
    } else {
        const { error: limitsError } = await adminClient
            .from('workspace_usage_limits')
            .upsert({
                workspace_id: usageWorkspaceId,
                storage_unit_limit: storageUnitLimit.value,
                monthly_data_transfer_limit_bytes: monthlyDataTransferLimitBytes.value,
                notes
            }, { onConflict: 'workspace_id' })

        if (limitsError) {
            return errorResponse(limitsError.message, 500)
        }

        const { error: usageError } = await adminClient
            .from('workspace_usage')
            .upsert({
                workspace_id: usageWorkspaceId,
                storage_units: storageUnits.value,
                data_transfer_bytes: dataTransferBytes.value,
                transfer_period_start: periodStart.value,
                storage_updated_at: now,
                transfer_updated_at: now,
                updated_at: now
            }, { onConflict: 'workspace_id' })

        if (usageError) {
            return errorResponse(usageError.message, 500)
        }
    }

    return jsonResponse({ success: true })
}

async function refreshWorkspaceUsage(
    adminClient: ReturnType<typeof createAdminClient>,
    body: RefreshWorkspaceUsageRequest
) {
    const requestedWorkspaceId = body.workspaceId?.trim() || null
    let workspaceId = requestedWorkspaceId

    if (requestedWorkspaceId) {
        try {
            workspaceId = await resolveUsageOwnerWorkspaceId(adminClient, requestedWorkspaceId)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to resolve usage workspace'
            return errorResponse(message, 500)
        }
    }

    const { error } = await adminClient.rpc('refresh_workspace_storage_usage', {
        p_workspace_id: workspaceId
    })

    if (error) {
        return errorResponse(error.message, 500)
    }

    try {
        await syncWorkspaceUsagePeriod(adminClient, await getLimitedWorkspaceIds(adminClient))
    } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : 'Failed to sync usage period'
        return errorResponse(message, 500)
    }

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

        if (body.action === 'listWorkspaceUsage') {
            return await listWorkspaceUsage(adminClient)
        }

        if (body.action === 'updateWorkspaceUsage') {
            return await updateWorkspaceUsage(adminClient, body)
        }

        if (body.action === 'refreshWorkspaceUsage') {
            return await refreshWorkspaceUsage(adminClient, body)
        }

        return errorResponse('Unsupported action', 400)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error'
        return errorResponse(message, 500)
    }
})
