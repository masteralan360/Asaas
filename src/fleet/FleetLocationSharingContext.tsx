import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { useAuth } from "@/auth";
import { isSupabaseConfigured, supabase } from "@/auth/supabase";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { db, type Agent, type FleetLocationPoint, useAgents } from "@/local-db";
import { getFleetSupabaseClient, getSupabaseClientForTable } from "@/lib/supabaseSchema";
import { runSupabaseAction } from "@/lib/supabaseRequest";
import { toCamelCase } from "@/lib/utils";
import { useWorkspace } from "@/workspace";

type SharingStatus = "idle" | "starting" | "sharing" | "error";

interface FleetLocationSharingContextValue {
  linkedAgent?: Agent;
  status: SharingStatus;
  latestLocation?: FleetLocationPoint;
  error?: string;
  isOnline: boolean;
  isSupported: boolean;
  canShare: boolean;
  startSharing: () => Promise<void>;
  stopSharing: () => Promise<void>;
}

const FleetLocationSharingContext =
  createContext<FleetLocationSharingContextValue | undefined>(undefined);

const LIVE_PERSIST_INTERVAL_MS = 5_000;
const HISTORY_INTERVAL_MS = 60_000;
const HISTORY_DISTANCE_METERS = 50;
const BROADCAST_INTERVAL_MS = 5_000;
const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 20_000,
};

function distanceMeters(
  left: Pick<FleetLocationPoint, "latitude" | "longitude">,
  right: Pick<FleetLocationPoint, "latitude" | "longitude">,
) {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission was denied. Enable it in your device settings.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Your device could not determine its current location.";
  }
  return "Location tracking timed out. Check GPS and network access.";
}

function isGeolocationPositionError(
  error: unknown,
): error is GeolocationPositionError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function requestCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      GEOLOCATION_OPTIONS,
    );
  });
}

function getDeviceLabel() {
  if (typeof navigator === "undefined") {
    return null;
  }
  return navigator.userAgent.slice(0, 250);
}

function getSupabaseErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return error;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  return {
    code: candidate.code,
    message: candidate.message,
    details: candidate.details,
    hint: candidate.hint,
  };
}

export function FleetLocationSharingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useAuth();
  const { features, isLocalMode, isDemoMode } = useWorkspace();
  const isOnline = useNetworkStatus();
  const agents = useAgents(user?.workspaceId);
  const linkedAgent = agents.find(
    (agent) => agent.linkedUserId === user?.id && agent.status === "active",
  );
  const [status, setStatus] = useState<SharingStatus>("idle");
  const [latestLocation, setLatestLocation] = useState<FleetLocationPoint>();
  const [error, setError] = useState<string>();
  const watchIdRef = useRef<number>();
  const sessionIdRef = useRef<string>();
  const channelRef = useRef<RealtimeChannel>();
  const lastBroadcastAtRef = useRef(0);
  const lastPersistAtRef = useRef(0);
  const lastHistoryAtRef = useRef(0);
  const lastHistoryPointRef = useRef<FleetLocationPoint>();
  const stoppingRef = useRef(false);

  const isSupported =
    typeof navigator !== "undefined" && "geolocation" in navigator;
  const canShare =
    Boolean(
      user?.workspaceId &&
        user.id &&
        features.agents &&
        linkedAgent &&
        isSupabaseConfigured &&
        !isLocalMode &&
        !isDemoMode,
    ) && isSupported;

  useEffect(() => {
    if (
      !user?.workspaceId ||
      !user.id ||
      !features.agents ||
      isLocalMode ||
      isDemoMode ||
      linkedAgent ||
      !isSupabaseConfigured
    ) {
      return;
    }

    let cancelled = false;
    void runSupabaseAction("fleet.linkedAgent", () =>
      getSupabaseClientForTable("agents")
        .from("agents")
        .select("*")
        .eq("workspace_id", user.workspaceId)
        .eq("linked_user_id", user.id)
        .eq("is_deleted", false)
        .maybeSingle(),
    )
      .then(async ({ data, error: fetchError }: any) => {
        if (cancelled || fetchError || !data) {
          return;
        }
        await db.agents.put({
          ...(toCamelCase(data) as unknown as Agent),
          syncStatus: "synced",
          lastSyncedAt: new Date().toISOString(),
        });
      })
      .catch((fetchError) => {
        console.warn("[Fleet] Failed to resolve linked agent:", fetchError);
      });

    return () => {
      cancelled = true;
    };
  }, [
    features.agents,
    isDemoMode,
    isLocalMode,
    linkedAgent,
    user?.id,
    user?.workspaceId,
  ]);

  const persistLocation = useCallback(
    async (point: FleetLocationPoint) => {
      const now = Date.now();
      const fleetClient = getFleetSupabaseClient();
      const livePayload = {
        workspace_id: point.workspaceId,
        agent_id: point.agentId,
        session_id: point.sessionId,
        user_id: point.userId,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        heading: point.heading,
        speed: point.speed,
        altitude: point.altitude,
        recorded_at: point.recordedAt,
        received_at: new Date().toISOString(),
        is_sharing: true,
      };
      const historyPayload = {
        workspace_id: point.workspaceId,
        agent_id: point.agentId,
        session_id: point.sessionId,
        user_id: point.userId,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        heading: point.heading,
        speed: point.speed,
        altitude: point.altitude,
        recorded_at: point.recordedAt,
      };

      if (now - lastPersistAtRef.current >= LIVE_PERSIST_INTERVAL_MS) {
        lastPersistAtRef.current = now;
        const { error: liveError } = (await runSupabaseAction(
          "fleet.liveLocation.upsert",
          () =>
            fleetClient
              .from("live_locations")
              .upsert(livePayload, { onConflict: "agent_id" }),
        )) as { error?: unknown };
        if (liveError) {
          throw liveError;
        }

        void fleetClient
          .from("location_sessions")
          .update({ last_seen_at: point.recordedAt })
          .eq("id", point.sessionId);
      }

      const previousHistoryPoint = lastHistoryPointRef.current;
      const shouldWriteHistory =
        !previousHistoryPoint ||
        now - lastHistoryAtRef.current >= HISTORY_INTERVAL_MS ||
        distanceMeters(previousHistoryPoint, point) >= HISTORY_DISTANCE_METERS;

      if (shouldWriteHistory) {
        const { error: historyError } = (await runSupabaseAction(
          "fleet.locationHistory.insert",
          () => fleetClient.from("location_history").insert(historyPayload),
        )) as { error?: unknown };
        if (historyError) {
          console.warn(
            "[Fleet] Failed to archive location history; live sharing will continue.",
            getSupabaseErrorDetails(historyError),
          );
        }
        lastHistoryAtRef.current = now;
        lastHistoryPointRef.current = point;
      }
    },
    [],
  );

  const handlePosition = useCallback(
    async (position: GeolocationPosition) => {
      const sessionId = sessionIdRef.current;
      if (!user?.workspaceId || !user.id || !linkedAgent || !sessionId) {
        return;
      }

      const point: FleetLocationPoint = {
        workspaceId: user.workspaceId,
        agentId: linkedAgent.id,
        sessionId,
        userId: user.id,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        altitude: position.coords.altitude,
        recordedAt: new Date(position.timestamp).toISOString(),
        isSharing: true,
      };
      setLatestLocation(point);
      setError(undefined);
      setStatus("sharing");

      const now = Date.now();
      if (now - lastBroadcastAtRef.current >= BROADCAST_INTERVAL_MS) {
        lastBroadcastAtRef.current = now;
        void channelRef.current
          ?.httpSend("location", point)
          .catch((broadcastError) => {
            console.warn("[Fleet] Failed to broadcast location:", broadcastError);
          });
      }

      if (isOnline) {
        await persistLocation(point);
      }
    },
    [isOnline, linkedAgent, persistLocation, user?.id, user?.workspaceId],
  );

  const stopSharing = useCallback(async () => {
    if (stoppingRef.current) {
      return;
    }
    stoppingRef.current = true;

    if (watchIdRef.current !== undefined && isSupported) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = undefined;
    }

    const sessionId = sessionIdRef.current;
    const currentAgent = linkedAgent;
    try {
      if (sessionId && currentAgent && isSupabaseConfigured && isOnline) {
        const fleetClient = getFleetSupabaseClient();
        await fleetClient
          .from("live_locations")
          .update({
            is_sharing: false,
            received_at: new Date().toISOString(),
          })
          .eq("agent_id", currentAgent.id)
          .eq("session_id", sessionId);
        await fleetClient
          .from("location_sessions")
          .update({
            status: "stopped",
            ended_at: new Date().toISOString(),
            last_seen_at: latestLocation?.recordedAt ?? new Date().toISOString(),
          })
          .eq("id", sessionId);
      }
    } catch (stopError) {
      console.warn("[Fleet] Failed to close location session:", stopError);
    } finally {
      if (channelRef.current) {
        await supabase.removeChannel(channelRef.current);
        channelRef.current = undefined;
      }
      sessionIdRef.current = undefined;
      lastBroadcastAtRef.current = 0;
      lastPersistAtRef.current = 0;
      lastHistoryAtRef.current = 0;
      lastHistoryPointRef.current = undefined;
      setLatestLocation(undefined);
      setStatus("idle");
      stoppingRef.current = false;
    }
  }, [isOnline, isSupported, latestLocation?.recordedAt, linkedAgent]);

  const startSharing = useCallback(async () => {
    if (!canShare || !user?.workspaceId || !user.id || !linkedAgent) {
      setError(
        isLocalMode || isDemoMode
          ? "Live fleet tracking requires a cloud or hybrid workspace."
          : "An active agent must be linked to your workspace user.",
      );
      setStatus("error");
      return;
    }
    if (!isOnline) {
      setError("Connect to the internet before starting live location sharing.");
      setStatus("error");
      return;
    }
    if (status === "starting" || status === "sharing") {
      return;
    }

    setStatus("starting");
    setError(undefined);
    try {
      // Trigger the browser or native permission prompt directly from the user action.
      const initialPosition = await requestCurrentPosition();
      const fleetClient = getFleetSupabaseClient();
      await fleetClient
        .from("location_sessions")
        .update({
          status: "stopped",
          ended_at: new Date().toISOString(),
        })
        .eq("workspace_id", user.workspaceId)
        .eq("user_id", user.id)
        .eq("status", "active");

      const { data, error: sessionError } = (await runSupabaseAction(
        "fleet.locationSession.start",
        () =>
          fleetClient
            .from("location_sessions")
            .insert({
              workspace_id: user.workspaceId,
              agent_id: linkedAgent.id,
              user_id: user.id,
              status: "active",
              device_label: getDeviceLabel(),
            })
            .select("id")
            .single(),
      )) as { data?: { id: string } | null; error?: unknown };
      if (sessionError || !data?.id) {
        throw sessionError || new Error("Failed to start a location session");
      }
      sessionIdRef.current = data.id;

      // Agents only send to this private channel. Receiving remains restricted to
      // administrators with fleet.viewLiveLocations.
      channelRef.current = supabase.channel(`fleet-live:${user.workspaceId}`, {
        config: {
          private: true,
          broadcast: { self: false, ack: false },
        },
      });

      await handlePosition(initialPosition);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          void handlePosition(position).catch((persistError) => {
            console.warn("[Fleet] Failed to persist location:", persistError);
          });
        },
        (positionError) => {
          setError(geolocationErrorMessage(positionError));
          setStatus("error");
          void stopSharing();
        },
        GEOLOCATION_OPTIONS,
      );
    } catch (startError) {
      setError(
        isGeolocationPositionError(startError)
          ? geolocationErrorMessage(startError)
          : startError instanceof Error
          ? startError.message
          : "Failed to start location sharing",
      );
      setStatus("error");
      await stopSharing();
    }
  }, [
    canShare,
    handlePosition,
    isDemoMode,
    isLocalMode,
    isOnline,
    linkedAgent,
    status,
    stopSharing,
    user?.id,
    user?.workspaceId,
  ]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== undefined && isSupported) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
      }
    };
  }, [isSupported]);

  useEffect(() => {
    if (!user || !linkedAgent || linkedAgent.status !== "active") {
      void stopSharing();
    }
  }, [linkedAgent, stopSharing, user]);

  const value = useMemo(
    () => ({
      linkedAgent,
      status,
      latestLocation,
      error,
      isOnline,
      isSupported,
      canShare,
      startSharing,
      stopSharing,
    }),
    [
      canShare,
      error,
      isOnline,
      isSupported,
      latestLocation,
      linkedAgent,
      startSharing,
      status,
      stopSharing,
    ],
  );

  return (
    <FleetLocationSharingContext.Provider value={value}>
      {children}
    </FleetLocationSharingContext.Provider>
  );
}

export function useFleetLocationSharing() {
  const context = useContext(FleetLocationSharingContext);
  if (!context) {
    throw new Error(
      "useFleetLocationSharing must be used within FleetLocationSharingProvider",
    );
  }
  return context;
}
