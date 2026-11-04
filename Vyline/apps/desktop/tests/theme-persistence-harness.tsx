import { lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeApplier } from "../src/components/theme-applier";
import { VyThemePanel } from "../src/components/vy-theme-panel";
import { useStore } from "../src/lib/store";
import { DesignSystemPicker } from "../src/ui/design-system-picker";
import { useDesignTheme } from "../src/ui/design-theme";

// SettingsSections lazily brings in this same module in the product.
const SettingsBackup = lazy(() =>
  import("../src/components/settings-backup").then((module) => ({
    default: module.SettingsBackupSection,
  })),
);

function Harness() {
  const saved = useStore((state) => state.theme);
  const readMarks = useStore((state) => state.localReadMarks);
  const { theme, mode } = useDesignTheme();
  const [settingsOpen, setSettingsOpen] = useState(() => location.search === "?settings");
  return (
    <>
      <ThemeApplier />
      <output hidden id="saved-theme">
        {JSON.stringify(saved)}
      </output>
      <output hidden id="resolved-theme">
        {JSON.stringify(theme)}
      </output>
      <output hidden id="read-marks">
        {JSON.stringify(readMarks)}
      </output>
      <button
        type="button"
        onClick={() =>
          useStore.setState({
            localReadMarks: {
              "fixture-account-a:fixture-chat": {
                lastMessageId: "101",
                lastMessageTime: 1000,
                unreadCount: 13,
              },
              "fixture-account-b:fixture-chat": {
                lastMessageId: "202",
                lastMessageTime: 2000,
                unreadCount: 7,
              },
            },
          })
        }
      >
        合成既読位置を保存
      </button>
      <button
        type="button"
        onClick={() => {
          history.replaceState(null, "", settingsOpen ? "/" : "?settings");
          setSettingsOpen(!settingsOpen);
        }}
      >
        {settingsOpen ? "チャットへ戻る" : "設定を開く"}
      </button>
      <DesignSystemPicker />
      {mode === "legacy" && <VyThemePanel />}
      {settingsOpen && (
        <Suspense fallback={<p>設定を読み込み中</p>}>
          <SettingsBackup />
        </Suspense>
      )}
    </>
  );
}

createRoot(document.body.appendChild(document.createElement("div"))).render(<Harness />);
