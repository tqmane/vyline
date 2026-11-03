export const BETA_CONSENT_KEY = "vyline:beta-feature-consent-v1";
export const BETA_CONSENT_TERMS_VERSION = "2026-11-03";
export const BETA_FEATURES = {
  betaBlockCheckManual: "block-status-check-manual",
  betaBlockCheckAuto: "block-status-check-auto",
  betaMidSearch: "mid-user-search",
  betaAgentI: "agent-i-assistant",
} as const;
export type BetaSetting = keyof typeof BETA_FEATURES;
export type BetaConsentDecision = "accepted" | "declined" | "withdrawn" | "disabled_by_restore";
export type BetaConsentEvent = {
  featureId: string; decision: BetaConsentDecision; occurredAt: string; termsVersion: string;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type Ledger = { schemaVersion: 2; events: BetaConsentEvent[] };

export function betaFeatureIdForSetting(key: string): string {
  return BETA_FEATURES[key as BetaSetting] ?? key;
}

export function normalizeBetaConsent(value: unknown): Ledger {
  const events: BetaConsentEvent[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { schemaVersion: 2, events };
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion === 2 && Array.isArray(raw.events)) {
    for (const event of raw.events) {
      if (!event || typeof event !== "object") continue;
      const e = event as BetaConsentEvent;
      if (typeof e.featureId === "string" && e.featureId.length <= 100 &&
        ["accepted", "declined", "withdrawn", "disabled_by_restore"].includes(e.decision) &&
        typeof e.occurredAt === "string" && Number.isFinite(Date.parse(e.occurredAt)) &&
        typeof e.termsVersion === "string") events.push({
          featureId: e.featureId, decision: e.decision, occurredAt: e.occurredAt, termsVersion: e.termsVersion,
        });
    }
  } else if (raw.schemaVersion === undefined) {
    for (const [feature, record] of Object.entries(raw)) {
      if (!record || typeof record !== "object") continue;
      const at = (record as { consentedAt?: unknown }).consentedAt;
      if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) continue;
      const features = feature === "block-status-check"
        ? [BETA_FEATURES.betaBlockCheckManual, BETA_FEATURES.betaBlockCheckAuto] : [feature];
      for (const featureId of features) events.push({ featureId, decision: "accepted", occurredAt: at, termsVersion: "legacy" });
    }
  }
  return { schemaVersion: 2, events };
}

export function getBetaFeatureConsentHistory(storage?: Storage): BetaConsentEvent[] {
  try {
    const target = storage ?? localStorage;
    const parsed = JSON.parse(target.getItem(BETA_CONSENT_KEY) ?? "null");
    const ledger = normalizeBetaConsent(parsed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.schemaVersion === undefined) {
      const serialized = JSON.stringify(ledger);
      target.setItem(BETA_CONSENT_KEY, serialized);
      if (target.getItem(BETA_CONSENT_KEY) !== serialized) return [];
    }
    return ledger.events;
  }
  catch { return []; }
}

export function hasBetaFeatureConsent(featureId: string, storage?: Storage): boolean {
  const history = getBetaFeatureConsentHistory(storage);
  for (let i = history.length - 1; i >= 0; i--) {
    const event = history[i]!;
    if (event.featureId === featureId) return event.decision === "accepted" &&
      (event.termsVersion === "legacy" || event.termsVersion === BETA_CONSENT_TERMS_VERSION);
  }
  return false;
}

/** One atomic ledger write: a failed restore cannot partially revoke consent. */
export function recordBetaFeatureDecisions(features: readonly string[], decision: BetaConsentDecision, storage?: Storage): boolean {
  try {
    const target = storage ?? localStorage;
    const ledger = normalizeBetaConsent(JSON.parse(target.getItem(BETA_CONSENT_KEY) ?? "null"));
    const occurredAt = new Date().toISOString();
    for (const featureId of new Set(features)) ledger.events.push({ featureId, decision, occurredAt, termsVersion: BETA_CONSENT_TERMS_VERSION });
    const serialized = JSON.stringify(ledger);
    target.setItem(BETA_CONSENT_KEY, serialized);
    return target.getItem(BETA_CONSENT_KEY) === serialized;
  } catch { return false; }
}

export function recordBetaFeatureDecision(featureId: string, decision: BetaConsentDecision, storage?: Storage): boolean {
  return recordBetaFeatureDecisions([featureId], decision, storage);
}

/** Revoke consent first so a failing preferences write cannot restore acceptance on restart. */
export function withdrawBetaFeature(featureId: string, disable: () => void, storage?: Storage): boolean {
  const recorded = recordBetaFeatureDecision(featureId, "withdrawn", storage);
  try { disable(); } catch { return false; }
  return recorded;
}
