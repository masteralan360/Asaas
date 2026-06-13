import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearWorkspaceModeSnapshot,
  writeWorkspaceModeSnapshot,
} from "@/workspace/workspaceMode";

import { db } from "./database";
import type { Agent } from "./models";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000101";
let createFleetVehicle: typeof import("./fleet").createFleetVehicle;
let createFleetAssignment: typeof import("./fleet").createFleetAssignment;
let endFleetAssignment: typeof import("./fleet").endFleetAssignment;

function installBrowserStorage() {
  const rows = new Map<string, string>();
  const storage = {
    get length() {
      return rows.size;
    },
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
    clear: () => rows.clear(),
    key: (index: number) => Array.from(rows.keys())[index] ?? null,
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      sessionStorage: storage,
      location: { origin: "http://localhost", hash: "", pathname: "/" },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      documentElement: { lang: "en", dir: "ltr" },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: false },
  });
}

function buildAgent(id: string): Agent {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: WORKSPACE_ID,
    businessPartnerId: crypto.randomUUID(),
    zone: "Baghdad",
    agentType: "driver",
    carModel: "Legacy vehicle",
    plateNumber: `LEGACY-${id.slice(-2)}`,
    linkedUserId: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    syncStatus: "synced",
    lastSyncedAt: now,
    version: 1,
    isDeleted: false,
  };
}

describe("fleet vehicles and assignments", () => {
  beforeAll(async () => {
    installBrowserStorage();
    const fleet = await import("./fleet");
    createFleetVehicle = fleet.createFleetVehicle;
    createFleetAssignment = fleet.createFleetAssignment;
    endFleetAssignment = fleet.endFleetAssignment;
  });

  beforeEach(async () => {
    await db.delete();
    await db.open();
    writeWorkspaceModeSnapshot({
      workspaceId: WORKSPACE_ID,
      dataMode: "local",
    });
  });

  afterEach(() => {
    clearWorkspaceModeSnapshot(WORKSPACE_ID);
  });

  afterAll(async () => {
    await db.delete();
  });

  it("normalizes plate numbers and rejects duplicates", async () => {
    const vehicle = await createFleetVehicle(WORKSPACE_ID, {
      plateNumber: " 22 a 12345 ",
      model: "Hilux",
      status: "active",
    });

    expect(vehicle.plateNumber).toBe("22 A 12345");
    await expect(
      createFleetVehicle(WORKSPACE_ID, {
        plateNumber: "22 A 12345",
        model: "Another vehicle",
        status: "active",
      }),
    ).rejects.toThrow("plate number already exists");
  });

  it("enforces one active assignment per agent and vehicle", async () => {
    const firstAgent = buildAgent(crypto.randomUUID());
    const secondAgent = buildAgent(crypto.randomUUID());
    await db.agents.bulkPut([firstAgent, secondAgent]);
    const firstVehicle = await createFleetVehicle(WORKSPACE_ID, {
      plateNumber: "A-100",
      model: "Hilux",
      status: "active",
    });
    const secondVehicle = await createFleetVehicle(WORKSPACE_ID, {
      plateNumber: "A-200",
      model: "Land Cruiser",
      status: "active",
    });

    const assignment = await createFleetAssignment(WORKSPACE_ID, {
      vehicleId: firstVehicle.id,
      agentId: firstAgent.id,
    });

    await expect(
      createFleetAssignment(WORKSPACE_ID, {
        vehicleId: secondVehicle.id,
        agentId: firstAgent.id,
      }),
    ).rejects.toThrow("already has an active assignment");
    await expect(
      createFleetAssignment(WORKSPACE_ID, {
        vehicleId: firstVehicle.id,
        agentId: secondAgent.id,
      }),
    ).rejects.toThrow("already has an active assignment");

    await endFleetAssignment(assignment.id);
    const reassigned = await createFleetAssignment(WORKSPACE_ID, {
      vehicleId: firstVehicle.id,
      agentId: secondAgent.id,
    });
    expect(reassigned.status).toBe("active");
  });
});
