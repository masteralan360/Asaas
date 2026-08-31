import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
    if (!window.confirm(t("fleet.vehicles.deleteConfirmation", { plateNumber: vehicle.plateNumber }))) {
      return;
    }
    try {
      await deleteFleetVehicle(vehicle.id);
      toast({ title: t("fleet.messages.vehicleDeleted") });
    } catch {
      toast({
        title: t("fleet.messages.deleteVehicleFailed"),
        description: t("fleet.messages.tryAgain"),
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{t("fleet.vehicles.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("fleet.vehicles.description")}
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
              {t("fleet.vehicles.add")}
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fleet.vehicles.plate")}</TableHead>
                <TableHead>{t("fleet.vehicle")}</TableHead>
                <TableHead>{t("fleet.vehicles.year")}</TableHead>
                <TableHead>{t("fleet.status")}</TableHead>
                <TableHead>{t("fleet.vehicles.assignment")}</TableHead>
                {canManage && <TableHead className="text-right">{t("common.actions")}</TableHead>}
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
                      {t(`fleet.vehicleStatus.${vehicle.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {activeAssignmentByVehicle.has(vehicle.id)
                      ? t("fleet.vehicles.assigned")
                      : t("fleet.vehicles.available")}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("fleet.vehicles.editAria", {
                            plateNumber: vehicle.plateNumber,
                          })}
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
                          aria-label={t("fleet.vehicles.deleteAria", {
                            plateNumber: vehicle.plateNumber,
                          })}
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
                    {t("fleet.vehicles.empty")}
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
