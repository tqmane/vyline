import { describe, expect, test } from "bun:test";
import { CHAT_PANE_DRAG_TYPE } from "@/lib/chatPanes";
import {
  detectFileMediaKind,
  fileExtensionLabel,
  formatFileSize,
  hasVisualMediaFiles,
  isExternalFileDrag,
} from "@/lib/fileDrop";

describe("fileDrop", () => {
  test("isExternalFileDrag accepts Files and rejects internal pane/sticker drags", () => {
    expect(isExternalFileDrag({ types: ["Files"] })).toBe(true);
    expect(isExternalFileDrag({ types: ["Files", "text/uri-list"] })).toBe(true);
    expect(isExternalFileDrag({ types: [CHAT_PANE_DRAG_TYPE, "Files"] })).toBe(false);
    expect(isExternalFileDrag({ types: ["application/x-vyline-sticker", "Files"] })).toBe(false);
    expect(isExternalFileDrag({ types: ["text/plain"] })).toBe(false);
    expect(isExternalFileDrag(null)).toBe(false);
  });

  test("detectFileMediaKind classifies MIME types, empty-MIME extensions, and forceFile", () => {
    expect(detectFileMediaKind({ name: "photo.jpg", type: "image/jpeg" })).toBe("image");
    expect(detectFileMediaKind({ name: "clip.mp4", type: "video/mp4" })).toBe("video");
    expect(detectFileMediaKind({ name: "report.pdf", type: "application/pdf" })).toBe("file");

    expect(detectFileMediaKind({ name: "screen.PNG", type: "" })).toBe("image");
    expect(detectFileMediaKind({ name: "movie.mkv", type: "application/octet-stream" })).toBe("video");
    expect(detectFileMediaKind({ name: "archive.zip", type: "" })).toBe("file");

    expect(detectFileMediaKind({ name: "photo.jpg", type: "image/jpeg" }, true)).toBe("file");
  });

  test("hasVisualMediaFiles detects whether any visual media exists", () => {
    expect(hasVisualMediaFiles([{ name: "doc.pdf", type: "application/pdf" }])).toBe(false);
    expect(
      hasVisualMediaFiles([
        { name: "doc.pdf", type: "application/pdf" },
        { name: "pic.webp", type: "" },
      ]),
    ).toBe(true);
  });

  test("formatFileSize and fileExtensionLabel format human readable metadata", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe("3.5 MB");

    expect(fileExtensionLabel("notes.markdown")).toBe("MARKD");
    expect(fileExtensionLabel("photo.png")).toBe("PNG");
    expect(fileExtensionLabel("README")).toBe("FILE");
  });
});
