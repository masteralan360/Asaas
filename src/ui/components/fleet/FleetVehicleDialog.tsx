import { useEffect, useState } from "react";

import {
  createFleetVehicle,
  updateFleetVehicle,
  type FleetVehicle,
  type FleetVehicleStatus,
} from "@/local-db";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from "@/ui/components";

interface FleetVehicleDialogProps {
  workspaceId: string;
  vehicle?: FleetVehicle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FleetVehicleDialog({
  workspaceId,
  vehicle,
  open,
  onOpenChange,
}: FleetVehicleDialogProps) {
  const { toast } = useToast();
  const [plateNumber, setPlateNumber] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [vin, setVin] = useState("");
  const [status, setStatus] = useState<FleetVehicleStatus>("active");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setPlateNumber(vehicle?.plateNumber ?? "");
    setMake(vehicle?.make ?? "");
    setModel(vehicle?.model ?? "");
    setYear(vehicle?.year ? String(vehicle.year) : "");
    setColor(vehicle?.color ?? "");
    setVin(vehicle?.vin ?? "");
    setStatus(vehicle?.status ?? "active");
    setNotes(vehicle?.notes ?? "");
  }, [open, vehicle]);

  async function handleSave() {
    setIsSaving(true);
    try {
      const payload = {
        plateNumber,
        make,
        model,
        year: year ? Number(year) : null,
        color,
        vin,
        status,
        notes,
      };
      if (vehicle) {
        await updateFleetVehicle(vehicle.id, payload);
      } else {
        await createFleetVehicle(workspaceId, payload);
      }
      toast({
        title: vehicle ? "Vehicle updated" : "Vehicle created",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not save vehicle",
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{vehicle ? "Edit vehicle" : "Add vehicle"}</DialogTitle>
          <DialogDescription>
            Maintain the reusable fleet asset separately from its agent assignment.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fleet-plate">Plate number</Label>
            <Input
              id="fleet-plate"
              value={plateNumber}
              onChange={(event) => setPlateNumber(event.target.value)}
              placeholder="22 A 12345"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fleet-model">Model</Label>
            <Input
              id="fleet-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Hilux"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fleet-make">Make</Label>
            <Input
              id="fleet-make"
              value={make}
              onChange={(event) => setMake(event.target.value)}
              placeholder="Toyota"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fleet-year">Year</Label>
            <Input
              id="fleet-year"
              type="number"
              min={1900}
              max={2200}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fleet-color">Color</Label>
            <Input
              id="fleet-color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fleet-vin">VIN</Label>
            <Input
              id="fleet-vin"
              value={vin}
              onChange={(event) => setVin(event.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as FleetVehicleStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="fleet-notes">Notes</Label>
            <Textarea
              id="fleet-notes"
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
            onClick={handleSave}
            disabled={isSaving || !plateNumber.trim() || !model.trim()}
          >
            {isSaving ? "Saving..." : "Save vehicle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
