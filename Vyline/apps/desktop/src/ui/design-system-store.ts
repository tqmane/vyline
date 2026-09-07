import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DESIGN_SYSTEMS = [
  { id: "legacy", name: "Vyline Classic", description: "現在のレイアウトとVyTheme" },
  { id: "apple", name: "Messages", description: "Apple Messages · Liquid Glass" },
  { id: "fluent", name: "Fluent", description: "Microsoft · Compose Fluent" },
  { id: "miuix", name: "Miuix", description: "Xiaomi / HyperOS · Miuix" },
  { id: "nezu", name: "NezuUI", description: "NezuUI portable components" },
] as const;

export type DesignSystem = (typeof DESIGN_SYSTEMS)[number]["id"];
export type Appearance = "system" | "light" | "dark";
export function isComposeMode(mode: DesignSystem): mode is "apple" | "fluent" | "miuix" {
  return mode === "apple" || mode === "fluent" || mode === "miuix";
}
export type DesignPreferences = { mode: DesignSystem; appearance: Appearance };

export function readDesignPreferences(value: unknown): DesignPreferences {
  const saved = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    mode: DESIGN_SYSTEMS.some((entry) => entry.id === saved.mode)
      ? (saved.mode as DesignSystem)
      : "legacy",
    appearance:
      saved.appearance === "light" || saved.appearance === "dark" ? saved.appearance : "system",
  };
}

// Presentation is browser-local, independent of account/session and VyTheme data.
export const useDesignSystemStore = create<
  DesignPreferences & {
    setMode: (mode: DesignSystem) => void;
    setAppearance: (appearance: Appearance) => void;
  }
>()(
  persist(
    (set) => ({
      mode: "legacy",
      appearance: "system",
      setMode: (mode) => set({ mode: readDesignPreferences({ mode }).mode }),
      setAppearance: (appearance) =>
        set({ appearance: readDesignPreferences({ appearance }).appearance }),
    }),
    {
      name: "vyline:design-system",
      partialize: ({ mode, appearance }) => ({ mode, appearance }),
      merge: (saved, current) => ({ ...current, ...readDesignPreferences(saved) }),
    },
  ),
);
