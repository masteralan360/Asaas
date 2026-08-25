import { describe, expect, it } from 'vitest'

import { hasEffectiveSalesAgentCommissionPermission } from './salesAgentCommissionPermissions'
import type { WorkspacePermissionKey } from './workspacePermissionDefinitions'

const keys = (...permissionKeys: WorkspacePermissionKey[]) => permissionKeys

describe('hasEffectiveSalesAgentCommissionPermission', () => {
  it('lets workspace admins use commission workflows', () => {
    expect(hasEffectiveSalesAgentCommissionPermission(
      'admin',
      [],
      'salesAgentCommissions.pay',
    )).toBe(true)
  })

  it('requires each commission permission and its base module permissions', () => {
    expect(hasEffectiveSalesAgentCommissionPermission(
      'staff',
      keys('salesAgentCommissions.viewAll', 'agents.access'),
      'salesAgentCommissions.viewAll',
    )).toBe(false)
    expect(hasEffectiveSalesAgentCommissionPermission(
      'staff',
      keys('salesAgentCommissions.viewAll', 'agents.access', 'orders.saleOrdersAccess'),
      'salesAgentCommissions.viewAll',
    )).toBe(true)
    expect(hasEffectiveSalesAgentCommissionPermission(
      'staff',
      keys('salesAgentCommissions.assignOrders', 'orders.saleOrdersAccess'),
      'salesAgentCommissions.assignOrders',
    )).toBe(true)
    expect(hasEffectiveSalesAgentCommissionPermission(
      'staff',
      keys('salesAgentCommissions.managePlans', 'agents.access'),
      'salesAgentCommissions.managePlans',
    )).toBe(true)
  })
})
