import { expect, test } from "bun:test";
import { BETA_CONSENT_KEY, BETA_FEATURES, getBetaFeatureConsentHistory, hasBetaFeatureConsent, recordBetaFeatureDecision, recordBetaFeatureDecisions, withdrawBetaFeature } from "./betaConsent";
import { hasTosConsent, setTosConsent } from "./tosConsent";

function memoryStorage(initial = "null") {
  const values = new Map([[BETA_CONSENT_KEY, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("v1 block consent migrates both features preserving the date, then withdrawal requires fresh acceptance", () => {
  const storage = memoryStorage(JSON.stringify({ "block-status-check": { consentedAt: "2026-08-01T00:00:00Z", version: "1" } }));
  expect(hasBetaFeatureConsent(BETA_FEATURES.betaBlockCheckManual, storage)).toBe(true);
  expect(hasBetaFeatureConsent(BETA_FEATURES.betaBlockCheckAuto, storage)).toBe(true);
  expect(recordBetaFeatureDecision(BETA_FEATURES.betaBlockCheckManual, "withdrawn", storage)).toBe(true);
  expect(hasBetaFeatureConsent(BETA_FEATURES.betaBlockCheckManual, storage)).toBe(false);
  expect(hasBetaFeatureConsent(BETA_FEATURES.betaBlockCheckAuto, storage)).toBe(true);
  expect(getBetaFeatureConsentHistory(storage)[0]?.occurredAt).toBe("2026-08-01T00:00:00Z");
  expect(recordBetaFeatureDecision(BETA_FEATURES.betaBlockCheckManual, "accepted", storage)).toBe(true);
  expect(hasBetaFeatureConsent(BETA_FEATURES.betaBlockCheckManual, storage)).toBe(true);
});

test("restore records all features atomically and preserves history across reads", () => {
  const storage = memoryStorage();
  recordBetaFeatureDecision("agent-i-assistant", "accepted", storage);
  expect(recordBetaFeatureDecisions(Object.values(BETA_FEATURES), "disabled_by_restore", storage)).toBe(true);
  expect(hasBetaFeatureConsent("agent-i-assistant", storage)).toBe(false);
  expect(getBetaFeatureConsentHistory(storage)).toHaveLength(5);
});

test("storage denial and silent write loss fail closed for beta and ToS", () => {
  for (const storage of [
    { getItem: () => null, setItem: () => { throw new Error("quota"); } },
    { getItem: () => null, setItem: () => {} },
  ]) {
    expect(recordBetaFeatureDecision("agent-i-assistant", "accepted", storage)).toBe(false);
    expect(hasBetaFeatureConsent("agent-i-assistant", storage)).toBe(false);
    expect(setTosConsent(storage)).toBe(false);
    expect(hasTosConsent(storage)).toBe(false);
  }
});

test("legacy ToS remains accepted and is not part of beta restore", () => {
  const storage = memoryStorage();
  expect(setTosConsent(storage)).toBe(true);
  recordBetaFeatureDecisions(Object.values(BETA_FEATURES), "disabled_by_restore", storage);
  expect(hasTosConsent(storage)).toBe(true);
});

test("withdrawing remains recorded when a preference write fails", () => {
  const storage = memoryStorage();
  recordBetaFeatureDecision("agent-i-assistant", "accepted", storage);
  expect(withdrawBetaFeature("agent-i-assistant", () => { throw new Error("preferences blocked"); }, storage)).toBe(false);
  expect(hasBetaFeatureConsent("agent-i-assistant", storage)).toBe(false);
  expect(getBetaFeatureConsentHistory(storage).at(-1)?.decision).toBe("withdrawn");
});
