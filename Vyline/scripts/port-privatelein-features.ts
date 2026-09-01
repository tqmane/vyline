import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repositoryRoot = process.cwd();
const changed = new Set<string>();

function lines(...values: string[]): string {
  return values.join("\n");
}

function absolute(relativePath: string): string {
  return resolve(repositoryRoot, relativePath);
}

function read(relativePath: string): string {
  return readFileSync(absolute(relativePath), "utf8");
}

function write(relativePath: string, content: string): void {
  const target = absolute(relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  changed.add(relativePath);
}

function replaceOnce(relativePath: string, before: string, after: string): void {
  const content = read(relativePath);
  if (content.includes(after)) return;
  const occurrences = content.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${relativePath}: expected one replacement target, found ${occurrences}`);
  }
  write(relativePath, content.replace(before, after));
}

function appendOnce(relativePath: string, marker: string, addition: string): void {
  const content = read(relativePath);
  if (content.includes(marker)) return;
  write(relativePath, `${content.trimEnd()}\n\n${addition.trim()}\n`);
}

function writeGenerated(relativePath: string, content: string): void {
  const normalized = `${content.trim()}\n`;
  if (readFileSync(absolute(relativePath), { encoding: "utf8", flag: "a+" }) === normalized) return;
  write(relativePath, normalized);
}

const interactionEnvironmentPath =
  "Vyline/apps/desktop/src/lib/interactionEnvironment.ts";
replaceOnce(
  interactionEnvironmentPath,
  "export function getInteractionMode(): InteractionMode {",
  lines(
    "export type SubmitMessageInputOptions = {",
    "  key: string;",
    "  shiftKey: boolean;",
    "  ctrlKey: boolean;",
    "  metaKey: boolean;",
    "  composing: boolean;",
    "  enterToSend: boolean;",
    "  mode: InteractionMode;",
    "};",
    "",
    "/**",
    " * LINE Android の CHATROOM_ENTER_SEND と同じ選択を Web 入力へ反映する。",
    " * モバイルではソフトウェアキーボードの Enter を常に改行として扱う。",
    " */",
    "export function shouldSubmitMessageInput({",
    "  key,",
    "  shiftKey,",
    "  ctrlKey,",
    "  metaKey,",
    "  composing,",
    "  enterToSend,",
    "  mode,",
    "}: SubmitMessageInputOptions): boolean {",
    "  if (key !== \"Enter\" || composing || mode !== \"desktop\") return false;",
    "  if (enterToSend) return !shiftKey;",
    "  return ctrlKey || metaKey;",
    "}",
    "",
    "export function getInteractionMode(): InteractionMode {",
  ),
);

const interactionEnvironmentTestPath =
  "Vyline/apps/desktop/src/lib/interactionEnvironment.test.ts";
replaceOnce(
  interactionEnvironmentTestPath,
  'import { interactionModeFromUserAgent } from "./interactionEnvironment";',
  lines(
    'import {',
    '  interactionModeFromUserAgent,',
    '  shouldSubmitMessageInput,',
    '} from "./interactionEnvironment";',
  ),
);
appendOnce(
  interactionEnvironmentTestPath,
  'describe("shouldSubmitMessageInput"',
  lines(
    'describe("shouldSubmitMessageInput", () => {',
    '  const desktopEnter = {',
    '    key: "Enter",',
    '    shiftKey: false,',
    '    ctrlKey: false,',
    '    metaKey: false,',
    '    composing: false,',
    '    enterToSend: true,',
    '    mode: "desktop",',
    '  } as const;',
    '',
    '  it("sends with Enter and keeps Shift+Enter as a newline when enabled", () => {',
    '    expect(shouldSubmitMessageInput(desktopEnter)).toBe(true);',
    '    expect(shouldSubmitMessageInput({ ...desktopEnter, shiftKey: true })).toBe(false);',
    '  });',
    '',
    '  it("uses Ctrl/Cmd+Enter when Enter-to-send is disabled", () => {',
    '    expect(shouldSubmitMessageInput({ ...desktopEnter, enterToSend: false })).toBe(false);',
    '    expect(',
    '      shouldSubmitMessageInput({ ...desktopEnter, enterToSend: false, ctrlKey: true }),',
    '    ).toBe(true);',
    '    expect(',
    '      shouldSubmitMessageInput({ ...desktopEnter, enterToSend: false, metaKey: true }),',
    '    ).toBe(true);',
    '  });',
    '',
    '  it("never submits mobile Enter or an IME composition", () => {',
    '    expect(shouldSubmitMessageInput({ ...desktopEnter, mode: "mobile" })).toBe(false);',
    '    expect(shouldSubmitMessageInput({ ...desktopEnter, composing: true })).toBe(false);',
    '  });',
    '});',
  ),
);

const messageInputPath = "Vyline/apps/desktop/src/components/message-input.tsx";
replaceOnce(
  messageInputPath,
  'import { isDesktopInteraction } from "@/lib/interactionEnvironment";',
  lines(
    'import {',
    '  isDesktopInteraction,',
    '  shouldSubmitMessageInput,',
    '} from "@/lib/interactionEnvironment";',
  ),
);
replaceOnce(
  messageInputPath,
  lines(
    "  const agentEnabled = useStore((s) => s.settings.betaAgentI);",
    "  const replyToId = useStore((s) => s.replyToId);",
  ),
  lines(
    "  const agentEnabled = useStore((s) => s.settings.betaAgentI);",
    "  const enterToSend = useStore((s) => s.settings.enterToSend);",
    "  const replyToId = useStore((s) => s.replyToId);",
  ),
);
replaceOnce(
  messageInputPath,
  lines(
    "    // Operation semantics are UA-driven. Layout continues to be width/media-query driven.",
    "    // Mobile (Android/iPhone/iPad): Enter is always a newline.",
    "    // Desktop (Windows/macOS/Linux): Enter sends, Shift+Enter inserts a newline.",
    '    if (e.key === "Enter" && !e.shiftKey && isDesktopInteraction() && !composing) {',
    "      e.preventDefault();",
    "      if (!draft.trim() && pendingMedia.length > 0) {",
    "        void sendPendingMedia();",
    "        return;",
    "      }",
    "      send();",
    "    }",
  ),
  lines(
    "    // LINE Android の CHATROOM_ENTER_SEND と同じ選択をデスクトップ入力へ反映する。",
    "    // モバイルでは Enter を常に改行として扱う。",
    "    if (",
    "      shouldSubmitMessageInput({",
    "        key: e.key,",
    "        shiftKey: e.shiftKey,",
    "        ctrlKey: e.ctrlKey,",
    "        metaKey: e.metaKey,",
    "        composing,",
    "        enterToSend,",
    '        mode: isDesktopInteraction() ? "desktop" : "mobile",',
    "      })",
    "    ) {",
    "      e.preventDefault();",
    "      if (!draft.trim() && pendingMedia.length > 0) {",
    "        void sendPendingMedia();",
    "        return;",
    "      }",
    "      send();",
    "    }",
  ),
);

const settingsSectionsPath =
  "Vyline/apps/desktop/src/components/settings-sections.tsx";
replaceOnce(
  settingsSectionsPath,
  lines(
    '                    <Row',
    '                      title="ステータスメッセージ表示"',
    '                      desc="トークヘッダーに相手のステータスメッセージを表示します"',
  ),
  lines(
    '                    <Row',
    '                      title="Enterで送信"',
    '                      desc={',
    '                        desktopInteraction',
    '                          ? "ON: Enterで送信、Shift+Enterで改行。OFF: Enterで改行、Ctrl/Cmd+Enterで送信します"',
    '                          : "PC版の入力動作です。スマホ・タブレットではEnterは常に改行します"',
    '                      }',
    '                    >',
    '                      <Toggle',
    '                        checked={settings.enterToSend}',
    '                        onChange={(v) => updateSetting("enterToSend", v)}',
    '                        label="Enterで送信"',
    '                      />',
    '                    </Row>',
    '                    <Row',
    '                      title="ステータスメッセージ表示"',
    '                      desc="トークヘッダーに相手のステータスメッセージを表示します"',
  ),
);

writeGenerated(
  "Vyline/apps/desktop/src/lib/mediaDownloadFilename.ts",
  lines(
    'const INVALID_FILENAME_CHARS = /[\\\\/:*?"<>|\\u0000-\\u001f]/g;',
    'const MAX_FILENAME_BASE_LENGTH = 180;',
    '',
    'function pad(value: number): string {',
    '  return String(value).padStart(2, "0");',
    '}',
    '',
    'export function formatMediaDownloadTime(timestamp: number): string {',
    '  const date = new Date(timestamp);',
    '  if (!Number.isFinite(date.getTime())) return "unknown-time";',
    '  return [',
    '    date.getFullYear(),',
    '    pad(date.getMonth() + 1),',
    '    pad(date.getDate()),',
    '    pad(date.getHours()),',
    '    pad(date.getMinutes()),',
    '  ].join("-");',
    '}',
    '',
    'export function sanitizeDownloadFilenameBase(value: string, fallback: string): string {',
    '  const sanitized = value',
    '    .replace(INVALID_FILENAME_CHARS, "_")',
    '    .replace(/\\s+/g, " ")',
    '    .trim()',
    '    .replace(/[. ]+$/g, "")',
    '    .slice(0, MAX_FILENAME_BASE_LENGTH);',
    '  return sanitized || fallback;',
    '}',
    '',
    'export function buildDescriptiveMediaFilename({',
    '  senderName,',
    '  createdAt,',
    '  chatName,',
    '  messageId,',
    '  extension,',
    '}: {',
    '  senderName?: string;',
    '  createdAt: number;',
    '  chatName?: string;',
    '  messageId: string;',
    '  extension: "jpg" | "mp4" | "png" | "webp";',
    '}): string {',
    '  const rawBase = [',
    '    senderName?.trim() || "Unknown",',
    '    formatMediaDownloadTime(createdAt),',
    '    chatName?.trim() || "Unknown",',
    '  ].join("-");',
    '  const base = sanitizeDownloadFilenameBase(rawBase, `vyline_${messageId}`);',
    '  return `${base}.${extension}`;',
    '}',
  ),
);

writeGenerated(
  "Vyline/apps/desktop/src/lib/mediaDownloadFilename.test.ts",
  lines(
    'import { describe, expect, it } from "bun:test";',
    'import { buildDescriptiveMediaFilename } from "./mediaDownloadFilename";',
    '',
    'describe("buildDescriptiveMediaFilename", () => {',
    '  it("uses the PrivateLEIN sender-time-talk ordering", () => {',
    '    const createdAt = new Date(2026, 8, 1, 9, 7).getTime();',
    '    expect(',
    '      buildDescriptiveMediaFilename({',
    '        senderName: "Alice",',
    '        createdAt,',
    '        chatName: "Test Group",',
    '        messageId: "m1",',
    '        extension: "jpg",',
    '      }),',
    '    ).toBe("Alice-2026-09-01-09-07-Test Group.jpg");',
    '  });',
    '',
    '  it("replaces Windows-invalid filename characters", () => {',
    '    const createdAt = new Date(2026, 8, 1, 9, 7).getTime();',
    '    expect(',
    '      buildDescriptiveMediaFilename({',
    '        senderName: "A/B",',
    '        createdAt,',
    '        chatName: "Talk:*?",',
    '        messageId: "m2",',
    '        extension: "mp4",',
    '      }),',
    '    ).toBe("A_B-2026-09-01-09-07-Talk___.mp4");',
    '  });',
    '});',
  ),
);

writeGenerated(
  "Vyline/apps/desktop/src/lib/messageContextDetails.ts",
  lines(
    'export function buildMessageContextDetails({',
    '  messageId,',
    '  chatId,',
    '  chatName,',
    '  senderMid,',
    '  senderName,',
    '  createdAt,',
    '  direction,',
    '  kind,',
    '}: {',
    '  messageId: string;',
    '  chatId: string;',
    '  chatName?: string;',
    '  senderMid?: string;',
    '  senderName?: string;',
    '  createdAt: number;',
    '  direction: "incoming" | "outgoing";',
    '  kind: string;',
    '}): string {',
    '  const date = new Date(createdAt);',
    '  const createdAtLabel = Number.isFinite(date.getTime())',
    '    ? date.toISOString()',
    '    : String(createdAt);',
    '  return [',
    '    `Message ID: ${messageId}`,',
    '    `Chat ID: ${chatId}`,',
    '    ...(chatName ? [`Chat Name: ${chatName}`] : []),',
    '    ...(senderMid ? [`Sender MID: ${senderMid}`] : []),',
    '    ...(senderName ? [`Sender Name: ${senderName}`] : []),',
    '    `Created At: ${createdAtLabel}`,',
    '    `Direction: ${direction}`,',
    '    `Kind: ${kind}`,',
    '  ].join("\\n");',
    '}',
  ),
);

writeGenerated(
  "Vyline/apps/desktop/src/lib/messageContextDetails.test.ts",
  lines(
    'import { describe, expect, it } from "bun:test";',
    'import { buildMessageContextDetails } from "./messageContextDetails";',
    '',
    'describe("buildMessageContextDetails", () => {',
    '  it("emits stable copyable message identity fields", () => {',
    '    expect(',
    '      buildMessageContextDetails({',
    '        messageId: "m123",',
    '        chatId: "c456",',
    '        chatName: "Test",',
    '        senderMid: "u789",',
    '        senderName: "Alice",',
    '        createdAt: Date.UTC(2026, 8, 1, 0, 7),',
    '        direction: "incoming",',
    '        kind: "text",',
    '      }),',
    '    ).toBe(',
    '      [',
    '        "Message ID: m123",',
    '        "Chat ID: c456",',
    '        "Chat Name: Test",',
    '        "Sender MID: u789",',
    '        "Sender Name: Alice",',
    '        "Created At: 2026-09-01T00:07:00.000Z",',
    '        "Direction: incoming",',
    '        "Kind: text",',
    '      ].join("\\n"),',
    '    );',
    '  });',
    '});',
  ),
);

const messageBubblePath = "Vyline/apps/desktop/src/components/message-bubble.tsx";
replaceOnce(
  messageBubblePath,
  'import { isMobileInteraction } from "@/lib/interactionEnvironment";',
  lines(
    'import { isMobileInteraction } from "@/lib/interactionEnvironment";',
    'import { buildDescriptiveMediaFilename } from "@/lib/mediaDownloadFilename";',
    'import { buildMessageContextDetails } from "@/lib/messageContextDetails";',
  ),
);
replaceOnce(
  messageBubblePath,
  "    const author = chat.members?.find((m) => m.id === message.authorId);",
  lines(
    "    const author = chat.members?.find((m) => m.id === message.authorId);",
    "    const senderMid = isMe ? self.mid : message.authorId;",
    "    const downloadSenderName = isMe",
    "      ? self.name",
    "      : memberDisplayName(",
    '          author?.name ?? (chat.type === "friend" ? chat.name : message.authorId),',
    "          streamerMode,",
    "        );",
    '    const downloadChatName = streamerMode ? "トーク" : (chat.localName ?? chat.name);',
    "    const mediaDownloadFilename = buildDescriptiveMediaFilename({",
    "      senderName: downloadSenderName,",
    "      createdAt: message.createdAt,",
    "      chatName: downloadChatName,",
    "      messageId: message.id,",
    '      extension: message.kind === "video" ? "mp4" : "jpg",',
    "    });",
    "    const messageContextDetails = buildMessageContextDetails({",
    "      messageId: message.id,",
    "      chatId: chat.id,",
    "      chatName: downloadChatName,",
    "      senderMid,",
    "      senderName: downloadSenderName,",
    "      createdAt: message.createdAt,",
    '      direction: isMe ? "outgoing" : "incoming",',
    "      kind: message.kind,",
    "    });",
  ),
);
replaceOnce(
  messageBubblePath,
  lines(
    "        : []),",
    '      ...(message.kind === "sticker" && isStickerImageSrc(message.sticker)',
  ),
  lines(
    "        : []),",
    "      {",
    '        label: "メッセージ情報",',
    "        icon: <IconCopy size={16} />,","
    "        children: [",
    "          {",
    '            label: "詳細をコピー",',
    "            icon: <IconCopy size={16} />,","
    "            onClick: () => void copyText(messageContextDetails),",
    "          },",
    "          {",
    '            label: "メッセージIDをコピー",',
    "            icon: <IconCopy size={16} />,","
    "            onClick: () => void copyText(message.id),",
    "          },",
    "          {",
    '            label: "トークIDをコピー",',
    "            icon: <IconCopy size={16} />,","
    "            onClick: () => void copyText(chat.id),",
    "          },",
    "          ...(senderMid",
    "            ? [",
    "                {",
    '                  label: "送信者MIDをコピー",',
    "                  icon: <IconCopy size={16} />,","
    "                  onClick: () => void copyText(senderMid),",
    "                },",
    "              ]",
    "            : []),",
    "        ],",
    "      },",
    '      ...(message.kind === "sticker" && isStickerImageSrc(message.sticker)',
  ),
);
replaceOnce(
  messageBubblePath,
  lines(
    '      ...((message.kind === "image" || message.kind === "video") && message.imageSrc',
    "        ? [",
    "            {",
    '              label: message.kind === "video" ? "動画をダウンロード" : "画像をダウンロード",',
    "              icon: <IconDownload size={16} />,","
    "              onClick: () =>",
    "                downloadUrl(",
    '                  message.imageSrc!.replace(/preview=1/, "preview=0"),',
    '                  `vyline_${message.id}.${message.kind === "video" ? "mp4" : "jpg"}`,',
    "                ),",
    "            },",
    "          ]",
    "        : []),",
  ),
  lines(
    '      ...((message.kind === "image" || message.kind === "video") && message.imageSrc',
    "        ? [",
    "            {",
    '              label: message.kind === "video" ? "動画をダウンロード" : "画像をダウンロード",',
    "              icon: <IconDownload size={16} />,","
    "              children: [",
    "                {",
    '                  label: "通常の名前",',
    "                  icon: <IconDownload size={16} />,","
    "                  onClick: () =>",
    "                    downloadUrl(",
    '                      message.imageSrc!.replace(/preview=1/, "preview=0"),',
    '                      `vyline_${message.id}.${message.kind === "video" ? "mp4" : "jpg"}`,',
    "                    ),",
    "                },",
    "                {",
    '                  label: "送信者・日時・トーク名",',
    "                  icon: <IconDownload size={16} />,","
    "                  onClick: () =>",
    "                    downloadUrl(",
    '                      message.imageSrc!.replace(/preview=1/, "preview=0"),',
    "                      mediaDownloadFilename,",
    "                    ),",
    "                },",
    "              ],",
    "            },",
    "          ]",
    "        : []),",
  ),
);

console.log(`Updated ${changed.size} files:`);
for (const relativePath of [...changed].sort()) console.log(`- ${relativePath}`);
