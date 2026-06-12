import { db } from "@/local-db/database";
import type {
  LocalAccountCredential,
  User,
  UserRole,
} from "@/local-db/models";

const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_DIGEST = "SHA-256" as const;
const SALT_BYTES = 16;
const VERIFIER_BYTES = 32;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

export interface LocalWorkspaceAccount {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  role: UserRole;
  profileUrl?: string;
  hasCredential: boolean;
}

export type LocalPasswordVerificationResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid" | "locked"; retryAfterMs?: number };

function getCredentialId(workspaceId: string, userId: string) {
  return `${workspaceId}:${userId}`;
}

function normalizeRole(role: string | null | undefined): UserRole {
  return role === "admin" || role === "staff" || role === "viewer"
    ? role
    : "viewer";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveVerifier(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: PBKDF2_DIGEST,
      salt,
      iterations,
    },
    passwordKey,
    VERIFIER_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function enrollLocalAccountCredential({
  workspaceId,
  userId,
  email,
  password,
}: {
  workspaceId: string;
  userId: string;
  email: string;
  password: string;
}) {
  if (!workspaceId || !userId || !email || !password) {
    throw new Error("Incomplete local account credential data.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const verifier = await deriveVerifier(password, salt, PBKDF2_ITERATIONS);
  const now = new Date().toISOString();
  const id = getCredentialId(workspaceId, userId);
  const existing = await db.local_account_credentials.get(id);

  const credential: LocalAccountCredential = {
    id,
    workspaceId,
    userId,
    email,
    salt: bytesToBase64(salt),
    verifier: bytesToBase64(verifier),
    iterations: PBKDF2_ITERATIONS,
    digest: PBKDF2_DIGEST,
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastVerifiedAt: now,
  };

  await db.local_account_credentials.put(credential);
  return credential;
}

export async function verifyLocalAccountPassword(
  workspaceId: string,
  userId: string,
  password: string,
): Promise<LocalPasswordVerificationResult> {
  const credential = await db.local_account_credentials.get(
    getCredentialId(workspaceId, userId),
  );
  if (!credential) {
    return { ok: false, reason: "missing" };
  }

  const now = Date.now();
  const lockedUntil = credential.lockedUntil
    ? new Date(credential.lockedUntil).getTime()
    : 0;
  if (lockedUntil > now) {
    return {
      ok: false,
      reason: "locked",
      retryAfterMs: lockedUntil - now,
    };
  }

  const candidate = await deriveVerifier(
    password,
    base64ToBytes(credential.salt),
    credential.iterations,
  );
  const matches = constantTimeEqual(
    candidate,
    base64ToBytes(credential.verifier),
  );

  if (matches) {
    await db.local_account_credentials.update(credential.id, {
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  const failedAttempts = credential.failedAttempts + 1;
  const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS;
  await db.local_account_credentials.update(credential.id, {
    failedAttempts: shouldLock ? 0 : failedAttempts,
    lockedUntil: shouldLock
      ? new Date(now + LOCKOUT_MS).toISOString()
      : null,
    updatedAt: new Date().toISOString(),
  });

  return {
    ok: false,
    reason: shouldLock ? "locked" : "invalid",
    retryAfterMs: shouldLock ? LOCKOUT_MS : undefined,
  };
}

export async function hasLocalAccountCredential(
  workspaceId: string,
  userId: string,
) {
  return Boolean(
    await db.local_account_credentials.get(
      getCredentialId(workspaceId, userId),
    ),
  );
}

export async function persistLocalAccountProfile(account: {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  role: UserRole;
  profileUrl?: string;
}) {
  const existing = await db.users.get(account.id);
  const now = new Date().toISOString();
  const localUser: User = {
    ...existing,
    id: account.id,
    workspaceId: account.workspaceId,
    email: account.email,
    name: account.name,
    role: account.role,
    profileUrl: account.profileUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    syncStatus: "synced",
    lastSyncedAt: now,
    version: existing?.version ?? 1,
    isDeleted: false,
  };

  await Promise.all([
    db.users.put(localUser),
    db.profiles.put({
      id: account.id,
      workspaceId: account.workspaceId,
      name: account.name,
      role: account.role,
      profile_url: account.profileUrl ?? null,
      created_at: existing?.createdAt ?? now,
    }),
  ]);
}

export async function getLocalWorkspaceAccount(
  workspaceId: string,
  userId: string,
): Promise<LocalWorkspaceAccount | null> {
  const [localUser, profile, credential] = await Promise.all([
    db.users.get(userId),
    db.profiles.get(userId),
    db.local_account_credentials.get(getCredentialId(workspaceId, userId)),
  ]);

  if (localUser?.isDeleted) {
    return null;
  }

  if (
    localUser?.workspaceId !== workspaceId &&
    profile?.workspaceId !== workspaceId
  ) {
    return null;
  }

  return {
    id: userId,
    workspaceId,
    email: localUser?.email || credential?.email || "",
    name: localUser?.name || profile?.name || "User",
    role: normalizeRole(localUser?.role || profile?.role),
    profileUrl: localUser?.profileUrl || profile?.profile_url || undefined,
    hasCredential: Boolean(credential),
  };
}

export async function listLocalWorkspaceAccounts(
  workspaceId: string,
): Promise<LocalWorkspaceAccount[]> {
  if (!workspaceId) return [];

  const [users, profiles, credentials] = await Promise.all([
    db.users.where("workspaceId").equals(workspaceId).toArray(),
    db.profiles.where("workspaceId").equals(workspaceId).toArray(),
    db.local_account_credentials
      .where("workspaceId")
      .equals(workspaceId)
      .toArray(),
  ]);
  const credentialByUserId = new Map(
    credentials.map((credential) => [credential.userId, credential]),
  );
  const deletedUserIds = new Set(
    users.filter((user) => user.isDeleted).map((user) => user.id),
  );
  const accountById = new Map<string, LocalWorkspaceAccount>();

  for (const profile of profiles) {
    if (deletedUserIds.has(profile.id)) continue;
    const credential = credentialByUserId.get(profile.id);
    accountById.set(profile.id, {
      id: profile.id,
      workspaceId,
      email: credential?.email || "",
      name: profile.name || "User",
      role: normalizeRole(profile.role),
      profileUrl: profile.profile_url || undefined,
      hasCredential: Boolean(credential),
    });
  }

  for (const user of users) {
    if (user.isDeleted) continue;
    const credential = credentialByUserId.get(user.id);
    const existing = accountById.get(user.id);
    accountById.set(user.id, {
      id: user.id,
      workspaceId,
      email: user.email || credential?.email || existing?.email || "",
      name: user.name || existing?.name || "User",
      role: normalizeRole(user.role || existing?.role),
      profileUrl: user.profileUrl || existing?.profileUrl,
      hasCredential: Boolean(credential),
    });
  }

  return Array.from(accountById.values()).sort((left, right) => {
    if (left.role === "admin" && right.role !== "admin") return -1;
    if (right.role === "admin" && left.role !== "admin") return 1;
    return left.name.localeCompare(right.name);
  });
}
