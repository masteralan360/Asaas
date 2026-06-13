import { useMemo, useState } from "react";

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
  const { toast } = useToast();
  const vehicles = useFleetVehicles(workspaceId);
  const assignments = useFleetAssignments(workspaceId);
  const { agents, getAgentName } = useFleetAgentDirectory(workspaceId);
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
      toast({ title: "Vehicle assigned" });
      setVehicleId("");
      setAgentId("");
      setNotes("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not create assignment",
        description:
          error instanceof Error ? error.message : "Unexpected fleet error",
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
          <DialogTitle>Assign vehicle</DialogTitle>
          <DialogDescription>
            Each agent and vehicle can have only one active assignment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an available vehicle" />
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
            <Label>Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an available agent" />
              </SelectTrigger>
              <SelectContent>
                {availableAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {getAgentName(agent.id)} - {agent.zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignment-notes">Notes</Label>
            <Textarea
              id="assignment-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || !vehicleId || !agentId}
            onClick={handleSave}
          >
            {isSaving ? "Assigning..." : "Assign vehicle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
