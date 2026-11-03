const CONSENT_KEY = "vyline:tos-consent-v1";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

// Existing consent remains browser-local and shared across account switches.
export function hasTosConsent(storage?: Storage): boolean {
  try { return (storage ?? localStorage).getItem(CONSENT_KEY) === "1"; }
  catch { return false; }
}

export function setTosConsent(storage?: Storage): boolean {
  try {
    const target = storage ?? localStorage;
    target.setItem(CONSENT_KEY, "1");
    return target.getItem(CONSENT_KEY) === "1";
  } catch { return false; }
}
