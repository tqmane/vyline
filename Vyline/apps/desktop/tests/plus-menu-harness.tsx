// Browser-only layout regression; all API requests are mocked and nothing is submitted.
import { createRoot } from "react-dom/client";
import { PlusMenu } from "../src/components/plus-menu";
import { useStore } from "../src/lib/store";
import { ActionDialog } from "../src/components/action-dialog";

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
globalThis.fetch = async () => Response.json({ ok: true, members: [], data: {} });
useStore.setState({
  accountId: "layout-test",
  chats: [
    {
      id: "c-layout-test",
      type: "group",
      name: "表示テスト",
      avatar: "T",
      status: "",
      color: "#24a8df",
      unread: 0,
      members: [],
    },
  ],
});
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
root.render(
  // The real vy-screen-enter wrapper has transform + zero height around the fixed chat shell.
  <div style={{ transform: "translateY(0)", height: 0 }}>
    <section style={{ position: "fixed", inset: 0, height: "100dvh", width: "100%" }}>
      <div style={{ position: "absolute", bottom: 24, left: 24 }}>
        <PlusMenu chatId="c-layout-test" />
      </div>
    </section>
  </div>,
);
const output = document.createElement("pre");
const run = document.createElement("button");
run.textContent = "5つのダイアログを検証";
document.body.prepend(run, output);
run.onclick = async () => {
  run.disabled = true;
  try {
    for (const label of ["イベントを作成", "あみだくじ", "ノート", "アンケート", "アルバム"]) {
      document.querySelector<HTMLButtonElement>('button[aria-label="メニューを開く"]')!.click();
      await tick();
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.endsWith(label))!
        .click();
      await tick();
      const title = document.querySelector("h3")!;
      const bounds = title.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > innerHeight)
        throw new Error(`${label}: title outside viewport (${Math.round(bounds.top)})`);
      const dialog = title.closest("dialog");
      if (!dialog?.open || !dialog.matches(":modal"))
        throw new Error(`${label}: not in the modal top layer`);
      const rect = dialog.getBoundingClientRect();
      if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight)
        throw new Error(`${label}: dialog outside viewport`);
      const body = dialog.lastElementChild!.lastElementChild!;
      if (body.scrollWidth > body.clientWidth + 1) throw new Error(`${label}: horizontal overflow`);
      dialog.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!.click();
      await tick();
      if (document.querySelector("dialog")) throw new Error(`${label}: close failed`);
      if (document.activeElement?.getAttribute("aria-label") !== "メニューを開く")
        throw new Error(`${label}: focus did not return to menu trigger`);
    }
    root.render(
      <ActionDialog title={"長いタイトル".repeat(100)} onClose={() => root.render(null)}>
        <p>本文を確認</p>
        <button type="button">操作</button>
      </ActionDialog>,
    );
    await tick();
    const longDialog = document.querySelector("dialog")!;
    const close = longDialog.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!;
    const body = longDialog.lastElementChild!.lastElementChild!;
    if (close.getBoundingClientRect().bottom > innerHeight || body.clientHeight < 40)
      throw new Error("long title hides close button or body");
    close.click();
    await tick();
    output.textContent = `PASS: 5 dialogs + long title inside ${innerWidth}×${innerHeight}, no horizontal overflow, focus restored; no API submission`;
  } catch (error) {
    output.textContent = `FAIL: ${(error as Error).message}`;
  }
};
