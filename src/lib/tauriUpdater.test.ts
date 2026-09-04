import { describe, expect, it } from "vitest";

import { getWindowsUpdateTarget } from "./tauriUpdater";

describe("getWindowsUpdateTarget", () => {
  it("keeps MSI installations on the MSI compatibility channel", () => {
    expect(getWindowsUpdateTarget("msi")).toBe("windows-x86_64-msi");
  });

  it("keeps NSIS installations on the no-UAC channel", () => {
    expect(getWindowsUpdateTarget("nsis")).toBe("windows-x86_64-nsis");
  });

  it("falls back to the generic legacy channel for other bundle types", () => {
    expect(getWindowsUpdateTarget("app")).toBeUndefined();
    expect(getWindowsUpdateTarget(null)).toBeUndefined();
  });
});
