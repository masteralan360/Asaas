import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { supabase } from "@/auth/supabase";
import type { FleetLocationPoint } from "@/local-db";
import { getFleetSupabaseClient } from "@/lib/supabaseSchema";
import { runSupabaseAction } from "@/lib/supabaseRequest";
import { toCamelCase } from "@/lib/utils";

interface FleetLiveLocationsResult {
  locations: FleetLocationPoint[];
  isLoading: boolean;
  error?: string;
  refresh: () => Promise<void>;
}

function normalizeLocation(row: Record<string, unknown>): FleetLocationPoint {
  return toCamelCase(row) as unknown as FleetLocationPoint;
}

export function useFleetLiveLocations(
  workspaceId?: string,
  enabled = true,
): FleetLiveLocationsResult {
  const { t } = useTranslation();
  const [locationsByAgent, setLocationsByAgent] = useState<
    Map<string, FleetLocationPoint>
  >(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!workspaceId || !enabled) {
      setLocationsByAgent(new Map());
      return;
    }

    setIsLoading(true);
    try {
      const { data, error: fetchError } = (await runSupabaseAction(
        "fleet.liveLocations.fetch",
        () =>
          getFleetSupabaseClient()
            .from("live_locations")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("recorded_at", { ascending: false }),
      )) as { data?: Record<string, unknown>[] | null; error?: unknown };
      if (fetchError) {
        throw fetchError;
      }

      setLocationsByAgent(
        new Map(
          (data ?? []).map((row) => {
            const location = normalizeLocation(row);
            return [location.agentId, location];
          }),
        ),
      );
      setError(undefined);
    } catch {
      setError(t("fleet.errors.loadLiveLocations"));
    } finally {
      setIsLoading(false);
    }
  }, [enabled, t, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workspaceId || !enabled) {
      return;
    }

    const upsertLocation = (location: FleetLocationPoint) => {
      if (location.workspaceId !== workspaceId) {
        return;
      }
      setLocationsByAgent((current) => {
        const next = new Map(current);
        const existing = next.get(location.agentId);
        if (
          !existing ||
          Date.parse(location.recordedAt) >= Date.parse(existing.recordedAt)
        ) {
          next.set(location.agentId, location);
        }
        return next;
      });
    };

    const databaseChannel = supabase
      .channel(`fleet-database:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "fleet",
          table: "live_locations",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const row =
            payload.eventType === "DELETE"
              ? (payload.old as Record<string, unknown>)
              : (payload.new as Record<string, unknown>);
          const location = normalizeLocation(row);
          if (payload.eventType === "DELETE") {
            setLocationsByAgent((current) => {
              const next = new Map(current);
              next.delete(location.agentId);
              return next;
            });
            return;
          }
          upsertLocation(location);
        },
      )
      .subscribe((channelStatus) => {
        if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT"
        ) {
          setError(t("fleet.errors.liveUpdatesUnavailable"));
        }
      });

    const broadcastChannel = supabase
      .channel(`fleet-live:${workspaceId}`, {
        config: {
          private: true,
          broadcast: { self: false, ack: false },
        },
      })
      .on("broadcast", { event: "location" }, ({ payload }) => {
        upsertLocation(payload as FleetLocationPoint);
      })
      .subscribe((channelStatus) => {
        if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT"
        ) {
          console.warn(
            "[Fleet] Private broadcast unavailable; using database updates.",
          );
        }
      });

    return () => {
      void supabase.removeChannel(databaseChannel);
      void supabase.removeChannel(broadcastChannel);
    };
  }, [enabled, t, workspaceId]);

  const locations = useMemo(
    () =>
      Array.from(locationsByAgent.values()).sort((left, right) =>
        right.recordedAt.localeCompare(left.recordedAt),
      ),
    [locationsByAgent],
  );

  return { locations, isLoading, error, refresh };
}

export function useFleetLocationHistory(
  workspaceId?: string,
  agentId?: string,
  enabled = true,
) {
  const { t } = useTranslation();
  const [points, setPoints] = useState<FleetLocationPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!workspaceId || !enabled) {
      setPoints([]);
      return;
    }

    setIsLoading(true);
    try {
      let query = getFleetSupabaseClient()
        .from("location_history")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("recorded_at", { ascending: false })
        .limit(500);
      if (agentId && agentId !== "all") {
        query = query.eq("agent_id", agentId);
      }

      const { data, error: fetchError } = (await runSupabaseAction(
        "fleet.locationHistory.fetch",
        () => query,
      )) as { data?: Record<string, unknown>[] | null; error?: unknown };
      if (fetchError) {
        throw fetchError;
      }
      setPoints((data ?? []).map(normalizeLocation));
      setError(undefined);
    } catch {
      setError(t("fleet.errors.loadHistory"));
    } finally {
      setIsLoading(false);
    }
  }, [agentId, enabled, t, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { points, isLoading, error, refresh };
}
