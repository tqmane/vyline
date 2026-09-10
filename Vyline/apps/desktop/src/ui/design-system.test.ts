import { expect, test } from "bun:test";
import { DESIGN_SYSTEMS, readDesignPreferences } from "./design-system-store";
import { resolveDesignTheme } from "./design-theme";
import { THEME_PRESETS } from "@vyline/themes";

test("presentation preferences accept known modes and recover stale or malformed storage", () => {
  for (const { id } of DESIGN_SYSTEMS) {
    expect(readDesignPreferences({ mode: id, appearance: "dark" })).toEqual({
      mode: id,
      appearance: "dark",
    });
  }
  for (const value of [null, [], "apple", { mode: "removed", appearance: "invalid" }]) {
    expect(readDesignPreferences(value)).toEqual({ mode: "legacy", appearance: "system" });
  }
  expect(
    readDesignPreferences({ mode: "nezu", appearance: "light", accountId: "unrelated" }),
  ).toEqual({ mode: "nezu", appearance: "light" });
});

test("iMessage keeps the persisted apple identifier", () => {
  expect(DESIGN_SYSTEMS.find(({ id }) => id === "apple")?.name).toBe("iMessage");
  for (const appearance of ["light", "dark", "system"] as const) {
    expect(readDesignPreferences({ mode: "apple", appearance })).toEqual({
      mode: "apple",
      appearance,
    });
  }
});

test("design palettes preserve the exact saved theme and restore it for Classic", () => {
  const saved = { ...THEME_PRESETS[0]!, chatImage: "https://example.invalid/custom.jpg" };
  const before = { ...saved };
  for (const { id } of DESIGN_SYSTEMS) {
    const light = resolveDesignTheme(id, false, saved);
    const dark = resolveDesignTheme(id, true, saved);
    expect(saved).toEqual(before);
    if (id === "legacy") expect(light).toBe(saved);
    else {
      expect(light.bg).not.toBe(dark.bg);
      expect(light.chatImage).toBeUndefined();
      expect(light.pattern).toBe(0);
    }
  }
  expect(resolveDesignTheme("legacy", false, saved)).toBe(saved);
});
