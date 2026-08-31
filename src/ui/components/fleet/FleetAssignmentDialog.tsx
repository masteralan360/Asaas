import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createFleetAssignment,
  useFleetAssignments,
  useFleetVehicles,
} from "@/local-db";
import { useFleetAgentDirectory } from "@/fleet/useFleetAgentDirectory";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from "@/ui/components";
import { FleetAgentAvatar } from "./FleetAgentAvatar";

interface FleetAssignmentDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FleetAssignmentDialog({
  workspaceId,
  open,
  onOpenChange,
}: FleetAssignmentDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const vehicles = useFleetVehicles(workspaceId);
  const assignments = useFleetAssignments(workspaceId);
  const { agents, getAgentName, getAgentProfileUrl } =
    useFleetAgentDirectory(workspaceId);
  const [vehicleId, setVehicleId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const activeAssignments = assignments.filter(
    (assignment) => assignment.status === "active",
  );
  const assignedVehicleIds = useMemo(
    () => new Set(activeAssignments.map((assignment) => assignment.vehicleId)),
    [activeAssignments],
  );
  const assignedAgentIds = useMemo(
    () => new Set(activeAssignments.map((assignment) => assignment.agentId)),
    [activeAssignments],
  );
  const availableVehicles = vehicles.filter(
    (vehicle) =>
      vehicle.status === "active" && !assignedVehicleIds.has(vehicle.id),
  );
  const availableAgents = agents.filter(
    (agent) =>
      agent.status === "active" && !assignedAgentIds.has(agent.id),
  );

  async function handleSave() {
    setIsSaving(true);
    try {
      await createFleetAssignment(workspaceId, {
        vehicleId,
        agentId,
        notes,
      });
      toast({ title: t("fleet.messages.vehicleAssigned") });
      setVehicleId("");
      setAgentId("");
      setNotes("");
      onOpenChange(false);
    } catch {
      toast({
        title: t("fleet.messages.createAssignmentFailed"),
        description: t("fleet.messages.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("fleet.assignments.assignVehicle")}</DialogTitle>
          <DialogDescription>
            {t("fleet.assignments.dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("fleet.assignments.vehicleRequired")}</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger>
                <SelectValue placeholder={t("fleet.assignments.selectVehicle")} />
              </SelectTrigger>
              <SelectContent>
                {availableVehicles.map((vehicle) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNumber} -{" "}
                    {[vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("fleet.assignments.agentRequired")}</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder={t("fleet.assignments.selectAgent")} />
              </SelectTrigger>
              <SelectContent>
                {availableAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <div className="flex items-center gap-2">
                      <FleetAgentAvatar
                        profileUrl={getAgentProfileUrl(agent.id)}
                        name={getAgentName(agent.id)}
                        className="h-6 w-6"
                      />
                      <span>{getAgentName(agent.id)} - {agent.zone}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-notes">{t("fleet.notes")}</Label>
            <Textarea
              id="assignment-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={isSaving || !vehicleId || !agentId}
            onClick={handleSave}
          >
            {isSaving
              ? t("fleet.assignments.assigning")
              : t("fleet.assignments.assignVehicle")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
