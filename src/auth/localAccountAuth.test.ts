import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/local-db/database";
import {
  enrollLocalAccountCredential,
  listLocalWorkspaceAccounts,
  persistLocalAccountProfile,
  verifyLocalAccountPassword,
} from "./localAccountAuth";

describe("local account credentials", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it("verifies the enrolled password without storing the password", async () => {
    const credential = await enrollLocalAccountCredential({
      workspaceId: "workspace-1",
      userId: "user-1",
      email: "user@example.com",
      password: "correct horse battery staple",
    });

    expect(credential.verifier).not.toContain("correct horse");
    await expect(
      verifyLocalAccountPassword(
        "workspace-1",
        "user-1",
        "correct horse battery staple",
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      verifyLocalAccountPassword("workspace-1", "user-1", "wrong password"),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
  });

  it("reports accounts without an enrolled local credential", async () => {
    await expect(
      verifyLocalAccountPassword("workspace-1", "missing-user", "password"),
    ).resolves.toEqual({ ok: false, reason: "missing" });
  });

  it("temporarily locks an account after repeated invalid passwords", async () => {
    await enrollLocalAccountCredential({
      workspaceId: "workspace-1",
      userId: "user-1",
      email: "user@example.com",
      password: "correct-password",
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        verifyLocalAccountPassword(
          "workspace-1",
          "user-1",
          "wrong-password",
        ),
      ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    }

    await expect(
      verifyLocalAccountPassword(
        "workspace-1",
        "user-1",
        "wrong-password",
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "locked",
      retryAfterMs: expect.any(Number),
    });

    await expect(
      verifyLocalAccountPassword(
        "workspace-1",
        "user-1",
        "correct-password",
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "locked",
      retryAfterMs: expect.any(Number),
    });
  });

  it("does not list locally deleted workspace members", async () => {
    const now = new Date().toISOString();
    await db.profiles.put({
      id: "deleted-user",
      workspaceId: "workspace-1",
      currentWorkspaceId: "workspace-1",
      name: "Deleted User",
      role: "staff",
    });
    await db.users.put({
      id: "deleted-user",
      workspaceId: "workspace-1",
      email: "deleted@example.com",
      name: "Deleted User",
      role: "staff",
      createdAt: now,
      updatedAt: now,
      syncStatus: "synced",
      lastSyncedAt: now,
      version: 1,
      isDeleted: true,
    });

    await expect(listLocalWorkspaceAccounts("workspace-1")).resolves.toEqual(
      [],
    );
  });

  it("stores source and current workspaces separately for local profiles", async () => {
    await persistLocalAccountProfile({
      id: "user-1",
      workspaceId: "branch-workspace",
      sourceWorkspaceId: "source-workspace",
      currentWorkspaceId: "branch-workspace",
      email: "user@example.com",
      name: "Branch User",
      role: "admin",
    });

    await expect(db.profiles.get("user-1")).resolves.toMatchObject({
      workspaceId: "source-workspace",
      currentWorkspaceId: "branch-workspace",
    });
  });
});
