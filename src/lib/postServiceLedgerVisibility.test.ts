import { describe, expect, it } from "vitest";

import { isVisibleDeliveryLedgerEntry } from "./postServiceLedgerVisibility";

describe("isVisibleDeliveryLedgerEntry", () => {
  const visibleShipmentIds = new Set(["shipment-1"]);
  const linkedCourierIds = new Set(["courier-1"]);

  it("keeps a linked courier's aggregate handover visible", () => {
    expect(isVisibleDeliveryLedgerEntry({ isDeleted: false, shipmentId: null, agentId: "courier-1" }, visibleShipmentIds, linkedCourierIds)).toBe(true);
  });

  it("keeps visible shipment entries but excludes other couriers and deleted entries", () => {
    expect(isVisibleDeliveryLedgerEntry({ isDeleted: false, shipmentId: "shipment-1", agentId: null }, visibleShipmentIds, linkedCourierIds)).toBe(true);
    expect(isVisibleDeliveryLedgerEntry({ isDeleted: false, shipmentId: null, agentId: "courier-2" }, visibleShipmentIds, linkedCourierIds)).toBe(false);
    expect(isVisibleDeliveryLedgerEntry({ isDeleted: true, shipmentId: null, agentId: "courier-1" }, visibleShipmentIds, linkedCourierIds)).toBe(false);
  });
});
