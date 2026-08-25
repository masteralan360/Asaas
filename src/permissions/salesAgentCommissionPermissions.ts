import type { WorkspacePermissionKey } from './workspacePermissionDefinitions'

export type SalesAgentCommissionPermissionKey = Extract<
  WorkspacePermissionKey,
  `salesAgentCommissions.${string}`
>

export function hasEffectiveSalesAgentCommissionPermission(
  role: string | null | undefined,
  permissionKeys: readonly WorkspacePermissionKey[],
  permission: SalesAgentCommissionPermissionKey,
) {
  if (role === 'admin') return true
  if (!permissionKeys.includes(permission)) return false

  const hasAgentsAccess = permissionKeys.includes('agents.access')
  const hasSalesOrderAccess = permissionKeys.includes('orders.saleOrdersAccess')

  if (permission === 'salesAgentCommissions.managePlans') {
    return hasAgentsAccess
  }
  if (permission === 'salesAgentCommissions.assignOrders') {
    return hasSalesOrderAccess
  }
  return hasAgentsAccess && hasSalesOrderAccess
}
