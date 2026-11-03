import { expect, test } from "bun:test";
import { applyFontScale } from "./fontScale";
test("font multiplier changes text variable while root rem stays fixed, including invalid values", () => {
  const variables = new Map<string, string>();
  const root = { style: { fontSize: "", setProperty: (name: string, value: string) => { variables.set(name, value); } }, dataset: {} as Record<string, string> };
  for (const [value, expected] of [[1.25, "1.25"], [0.85, "0.85"], [Number.NaN, "1"], [100, "1.25"]] as const) {
    applyFontScale(root as unknown as Pick<HTMLElement, "style" | "dataset">, value);
    expect(root.style.fontSize).toBe("100%"); expect(variables.get("--vy-font-scale")).toBe(expected);
  }
});
