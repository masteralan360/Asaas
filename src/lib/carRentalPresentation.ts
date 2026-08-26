import type { RentalVehicle } from "@/local-db";

export function getRentalVehicleDisplayLabel(vehicle: RentalVehicle) {
  return [vehicle.make, vehicle.model, vehicle.plateNumber]
    .filter(Boolean)
    .join(" · ");
}
