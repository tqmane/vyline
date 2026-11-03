import { expect, test } from "bun:test";
import { createLinkPreviewLoader } from "./useLinkPreviews";

test("loader deduplicates accounts, bounds active work, and aborts only when all consumers leave", async () => {
  const calls: { account: string; signal: AbortSignal; finish: () => void }[] = [];
  const acquire = createLinkPreviewLoader(
    (account, _url, signal) =>
      new Promise((resolve) => {
        calls.push({
          account,
          signal,
          finish: () => resolve({ title: account, description: "", site: "site.org" }),
        });
        signal.addEventListener("abort", () => resolve(null));
      }),
  );
  const first = acquire("a", "https://site.org");
  const duplicate = acquire("a", "https://site.org");
  expect(calls).toHaveLength(1);
  first.release();
  expect(calls[0]!.signal.aborted).toBe(false);
  duplicate.release();
  expect(calls[0]!.signal.aborted).toBe(true);
  const work = Array.from({ length: 80 }, (_, i) =>
    acquire(i % 2 ? "a" : "b", `https://site.org/${i}`),
  );
  expect(calls.length).toBeLessThanOrEqual(4);
  work.forEach((item) => item.release());
  await Promise.all(work.map((item) => item.promise));
  expect(calls.every((call) => call.signal.aborted)).toBe(true);
});

test("loader caches failures and successful results per account with expiry", async () => {
  let time = 0;
  let calls = 0;
  const acquire = createLinkPreviewLoader(
    async (account) => {
      calls++;
      return account === "a" ? { title: "A", description: "", site: "site.org" } : null;
    },
    () => time,
  );
  await acquire("a", "https://site.org").promise;
  await acquire("a", "https://site.org").promise;
  await acquire("b", "https://site.org").promise;
  await acquire("b", "https://site.org").promise;
  expect(calls).toBe(2);
  time = 5 * 60_000 + 1;
  await acquire("b", "https://site.org").promise;
  expect(calls).toBe(3);
});
