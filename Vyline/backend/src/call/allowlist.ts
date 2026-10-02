/** 通話先の種別を検証する。実送信テストは AGENTS.md の指定先だけ。 */

export class CallNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallNotAllowedError";
  }
}

/**
 * The call could not start because of call state the user can act on (already on
 * a call, still connecting, ring already finished). Not a server fault: without
 * this the router answers 500 `internal server error` and the caller loses the
 * message that was written for them.
 */
export class CallConflictError extends Error {
  /** 409 Conflict, or 410 Gone when the targeted call has already finished. */
  readonly status: 409 | 410;

  constructor(message: string, status: 409 | 410 = 409) {
    super(message);
    this.name = "CallConflictError";
    this.status = status;
  }
}

/** 409 Conflict by default; pass 410 when the call the user targeted is already gone. */
export function callConflict(message: string, status: 409 | 410 = 409): CallConflictError {
  return new CallConflictError(message, status);
}

/** mid が 1:1 通話可能か（u* の DM のみ） */
export function isAllowedCallTarget(toMid: string): boolean {
  return toMid.startsWith("u");
}

export function isGroupCallTarget(mid: string): boolean {
  return /^c[0-9a-f]{32}$/.test(mid);
}

export function callAllowlistHint(): string {
  return "1:1 通話は DM（u*）のみ対応しています。";
}
