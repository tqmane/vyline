export function applyFontScale(root: Pick<HTMLElement, "style" | "dataset">, value: number) {
  const scale = Number.isFinite(value) ? Math.min(1.25, Math.max(0.85, value)) : 1;
  // An inline 100% also overrides older stylesheets that scale :root via the variable.
  root.style.fontSize = "100%";
  root.style.setProperty("--vy-font-scale", String(scale));
  root.dataset.fontScale = String(scale);
}
