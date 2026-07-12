import { useMemo, useState } from "react";
import { Link2, Plus } from "lucide-react";

import {
  endFleetAssignment,
  useFleetAssignments,
  useFleetVehicles,
} from "@/local-db";
import { useFleetAgentDirectory } from "@/fleet/useFleetAgentDirectory";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@/ui/components";
import { FleetAssignmentDialog } from "./FleetAssignmentDialog";
import { FleetAgentAvatar } from "./FleetAgentAvatar";

interface FleetAssignmentsPanelProps {
  workspaceId: string;
  canManage: boolean;
}

export function FleetAssignmentsPanel({
  workspaceId,
  canManage,
}: FleetAssignmentsPanelProps) {
  const assignments = useFleetAssignments(workspaceId);
  const vehicles = useFleetVehicles(workspaceId);
  const { getAgentName, getAgentProfileUrl } = useFleetAgentDirectory(workspaceId);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const vehicleById = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
    [vehicles],
  );

  async function handleEnd(assignmentId: string) {
    try {
      await endFleetAssignment(assignmentId);
      toast({ title: "Assignment ended" });
    } catch (error) {
      toast({
        title: "Could not end assignment",
        description: error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Vehicle assignments</h2>
            <p className="text-sm text-muted-foreground">
              Current ownership and the complete assignment history.
            </p>
          </div>
          {canManage && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Assign vehicle
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Ended</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => {
                const vehicle = vehicleById.get(assignment.vehicleId);
                const agentName = getAgentName(assignment.agentId);
                return (
                  <TableRow key={assignment.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <FleetAgentAvatar
                          profileUrl={getAgentProfileUrl(assignment.agentId)}
                          name={agentName}
                        />
                        {agentName}
                      </div>
                    </TableCell>
                    <TableCell>
                      {vehicle
                        ? `${vehicle.plateNumber} - ${vehicle.model}`
                        : "Removed vehicle"}
                    </TableCell>
                    <TableCell>
                      {new Date(assignment.assignedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {assignment.endedAt
                        ? new Date(assignment.endedAt).toLocaleString()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          assignment.status === "active"
                            ? "success"
                            : "secondary"
                        }
                      >
                        {assignment.status}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {assignment.status === "active" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleEnd(assignment.id)}
                          >
                            <Link2 className="mr-2 h-4 w-4" />
                            End
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {assignments.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 6 : 5}
                    className="h-28 text-center text-muted-foreground"
                  >
                    No vehicle assignments yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <FleetAssignmentDialog
        workspaceId={workspaceId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </Card>
  );
}
