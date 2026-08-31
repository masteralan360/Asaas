import type { DeliveryLedgerEntry } from "@/local-db";

/**
 * A view-own courier can access all ledger entries attached to their visible
 * shipments, plus their own aggregate handovers that are not tied to one
 * shipment. Entries belonging to another courier remain out of scope.
 */
export function isVisibleDeliveryLedgerEntry(
  entry: Pick<DeliveryLedgerEntry, "isDeleted" | "shipmentId" | "agentId">,
  visibleShipmentIds: ReadonlySet<string>,
  linkedCourierIds: ReadonlySet<string>,
) {
  if (entry.isDeleted) return false;
  return (
    (!!entry.shipmentId && visibleShipmentIds.has(entry.shipmentId))
    || (!!entry.agentId && linkedCourierIds.has(entry.agentId))
  );
}
