import { useMemo } from "react";

import { useOptionalAuth } from "@/auth/AuthContext";
import type { WorkspacePermissionKey } from "./workspacePermissionDefinitions";
import { useOptionalWorkspacePermissions } from "./workspacePermissionsState";

export interface ViewOwnRecordScope {
  isRestricted: boolean;
  userId: string | undefined;
}

/**
 * RLS is the authoritative enforcement layer. This hook mirrors its scope in
 * the offline/local cache so stale rows cannot briefly appear while a cloud
 * refresh reconciles the cache after a permission change.
 */
export function useViewOwnRecordScope(
  permission: Extract<WorkspacePermissionKey, `${string}.view_own`>,
): ViewOwnRecordScope {
  const auth = useOptionalAuth();
  const permissions = useOptionalWorkspacePermissions();
  const userId = auth?.user?.id;
  const userRole = auth?.user?.role;

  return useMemo(
    () => ({
      isRestricted: Boolean(
        userId
          && userRole !== "admin"
          && permissions?.permissionKeys.includes(permission),
      ),
      userId,
    }),
    [permission, permissions?.permissionKeys, userId, userRole],
  );
}
