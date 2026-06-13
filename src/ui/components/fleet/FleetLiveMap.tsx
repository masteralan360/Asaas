import { useMemo, useRef, useState } from "react";
import { LocateFixed, Radio, RefreshCw } from "lucide-react";

import { useFleetAgentDirectory } from "@/fleet/useFleetAgentDirectory";
import { useFleetLiveLocations } from "@/fleet/useFleetLiveLocations";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  type MapRef,
} from "@/ui/components";

interface FleetLiveMapProps {
  workspaceId: string;
}

function locationState(recordedAt: string, isSharing: boolean) {
  if (!isSharing) {
    return { label: "Stopped", variant: "secondary" as const, active: false };
  }
  const age = Date.now() - Date.parse(recordedAt);
  if (age <= 30_000) {
    return { label: "Live", variant: "success" as const, active: true };
  }
  if (age <= 5 * 60_000) {
    return { label: "Delayed", variant: "warning" as const, active: true };
  }
  return { label: "Stale", variant: "secondary" as const, active: false };
}

export function FleetLiveMap({ workspaceId }: FleetLiveMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const { locations, isLoading, error, refresh } = useFleetLiveLocations(
    workspaceId,
    true,
  );
  const { getAgentName, partnerByAgentId } =
    useFleetAgentDirectory(workspaceId);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const selectedLocation = locations.find(
    (location) => location.agentId === selectedAgentId,
  );
  const mapCenter = useMemo<[number, number]>(
    () =>
      selectedLocation
        ? [selectedLocation.longitude, selectedLocation.latitude]
        : locations[0]
          ? [locations[0].longitude, locations[0].latitude]
          : [44.3661, 33.3152],
    [locations, selectedLocation],
  );

  function focusAgent(agentId: string) {
    const location = locations.find((item) => item.agentId === agentId);
    if (!location) {
      return;
    }
    setSelectedAgentId(agentId);
    mapRef.current?.flyTo({
      center: [location.longitude, location.latitude],
      zoom: 15,
      duration: 800,
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Location-enabled agents</h2>
              <p className="text-xs text-muted-foreground">
                Updates arrive through the secure fleet channel.
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh live locations"
              onClick={() => void refresh()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {locations.map((location) => {
              const state = locationState(
                location.recordedAt,
                location.isSharing,
              );
              const partner = partnerByAgentId.get(location.agentId);
              return (
                <button
                  type="button"
                  key={location.agentId}
                  className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${
                    selectedAgentId === location.agentId
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                  onClick={() => focusAgent(location.agentId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {getAgentName(location.agentId)}
                    </span>
                    <Badge variant={state.variant}>{state.label}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {partner?.phone || "No phone"} ·{" "}
                    {new Date(location.recordedAt).toLocaleTimeString()}
                  </div>
                </button>
              );
            })}
            {locations.length === 0 && !isLoading && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No agents are sharing a location.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Map
            ref={mapRef}
            center={mapCenter}
            zoom={locations.length ? 12 : 6}
            className="h-[620px] w-full"
          >
            <MapControls showCompass showFullscreen />
            {locations.map((location) => {
              const state = locationState(
                location.recordedAt,
                location.isSharing,
              );
              return (
                <MapMarker
                  key={location.agentId}
                  longitude={location.longitude}
                  latitude={location.latitude}
                  onClick={() => setSelectedAgentId(location.agentId)}
                >
                  <MarkerContent>
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-background shadow-lg ${
                        state.active ? "bg-emerald-500" : "bg-slate-500"
                      }`}
                    >
                      {state.active ? (
                        <Radio className="h-4 w-4 text-white" />
                      ) : (
                        <LocateFixed className="h-4 w-4 text-white" />
                      )}
                    </div>
                  </MarkerContent>
                  <MarkerPopup closeButton>
                    <div className="min-w-48 space-y-1 p-1">
                      <p className="font-semibold">
                        {getAgentName(location.agentId)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Updated {new Date(location.recordedAt).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Accuracy:{" "}
                        {location.accuracy
                          ? `${Math.round(location.accuracy)} m`
                          : "unknown"}
                      </p>
                    </div>
                  </MarkerPopup>
                </MapMarker>
              );
            })}
          </Map>
        </CardContent>
      </Card>
    </div>
  );
}
