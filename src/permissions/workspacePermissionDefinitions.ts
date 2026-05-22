export const WORKSPACE_PERMISSION_DEFINITIONS = [
  {
    key: "payment.access",
    module: "payment",
    labelKey: "members.permissions.paymentAccess",
    defaultLabel: "Payment module",
    descriptionKey: "members.permissions.paymentAccessDescription",
    defaultDescription: "Access the central payments page.",
  },
  {
    key: "directTransaction.access",
    module: "directTransaction",
    labelKey: "members.permissions.directTransactionAccess",
    defaultLabel: "Direct Transaction module",
    descriptionKey: "members.permissions.directTransactionAccessDescription",
    defaultDescription: "Access manual incoming and outgoing transactions.",
  },
] as const;

export type WorkspacePermissionKey =
  (typeof WORKSPACE_PERMISSION_DEFINITIONS)[number]["key"];

const supportedPermissionKeys = new Set<string>(
  WORKSPACE_PERMISSION_DEFINITIONS.map((permission) => permission.key),
);

export function isSupportedWorkspacePermissionKey(
  key: string,
): key is WorkspacePermissionKey {
  return supportedPermissionKeys.has(key);
}

export function getWorkspacePermissionModule(key: string) {
  return key.split(".")[0] || key;
}

