import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/auth";
import { isSupabaseConfigured, supabase } from "@/auth/supabase";
import { useWorkspace } from "@/workspace";
import {
  isSupportedWorkspacePermissionKey,
  WORKSPACE_PERMISSION_DEFINITIONS,
  type WorkspacePermissionKey,
} from "./workspacePermissionDefinitions";
import {
  normalizeSupabaseActionError,
  runSupabaseAction,
} from "@/lib/supabaseRequest";
import {
  readCachedPermissions,
  writeCachedPermissions,
} from "./workspacePermissionCache";
import { db } from "@/local-db";

interface WorkspacePermissionsContextType {
  permissionKeys: WorkspacePermissionKey[];
  isLoading: boolean;
  hasPermission: (permission: WorkspacePermissionKey) => boolean;
  refreshPermissions: () => Promise<void>;
}

const WorkspacePermissionsContext =
  createContext<WorkspacePermissionsContextType | undefined>(undefined);

export function WorkspacePermissionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, isAuthenticated } = useAuth();
  const { hasCapability } = useWorkspace();
  const [permissionKeys, setPermissionKeys] = useState<WorkspacePermissionKey[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);

  const workspaceId = user?.workspaceId ?? "";
  const userId = user?.id ?? "";
  const userRole = user?.role;
  const isLocalMode =
    user?.workspaceMode === "local" || user?.workspaceMode === "demo";
  const permissionsEnabled = hasCapability("workspaceManagementPermissions");

  const refreshPermissions = useCallback(async () => {
    if (!isAuthenticated || !workspaceId || !userId || !permissionsEnabled) {
      setPermissionKeys([]);
      setIsLoading(false);
      return;
    }

    if (userRole === "admin") {
      setPermissionKeys([]);
      setIsLoading(false);
      return;
    }

    if (isLocalMode || !isSupabaseConfigured) {
      if (isLocalMode) {
        const rows = await db.workspace_permissions
          .where("userUuid")
          .equals(userId)
          .toArray();
        const keys = rows
          .map((r) => r.key)
          .filter(isSupportedWorkspacePermissionKey);
        setPermissionKeys(keys);
        writeCachedPermissions(workspaceId, userId, keys);
      } else {
        const cached = readCachedPermissions(workspaceId, userId);
        setPermissionKeys(cached);
      }
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = (await runSupabaseAction(
        "workspacePermissions.fetchMine",
        () =>
          supabase
            .from("workspace_permissions")
            .select("key")
            .eq("workspace_id", workspaceId)
            .eq("user_uuid", userId),
        { timeoutMs: 8000, platform: "all" },
      )) as {
        data: Array<{ key: string }> | null;
        error?: unknown;
      };

      if (error) {
        throw error;
      }

      const nextKeys = (data ?? [])
        .map((row) => row.key)
        .filter(isSupportedWorkspacePermissionKey);

      setPermissionKeys(nextKeys);
      writeCachedPermissions(workspaceId, userId, nextKeys);
    } catch (error) {
      const normalized = normalizeSupabaseActionError(error);
      console.warn("[Permissions] Failed to fetch workspace permissions:", normalized);
      if (cached.length === 0) {
        setPermissionKeys([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, isLocalMode, permissionsEnabled, userId, userRole, workspaceId]);

  useEffect(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  useEffect(() => {
    if (
      !isSupabaseConfigured ||
      isLocalMode ||
      !isAuthenticated ||
      !workspaceId ||
      !userId ||
      !permissionsEnabled ||
      userRole === "admin"
    ) {
      return;
    }

    const channel = supabase
      .channel(`workspace-permissions-${workspaceId}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_permissions",
          filter: `user_uuid=eq.${userId}`,
        },
        () => {
          void refreshPermissions();
        },
      )
      .subscribe();

    const handlePermissionsChanged = () => {
      void refreshPermissions();
    };

    window.addEventListener(
      "workspace-permissions:changed",
      handlePermissionsChanged,
    );

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener(
        "workspace-permissions:changed",
        handlePermissionsChanged,
      );
    };
  }, [isAuthenticated, isLocalMode, permissionsEnabled, refreshPermissions, userId, userRole, workspaceId]);

  const permissionSet = useMemo(
    () => new Set<WorkspacePermissionKey>(permissionKeys),
    [permissionKeys],
  );

  const hasPermission = useCallback(
    (permission: WorkspacePermissionKey) => {
      // 1. Check for global.NOprint restriction first for any print-related checks
      const isPrintAction = permission === 'global.NOprint' || (permission.split('.').length === 2 && permission.split('.')[1] === 'print')
      
      if (isPrintAction) {
        // If they have the explicit NOprint restriction, they don't have permission
        if (permissionSet.has('global.NOprint')) {
          return false
        }
        
        // For above staff roles (admin), print is always ON by default if not restricted
        if (userRole === "admin") {
          return true
        }

        // For other roles, they might still need explicit module-specific grant?
        // Actually, the user's logic says "global print is always ON" for above staff.
        // What about Staff? The user didn't explicitly say, but mentioned "for above staff".
        // I'll keep the existing fallback logic but oriented around NOprint for non-admins too?
        // No, I'll stick to the prompt: above staff = always ON unless NOprint.
      }

      if (userRole === "admin") {
        return true;
      }

      if (!permissionsEnabled) {
        return true;
      }

      // 2. Check direct permission
      if (permissionSet.has(permission)) {
        return true;
      }

      // 3. Check global fallback (non-print actions)
      const parts = permission.split(".");
      if (parts.length === 2 && parts[0] !== "global") {
        const action = parts[1];
        if (action === 'print') {
           // We already handled print above, but just to be sure
           return !permissionSet.has('global.NOprint')
        }

        const globalKey = `global.${action}` as WorkspacePermissionKey;

        // Check if globalFallback exists and is granted
        if (isSupportedWorkspacePermissionKey(globalKey) && permissionSet.has(globalKey)) {
          // Precedence rule: Module-specific permission wins if it exists in definitions
          const hasModuleSpecificDefinition = WORKSPACE_PERMISSION_DEFINITIONS.some(
            (d) => d.key === permission && d.module !== "global",
          );

          // If no module-specific definition exists for this permission, allow global fallback
          if (!hasModuleSpecificDefinition) {
            return true;
          }
        }
      }

      return false;
    },
    [permissionSet, permissionsEnabled, userRole],
  );

  return (
    <WorkspacePermissionsContext.Provider
      value={{
        permissionKeys,
        isLoading,
        hasPermission,
        refreshPermissions,
      }}
    >
      {children}
    </WorkspacePermissionsContext.Provider>
  );
}

export function useWorkspacePermissions() {
  const context = useContext(WorkspacePermissionsContext);
  if (context === undefined) {
    throw new Error(
      "useWorkspacePermissions must be used within WorkspacePermissionsProvider",
    );
  }
  return context;
}
