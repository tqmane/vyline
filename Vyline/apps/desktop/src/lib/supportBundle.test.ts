import { expect, test } from "bun:test";
import { unzipSync } from "../../../../backend/node_modules/fflate";
import { createSupportZip, redactSupportValue, supportIssuePreview, validateSupportImages } from "./supportBundle";

test("support masks nested credentials, cookie lines, JWT, MID, URL secrets, personal data and body", () => {
  const secrets = ["fixture-token", "fixture-cookie", "fixture-password", "eyJmb28iOiJiYXIifQ.abcdefghi.abcdefghij", "u0123456789abcdef0123456789abcdef", "person@example.test", "private-body"];
  const result = JSON.stringify(redactSupportValue({ token: secrets[0], error: `Cookie: sid=${secrets[1]}; second=private\npassword=${secrets[2]}\n${secrets[3]} ${secrets[4]} ${secrets[5]} https://example.test/?secret=fixture-url`, body: secrets[6], nested: { refreshToken: secrets[0] } }));
  for (const secret of [...secrets, "fixture-url", "second=private"]) expect(result).not.toContain(secret);
  const cycle: { child?: unknown } = {}; cycle.child = cycle;
  expect(JSON.stringify(redactSupportValue(cycle))).toContain("CIRCULAR");
});

test("issue preview only targets tqmane, masks free text and falls back to copy for long bodies", () => {
  const input = { summary: "bug", steps: "1. token=fixture", actual: "fail", expected: "success", version: "0.8.0-beta" };
  const preview = supportIssuePreview(input);
  expect(preview.url).toStartWith("https://github.com/tqmane/vyline/issues/new?"); expect(preview.body).not.toContain("fixture");
  expect(supportIssuePreview({ ...input, steps: "漢".repeat(12000) }).copyRequired).toBe(true);
});

test("quoted JSON credentials and escaped values never enter a report URL", () => {
  const actual = '{"accessToken":"fixture-secret\\\"-tail","cookie":"sid=fixture-cookie","nested":{"api_key":"fixture-api"}}';
  const preview = supportIssuePreview({ summary: "fixture", actual, steps: "", expected: "", version: "test" });
  for (const value of ["fixture-secret", "fixture-cookie", "fixture-api", "-tail"])
    expect(decodeURIComponent(preview.url)).not.toContain(value);
});

test("screenshot count, type, per-file and total limits reject before reading", () => {
  const file = (size: number, type = "image/png") => ({ size, type });
  validateSupportImages([]); validateSupportImages([file(10 * 1024 * 1024)]);
  for (const files of [[file(10 * 1024 * 1024 + 1)], [file(1, "image/svg+xml")], [file(0)], Array(11).fill(file(1)), Array(3).fill(file(9 * 1024 * 1024))])
    expect(() => validateSupportImages(files)).toThrow();
});

test("locally generated ZIP extracts byte-for-byte and rejects unsafe/duplicate names and oversized files", async () => {
  const data = new TextEncoder().encode("{\"fixture\":\"日本語\"}");
  const blob = createSupportZip([{ name: "diagnostics.json", data }]);
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(files["diagnostics.json"]).toEqual(data);
  expect(Object.keys(unzipSync(new Uint8Array(await createSupportZip([]).arrayBuffer())))).toHaveLength(0);
  expect(() => createSupportZip([{ name: "../bad.json", data }])).toThrow();
  expect(() => createSupportZip([{ name: "same.json", data }, { name: "same.json", data }])).toThrow();
  expect(() => createSupportZip([{ name: "large.json", data: new Uint8Array(30 * 1024 * 1024 + 1) }])).toThrow();
});
