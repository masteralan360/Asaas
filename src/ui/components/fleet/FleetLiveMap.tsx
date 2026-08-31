import { useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

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
import { FleetAgentAvatar } from "./FleetAgentAvatar";

interface FleetLiveMapProps {
  workspaceId: string;
}

function locationState(recordedAt: string, isSharing: boolean) {
  if (!isSharing) {
    return { key: "stopped", variant: "secondary" as const, active: false };
  }
  const age = Date.now() - Date.parse(recordedAt);
  if (age <= 30_000) {
    return { key: "live", variant: "success" as const, active: true };
  }
  if (age <= 5 * 60_000) {
    return { key: "delayed", variant: "warning" as const, active: true };
  }
  return { key: "stale", variant: "secondary" as const, active: false };
}

export function FleetLiveMap({ workspaceId }: FleetLiveMapProps) {
  const { t, i18n } = useTranslation();
  const mapRef = useRef<MapRef | null>(null);
  const { locations, isLoading, error, refresh } = useFleetLiveLocations(
    workspaceId,
    true,
  );
  const { getAgentName, getAgentProfileUrl, partnerByAgentId } =
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
              <h2 className="font-semibold">{t("fleet.live.locationEnabledAgents")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("fleet.live.secureChannelNote")}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("fleet.live.refreshLocations")}
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
              const agentName = getAgentName(location.agentId);
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
                    <div className="flex items-center gap-2">
                      <FleetAgentAvatar
                        profileUrl={getAgentProfileUrl(location.agentId)}
                        name={agentName}
                      />
                      <span className="font-medium">{agentName}</span>
                    </div>
                    <Badge variant={state.variant}>
                      {t(`fleet.liveStatus.${state.key}`)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {partner?.phone || t("fleet.live.noPhone")} ·{" "}
                    {new Date(location.recordedAt).toLocaleTimeString(i18n.language)}
                  </div>
                </button>
              );
            })}
            {locations.length === 0 && !isLoading && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {t("fleet.live.noSharedLocations")}
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
              const agentName = getAgentName(location.agentId);
              return (
                <MapMarker
                  key={location.agentId}
                  longitude={location.longitude}
                  latitude={location.latitude}
                  onClick={() => setSelectedAgentId(location.agentId)}
                >
                  <MarkerContent>
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-background p-0.5 shadow-lg ${
                        state.active ? "bg-emerald-500" : "bg-slate-500"
                      }`}
                    >
                      <FleetAgentAvatar
                        profileUrl={getAgentProfileUrl(location.agentId)}
                        name={agentName}
                        className="h-full w-full border-0 bg-white"
                      />
                    </div>
                  </MarkerContent>
                  <MarkerPopup closeButton>
                    <div className="flex min-w-48 gap-2 p-1">
                      <FleetAgentAvatar
                        profileUrl={getAgentProfileUrl(location.agentId)}
                        name={agentName}
                      />
                      <div className="space-y-1">
                      <p className="font-semibold">
                        {agentName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("fleet.live.updatedAt", {
                          date: new Date(location.recordedAt).toLocaleString(
                            i18n.language,
                          ),
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("fleet.live.accuracy", {
                          accuracy: location.accuracy
                            ? t("fleet.meters", {
                                value: Math.round(location.accuracy),
                              })
                            : t("fleet.unknown"),
                        })}
                      </p>
                      </div>
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
