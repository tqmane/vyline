import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Vyline ErrorBoundary]", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full min-h-dvh w-full items-center justify-center bg-[var(--vy-bg)] p-6 text-[var(--vy-text)]">
        <div className="w-full max-w-md rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-5 shadow-xl">
          <h2 className="text-base font-semibold">画面の表示中にエラーが発生しました</h2>
          <p className="mt-2 break-words rounded-xl bg-[var(--vy-surface-2)] p-3 font-mono text-xs text-[var(--vy-danger)]">
            {this.state.error.message || String(this.state.error)}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-full border border-[var(--vy-border)] px-4 py-1.5 text-xs font-medium text-[var(--vy-text)] transition-colors hover:bg-[var(--vy-surface-2)]"
            >
              再試行
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full bg-[var(--vy-accent)] px-4 py-1.5 text-xs font-semibold text-[var(--vy-accent-contrast)]"
            >
              再読み込み
            </button>
          </div>
        </div>
      </div>
    );
  }
}
