import { ActionDialog } from "@/components/action-dialog";

const button = "min-h-11 rounded-lg border border-[var(--vy-border)] px-4 text-sm";

export function RecordingActionConfirmation({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ActionDialog title={title} onClose={onCancel}>
      <p className="whitespace-pre-line">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={button} onClick={onCancel}>
          キャンセル
        </button>
        <button
          type="button"
          className={`${button} ${
            danger
              ? "border-[var(--vy-danger)] bg-[var(--vy-danger)] text-white"
              : "bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)]"
          }`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </ActionDialog>
  );
}
