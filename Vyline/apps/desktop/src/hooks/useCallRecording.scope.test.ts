import { expect, test } from "bun:test";
import { releaseRecordingSession, type RecordingSessionHandle } from "./useCallRecording";

// The recording session belongs to one call in one account. When that scope ends,
// the handle must not keep blocking the next recording: automatic recording would
// otherwise capture zero bytes silently.

function holder(session: RecordingSessionHandle | null) {
  return { current: session };
}

test("a finished call detaches its recording session and re-enables recording", () => {
  let stopped = 0;
  const session: RecordingSessionHandle = {
    scope: "account-a:session-1",
    cancelled: false,
    stop() {
      stopped += 1;
    },
  };
  const active = holder(session);
  let operationActive = true;

  releaseRecordingSession(active, (value) => {
    operationActive = value;
  });

  expect(stopped).toBe(1);
  expect(active.current).toBeNull();
  // A stale handle here is what disables the next 記録 button and skips automatic start.
  expect(operationActive).toBe(false);
});

test("detaching does not clobber a session that already replaced the old one", () => {
  const active = holder(null);
  let operationActive = false;
  // start()'s finally only clears when it still owns the handle.
  const stale: RecordingSessionHandle = { scope: "old", cancelled: false, stop() {} };
  active.current = { scope: "new", cancelled: false, stop() {} };

  releaseRecordingSession(active, (value) => {
    operationActive = value;
  });
  active.current = { ...stale, scope: "new" };

  expect(active.current?.scope).toBe("new");
  expect(operationActive).toBe(false);
});

test("detaching with no session in flight is a no-op", () => {
  const active = holder(null);
  let calls = 0;
  releaseRecordingSession(active, () => {
    calls += 1;
  });
  expect(active.current).toBeNull();
  expect(calls).toBe(1);
});
