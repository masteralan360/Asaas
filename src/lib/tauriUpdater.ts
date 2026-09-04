import { check } from "@tauri-apps/plugin-updater";

type WindowsInstallerType = "msi" | "nsis";

const WINDOWS_UPDATE_TARGET_PREFIX = "windows-x86_64";

export function getWindowsUpdateTarget(
  bundleType: string | null | undefined,
): string | undefined {
  if (bundleType !== "msi" && bundleType !== "nsis") {
    return undefined;
  }

  return `${WINDOWS_UPDATE_TARGET_PREFIX}-${bundleType satisfies WindowsInstallerType}`;
}

/**
 * Request the artifact matching the installed Windows package when possible.
 *
 * Older releases do not send a target and therefore use the generic Windows
 * channel. That channel is deliberately reserved for the one-time MSI to NSIS
 * migration. Once this code is installed, MSI and NSIS updates stay separate.
 */
export async function checkForTauriUpdate() {
  try {
    const { getBundleType } = await import("@tauri-apps/api/app");
    const target = getWindowsUpdateTarget(await getBundleType());
    return check(target ? { target } : undefined);
  } catch (error) {
    // A missing bundle type must not stop updates on a supported platform.
    // Falling back preserves compatibility with older Tauri runtimes.
    console.warn("[Updater] Could not resolve the installer type:", error);
    return check();
  }
}
