/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4 · component: compact path picker · existing VyTheme */
import { useEffect, useId, useRef, useState } from "react";
import type { RecordingPathSuggestions } from "@vyline/types";
import type { recordingClient, RecordingSettingsResponse } from "@/api/recordings";

export function RecordingPathInput({
  value,
  onChange,
  client,
  roots,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  client: ReturnType<typeof recordingClient>;
  roots: RecordingSettingsResponse["roots"];
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<
    RecordingPathSuggestions & { prefix: string; error?: string }
  >({
    prefix: "",
    items: roots.filter((root) => root.available).map((root) => root.path),
    truncated: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void client.paths(value, controller.signal).then(
        (paths) => {
          if (!controller.signal.aborted) setResult({ ...paths, prefix: value });
        },
        (error) => {
          if (!controller.signal.aborted)
            setResult({
              prefix: value,
              items: [],
              truncated: false,
              error: error instanceof Error ? error.message : "保存先の候補を取得できませんでした",
            });
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, value]);
  const current = result.prefix === value;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm">
        サーバー内の絶対パス
      </label>
      <input
        ref={input}
        id={id}
        aria-describedby={`${id}-status`}
        aria-invalid={current && !!result.error}
        aria-controls={`${id}-paths`}
        disabled={disabled}
        required
        maxLength={2048}
        autoComplete="off"
        className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 text-sm text-[var(--vy-text)] hover:bg-[var(--vy-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-text)] aria-[invalid=true]:border-[var(--vy-danger)] disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {current && result.items.length > 0 && (
        <ul
          id={`${id}-paths`}
          aria-label="フォルダー候補"
          className="max-h-44 overflow-y-auto rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] p-1"
        >
          {result.items.map((path) => (
            <li key={path}>
              <button
                type="button"
                disabled={disabled}
                title={path}
                aria-label={`保存先に選択: ${path}`}
                className="flex min-h-11 w-full min-w-0 items-center rounded-md px-3 text-left text-xs text-[var(--vy-text)] hover:bg-[var(--vy-surface-2)] active:bg-[var(--vy-surface-3)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--vy-text)] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  onChange(path);
                  input.current?.focus({ preventScroll: true });
                }}
              >
                <span className="max-w-[45%] shrink-0 truncate font-medium">
                  {path
                    .replace(/[\\/]$/, "")
                    .split(/[\\/]/)
                    .at(-1) || path}
                </span>
                <span className="ml-3 min-w-0 flex-1 truncate">{path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p
        id={`${id}-status`}
        role="status"
        className={`min-h-4 break-words text-xs ${current && result.error ? "text-[var(--vy-text)]" : "text-[var(--vy-text-dim)]"}`}
      >
        {!current
          ? "候補を確認中…"
          : (result.error ??
            (result.truncated
              ? "候補を一部表示しています。パスを続けて入力すると絞り込めます。"
              : result.items.length
                ? "入力に合うフォルダーを候補から選べます。"
                : "候補はありません。パスが正しい場合は、そのまま保存先を追加できます。"))}
      </p>
    </div>
  );
}
