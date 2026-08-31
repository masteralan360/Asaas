import { LocateFixed, MapPin, Radio, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModulePageFreshness } from '@/ui/components/ModulePageFreshness';

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
  const { t } = useTranslation();
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
          {t("fleet.shareLocation")}
        </h1>
        <p className="text-muted-foreground">
          {t("fleet.shareLocationDescription")} <ModulePageFreshness className="ms-2" />
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>{linkedAgent ? getAgentName(linkedAgent.id) : t("fleet.agentLinkRequired")}</span>
            <Badge
              variant={
                status === "sharing"
                  ? "success"
                  : status === "error"
                    ? "destructive"
                    : "secondary"
              }
            >
              {t(`fleet.sharingStatus.${status}`)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!linkedAgent && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              {t("fleet.agentLinkDescription")}
            </div>
          )}
          {!isSupported && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {t("fleet.geolocationUnsupported")}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("fleet.agentType")}</p>
              <p className="font-medium">
                {linkedAgent
                  ? t(`fleet.agentTypes.${linkedAgent.agentType}`)
                  : "-"}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("fleet.territory")}</p>
              <p className="font-medium">{linkedAgent?.zone ?? "-"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t("fleet.connection")}</p>
              <p className="font-medium">
                {isOnline ? t("fleet.online") : t("fleet.offline")}
              </p>
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
                {t("fleet.startSharing")}
              </Button>
            ) : (
              <Button
                size="lg"
                variant="destructive"
                onClick={() => void stopSharing()}
              >
                {t("fleet.stopSharing")}
              </Button>
            )}
          </div>
          <div className="flex gap-3 rounded-lg bg-muted/60 p-4 text-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p>
              {t("fleet.sharingPrivacyNotice")}
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
