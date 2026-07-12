import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { useFleetAgentDirectory } from "@/fleet/useFleetAgentDirectory";
import { useFleetLocationHistory } from "@/fleet/useFleetLiveLocations";
import {
  Button,
  Card,
  CardContent,
  Map,
  MapControls,
  MapMarker,
  MapRoute,
  MarkerContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components";
import { FleetAgentAvatar } from "./FleetAgentAvatar";

interface FleetHistoryPanelProps {
  workspaceId: string;
}

export function FleetHistoryPanel({ workspaceId }: FleetHistoryPanelProps) {
  const { agents, getAgentName, getAgentProfileUrl } =
    useFleetAgentDirectory(workspaceId);
  const [agentId, setAgentId] = useState<string>("all");
  const { points, isLoading, error, refresh } = useFleetLocationHistory(
    workspaceId,
    agentId,
    true,
  );
  const routePoints = useMemo(
    () =>
      agentId === "all"
        ? []
        : [...points]
            .reverse()
            .map(
              (point) =>
                [point.longitude, point.latitude] as [number, number],
            ),
    [agentId, points],
  );
  const latestPoint = points[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end">
          <div className="min-w-64 space-y-2">
            <label className="text-sm font-medium">Agent</label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <div className="flex items-center gap-2">
                      <FleetAgentAvatar
                        profileUrl={getAgentProfileUrl(agent.id)}
                        name={getAgentName(agent.id)}
                        className="h-6 w-6"
                      />
                      <span>{getAgentName(agent.id)}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <p className="text-sm text-muted-foreground">
            Showing the latest {points.length} sampled points.
          </p>
        </CardContent>
      </Card>
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {agentId !== "all" && latestPoint && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Map
              center={[latestPoint.longitude, latestPoint.latitude]}
              zoom={13}
              className="h-[360px] w-full"
            >
              <MapControls showCompass showFullscreen />
              <MapRoute
                id={`history-${agentId}`}
                coordinates={routePoints}
                color="#2563eb"
                width={4}
              />
              <MapMarker
                longitude={latestPoint.longitude}
                latitude={latestPoint.latitude}
              >
                <MarkerContent>
                  <div className="h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow" />
                </MarkerContent>
              </MapMarker>
            </Map>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Recorded</TableHead>
                  <TableHead>Latitude</TableHead>
                  <TableHead>Longitude</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Speed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((point) => {
                  const agentName = getAgentName(point.agentId);
                  return (
                  <TableRow key={point.id ?? `${point.agentId}-${point.recordedAt}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FleetAgentAvatar
                          profileUrl={getAgentProfileUrl(point.agentId)}
                          name={agentName}
                        />
                        {agentName}
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(point.recordedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{point.latitude.toFixed(6)}</TableCell>
                    <TableCell>{point.longitude.toFixed(6)}</TableCell>
                    <TableCell>
                      {point.accuracy ? `${Math.round(point.accuracy)} m` : "-"}
                    </TableCell>
                    <TableCell>
                      {point.speed != null
                        ? `${Math.round(point.speed * 3.6)} km/h`
                        : "-"}
                    </TableCell>
                  </TableRow>
                  );
                })}
                {points.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-28 text-center text-muted-foreground"
                    >
                      No sampled location history is available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
