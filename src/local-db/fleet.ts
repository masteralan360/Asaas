import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { isOnline } from "@/lib/network";
import { getSupabaseClientForTable } from "@/lib/supabaseSchema";
import { runSupabaseAction } from "@/lib/supabaseRequest";
import { generateId, toSnakeCase } from "@/lib/utils";
import { isLocalWorkspaceMode } from "@/workspace/workspaceMode";

import { db } from "./database";
import { addToOfflineMutations, fetchTableFromSupabase } from "./hooks";
import type {
  Agent,
  FleetVehicle,
  FleetVehicleAssignment,
  FleetVehicleStatus,
} from "./models";

const VEHICLES_TABLE = "fleet_vehicles";
const ASSIGNMENTS_TABLE = "fleet_vehicle_assignments";

type FleetTableName = typeof VEHICLES_TABLE | typeof ASSIGNMENTS_TABLE;
type FleetEntity = FleetVehicle | FleetVehicleAssignment;

export interface SaveFleetVehicleInput {
  plateNumber: string;
  make?: string | null;
  model: string;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
  status: FleetVehicleStatus;
  notes?: string | null;
}

export interface CreateFleetAssignmentInput {
  vehicleId: string;
  agentId: string;
  assignedAt?: string;
  notes?: string | null;
}

function shouldUseCloudFleetData(workspaceId?: string | null) {
  return !!workspaceId && !isLocalWorkspaceMode(workspaceId);
}

function normalizeText(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function getSyncMetadata(workspaceId: string, timestamp: string) {
  if (!shouldUseCloudFleetData(workspaceId)) {
    return {
      syncStatus: "synced" as const,
      lastSyncedAt: timestamp,
    };
  }

  return {
    syncStatus: "pending" as const,
    lastSyncedAt: null,
  };
}

function sanitizePayload(entity: FleetEntity) {
  const payload = toSnakeCase(entity as unknown as Record<string, unknown>);
  delete payload.sync_status;
  delete payload.last_synced_at;
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

async function markSynced(tableName: FleetTableName, id: string) {
  const table =
    tableName === VEHICLES_TABLE
      ? db.fleet_vehicles
      : db.fleet_vehicle_assignments;
  await table.update(id, {
    syncStatus: "synced",
    lastSyncedAt: new Date().toISOString(),
  } as never);
}

async function syncUpsert(tableName: FleetTableName, entity: FleetEntity) {
  if (!shouldUseCloudFleetData(entity.workspaceId)) {
    return;
  }

  if (!isOnline(entity.workspaceId)) {
    await addToOfflineMutations(
      tableName,
      entity.id,
      entity.version > 1 ? "update" : "create",
      entity as unknown as Record<string, unknown>,
      entity.workspaceId,
    );
    return;
  }

  try {
    const client = getSupabaseClientForTable(tableName);
    const { error } = (await runSupabaseAction(`${tableName}.sync`, () =>
      client.from(tableName).upsert(sanitizePayload(entity)),
    )) as { error?: unknown };

    if (error) {
      throw error;
    }

    await markSynced(tableName, entity.id);
  } catch (error) {
    console.error(`[Fleet] Failed to sync ${tableName}:`, error);
    await addToOfflineMutations(
      tableName,
      entity.id,
      entity.version > 1 ? "update" : "create",
      entity as unknown as Record<string, unknown>,
      entity.workspaceId,
    );
  }
}

async function hydrateFleetTable(
  tableName: FleetTableName,
  workspaceId: string,
) {
  if (!shouldUseCloudFleetData(workspaceId)) {
    return;
  }

  if (tableName === VEHICLES_TABLE) {
    await fetchTableFromSupabase(tableName, db.fleet_vehicles, workspaceId);
    return;
  }

  await fetchTableFromSupabase(
    tableName,
    db.fleet_vehicle_assignments,
    workspaceId,
  );
}

export function useFleetVehicles(workspaceId?: string) {
  const online = useNetworkStatus();
  const vehicles =
    useLiveQuery(
      () =>
        workspaceId
          ? db.fleet_vehicles
              .where("workspaceId")
              .equals(workspaceId)
              .and((row) => !row.isDeleted)
              .toArray()
          : [],
      [workspaceId],
    ) ?? [];

  useEffect(() => {
    if (!workspaceId || !online) {
      return;
    }
    void hydrateFleetTable(VEHICLES_TABLE, workspaceId).catch((error) => {
      console.error("[Fleet] Failed to hydrate vehicles:", error);
    });
  }, [online, workspaceId]);

  return vehicles.sort((left, right) =>
    left.plateNumber.localeCompare(right.plateNumber),
  );
}

export function useFleetAssignments(workspaceId?: string) {
  const online = useNetworkStatus();
  const assignments =
    useLiveQuery(
      () =>
        workspaceId
          ? db.fleet_vehicle_assignments
              .where("workspaceId")
              .equals(workspaceId)
              .and((row) => !row.isDeleted)
              .toArray()
          : [],
      [workspaceId],
    ) ?? [];

  useEffect(() => {
    if (!workspaceId || !online) {
      return;
    }
    void hydrateFleetTable(ASSIGNMENTS_TABLE, workspaceId).catch((error) => {
      console.error("[Fleet] Failed to hydrate assignments:", error);
    });
  }, [online, workspaceId]);

  return assignments.sort((left, right) =>
    right.assignedAt.localeCompare(left.assignedAt),
  );
}

export async function createFleetVehicle(
  workspaceId: string,
  input: SaveFleetVehicleInput,
) {
  const plateNumber = input.plateNumber.trim().toUpperCase();
  const model = input.model.trim();
  if (!plateNumber || !model) {
    throw new Error("Plate number and model are required");
  }

  const duplicate = await db.fleet_vehicles
    .where("workspaceId")
    .equals(workspaceId)
    .and(
      (row) =>
        !row.isDeleted &&
        row.plateNumber.trim().toUpperCase() === plateNumber,
    )
    .first();
  if (duplicate) {
    throw new Error("A vehicle with this plate number already exists");
  }

  const now = new Date().toISOString();
  const vehicle: FleetVehicle = {
    id: generateId(),
    workspaceId,
    plateNumber,
    make: normalizeText(input.make),
    model,
    year: input.year || null,
    color: normalizeText(input.color),
    vin: normalizeText(input.vin),
    status: input.status,
    notes: normalizeText(input.notes),
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...getSyncMetadata(workspaceId, now),
  };

  await db.fleet_vehicles.put(vehicle);
  await syncUpsert(VEHICLES_TABLE, vehicle);
  return vehicle;
}

export async function updateFleetVehicle(
  vehicleId: string,
  input: SaveFleetVehicleInput,
) {
  const existing = await db.fleet_vehicles.get(vehicleId);
  if (!existing || existing.isDeleted) {
    throw new Error("Vehicle not found");
  }

  const plateNumber = input.plateNumber.trim().toUpperCase();
  const model = input.model.trim();
  if (!plateNumber || !model) {
    throw new Error("Plate number and model are required");
  }

  const duplicate = await db.fleet_vehicles
    .where("workspaceId")
    .equals(existing.workspaceId)
    .and(
      (row) =>
        row.id !== vehicleId &&
        !row.isDeleted &&
        row.plateNumber.trim().toUpperCase() === plateNumber,
    )
    .first();
  if (duplicate) {
    throw new Error("A vehicle with this plate number already exists");
  }

  const now = new Date().toISOString();
  const updated: FleetVehicle = {
    ...existing,
    plateNumber,
    make: normalizeText(input.make),
    model,
    year: input.year || null,
    color: normalizeText(input.color),
    vin: normalizeText(input.vin),
    status: input.status,
    notes: normalizeText(input.notes),
    updatedAt: now,
    version: existing.version + 1,
    ...getSyncMetadata(existing.workspaceId, now),
  };

  await db.fleet_vehicles.put(updated);
  await syncUpsert(VEHICLES_TABLE, updated);
  return updated;
}

export async function deleteFleetVehicle(vehicleId: string) {
  const existing = await db.fleet_vehicles.get(vehicleId);
  if (!existing || existing.isDeleted) {
    return;
  }

  const activeAssignment = await db.fleet_vehicle_assignments
    .where("[workspaceId+vehicleId]")
    .equals([existing.workspaceId, vehicleId])
    .and((row) => !row.isDeleted && row.status === "active")
    .first();
  if (activeAssignment) {
    throw new Error("End the active vehicle assignment before deleting it");
  }

  const now = new Date().toISOString();
  const deleted: FleetVehicle = {
    ...existing,
    isDeleted: true,
    updatedAt: now,
    version: existing.version + 1,
    ...getSyncMetadata(existing.workspaceId, now),
  };
  await db.fleet_vehicles.put(deleted);
  await syncUpsert(VEHICLES_TABLE, deleted);
}

export async function createFleetAssignment(
  workspaceId: string,
  input: CreateFleetAssignmentInput,
) {
  const [vehicle, agent] = await Promise.all([
    db.fleet_vehicles.get(input.vehicleId),
    db.agents.get(input.agentId),
  ]);
  if (!vehicle || vehicle.isDeleted || vehicle.workspaceId !== workspaceId) {
    throw new Error("Vehicle not found");
  }
  if (!agent || agent.isDeleted || agent.workspaceId !== workspaceId) {
    throw new Error("Agent not found");
  }

  const activeAssignments = await db.fleet_vehicle_assignments
    .where("[workspaceId+status]")
    .equals([workspaceId, "active"])
    .and((row) => !row.isDeleted)
    .toArray();
  if (
    activeAssignments.some(
      (row) => row.vehicleId === input.vehicleId || row.agentId === input.agentId,
    )
  ) {
    throw new Error("The selected agent or vehicle already has an active assignment");
  }

  const now = new Date().toISOString();
  const assignment: FleetVehicleAssignment = {
    id: generateId(),
    workspaceId,
    vehicleId: input.vehicleId,
    agentId: input.agentId,
    assignedAt: input.assignedAt || now,
    endedAt: null,
    status: "active",
    notes: normalizeText(input.notes),
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...getSyncMetadata(workspaceId, now),
  };

  await db.fleet_vehicle_assignments.put(assignment);
  await syncUpsert(ASSIGNMENTS_TABLE, assignment);
  return assignment;
}

export async function endFleetAssignment(assignmentId: string) {
  const existing = await db.fleet_vehicle_assignments.get(assignmentId);
  if (!existing || existing.isDeleted || existing.status === "ended") {
    return;
  }

  const now = new Date().toISOString();
  const ended: FleetVehicleAssignment = {
    ...existing,
    status: "ended",
    endedAt: now,
    updatedAt: now,
    version: existing.version + 1,
    ...getSyncMetadata(existing.workspaceId, now),
  };
  await db.fleet_vehicle_assignments.put(ended);
  await syncUpsert(ASSIGNMENTS_TABLE, ended);
  return ended;
}

export async function ensureDriverFleetAssignment(agent: Agent) {
  if (agent.status !== "active") {
    await endActiveFleetAssignmentsForAgent(agent.id);
    return;
  }

  if (
    agent.agentType !== "driver" ||
    !agent.carModel?.trim() ||
    !agent.plateNumber?.trim()
  ) {
    return;
  }

  const activeAssignment = await db.fleet_vehicle_assignments
    .where("[workspaceId+agentId]")
    .equals([agent.workspaceId, agent.id])
    .and((row) => !row.isDeleted && row.status === "active")
    .first();
  if (activeAssignment) {
    return activeAssignment;
  }

  const normalizedPlate = agent.plateNumber.trim().toUpperCase();
  let vehicle = await db.fleet_vehicles
    .where("workspaceId")
    .equals(agent.workspaceId)
    .and(
      (row) =>
        !row.isDeleted &&
        row.plateNumber.trim().toUpperCase() === normalizedPlate,
    )
    .first();
  if (!vehicle) {
    vehicle = await createFleetVehicle(agent.workspaceId, {
      plateNumber: normalizedPlate,
      model: agent.carModel,
      status: "active",
      notes: "Created from the driver profile",
    });
  }

  return createFleetAssignment(agent.workspaceId, {
    vehicleId: vehicle.id,
    agentId: agent.id,
    notes: "Created from the driver profile",
  });
}

export async function endActiveFleetAssignmentsForAgent(agentId: string) {
  const assignments = await db.fleet_vehicle_assignments
    .where("agentId")
    .equals(agentId)
    .and((row) => !row.isDeleted && row.status === "active")
    .toArray();
  await Promise.all(
    assignments.map((assignment) => endFleetAssignment(assignment.id)),
  );
}
