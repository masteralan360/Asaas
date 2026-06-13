import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  deleteFleetVehicle,
  type FleetVehicle,
  useFleetAssignments,
  useFleetVehicles,
} from "@/local-db";
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
import { FleetVehicleDialog } from "./FleetVehicleDialog";

interface FleetVehiclesPanelProps {
  workspaceId: string;
  canManage: boolean;
}

export function FleetVehiclesPanel({
  workspaceId,
  canManage,
}: FleetVehiclesPanelProps) {
  const vehicles = useFleetVehicles(workspaceId);
  const assignments = useFleetAssignments(workspaceId);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<FleetVehicle>();
  const activeAssignmentByVehicle = useMemo(
    () =>
      new Map(
        assignments
          .filter((assignment) => assignment.status === "active")
          .map((assignment) => [assignment.vehicleId, assignment]),
      ),
    [assignments],
  );

  async function handleDelete(vehicle: FleetVehicle) {
    if (!window.confirm(`Delete vehicle ${vehicle.plateNumber}?`)) {
      return;
    }
    try {
      await deleteFleetVehicle(vehicle.id);
      toast({ title: "Vehicle deleted" });
    } catch (error) {
      toast({
        title: "Could not delete vehicle",
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
            <h2 className="font-semibold">Fleet vehicles</h2>
            <p className="text-sm text-muted-foreground">
              Reusable vehicles and their current availability.
            </p>
          </div>
          {canManage && (
            <Button
              onClick={() => {
                setEditingVehicle(undefined);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add vehicle
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plate</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignment</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.map((vehicle) => (
                <TableRow key={vehicle.id}>
                  <TableCell className="font-semibold">{vehicle.plateNumber}</TableCell>
                  <TableCell>
                    {[vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                  </TableCell>
                  <TableCell>{vehicle.year ?? "-"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        vehicle.status === "active"
                          ? "success"
                          : vehicle.status === "maintenance"
                            ? "warning"
                            : "secondary"
                      }
                    >
                      {vehicle.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {activeAssignmentByVehicle.has(vehicle.id)
                      ? "Assigned"
                      : "Available"}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Edit ${vehicle.plateNumber}`}
                          onClick={() => {
                            setEditingVehicle(vehicle);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${vehicle.plateNumber}`}
                          onClick={() => void handleDelete(vehicle)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {vehicles.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 6 : 5}
                    className="h-28 text-center text-muted-foreground"
                  >
                    No fleet vehicles yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <FleetVehicleDialog
        workspaceId={workspaceId}
        vehicle={editingVehicle}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </Card>
  );
}
