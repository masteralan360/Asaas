import {
  getLocalModeSqliteConnection,
  runLocalModeSqliteWrite,
  type SqliteConnection,
} from "./localModeSqlite";
import {
  isDemoWorkspaceMode,
  isLocalWorkspaceMode,
  shouldMirrorToSqlite,
} from "@/workspace/workspaceMode";
import { db } from "./database";

const CUSTOM_TEMPLATE_ENTITY_TYPE = "custom_templates";
const DEMO_TEMPLATE_SETTING_PREFIX = "demo_custom_template";

export type LocalCustomTemplateRow = {
  id: string;
  workspace_id: string;
  module_type_key: string;
  label: string;
  layout_json: unknown;
  active: boolean;
  primary: boolean;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type StoredEntityRow = {
  entity_id: string;
  payload: string;
  updated_at: string | null;
};

type LegacyCustomTemplateRow = Omit<
  LocalCustomTemplateRow,
  "layout_json" | "active" | "primary"
> & {
  layout_json: string;
  active: boolean | number;
  primary: boolean | number;
};

type SaveLocalCustomTemplateInput = {
  id?: string;
  workspaceId: string;
  moduleTypeKey: string;
  label: string;
  layoutJson: unknown;
  active?: boolean;
  primary?: boolean;
  version?: number;
  userId?: string | null;
};

export type ListLocalCustomTemplatesOptions = {
  moduleTypeKey?: string;
  moduleTypePrefix?: string;
  activeOnly?: boolean;
  primaryOnly?: boolean;
};

let entityStorageReady: Promise<void> | null = null;

function assertLocalWorkspace(workspaceId: string) {
  if (!isLocalWorkspaceMode(workspaceId)) {
    throw new Error("Custom templates are available only in local mode.");
  }
}

function assertMirroredWorkspace(workspaceId: string) {
  if (!shouldMirrorToSqlite(workspaceId)) {
    throw new Error(
      "Custom templates are stored in SQLite only for local and hybrid workspaces.",
    );
  }
}

function getDemoTemplateSettingPrefix(workspaceId: string) {
  return `${DEMO_TEMPLATE_SETTING_PREFIX}:${workspaceId}:`;
}

function getDemoTemplateSettingKey(workspaceId: string, templateId: string) {
  return `${getDemoTemplateSettingPrefix(workspaceId)}${templateId}`;
}

async function listDemoTemplates(workspaceId: string) {
  const prefix = getDemoTemplateSettingPrefix(workspaceId);
  const settings = await db.app_settings
    .filter((setting) => setting.key.startsWith(prefix))
    .toArray();

  return settings.flatMap((setting) => {
    try {
      const row = JSON.parse(setting.value) as LocalCustomTemplateRow;
      return row.workspace_id === workspaceId ? [row] : [];
    } catch {
      return [];
    }
  });
}

async function persistDemoTemplates(rows: LocalCustomTemplateRow[]) {
  await db.app_settings.bulkPut(
    rows.map((row) => ({
      key: getDemoTemplateSettingKey(row.workspace_id, row.id),
      value: JSON.stringify(row),
    })),
  );
}

async function deleteDemoTemplate(workspaceId: string, templateId: string) {
  const workspaceTemplates = await listDemoTemplates(workspaceId);
  const existing = workspaceTemplates.find((row) => row.id === templateId);
  if (!existing) {
    throw new Error("Custom template not found.");
  }

  const remainingModuleRows = workspaceTemplates.filter(
    (row) =>
      row.module_type_key === existing.module_type_key && row.id !== templateId,
  );
  const activeRemainingRows = remainingModuleRows.filter((row) => row.active);
  if (activeRemainingRows.length > 0) {
    const now = new Date().toISOString();
    await persistDemoTemplates(
      reconcilePrimaryTemplate(
        remainingModuleRows,
        undefined,
        now,
        null,
      ),
    );
  }

  await db.app_settings.delete(
    getDemoTemplateSettingKey(workspaceId, templateId),
  );
}

async function saveDemoTemplate(input: SaveLocalCustomTemplateInput) {
  const label = input.label.trim();
  if (!label) {
    throw new Error("Template label is required.");
  }

  const workspaceTemplates = await listDemoTemplates(input.workspaceId);
  const existing = input.id
    ? workspaceTemplates.find((row) => row.id === input.id)
    : undefined;
  if (input.id && !existing) {
    throw new Error("Custom template not found.");
  }
  if (existing && existing.module_type_key !== input.moduleTypeKey) {
    throw new Error("A custom template cannot be moved to another module type.");
  }

  const id = existing?.id ?? input.id ?? crypto.randomUUID();
  const active = input.active ?? existing?.active ?? true;
  if (input.primary === true && !active) {
    throw new Error("An inactive template cannot be primary.");
  }

  const now = new Date().toISOString();
  const savedRow: LocalCustomTemplateRow = {
    id,
    workspace_id: input.workspaceId,
    module_type_key: input.moduleTypeKey,
    label,
    layout_json: input.layoutJson,
    active,
    primary: active && (input.primary ?? existing?.primary ?? false),
    version: input.version ?? existing?.version ?? 1,
    created_by: existing?.created_by ?? input.userId ?? null,
    updated_by: input.userId ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  const moduleRows = workspaceTemplates
    .filter(
      (row) =>
        row.module_type_key === input.moduleTypeKey && row.id !== savedRow.id,
    )
    .concat(savedRow);
  const reconciledRows = reconcilePrimaryTemplate(
    moduleRows,
    savedRow.primary ? savedRow.id : undefined,
    now,
    input.userId ?? null,
  );

  await persistDemoTemplates(reconciledRows);
  return reconciledRows.find((row) => row.id === savedRow.id)!;
}

async function requireConnection() {
  const connection = await getLocalModeSqliteConnection();
  if (!connection) {
    throw new Error("Local template storage is unavailable.");
  }
  return connection;
}

function parseLegacyLayout(layoutJson: string) {
  try {
    return JSON.parse(layoutJson) as unknown;
  } catch {
    return layoutJson;
  }
}

function normalizeLegacyRow(
  row: LegacyCustomTemplateRow,
): LocalCustomTemplateRow {
  const active = row.active === true || row.active === 1;
  return {
    ...row,
    layout_json: parseLegacyLayout(row.layout_json),
    active,
    primary: active && (row.primary === true || row.primary === 1),
  };
}

async function upsertTemplateEntity(
  connection: SqliteConnection,
  row: LocalCustomTemplateRow,
  conflictAction = "UPDATE",
) {
  const conflictClause =
    conflictAction === "NOTHING"
      ? "DO NOTHING"
      : `DO UPDATE SET
           workspace_id = excluded.workspace_id,
           payload = excluded.payload,
           updated_at = excluded.updated_at`;

  await connection.execute(
    `
      INSERT INTO local_entities (
        entity_type, entity_id, workspace_id, payload, updated_at
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(entity_type, entity_id) ${conflictClause}
    `,
    [
      CUSTOM_TEMPLATE_ENTITY_TYPE,
      row.id,
      row.workspace_id,
      JSON.stringify(row),
      row.updated_at,
    ],
  );
}

async function migrateLegacyCustomTemplateTable(
  connection: SqliteConnection,
) {
  const tables = await connection.select<Array<{ name: string }>>(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = $1
      LIMIT 1
    `,
    [CUSTOM_TEMPLATE_ENTITY_TYPE],
  );
  if (tables.length === 0) {
    return;
  }

  const legacyRows = await connection.select<LegacyCustomTemplateRow[]>(
    `
      SELECT id, workspace_id, module_type_key, label, layout_json, active,
             "primary", created_by, updated_by, created_at, updated_at
      FROM custom_templates
    `,
  );
  for (const legacyRow of legacyRows) {
    await upsertTemplateEntity(
      connection,
      normalizeLegacyRow(legacyRow),
      "NOTHING",
    );
  }

  await connection.execute("DROP TABLE IF EXISTS custom_templates");
}

async function ensureCustomTemplateEntityStorage() {
  if (!entityStorageReady) {
    entityStorageReady = runLocalModeSqliteWrite(async () => {
      const connection = await requireConnection();
      await migrateLegacyCustomTemplateTable(connection);
    }).catch((error) => {
      entityStorageReady = null;
      throw error;
    });
  }

  return entityStorageReady;
}

function deserializeEntityRow(row: StoredEntityRow): LocalCustomTemplateRow {
  const parsed = JSON.parse(row.payload) as LocalCustomTemplateRow;
  return {
    ...parsed,
    id: parsed.id || row.entity_id,
    active: parsed.active !== false,
    primary: parsed.active !== false && parsed.primary === true,
    updated_at: parsed.updated_at || row.updated_at || parsed.created_at,
  };
}

function sortTemplates(
  left: LocalCustomTemplateRow,
  right: LocalCustomTemplateRow,
) {
  if (left.primary !== right.primary) {
    return Number(right.primary) - Number(left.primary);
  }
  return (
    right.updated_at.localeCompare(left.updated_at) ||
    right.created_at.localeCompare(left.created_at) ||
    left.id.localeCompare(right.id)
  );
}

async function selectWorkspaceTemplates(
  connection: SqliteConnection,
  workspaceId: string,
) {
  const rows = await connection.select<StoredEntityRow[]>(
    `
      SELECT entity_id, payload, updated_at
      FROM local_entities
      WHERE entity_type = $1 AND workspace_id = $2
    `,
    [CUSTOM_TEMPLATE_ENTITY_TYPE, workspaceId],
  );
  return rows.map(deserializeEntityRow).sort(sortTemplates);
}

function matchesOptions(
  row: LocalCustomTemplateRow,
  options: ListLocalCustomTemplatesOptions,
) {
  if (
    options.moduleTypeKey &&
    row.module_type_key !== options.moduleTypeKey
  ) {
    return false;
  }
  if (
    options.moduleTypePrefix &&
    !row.module_type_key.startsWith(options.moduleTypePrefix)
  ) {
    return false;
  }
  if (options.activeOnly && !row.active) {
    return false;
  }
  if (options.primaryOnly && !row.primary) {
    return false;
  }
  return true;
}

async function runTemplateWrite<T>(
  operation: (connection: SqliteConnection) => Promise<T>,
): Promise<T> {
  await ensureCustomTemplateEntityStorage();
  return runLocalModeSqliteWrite(async () => {
    const connection = await requireConnection();
    return operation(connection);
  });
}

function reconcilePrimaryTemplate(
  rows: LocalCustomTemplateRow[],
  preferredPrimaryId: string | undefined,
  now: string,
  userId: string | null,
) {
  const activeRows = rows.filter((row) => row.active).sort(sortTemplates);
  if (activeRows.length === 0) {
    throw new Error(
      "At least one active template is required for each module type.",
    );
  }

  const primaryId =
    activeRows.find((row) => row.id === preferredPrimaryId)?.id ??
    activeRows.find((row) => row.primary)?.id ??
    activeRows[0].id;

  return rows.map((row) => {
    const primary = row.active && row.id === primaryId;
    if (row.primary === primary) {
      return row;
    }
    return {
      ...row,
      primary,
      updated_by: userId ?? row.updated_by,
      updated_at: now,
    };
  });
}

async function saveTemplateInWrite(
  connection: SqliteConnection,
  input: SaveLocalCustomTemplateInput,
) {
  const label = input.label.trim();
  if (!label) {
    throw new Error("Template label is required.");
  }

  const workspaceTemplates = await selectWorkspaceTemplates(
    connection,
    input.workspaceId,
  );
  const existing = input.id
    ? workspaceTemplates.find((row) => row.id === input.id)
    : undefined;
  if (input.id && !existing) {
    throw new Error("Custom template not found.");
  }
  if (existing && existing.module_type_key !== input.moduleTypeKey) {
    throw new Error("A custom template cannot be moved to another module type.");
  }

  const id = existing?.id ?? input.id ?? crypto.randomUUID();
  const active = input.active ?? existing?.active ?? true;
  if (input.primary === true && !active) {
    throw new Error("An inactive template cannot be primary.");
  }

  const now = new Date().toISOString();
  const savedRow: LocalCustomTemplateRow = {
    id,
    workspace_id: input.workspaceId,
    module_type_key: input.moduleTypeKey,
    label,
    layout_json: input.layoutJson,
    active,
    primary: active && (input.primary ?? existing?.primary ?? false),
    version: input.version ?? existing?.version ?? 1,
    created_by: existing?.created_by ?? input.userId ?? null,
    updated_by: input.userId ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  const moduleRows = workspaceTemplates
    .filter((row) => row.module_type_key === input.moduleTypeKey && row.id !== id)
    .concat(savedRow);
  const reconciledRows = reconcilePrimaryTemplate(
    moduleRows,
    savedRow.primary ? id : undefined,
    now,
    input.userId ?? null,
  );

  for (const row of reconciledRows) {
    await upsertTemplateEntity(connection, row);
  }

  const saved = reconciledRows.find((row) => row.id === id);
  if (!saved) {
    throw new Error("Failed to read the saved custom template.");
  }
  return saved;
}

export async function listLocalCustomTemplates(
  workspaceId: string,
  options: ListLocalCustomTemplatesOptions = {},
) {
  if (isDemoWorkspaceMode(workspaceId)) {
    const rows = await listDemoTemplates(workspaceId);
    return rows.filter((row) => matchesOptions(row, options));
  }

  assertMirroredWorkspace(workspaceId);
  await ensureCustomTemplateEntityStorage();
  const connection = await requireConnection();
  const rows = await selectWorkspaceTemplates(connection, workspaceId);
  return rows.filter((row) => matchesOptions(row, options));
}

export async function upsertLocalCustomTemplateCache(
  workspaceId: string,
  rows: LocalCustomTemplateRow[],
): Promise<void> {
  assertMirroredWorkspace(workspaceId);
  await runTemplateWrite(async (connection) => {
    for (const row of rows) {
      await upsertTemplateEntity(connection, row);
    }
  });
}

export async function replaceMirroredCustomTemplates(
  workspaceId: string,
  rows: LocalCustomTemplateRow[],
  options: Pick<
    ListLocalCustomTemplatesOptions,
    "moduleTypeKey" | "moduleTypePrefix"
  > = {},
) {
  assertMirroredWorkspace(workspaceId);
  if (!(await getLocalModeSqliteConnection())) {
    return rows;
  }

  return runTemplateWrite(async (connection) => {
    for (const row of rows) {
      if (row.workspace_id !== workspaceId) {
        throw new Error("Cannot mirror a custom template from another workspace.");
      }
      if (!matchesOptions(row, options)) {
        throw new Error("Cannot mirror a custom template outside the requested scope.");
      }
    }

    const existingRows = await selectWorkspaceTemplates(connection, workspaceId);
    const rowsToDelete = existingRows.filter((row) =>
      matchesOptions(row, options),
    );
    for (const row of rowsToDelete) {
      await connection.execute(
        `
          DELETE FROM local_entities
          WHERE entity_type = $1 AND entity_id = $2
        `,
        [CUSTOM_TEMPLATE_ENTITY_TYPE, row.id],
      );
    }

    for (const row of rows) {
      await upsertTemplateEntity(connection, row);
    }
    return rows;
  });
}

export async function saveLocalCustomTemplate(
  input: SaveLocalCustomTemplateInput,
) {
  assertLocalWorkspace(input.workspaceId);
  if (isDemoWorkspaceMode(input.workspaceId)) {
    return saveDemoTemplate(input);
  }

  return runTemplateWrite((connection) =>
    saveTemplateInWrite(connection, input),
  );
}

export async function updateLocalCustomTemplateStatus(
  workspaceId: string,
  templateId: string,
  changes: { active?: boolean; primary?: boolean },
  userId?: string | null,
) {
  assertLocalWorkspace(workspaceId);
  if (isDemoWorkspaceMode(workspaceId)) {
    const existing = (await listDemoTemplates(workspaceId)).find(
      (row) => row.id === templateId,
    );
    if (!existing) {
      throw new Error("Custom template not found.");
    }

    return saveDemoTemplate({
      id: existing.id,
      workspaceId,
      moduleTypeKey: existing.module_type_key,
      label: existing.label,
      layoutJson: existing.layout_json,
      active: changes.active ?? existing.active,
      primary: changes.primary,
      userId,
    });
  }

  return runTemplateWrite(async (connection) => {
    const existing = (
      await selectWorkspaceTemplates(connection, workspaceId)
    ).find((row) => row.id === templateId);
    if (!existing) {
      throw new Error("Custom template not found.");
    }

    return saveTemplateInWrite(connection, {
      id: existing.id,
      workspaceId,
      moduleTypeKey: existing.module_type_key,
      label: existing.label,
      layoutJson: existing.layout_json,
      active: changes.active ?? existing.active,
      primary: changes.primary,
      userId,
    });
  });
}

export async function deleteLocalCustomTemplate(
  workspaceId: string,
  templateId: string,
  userId?: string | null,
) {
  assertLocalWorkspace(workspaceId);
  if (isDemoWorkspaceMode(workspaceId)) {
    await deleteDemoTemplate(workspaceId, templateId);
    return;
  }

  await runTemplateWrite(async (connection) => {
    const workspaceTemplates = await selectWorkspaceTemplates(
      connection,
      workspaceId,
    );
    const existing = workspaceTemplates.find((row) => row.id === templateId);
    if (!existing) {
      throw new Error("Custom template not found.");
    }

    await connection.execute(
      `
        DELETE FROM local_entities
        WHERE entity_type = $1 AND entity_id = $2 AND workspace_id = $3
      `,
      [CUSTOM_TEMPLATE_ENTITY_TYPE, templateId, workspaceId],
    );

    const remainingModuleRows = workspaceTemplates.filter(
      (row) =>
        row.module_type_key === existing.module_type_key
        && row.id !== templateId,
    );
    if (remainingModuleRows.some((row) => row.active)) {
      const reconciledRows = reconcilePrimaryTemplate(
        remainingModuleRows,
        undefined,
        new Date().toISOString(),
        userId ?? null,
      );
      for (const row of reconciledRows) {
        await upsertTemplateEntity(connection, row);
      }
    }
  });
}
