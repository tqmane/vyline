// Browser-only fixture for the real data hook; never connects to a LINE account.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useLineData } from "../src/hooks/useLineData";
import { useDesignSystemStore } from "../src/ui/design-system-store";

function Probe() {
  const [accountId, setAccountId] = useState("cache-fixture-a");
  const mode = useDesignSystemStore((state) => state.mode);
  const data = useLineData({ accountId });
  return <>
    <output aria-label="data">{JSON.stringify({ owner: data.dataAccountId, chats: data.chats, messages: data.messages, profile: data.profile, mode })}</output>
    <button type="button" onClick={() => data.setSelectedChatMid(`c${"1".repeat(32)}`)}>Open history</button>
    <button type="button" onClick={() => setAccountId("cache-fixture-b")}>Switch account</button>
    <button type="button" onClick={() => useDesignSystemStore.getState().setMode(mode === "apple" ? "miuix" : "apple")}>Switch renderer</button>
  </>;
}
createRoot(document.getElementById("root")!).render(<Probe />);
