const PERSIST_KEY = "atlas_storage_persist_requested";

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("storage" in navigator)) {
    return false;
  }

  try {
    const alreadyPersisted = await navigator.storage.persisted();
    if (alreadyPersisted) {
      return true;
    }

    const isPersisted = await navigator.storage.persist();
    if (isPersisted) {
      localStorage.setItem(PERSIST_KEY, "true");
    }
    return isPersisted;
  } catch (error) {
    console.warn("[StoragePersist] Failed to request persistent storage:", error);
    return false;
  }
}

export async function getStorageEstimate(): Promise<{
  quota: number;
  usage: number;
  percentage: number;
} | null> {
  if (typeof navigator === "undefined" || !("storage" in navigator)) {
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota ?? 0;
    const usage = estimate.usage ?? 0;
    return {
      quota,
      usage,
      percentage: quota > 0 ? (usage / quota) * 100 : 0,
    };
  } catch {
    return null;
  }
}

export async function getStoragePressureInfo(): Promise<{
  isLow: boolean;
  details: string;
}> {
  const estimate = await getStorageEstimate();
  if (!estimate) {
    return { isLow: false, details: "Storage API not available" };
  }

  const { quota, usage, percentage } = estimate;
  const isLow = percentage > 80;

  return {
    isLow,
    details: `Using ${formatBytes(usage)} of ${formatBytes(quota)} (${percentage.toFixed(1)}%)`,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
