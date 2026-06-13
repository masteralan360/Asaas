import { LocateFixed, MapPin, Radio, ShieldCheck } from "lucide-react";

import { useFleetLocationSharing } from "@/fleet/FleetLocationSharingContext";
import { useFleetAgentDirectory } from "@/fleet/useFleetAgentDirectory";
import { useAuth } from "@/auth";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
} from "@/ui/components";

export function AgentLocationSharing() {
  const { user } = useAuth();
  const {
    linkedAgent,
    status,
    latestLocation,
    error,
    isOnline,
    isSupported,
    canShare,
    startSharing,
    stopSharing,
  } = useFleetLocationSharing();
  const { getAgentName } = useFleetAgentDirectory(user?.workspaceId);
  const isSharing = status === "sharing" || status === "starting";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <LocateFixed className="h-6 w-6 text-primary" />
          Share My Location
        </h1>
        <p className="text-muted-foreground">
          Explicitly enable foreground location sharing for fleet operations.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>{linkedAgent ? getAgentName(linkedAgent.id) : "Agent link required"}</span>
            <Badge
              variant={
                status === "sharing"
                  ? "success"
                  : status === "error"
                    ? "destructive"
                    : "secondary"
              }
            >
              {status === "starting" ? "Starting" : status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!linkedAgent && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              Your workspace user is not linked to an active agent. An admin must
              link it from the Agents module before location sharing is available.
            </div>
          )}
          {!isSupported && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              This device does not expose a supported geolocation service.
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Agent type</p>
              <p className="font-medium">{linkedAgent?.agentType ?? "-"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Territory</p>
              <p className="font-medium">{linkedAgent?.zone ?? "-"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Connection</p>
              <p className="font-medium">{isOnline ? "Online" : "Offline"}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            {!isSharing ? (
              <Button
                size="lg"
                disabled={!canShare || !isOnline}
                onClick={() => void startSharing()}
              >
                <Radio className="mr-2 h-4 w-4" />
                Start sharing
              </Button>
            ) : (
              <Button
                size="lg"
                variant="destructive"
                onClick={() => void stopSharing()}
              >
                Stop sharing
              </Button>
            )}
          </div>
          <div className="flex gap-3 rounded-lg bg-muted/60 p-4 text-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p>
              Sharing starts only after you press the button. This release tracks
              while Atlas remains open; native Android background tracking requires
              a later foreground-service build.
            </p>
          </div>
        </CardContent>
      </Card>
      {latestLocation && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Map
              center={[latestLocation.longitude, latestLocation.latitude]}
              zoom={15}
              className="h-[380px] w-full"
            >
              <MapControls showCompass showLocate />
              <MapMarker
                longitude={latestLocation.longitude}
                latitude={latestLocation.latitude}
              >
                <MarkerContent>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-emerald-500 shadow-lg">
                    <MapPin className="h-5 w-5 text-white" />
                  </div>
                </MarkerContent>
              </MapMarker>
            </Map>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
