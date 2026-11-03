import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { messageSearchClient, type MessageSearchClient } from "../api/messageSearch";
import { MessageSearchController } from "./searchController";
import { registerSearchPane } from "./searchPane";
import { useStore } from "./store";
import { onAppEvent } from "./appEvents";

export function useMessageSearch(account: string | null, chat: string | null, demo: boolean) {
  const [accountEpoch, setAccountEpoch] = useState(0);
  const controller = useMemo(() => {
    const loaded = () => useStore.getState().messages.filter((message) => message.chatId === chat);
    const client: MessageSearchClient =
      account && chat && !demo
        ? messageSearchClient(account, chat)
        : {
            search: async (query, regex) => {
              if (regex) throw new Error("デモでは正規表現を利用できません");
              return {
                hits: loaded()
                  .filter((message) => message.text?.toLowerCase().includes(query.toLowerCase()))
                  .map((message) => ({
                    id: message.id,
                    text: message.text!,
                    createdTime: message.createdAt,
                    highlight: query,
                  })),
                nextCursor: null,
                limit: 100,
              };
            },
            context: async () => {
              throw new Error("ローカル履歴を利用できません");
            },
          };
    return new MessageSearchController(
      client,
      () => new Set(loaded().map((message) => message.id)),
    );
  }, [account, chat, demo, accountEpoch]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    controller.activate();
    const unregister = registerSearchPane(account, chat, controller);
    const unsubscribe = useStore.subscribe((state) => {
      if (state.accountId !== account || state.demoMode !== demo) {
        controller.dispose();
        setAccountEpoch((epoch) => epoch + 1);
      }
    });
    const offDeleted = onAppEvent("message:deleted", (event) => {
      if (event.accountId === account && event.chatId === chat)
        controller.removeMessage(event.messageId);
    });
    return () => {
      offDeleted();
      unsubscribe();
      unregister();
      controller.dispose();
    };
  }, [controller, account, chat, demo]);
  return { controller, state };
}
