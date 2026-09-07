import { useEffect, useMemo, useState } from "react";
import type { VyTheme } from "@vyline/themes";
import { useStore } from "@/lib/store";
import { useDesignSystemStore, type DesignSystem } from "./design-system-store";

const ACCENTS = { apple: "#006ee6", fluent: "#005fb8", miuix: "#0666df", nezu: "#3365d6" };

/** Design-system surfaces do not mutate the user's saved VyTheme. */
export function resolveDesignTheme(mode: DesignSystem, dark: boolean, saved: VyTheme): VyTheme {
  if (mode === "legacy") return saved;
  const apple = mode === "apple";
  const fluent = mode === "fluent";
  const nezu = mode === "nezu";
  const accent = dark ? (apple ? "#0a84ff" : fluent ? "#60cdff" : "#70a9ff") : ACCENTS[mode];
  return {
    id: `ui-${mode}-${dark ? "dark" : "light"}`,
    name: mode,
    accent,
    accentContrast: dark && !apple ? "#071a30" : "#ffffff",
    bg: dark ? (apple ? "#000000" : "#191919") : apple ? "#ffffff" : "#f3f3f3",
    surface: dark ? "#202022" : "#ffffff",
    surface2: dark ? "#2c2c2e" : apple ? "#f2f2f7" : "#f6f6f6",
    sidebar: dark ? (apple ? "#161618" : "#202020") : apple ? "#f5f5f7" : "#f3f3f3",
    text: dark ? "#f5f5f7" : "#19191b",
    textDim: dark ? "#aaaab0" : "#626268",
    border: dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.10)",
    msgIn: dark ? "#2c2c2e" : apple ? "#e9e9eb" : "#ffffff",
    msgOut: apple ? (dark ? "#087cec" : "#006ee6") : dark ? "#263d54" : "#e0edff",
    msgInText: dark ? "#f5f5f7" : "#171719",
    msgOutText: apple ? "#ffffff" : dark ? "#f2f6ff" : "#152641",
    radius: apple ? 1.2 : fluent ? 0.5 : nezu ? 1.125 : 1.5,
    chatBg: dark ? (apple ? "#000000" : "#191919") : apple ? "#ffffff" : "#f5f5f5",
    pattern: 0,
  };
}

export function useDesignTheme() {
  const saved = useStore((state) => state.theme);
  const mode = useDesignSystemStore((state) => state.mode);
  const appearance = useDesignSystemStore((state) => state.appearance);
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const dark = appearance === "dark" || (appearance === "system" && systemDark);
  const theme = useMemo(() => resolveDesignTheme(mode, dark, saved), [mode, dark, saved]);
  return { theme, mode, dark };
}
