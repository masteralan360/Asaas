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
import {
  isSupportedWorkspacePermissionKey,
  type WorkspacePermissionKey,
} from "./workspacePermissionDefinitions";
import {
  normalizeSupabaseActionError,
  runSupabaseAction,
} from "@/lib/supabaseRequest";

interface WorkspacePermissionsContextType {
  permissionKeys: WorkspacePermissionKey[];
  isLoading: boolean;
  hasPermission: (permission: WorkspacePermissionKey) => boolean;
  refreshPermissions: () => Promise<void>;
}

const WorkspacePermissionsContext =
  createContext<WorkspacePermissionsContextType | undefined>(undefined);

function getCacheKey(workspaceId: string, userId: string) {
  return `atlas_workspace_permissions:${workspaceId}:${userId}`;
}

function readCachedPermissions(workspaceId: string, userId: string) {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(getCacheKey(workspaceId, userId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isSupportedWorkspacePermissionKey);
  } catch (error) {
    console.warn("[Permissions] Failed to read cached permissions:", error);
    return [];
  }
}

function writeCachedPermissions(
  workspaceId: string,
  userId: string,
  keys: WorkspacePermissionKey[],
) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(getCacheKey(workspaceId, userId), JSON.stringify(keys));
  } catch (error) {
    console.warn("[Permissions] Failed to cache permissions:", error);
  }
}

export function WorkspacePermissionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, isAuthenticated } = useAuth();
  const [permissionKeys, setPermissionKeys] = useState<WorkspacePermissionKey[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);

  const workspaceId = user?.workspaceId ?? "";
  const userId = user?.id ?? "";
  const userRole = user?.role;

  const refreshPermissions = useCallback(async () => {
    if (!isAuthenticated || !workspaceId || !userId) {
      setPermissionKeys([]);
      setIsLoading(false);
      return;
    }

    if (userRole === "admin") {
      setPermissionKeys([]);
      setIsLoading(false);
      return;
    }

    const cached = readCachedPermissions(workspaceId, userId);
    if (cached.length > 0) {
      setPermissionKeys(cached);
    }

    if (!isSupabaseConfigured) {
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
  }, [isAuthenticated, userId, userRole, workspaceId]);

  useEffect(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  useEffect(() => {
    if (
      !isSupabaseConfigured ||
      !isAuthenticated ||
      !workspaceId ||
      !userId ||
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
  }, [isAuthenticated, refreshPermissions, userId, userRole, workspaceId]);

  const permissionSet = useMemo(
    () => new Set<WorkspacePermissionKey>(permissionKeys),
    [permissionKeys],
  );

  const hasPermission = useCallback(
    (permission: WorkspacePermissionKey) => {
      if (userRole === "admin") {
        return true;
      }

      return permissionSet.has(permission);
    },
    [permissionSet, userRole],
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

