from __future__ import annotations

from pathlib import Path
from textwrap import dedent

ROOT = Path.cwd()
changed: set[str] = set()


def snippet(value: str) -> str:
    return dedent(value).strip("\n")


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def write(relative_path: str, content: str) -> None:
    target = ROOT / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="\n")
    changed.add(relative_path)


def replace_once(relative_path: str, before: str, after: str) -> None:
    content = read(relative_path)
    if after in content:
        return
    occurrences = content.count(before)
    if occurrences != 1:
        raise RuntimeError(
            f"{relative_path}: expected one replacement target, found {occurrences}"
        )
    write(relative_path, content.replace(before, after, 1))


def append_once(relative_path: str, marker: str, addition: str) -> None:
    content = read(relative_path)
    if marker in content:
        return
    write(relative_path, f"{content.rstrip()}\n\n{addition.strip()}\n")


def write_generated(relative_path: str, content: str) -> None:
    normalized = f"{content.strip()}\n"
    target = ROOT / relative_path
    if target.exists() and target.read_text(encoding="utf-8") == normalized:
        return
    write(relative_path, normalized)


interaction_environment_path = (
    "Vyline/apps/desktop/src/lib/interactionEnvironment.ts"
)
replace_once(
    interaction_environment_path,
    "export function getInteractionMode(): InteractionMode {",
    snippet(
        """
        export type SubmitMessageInputOptions = {
          key: string;
          shiftKey: boolean;
          ctrlKey: boolean;
          metaKey: boolean;
          composing: boolean;
          enterToSend: boolean;
          mode: InteractionMode;
        };

        /**
         * LINE Android の CHATROOM_ENTER_SEND と同じ選択を Web 入力へ反映する。
         * モバイルではソフトウェアキーボードの Enter を常に改行として扱う。
         */
        export function shouldSubmitMessageInput({
          key,
          shiftKey,
          ctrlKey,
          metaKey,
          composing,
          enterToSend,
          mode,
        }: SubmitMessageInputOptions): boolean {
          if (key !== "Enter" || composing || mode !== "desktop") return false;
          if (enterToSend) return !shiftKey;
          return ctrlKey || metaKey;
        }

        export function getInteractionMode(): InteractionMode {
        """
    ),
)

interaction_environment_test_path = (
    "Vyline/apps/desktop/src/lib/interactionEnvironment.test.ts"
)
replace_once(
    interaction_environment_test_path,
    'import { interactionModeFromUserAgent } from "./interactionEnvironment";',
    snippet(
        """
        import {
          interactionModeFromUserAgent,
          shouldSubmitMessageInput,
        } from "./interactionEnvironment";
        """
    ),
)
append_once(
    interaction_environment_test_path,
    'describe("shouldSubmitMessageInput"',
    snippet(
        """
        describe("shouldSubmitMessageInput", () => {
          const desktopEnter = {
            key: "Enter",
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            composing: false,
            enterToSend: true,
            mode: "desktop",
          } as const;

          it("sends with Enter and keeps Shift+Enter as a newline when enabled", () => {
            expect(shouldSubmitMessageInput(desktopEnter)).toBe(true);
            expect(shouldSubmitMessageInput({ ...desktopEnter, shiftKey: true })).toBe(false);
          });

          it("uses Ctrl/Cmd+Enter when Enter-to-send is disabled", () => {
            expect(shouldSubmitMessageInput({ ...desktopEnter, enterToSend: false })).toBe(false);
            expect(
              shouldSubmitMessageInput({ ...desktopEnter, enterToSend: false, ctrlKey: true }),
            ).toBe(true);
            expect(
              shouldSubmitMessageInput({ ...desktopEnter, enterToSend: false, metaKey: true }),
            ).toBe(true);
          });

          it("never submits mobile Enter or an IME composition", () => {
            expect(shouldSubmitMessageInput({ ...desktopEnter, mode: "mobile" })).toBe(false);
            expect(shouldSubmitMessageInput({ ...desktopEnter, composing: true })).toBe(false);
          });
        });
        """
    ),
)

message_input_path = "Vyline/apps/desktop/src/components/message-input.tsx"
replace_once(
    message_input_path,
    'import { isDesktopInteraction } from "@/lib/interactionEnvironment";',
    snippet(
        """
        import {
          isDesktopInteraction,
          shouldSubmitMessageInput,
        } from "@/lib/interactionEnvironment";
        """
    ),
)
replace_once(
    message_input_path,
    snippet(
        """
          const agentEnabled = useStore((s) => s.settings.betaAgentI);
          const replyToId = useStore((s) => s.replyToId);
        """
    ),
    snippet(
        """
          const agentEnabled = useStore((s) => s.settings.betaAgentI);
          const enterToSend = useStore((s) => s.settings.enterToSend);
          const replyToId = useStore((s) => s.replyToId);
        """
    ),
)
replace_once(
    message_input_path,
    snippet(
        """
            // Operation semantics are UA-driven. Layout continues to be width/media-query driven.
            // Mobile (Android/iPhone/iPad): Enter is always a newline.
            // Desktop (Windows/macOS/Linux): Enter sends, Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey && isDesktopInteraction() && !composing) {
              e.preventDefault();
              if (!draft.trim() && pendingMedia.length > 0) {
                void sendPendingMedia();
                return;
              }
              send();
            }
        """
    ),
    snippet(
        """
            // LINE Android の CHATROOM_ENTER_SEND と同じ選択をデスクトップ入力へ反映する。
            // モバイルでは Enter を常に改行として扱う。
            if (
              shouldSubmitMessageInput({
                key: e.key,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                composing,
                enterToSend,
                mode: isDesktopInteraction() ? "desktop" : "mobile",
              })
            ) {
              e.preventDefault();
              if (!draft.trim() && pendingMedia.length > 0) {
                void sendPendingMedia();
                return;
              }
              send();
            }
        """
    ),
)

settings_sections_path = (
    "Vyline/apps/desktop/src/components/settings-sections.tsx"
)
replace_once(
    settings_sections_path,
    snippet(
        """
                    <Row
                      title="ステータスメッセージ表示"
                      desc="トークヘッダーに相手のステータスメッセージを表示します"
        """
    ),
    snippet(
        """
                    <Row
                      title="Enterで送信"
                      desc={
                        desktopInteraction
                          ? "ON: Enterで送信、Shift+Enterで改行。OFF: Enterで改行、Ctrl/Cmd+Enterで送信します"
                          : "PC版の入力動作です。スマホ・タブレットではEnterは常に改行します"
                      }
                    >
                      <Toggle
                        checked={settings.enterToSend}
                        onChange={(v) => updateSetting("enterToSend", v)}
                        label="Enterで送信"
                      />
                    </Row>
                    <Row
                      title="ステータスメッセージ表示"
                      desc="トークヘッダーに相手のステータスメッセージを表示します"
        """
    ),
)

write_generated(
    "Vyline/apps/desktop/src/lib/mediaDownloadFilename.ts",
    snippet(
        r'''
        const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
        const MAX_FILENAME_BASE_LENGTH = 180;

        function pad(value: number): string {
          return String(value).padStart(2, "0");
        }

        export function formatMediaDownloadTime(timestamp: number): string {
          const date = new Date(timestamp);
          if (!Number.isFinite(date.getTime())) return "unknown-time";
          return [
            date.getFullYear(),
            pad(date.getMonth() + 1),
            pad(date.getDate()),
            pad(date.getHours()),
            pad(date.getMinutes()),
          ].join("-");
        }

        export function sanitizeDownloadFilenameBase(value: string, fallback: string): string {
          const sanitized = value
            .replace(INVALID_FILENAME_CHARS, "_")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/[. ]+$/g, "")
            .slice(0, MAX_FILENAME_BASE_LENGTH);
          return sanitized || fallback;
        }

        export function buildDescriptiveMediaFilename({
          senderName,
          createdAt,
          chatName,
          messageId,
          extension,
        }: {
          senderName?: string;
          createdAt: number;
          chatName?: string;
          messageId: string;
          extension: "jpg" | "mp4" | "png" | "webp";
        }): string {
          const rawBase = [
            senderName?.trim() || "Unknown",
            formatMediaDownloadTime(createdAt),
            chatName?.trim() || "Unknown",
          ].join("-");
          const base = sanitizeDownloadFilenameBase(rawBase, `vyline_${messageId}`);
          return `${base}.${extension}`;
        }
        ''',
    ),
)

write_generated(
    "Vyline/apps/desktop/src/lib/mediaDownloadFilename.test.ts",
    snippet(
        """
        import { describe, expect, it } from "bun:test";
        import { buildDescriptiveMediaFilename } from "./mediaDownloadFilename";

        describe("buildDescriptiveMediaFilename", () => {
          it("uses the PrivateLEIN sender-time-talk ordering", () => {
            const createdAt = new Date(2026, 8, 1, 9, 7).getTime();
            expect(
              buildDescriptiveMediaFilename({
                senderName: "Alice",
                createdAt,
                chatName: "Test Group",
                messageId: "m1",
                extension: "jpg",
              }),
            ).toBe("Alice-2026-09-01-09-07-Test Group.jpg");
          });

          it("replaces Windows-invalid filename characters", () => {
            const createdAt = new Date(2026, 8, 1, 9, 7).getTime();
            expect(
              buildDescriptiveMediaFilename({
                senderName: "A/B",
                createdAt,
                chatName: "Talk:*?",
                messageId: "m2",
                extension: "mp4",
              }),
            ).toBe("A_B-2026-09-01-09-07-Talk___.mp4");
          });
        });
        """
    ),
)

write_generated(
    "Vyline/apps/desktop/src/lib/messageContextDetails.ts",
    snippet(
        """
        export function buildMessageContextDetails({
          messageId,
          chatId,
          chatName,
          senderMid,
          senderName,
          createdAt,
          direction,
          kind,
        }: {
          messageId: string;
          chatId: string;
          chatName?: string;
          senderMid?: string;
          senderName?: string;
          createdAt: number;
          direction: "incoming" | "outgoing";
          kind: string;
        }): string {
          const date = new Date(createdAt);
          const createdAtLabel = Number.isFinite(date.getTime())
            ? date.toISOString()
            : String(createdAt);
          return [
            `Message ID: ${messageId}`,
            `Chat ID: ${chatId}`,
            ...(chatName ? [`Chat Name: ${chatName}`] : []),
            ...(senderMid ? [`Sender MID: ${senderMid}`] : []),
            ...(senderName ? [`Sender Name: ${senderName}`] : []),
            `Created At: ${createdAtLabel}`,
            `Direction: ${direction}`,
            `Kind: ${kind}`,
          ].join("\n");
        }
        """
    ),
)

write_generated(
    "Vyline/apps/desktop/src/lib/messageContextDetails.test.ts",
    snippet(
        """
        import { describe, expect, it } from "bun:test";
        import { buildMessageContextDetails } from "./messageContextDetails";

        describe("buildMessageContextDetails", () => {
          it("emits stable copyable message identity fields", () => {
            expect(
              buildMessageContextDetails({
                messageId: "m123",
                chatId: "c456",
                chatName: "Test",
                senderMid: "u789",
                senderName: "Alice",
                createdAt: Date.UTC(2026, 8, 1, 0, 7),
                direction: "incoming",
                kind: "text",
              }),
            ).toBe(
              [
                "Message ID: m123",
                "Chat ID: c456",
                "Chat Name: Test",
                "Sender MID: u789",
                "Sender Name: Alice",
                "Created At: 2026-09-01T00:07:00.000Z",
                "Direction: incoming",
                "Kind: text",
              ].join("\n"),
            );
          });
        });
        """
    ),
)

message_bubble_path = "Vyline/apps/desktop/src/components/message-bubble.tsx"
replace_once(
    message_bubble_path,
    'import { isMobileInteraction } from "@/lib/interactionEnvironment";',
    snippet(
        """
        import { isMobileInteraction } from "@/lib/interactionEnvironment";
        import { buildDescriptiveMediaFilename } from "@/lib/mediaDownloadFilename";
        import { buildMessageContextDetails } from "@/lib/messageContextDetails";
        """
    ),
)
replace_once(
    message_bubble_path,
    "    const author = chat.members?.find((m) => m.id === message.authorId);",
    snippet(
        """
            const author = chat.members?.find((m) => m.id === message.authorId);
            const senderMid = isMe ? self.mid : message.authorId;
            const downloadSenderName = isMe
              ? self.name
              : memberDisplayName(
                  author?.name ?? (chat.type === "friend" ? chat.name : message.authorId),
                  streamerMode,
                );
            const downloadChatName = streamerMode ? "トーク" : (chat.localName ?? chat.name);
            const mediaDownloadFilename = buildDescriptiveMediaFilename({
              senderName: downloadSenderName,
              createdAt: message.createdAt,
              chatName: downloadChatName,
              messageId: message.id,
              extension: message.kind === "video" ? "mp4" : "jpg",
            });
            const messageContextDetails = buildMessageContextDetails({
              messageId: message.id,
              chatId: chat.id,
              chatName: downloadChatName,
              senderMid,
              senderName: downloadSenderName,
              createdAt: message.createdAt,
              direction: isMe ? "outgoing" : "incoming",
              kind: message.kind,
            });
        """
    ),
)
replace_once(
    message_bubble_path,
    snippet(
        """
                : []),
              ...(message.kind === "sticker" && isStickerImageSrc(message.sticker)
        """
    ),
    snippet(
        """
                : []),
              {
                label: "メッセージ情報",
                icon: <IconCopy size={16} />,
                children: [
                  {
                    label: "詳細をコピー",
                    icon: <IconCopy size={16} />,
                    onClick: () => void copyText(messageContextDetails),
                  },
                  {
                    label: "メッセージIDをコピー",
                    icon: <IconCopy size={16} />,
                    onClick: () => void copyText(message.id),
                  },
                  {
                    label: "トークIDをコピー",
                    icon: <IconCopy size={16} />,
                    onClick: () => void copyText(chat.id),
                  },
                  ...(senderMid
                    ? [
                        {
                          label: "送信者MIDをコピー",
                          icon: <IconCopy size={16} />,
                          onClick: () => void copyText(senderMid),
                        },
                      ]
                    : []),
                ],
              },
              ...(message.kind === "sticker" && isStickerImageSrc(message.sticker)
        """
    ),
)
replace_once(
    message_bubble_path,
    snippet(
        """
              ...((message.kind === "image" || message.kind === "video") && message.imageSrc
                ? [
                    {
                      label: message.kind === "video" ? "動画をダウンロード" : "画像をダウンロード",
                      icon: <IconDownload size={16} />,
                      onClick: () =>
                        downloadUrl(
                          message.imageSrc!.replace(/preview=1/, "preview=0"),
                          `vyline_${message.id}.${message.kind === "video" ? "mp4" : "jpg"}`,
                        ),
                    },
                  ]
                : []),
        """
    ),
    snippet(
        """
              ...((message.kind === "image" || message.kind === "video") && message.imageSrc
                ? [
                    {
                      label: message.kind === "video" ? "動画をダウンロード" : "画像をダウンロード",
                      icon: <IconDownload size={16} />,
                      children: [
                        {
                          label: "通常の名前",
                          icon: <IconDownload size={16} />,
                          onClick: () =>
                            downloadUrl(
                              message.imageSrc!.replace(/preview=1/, "preview=0"),
                              `vyline_${message.id}.${message.kind === "video" ? "mp4" : "jpg"}`,
                            ),
                        },
                        {
                          label: "送信者・日時・トーク名",
                          icon: <IconDownload size={16} />,
                          onClick: () =>
                            downloadUrl(
                              message.imageSrc!.replace(/preview=1/, "preview=0"),
                              mediaDownloadFilename,
                            ),
                        },
                      ],
                    },
                  ]
                : []),
        """
    ),
)

print(f"Updated {len(changed)} files:")
for relative_path in sorted(changed):
    print(f"- {relative_path}")
