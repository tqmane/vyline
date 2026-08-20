/** Read-only structural smoke test for an Android LINE DB or LEINs ZIP. */

import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const source = process.argv[2] ? resolve(process.argv[2]) : "";
if (!source || !(await lstat(source)).isFile()) {
  throw new Error("Usage: bun run verify:android-backup -- <naver_line.db|LEINs_backup.zip>");
}

const temporary = await mkdtemp(join(tmpdir(), "vyline-android-verify-"));
const expectedParent = resolve(tmpdir());
if (
  dirname(resolve(temporary)) !== expectedParent ||
  !basename(temporary).startsWith("vyline-android-verify-")
) {
  throw new Error("unsafe verification directory");
}

try {
  process.env.VYLINE_DATA_DIR = join(temporary, "data");
  process.env.VYLINE_MEDIA_CACHE_DIR = join(temporary, "media");
  process.env.VYLINE_CACHE_SAVE_MS = "10";

  const handle = await open(source, "r");
  const header = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.byteLength, 0);
  } finally {
    await handle.close();
  }

  const dummyMid = `u${"1".repeat(32)}`;
  const result =
    header.subarray(0, 16).toString("binary") === "SQLite format 3\0"
      ? await import("../Vyline/backend/src/service/androidDbImport.js").then(
          ({ importAndroidLineDatabase }) =>
            importAndroidLineDatabase("verification", source, dummyMid),
        )
      : await import("../Vyline/backend/src/service/androidZipImport.js").then(
          ({ importAndroidLineZip }) => importAndroidLineZip("verification", source, dummyMid),
        );
  console.log(JSON.stringify(result));
} finally {
  const target = resolve(temporary);
  if (dirname(target) !== expectedParent || !basename(target).startsWith("vyline-android-verify-")) {
    console.error("refusing unsafe verification cleanup");
    process.exitCode = 1;
  } else {
    await rm(target, { recursive: true, force: true });
  }
}
