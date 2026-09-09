import type { ReactNode } from "react";

/** Semantic groups shared by the DOM controller and each native settings renderer. */
export function SettingsRow({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return <div data-native-kind="setting-row" data-native-label={title} data-native-description={desc}
    className="vy-settings-row flex items-center justify-between gap-4 py-3.5">
    <div className="min-w-0">
      <p className="text-sm font-medium">{title}</p>
      {desc && <p className="mt-0.5 text-xs leading-relaxed text-[var(--vy-text-dim)]">{desc}</p>}
    </div>
    <div data-native-controls="true" className="shrink-0">{children}</div>
  </div>;
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return <div data-native-kind="section" className="vy-settings-card rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 divide-y divide-[var(--vy-border)]">{children}</div>;
}

export function SettingsSection({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return <div className="vy-settings-section vy-fade-in">
    <h2 className="text-xl font-bold tracking-tight">{title}</h2>
    {desc && <p className="mt-1 mb-5 text-sm text-[var(--vy-text-dim)]">{desc}</p>}
    {children}
  </div>;
}
