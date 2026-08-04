import { createContext, useContext } from "react";

import type { WorkspacePermissionKey } from "./workspacePermissionDefinitions";

export interface WorkspacePermissionsContextType {
  permissionKeys: WorkspacePermissionKey[];
  isLoading: boolean;
  hasPermission: (permission: WorkspacePermissionKey) => boolean;
  refreshPermissions: () => Promise<void>;
}

export const WorkspacePermissionsContext =
  createContext<WorkspacePermissionsContextType | undefined>(undefined);

/**
 * Lets low-level data hooks apply a defensive local-cache filter without
 * forcing tests or non-app callers to mount the permissions provider.
 */
export function useOptionalWorkspacePermissions() {
  return useContext(WorkspacePermissionsContext);
}
