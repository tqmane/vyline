import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ActionDialog } from "@/components/action-dialog";
import { useControllerPortalTarget } from "@/ui/native-controller-surface";

interface EditMessageDialogProps {
  initialText: string;
  onSave: (newText: string) => Promise<void> | void;
  onClose: () => void;
}

export function EditMessageDialog({ initialText, onSave, onClose }: EditMessageDialogProps) {
  const controllerTarget = useControllerPortalTarget();
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // マウント時にテキストエリアをフォーカスし末尾にカーソルを合わせる
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed === initialText.trim() || saving) return;
    try {
      setSaving(true);
      await onSave(trimmed);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    // Ctrl+Enter or Cmd+Enter or Enter (without Shift if preferred)
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      void handleSave();
    }
  };

  const hasChanged = text.trim().length > 0 && text.trim() !== initialText.trim();

  if (typeof document === "undefined") return null;

  return createPortal(
    <ActionDialog title="メッセージを編集" onClose={onClose}>
      <div>
        <label htmlFor="edit-message-input" className="sr-only">
          編集後のメッセージ
        </label>
        <textarea
          id="edit-message-input"
          ref={textareaRef}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力…"
          className="vy-scroll max-h-60 w-full resize-y rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3 text-sm leading-relaxed text-[var(--vy-text)] outline-none transition-all placeholder:text-[var(--vy-text-dim)] focus:border-[var(--vy-accent)] focus:ring-1 focus:ring-[var(--vy-accent)]"
        />

        <div className="mt-2 flex items-center justify-between text-xs text-[var(--vy-text-dim)]">
          <span>Enter / Ctrl+Enter で保存 · Esc でキャンセル</span>
          <span>{text.length} 文字</span>
        </div>
      </div>

      {/* フッター */}
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--vy-border)] pt-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-xl px-4 py-2 text-xs font-medium text-[var(--vy-text)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] disabled:opacity-50"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanged || saving}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium text-[var(--vy-accent-contrast)] transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--vy-accent)" }}
        >
          {saving ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span>保存中…</span>
            </>
          ) : (
            <span>保存する</span>
          )}
        </button>
      </div>
    </ActionDialog>,
    controllerTarget ?? document.body,
  );
}
