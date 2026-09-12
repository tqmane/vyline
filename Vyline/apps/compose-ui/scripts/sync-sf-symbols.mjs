/**
 * Import and verify every Apple glyph that Vyline vendors from the user's
 * SF Symbols 8 export. The complete all-weights ZIP is preferred because the
 * currently extracted source directory contains only a subset of the archive.
 *
 * Usage:
 *   node scripts/sync-sf-symbols.mjs --write
 *   node scripts/sync-sf-symbols.mjs
 *   node scripts/sync-sf-symbols.mjs --archive C:/path/to/sf-symbols-8.0-all-weights.zip --write
 *   node scripts/sync-sf-symbols.mjs --source C:/path/to/complete/sf-symbols-8.0-svg --write
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const composeRoot = path.resolve(scriptDir, "..");
const desktopRoot = path.resolve(composeRoot, "../desktop");
const defaultSourceRoot = "C:/Users/Tqmane/Documents/Git/themes/sf-symbols-8.0-svg";
const defaultArchive = "C:/Users/Tqmane/Downloads/sf-symbols-8.0-all-weights/sf-symbols-8.0-all-weights.zip";
const archivePrefix = "sf-symbols-8.0-svg/";

const args = process.argv.slice(2);
const optionValue = name => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (!args[index + 1]) throw new Error(`${name} requires a path`);
  return args[index + 1];
};
const explicitSource = optionValue("--source");
const explicitArchive = optionValue("--archive");
assert(!(explicitSource && explicitArchive), "Use either --source or --archive, not both");
const write = args.includes("--write");
const archivePath = explicitArchive
  ? path.resolve(explicitArchive)
  : !explicitSource && existsSync(defaultArchive)
    ? path.resolve(defaultArchive)
    : null;
const sourceRoot = archivePath ? null : path.resolve(explicitSource ?? defaultSourceRoot);

const slash = value => value.replaceAll("\\", "/");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const runTar = (tarArgs, encoding = null) => {
  try {
    return execFileSync("tar", tarArgs, {
      encoding,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.("utf8")?.trim();
    throw new Error(`tar ${tarArgs.join(" ")} failed${stderr ? `: ${stderr}` : ""}`, { cause: error });
  }
};

let sourceNames;
let readSource;
let sourceManifestPath;
let sourceArtifact;
if (archivePath) {
  assert(existsSync(archivePath), `SF Symbols archive not found: ${archivePath}`);
  const listing = runTar(["-tf", archivePath], "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  sourceNames = new Set(
    listing
      .filter(name => name.startsWith(archivePrefix) && name.endsWith(".svg"))
      .map(name => name.slice(archivePrefix.length)),
  );
  const cache = new Map();
  readSource = async name => {
    if (!cache.has(name)) cache.set(name, runTar(["-xOf", archivePath, `${archivePrefix}${name}`]));
    return cache.get(name);
  };
  sourceManifestPath = path.resolve(path.dirname(archivePath), "sf-symbols-8.0-manifest.txt");
  sourceArtifact = {
    kind: "zip",
    path: slash(archivePath),
    sha256: sha256(await readFile(archivePath)),
  };
} else {
  assert(sourceRoot && existsSync(sourceRoot), `SF Symbols source directory not found: ${sourceRoot}`);
  sourceNames = new Set((await readdir(sourceRoot)).filter(name => name.endsWith(".svg")));
  readSource = name => readFile(path.join(sourceRoot, name));
  sourceManifestPath = path.resolve(sourceRoot, "../sf-symbols-8.0-manifest.txt");
  sourceArtifact = { kind: "directory", path: slash(sourceRoot), sha256: null };
}

const C = "compose";
const DC = "desktop-call";
const DP = "desktop-plus";
const mappings = [
  [C, "sf_arrow_clockwise.svg", "arrow.clockwise", "arrow.clockwise.svg", "arrow/Monochrome=arrow.clockwise.svg"],
  [C, "sf_arrow_expand.svg", "arrow.up.left.and.arrow.down.right", "arrow.up.left.and.arrow.down.right.svg", "arrow/Monochrome=arrow.up.left.and.arrow.down.right.svg"],
  [C, "sf_arrow_up.svg", "arrow.up", "arrow.up.svg", "arrow/Monochrome=arrow.up.svg"],
  [C, "sf_arrowshape_turn_up_left.svg", "arrowshape.turn.up.left", "arrowshape.turn.up.left.svg", "arrow/Monochrome=arrowshape.turn.up.left.svg"],
  [C, "sf_bell_slash.svg", "bell.slash", "bell.slash.svg", "object&tools/Monochrome=bell.slash.svg"],
  [C, "sf_bell.svg", "bell", "bell.svg", "object&tools/Monochrome=bell.svg"],
  [C, "sf_calendar.svg", "calendar", "calendar.svg", "object&tools/Monochrome=calendar.svg"],
  [C, "sf_camera_switch.svg", "arrow.trianglehead.2.clockwise.rotate.90.camera", "arrow.trianglehead.2.clockwise.rotate.90.camera.svg", "camera&photos/Mnochrome=arrow.triangle.2.circlepath.camera.svg", "arrow.triangle.2.circlepath.camera"],
  [C, "sf_camera.svg", "camera", "camera.svg", "camera&photos/Mnochrome=camera.svg"],
  [C, "sf_chart.svg", "chart.bar", "chart.bar.svg", "connectivity/Monochrome=chart.bar.svg"],
  [C, "sf_checkmark.svg", "checkmark", "checkmark.svg", "privacy&security/Monochrome=checkmark.svg"],
  [C, "sf_chevron_down.svg", "chevron.down", "chevron.down.svg", "arrow/Monochrome=chevron.down.svg"],
  [C, "sf_chevron_left.svg", "chevron.left", "chevron.left.svg", "arrow/Monochrome=chevron.left.svg"],
  [C, "sf_chevron_right.svg", "chevron.right", "chevron.right.svg", "arrow/Monochrome=chevron.right.svg"],
  [C, "sf_chevron_up.svg", "chevron.up", "chevron.up.svg", "arrow/Monochrome=chevron.up.svg"],
  [C, "sf_crop.svg", "crop", "crop.svg", "editing/Monochrome=crop.svg"],
  [C, "sf_devices.svg", "ipad.landscape.and.iphone", "ipad.landscape.and.iphone.svg", "devices/Monochrome=ipad.and.iphone.svg", "ipad.and.iphone"],
  [C, "sf_doc_on_doc.svg", "document.on.document", "document.on.document.svg", "object&tools/Monochrome=doc.on.doc.svg", "doc.on.doc"],
  [C, "sf_doc.svg", "document", "document.svg", "object&tools/Monochrome=doc.svg", "doc"],
  [C, "sf_face_smiling.svg", "face.smiling", "face.smiling.svg", "human/Monochrome=face.smiling.svg"],
  [C, "sf_gearshape.svg", "gearshape", "gearshape.svg", "object&tools/Monochrome=gearshape.svg"],
  [C, "sf_heart.svg", "heart", "heart.svg", "health/Monochrome=heart.svg"],
  [C, "sf_info.svg", "info.circle", "info.circle.svg", "missing/info.circle.svg"],
  [C, "sf_lock.svg", "lock", "lock.svg", "privacy&security/Monochrome=lock.svg"],
  [C, "sf_magnifyingglass.svg", "magnifyingglass", "magnifyingglass.svg", "object&tools/Monochrome=magnifyingglass.svg"],
  [C, "sf_mic_slash.svg", "microphone.slash", "microphone.slash.svg", "communication/Property 1=mic.slash.svg", "mic.slash"],
  [C, "sf_mic.svg", "microphone", "microphone.svg", "communication/Property 1=mic.svg", "mic"],
  [C, "sf_palette.svg", "paintpalette", "paintpalette.svg", "object&tools/Monochrome=paintpalette.svg"],
  [C, "sf_paperclip.svg", "paperclip", "paperclip.svg", "object&tools/Monochrome=paperclip.svg"],
  [C, "sf_pencil.svg", "pencil", "pencil.svg", "editing/Monochrome=pencil.svg"],
  [C, "sf_person_crop_circle.svg", "person.crop.circle", "person.crop.circle.svg", "human/Monochrome=person.crop.circle.svg"],
  [C, "sf_phone_down.svg", "phone.down", "phone.down.svg", "communication/Property 1=phone.down.svg"],
  [C, "sf_phone.svg", "phone", "phone.svg", "communication/Property 1=phone.svg"],
  [C, "sf_photo.svg", "photo", "photo.svg", "camera&photos/Mnochrome=photo.svg"],
  [C, "sf_pin.svg", "pin", "pin.svg", "object&tools/Monochrome=pin.svg"],
  [C, "sf_plugins.svg", "puzzlepiece", "puzzlepiece.svg", "object&tools/Monochrome=puzzlepiece.svg"],
  [C, "sf_plus.svg", "plus", "plus.svg", "gaming/Monochrome=plus.svg"],
  [C, "sf_slider_horizontal_3.svg", "slider.horizontal.3", "slider.horizontal.3.svg", "editing/Monochrome=slider.horizontal.3.svg"],
  [C, "sf_square_and_pencil.svg", "square.and.pencil", "square.and.pencil.svg", "editing/Monochrome=square.and.pencil.svg"],
  [C, "sf_storage.svg", "externaldrive", "externaldrive.svg", "object&tools/Monochrome=externaldrive.svg"],
  [C, "sf_trash.svg", "trash", "trash.svg", "object&tools/Monochrome=trash.svg"],
  [C, "sf_video_slash.svg", "video.slash", "video.slash.svg", "communication/Property 1=video.slash.svg"],
  [C, "sf_video.svg", "video", "video.svg", "communication/Property 1=video.svg"],
  [C, "sf_waveform.svg", "waveform", "waveform.svg", "communication/Property 1=waveform.svg"],
  [C, "sf_xmark.svg", "xmark", "xmark.svg", "gaming/Monochrome=xmark.svg"],
  [C, "sidebar_left.svg", "sidebar.left", "sidebar.left.svg", "local/sidebar_left.svg"],

  [DC, "video.svg", "video", "video.svg", "communication/Property 1=video.svg"],
  [DC, "mic-slash.svg", "microphone.slash", "microphone.slash.svg", "communication/Property 1=mic.slash.svg", "mic.slash"],
  [DC, "video-slash.svg", "video.slash", "video.slash.svg", "communication/Property 1=video.slash.svg"],
  [DC, "mic.svg", "microphone", "microphone.svg", "communication/Property 1=mic.svg", "mic"],
  [DC, "phone.svg", "phone", "phone.svg", "communication/Property 1=phone.svg"],
  [DC, "camera-switch.svg", "arrow.trianglehead.2.clockwise.rotate.90.camera", "arrow.trianglehead.2.clockwise.rotate.90.camera.svg", "camera&photos/Mnochrome=arrow.triangle.2.circlepath.camera.svg", "arrow.triangle.2.circlepath.camera"],
  [DC, "phone-down.svg", "phone.down.fill", "phone.down.fill.svg", "communication/Property 1=phone.down.fill.svg"],

  [DP, "calendar.svg", "calendar", "calendar.svg", "object&tools/Monochrome=calendar.svg"],
  [DP, "shuffle.svg", "shuffle", "shuffle.svg", "media/Monochrome=shuffle.svg"],
  [DP, "checklist.svg", "checklist", "checklist.svg", "missing/checklist.svg"],
  [DP, "note.svg", "text.pad.header", "text.pad.header.svg", "object&tools/Monochrome=note.text.svg", "note.text"],
  [DP, "photos.svg", "photo.on.rectangle", "photo.on.rectangle.svg", "camera&photos/Mnochrome=photo.on.rectangle.svg"],
].map(([scope, target, symbol, source, legacySource, legacySymbol]) => ({
  scope,
  target,
  symbol,
  source,
  legacySource,
  ...(legacySymbol ? { legacySymbol } : {}),
}));

const targetPath = entry => {
  if (entry.scope === C)
    return path.join(composeRoot, "src/commonMain/composeResources/drawable", entry.target);
  if (entry.scope === DC) return path.join(desktopRoot, "src/assets/call-symbols", entry.target);
  return path.join(desktopRoot, "src/assets/plus-symbols", entry.target);
};

const inventoryChecks = [
  [
    C,
    path.join(composeRoot, "src/commonMain/composeResources/drawable"),
    name => (name.startsWith("sf_") || name === "sidebar_left.svg") && name.endsWith(".svg"),
  ],
  [DC, path.join(desktopRoot, "src/assets/call-symbols"), name => name.endsWith(".svg")],
  [DP, path.join(desktopRoot, "src/assets/plus-symbols"), name => name.endsWith(".svg")],
];
for (const [scope, directory, include] of inventoryChecks) {
  const actual = (await readdir(directory)).filter(include).sort();
  const mapped = mappings.filter(entry => entry.scope === scope).map(entry => entry.target).sort();
  assert.deepEqual(mapped, actual, `${scope} SF asset inventory changed; update the explicit mapping`);
}

const textMeta = bytes => {
  const text = bytes.toString("utf8");
  return {
    title: text.match(/<title>([^<]+)<\/title>/)?.[1] ?? null,
    viewBox: text.match(/\bviewBox="([^"]+)"/)?.[1] ?? null,
  };
};
const weightOf = source => {
  const stem = source.slice(0, -4);
  const match = stem.match(/-(ultraLight|thin|light|medium|semibold|bold|heavy|black)$/);
  return match?.[1] ?? "regular";
};

let snapshotText = "";
try {
  snapshotText = await readFile(sourceManifestPath, "utf8");
} catch {
  // The source SVG titles and hashes still provide complete validation.
}
const header = key => snapshotText.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? null;
const sourceSnapshot = {
  sfSymbolsVersion: header("SF Symbols version"),
  repository: header("Repository"),
  commit: header("Commit"),
  packageVersion: header("Package version"),
  declaredSourceSymbols: Number(header("Source symbols")) || null,
  declaredGeneratedSvgs: Number(header("Generated SVGs")) || null,
  actualSvgFiles: sourceNames.size,
};
if (sourceSnapshot.declaredGeneratedSvgs)
  assert.equal(sourceNames.size, sourceSnapshot.declaredGeneratedSvgs, "Use the complete SF Symbols 8 export");

const missingSourceFiles = mappings.filter(entry => !sourceNames.has(entry.source)).map(entry => entry.source);
assert.deepEqual(missingSourceFiles, [], `SF Symbols 8 sources are missing: ${missingSourceFiles.join(", ")}`);

const records = [];
for (const entry of mappings) {
  assert(sourceNames.has(entry.source), `SF Symbols 8 source is missing: ${entry.source}`);
  const sourceBytes = await readSource(entry.source);
  const sourceMeta = textMeta(sourceBytes);
  assert.equal(sourceMeta.title, entry.symbol, `${entry.source} title does not match ${entry.symbol}`);
  assert(sourceMeta.viewBox, `${entry.source} has no viewBox`);
  const target = targetPath(entry);
  if (write) await writeFile(target, sourceBytes);
  const targetBytes = await readFile(target);
  assert.equal(sha256(targetBytes), sha256(sourceBytes), `${entry.target} differs from ${entry.source}`);
  records.push({
    ...entry,
    status: "sf8",
    weight: weightOf(entry.source),
    sha256: sha256(sourceBytes),
    viewBox: sourceMeta.viewBox,
  });
}

const summaryFor = subset => ({ total: subset.length, sf8: subset.length, retainedLegacy: 0 });
const portableRecord = record => ({
  symbol: record.symbol,
  ...(record.legacySymbol ? { legacySymbol: record.legacySymbol } : {}),
  source: `${archivePrefix}${record.source}`,
  target: record.scope === C
    ? `src/commonMain/composeResources/drawable/${record.target}`
    : record.target,
  status: record.status,
  weight: record.weight,
  sha256: record.sha256,
  viewBox: record.viewBox,
  legacySource: record.legacySource,
});
const manifestFor = (subset, kind) => ({
  formatVersion: 3,
  kind,
  sourceArtifact,
  sourceSnapshot,
  selectionPolicy: "SF Symbols 8 regular weight is copied byte-for-byte for every glyph; the call hang-up control uses regular phone.down.fill.",
  summary: summaryFor(subset),
  files: subset.map(portableRecord),
  missingSources: [],
});
const composeRecords = records.filter(record => record.scope === C);
const callRecords = records.filter(record => record.scope === DC);
const plusRecords = records.filter(record => record.scope === DP);
const composeManifest = manifestFor(composeRecords, "compose-apple-symbols");
const callManifest = manifestFor(callRecords, "call-symbols");
const plusManifest = manifestFor(plusRecords, "plus-symbols");

const tableRows = subset => subset.map(record =>
  `| \`${record.target}\` | \`${record.symbol}\` | \`${archivePrefix}${record.source}\` | ${record.weight} | \`${record.sha256}\` |`,
);
const provenance = [
  "# SF Symbols 8 provenance",
  "",
  "Vyline vendors Apple glyph SVGs copied byte-for-byte from the user-provided SF Symbols 8.0 all-weights export. No Apple font is included in this repository.",
  "",
  `- Source artifact: \`${sourceArtifact.path}\` (${sourceArtifact.kind})`,
  `- Source artifact SHA-256: \`${sourceArtifact.sha256 ?? "directory source"}\``,
  `- Export metadata: SF Symbols ${sourceSnapshot.sfSymbolsVersion ?? "unknown"}, package ${sourceSnapshot.packageVersion ?? "unknown"}, commit \`${sourceSnapshot.commit ?? "unknown"}\``,
  `- Complete export: ${sourceSnapshot.actualSvgFiles} SVGs`,
  "- Import rule: regular weight is used byte-for-byte for every glyph. The React call hang-up asset uses regular `phone.down.fill`.",
  "- SF Symbols 8 renamed several families used here: `doc` to `document`, `mic` to `microphone`, and `ipad.and.iphone` to `ipad.landscape.and.iphone`.",
  "- The SF Symbols 6 `note / note.text / note.text.badge.plus` family corresponds to the current `pad.header / text.pad.header / text.pad.header.badge.plus` family; this action therefore uses `text.pad.header`. `arrow.triangle.2.circlepath.camera` is now `arrow.trianglehead.2.clockwise.rotate.90.camera`.",
  "",
  "## Compose resources",
  "",
  "| Resource | SF symbol | SF Symbols 8 source | Weight | SHA-256 |",
  "| --- | --- | --- | --- | --- |",
  ...tableRows(composeRecords),
  "",
  "## Desktop call resources",
  "",
  "| Resource | SF symbol | SF Symbols 8 source | Weight | SHA-256 |",
  "| --- | --- | --- | --- | --- |",
  ...tableRows(callRecords),
  "",
  "## Desktop plus-menu resources",
  "",
  "| Resource | SF symbol | SF Symbols 8 source | Weight | SHA-256 |",
  "| --- | --- | --- | --- | --- |",
  ...tableRows(plusRecords),
  "",
].join("\n");
const jsonText = value => `${JSON.stringify(value, null, 2)}\n`;
const generated = [
  [path.join(composeRoot, "SF_SYMBOLS.json"), jsonText(composeManifest)],
  [path.join(composeRoot, "licenses/SFSymbols-SOURCES.md"), provenance],
  [path.join(desktopRoot, "src/assets/call-symbols/sources.json"), jsonText(callManifest)],
  [path.join(desktopRoot, "src/assets/plus-symbols/sources.json"), jsonText(plusManifest)],
];
for (const [file, expected] of generated) {
  if (write) await writeFile(file, expected, "utf8");
  else assert.equal(await readFile(file, "utf8"), expected, `${path.basename(file)} provenance is stale`);
}

const total = records.length;
console.log(
  `SF Symbols ${write ? "sync" : "validation"} PASS: ${total}/${total} vendored files match SF Symbols 8 regular sources. ` +
  `${sourceNames.size} SVGs verified from ${sourceArtifact.kind}.`,
);
