import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentIHistoryItem } from "@/api/client";
import { agentIClient, type AgentIAuthMode, type AgentICredentials } from "@/api/agentI";
import { useStore } from "@/lib/store";

type AgentAction = { label: string; prompt: (source: string) => string };

const ACTIONS: AgentAction[] = [
  {
    label: "文章を校正",
    prompt: (s) =>
      `次の文章を校正してください。誤字脱字を直し、自然な日本語にしてください。修正後の本文だけ返してください。\n\n${s}`,
  },
  {
    label: "丁寧にする",
    prompt: (s) =>
      `次の文章を丁寧で感じのよい表現に直してください。本文だけ返してください。\n\n${s}`,
  },
  {
    label: "カジュアルにする",
    prompt: (s) =>
      `次の文章を親しい相手向けの自然な表現に直してください。本文だけ返してください。\n\n${s}`,
  },
  {
    label: "英語に翻訳",
    prompt: (s) => `次の文章を自然な英語に翻訳してください。翻訳結果だけ返してください。\n\n${s}`,
  },
  {
    label: "Flexを生成",
    prompt: (s) =>
      `次の要件のLINE Flex Message JSONを生成してください。JSONだけ返してください。\n\n${s}`,
  },
  {
    label: "テーマ案を生成",
    prompt: (s) =>
      `次の要望に合うVyThemeのCSS変数案を生成してください。コードブロックで返してください。\n\n${s}`,
  },
  {
    label: "プラグイン案を生成",
    prompt: (s) =>
      `次の要望をVyline plugin-sdk向けTypeScriptプラグインとして実装してください。コードと短い使い方を返してください。\n\n${s}`,
  },
];

export function AgentIBetaPanel() {
  const accountId = useStore((state) => state.accountId);
  const enabled = useStore((state) => state.settings.betaAgentI);
  const demoMode = useStore((state) => state.demoMode);
  if (!enabled) return null;
  if (!accountId || demoMode)
    return <p className="mt-3 text-xs">Agent Iはログイン後に利用できます。</p>;
  return <AccountAgentIPanel key={accountId} accountId={accountId} />;
}

const EMPTY_CREDENTIALS: AgentICredentials = { yahooCookieConfigured: false, expiresAt: null };

function AccountAgentIPanel({ accountId }: { accountId: string }) {
  const client = useMemo(() => agentIClient(accountId), [accountId]);
  const chats = useStore((state) => state.chats);
  const messages = useStore((state) => state.messages);
  const setDraft = useStore((state) => state.setDraft);
  const sendMessage = useStore((state) => state.sendMessage);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [chatId, setChatId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<AgentIAuthMode>("anonymous");
  const [credentials, setCredentials] = useState<AgentICredentials>(EMPTY_CREDENTIALS);
  const [yahooCookie, setYahooCookie] = useState("");
  const [yahooConsent, setYahooConsent] = useState(false);
  const [history, setHistory] = useState<AgentIHistoryItem[]>([]);
  const [includeHistory, setIncludeHistory] = useState(false);
  const active = useRef(false);
  const sessionGeneration = useRef(0);
  const pendingChat = useRef<AbortController | null>(null);
  const current = () =>
    active.current &&
    useStore.getState().accountId === accountId &&
    useStore.getState().settings.betaAgentI &&
    !useStore.getState().demoMode;

  const clearLocalSession = () => {
    sessionGeneration.current++;
    pendingChat.current?.abort();
    setCredentials(EMPTY_CREDENTIALS);
    setAuthMode("anonymous");
    setYahooCookie("");
    setYahooConsent(false);
    setHistory([]);
    setIncludeHistory(false);
    setResult("");
  };

  useEffect(() => {
    active.current = true;
    const generation = sessionGeneration.current;
    void Promise.all([client.credentials(), client.history()])
      .then(([status, dialogue]) => {
        if (!current() || generation !== sessionGeneration.current) return;
        setCredentials(status);
        setHistory(dialogue.history);
      })
      .catch(() => {
        if (current()) setError("Agent Iのセッションを確認できませんでした");
      });
    const clear = () => {
      void client.resetSession().catch(() => {});
    };
    const pagehide = () => {
      clearLocalSession();
      clear();
    };
    window.addEventListener("pagehide", pagehide);
    return () => {
      active.current = false;
      sessionGeneration.current++;
      pendingChat.current?.abort();
      window.removeEventListener("pagehide", pagehide);
      clear();
    };
  }, [client]);

  useEffect(() => {
    if (!credentials.expiresAt) return;
    const timer = setTimeout(
      () => {
        if (!current()) return;
        clearLocalSession();
        setError("セッションの有効期限が切れました。匿名モードへ戻しました");
        void client.resetSession().catch(() => {});
      },
      Math.max(0, credentials.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [client, credentials.expiresAt]);

  const registerCookie = async () => {
    if (!current() || !yahooConsent || !yahooCookie.trim() || loading) return;
    const cookie = yahooCookie;
    const generation = ++sessionGeneration.current;
    setYahooCookie("");
    setLoading(true);
    setError("");
    try {
      const status = await client.setCredentials(cookie);
      if (!current() || generation !== sessionGeneration.current) {
        await client.resetSession();
        return;
      }
      setCredentials(status);
      setAuthMode("authenticated");
      setYahooConsent(false);
      setHistory([]);
      setIncludeHistory(false);
      setResult("");
    } catch (caught) {
      if (current())
        setError(caught instanceof Error ? caught.message : "Cookieを登録できませんでした");
    } finally {
      if (current()) setLoading(false);
    }
  };

  const clearSession = async () => {
    if (!current()) return;
    clearLocalSession();
    setError("");
    setLoading(true);
    try {
      await client.resetSession();
    } catch {
      if (current())
        setError("サーバーの消去を確認できませんでした。再試行してください（最長30分で自動消去）");
    } finally {
      if (current()) setLoading(false);
    }
  };
  const selectedChatName = useMemo(
    () => chats.find((chat) => chat.id === chatId)?.name ?? "",
    [chats, chatId],
  );

  const sourceForChat = (id: string) =>
    messages
      .filter((message) => message.chatId === id && message.text?.trim())
      .slice(-40)
      .map((message) => message.text!.trim().slice(0, 800))
      .join("\n");

  const ask = async (text: string) => {
    if (!current() || !text.trim() || loading) return;
    setLoading(true);
    setError("");
    setResult("");
    const context = includeHistory ? history : [];
    setIncludeHistory(false);
    const controller = new AbortController();
    pendingChat.current = controller;
    try {
      const response = await client.chat(text.trim(), context, authMode, controller.signal);
      if (!current() || controller.signal.aborted) return;
      setResult(response.text);
      setAuthMode(response.authMode);
      const [status, dialogue] = await Promise.all([client.credentials(), client.history()]);
      if (!current() || controller.signal.aborted) return;
      setCredentials(status);
      setHistory(dialogue.history);
    } catch (caught) {
      if (!current() || controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Agent Iへの問い合わせに失敗しました");
      const status = await client.credentials().catch(() => EMPTY_CREDENTIALS);
      if (!current() || controller.signal.aborted) return;
      setCredentials(status);
      if (!status.yahooCookieConfigured) {
        setAuthMode("anonymous");
        setHistory([]);
      }
    } finally {
      if (current()) setLoading(false);
    }
  };

  const summarize = () => {
    const transcript = sourceForChat(chatId);
    if (!chatId || !transcript) return setError("要約できるテキストメッセージがありません");
    void ask(
      `次の「${selectedChatName}」の会話を日本語で5行以内に要約してください。重要な決定とTODOを含めてください。\n\n${transcript}`,
    );
  };

  return (
    <div className="mt-6">
      <h3 className="text-base font-semibold">Agent I AIアシスタント</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
        質問、文章校正、翻訳、トーク要約、Flex・テーマ・プラグイン案の生成に使えます。
      </p>
      <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed">
        入力内容と明示的に選択したトーク本文は、回答生成のためYahooのAgent
        Iへ送信されます。LINEへ自動送信はしません。
      </div>
      <div
        data-native-kind="section"
        className="mt-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4"
      >
        <label className="mb-2 block text-xs">
          利用モード
          <select
            aria-label="Agent Iの利用モード"
            value={authMode}
            disabled={loading}
            onChange={(event) => {
              setAuthMode(event.target.value as AgentIAuthMode);
              setYahooCookie("");
              setYahooConsent(false);
              setIncludeHistory(false);
            }}
            className="mt-1 block w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2"
          >
            <option value="anonymous">匿名（既定）</option>
            <option value="authenticated">Yahooログイン済み（任意）</option>
          </select>
        </label>
        <p className="mb-3 text-xs leading-relaxed text-[var(--vy-text-dim)]">
          CookieとAI履歴はメモリ内だけに保持します。この画面を閉じる、アカウント切替、Agent I
          OFF、30分経過、backend再起動で消去します。
          Cookie未登録・期限切れ時は匿名モードを使用します。
        </p>
        {credentials.yahooCookieConfigured && (
          <p className="mb-3 text-xs" role="status">
            Yahoo Cookie登録済み（{new Date(credentials.expiresAt!).toLocaleTimeString()}まで）
          </p>
        )}
        {authMode === "authenticated" && !credentials.yahooCookieConfigured && (
          <div
            data-native-kind="section"
            data-native-label="Yahoo認証の一時登録"
            className="mb-4 space-y-3"
          >
            <p className="text-xs leading-relaxed">
              Yahooのログイン済みCookieを手動で登録できます。質問内容はYahooアカウントに関連付けられる可能性があります。Cookieはディスク・ログ・診断へ保存しません。
            </p>
            <label className="block text-xs">
              Yahoo Cookie
              <input
                type="password"
                aria-label="Yahoo Cookie"
                autoComplete="off"
                spellCheck={false}
                value={yahooCookie}
                maxLength={16384}
                disabled={loading}
                onChange={(event) => setYahooCookie(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2"
              />
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={yahooConsent}
                disabled={loading}
                onChange={(event) => setYahooConsent(event.target.checked)}
              />
              Yahooアカウントを使い、明示送信した内容をYahooへ送信することに同意する
            </label>
            <button
              type="button"
              disabled={loading || !yahooCookie.trim() || !yahooConsent}
              onClick={() => void registerCookie()}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs disabled:opacity-50"
            >
              Cookieを一時登録
            </button>
          </div>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => void clearSession()}
          className="mb-4 rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs disabled:opacity-50"
        >
          CookieとAI履歴を消去
        </button>
        <textarea
          aria-label="Agent Iへの質問"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={4000}
          placeholder="質問や文章を入力…"
          className="min-h-24 w-full resize-y rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3 text-sm"
        />
        <label className="mt-3 flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={includeHistory}
            disabled={loading || !history.length}
            onChange={(event) => setIncludeHistory(event.target.checked)}
          />
          次の質問に表示中のAI会話履歴も含めてYahooへ送信する（毎回選択）
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={!prompt.trim() || loading}
              onClick={() => void ask(action.prompt(prompt))}
              className="rounded-full border border-[var(--vy-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            disabled={!prompt.trim() || loading}
            onClick={() => void ask(prompt)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
            style={{ background: "var(--vy-accent)" }}
          >
            {loading ? "回答中…" : "質問する"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            aria-label="要約するトーク"
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
            className="min-w-48 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-2 py-2 text-xs"
          >
            <option value="">要約するトークを選択</option>
            {chats.map((chat) => (
              <option key={chat.id} value={chat.id}>
                {chat.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!chatId || loading}
            onClick={summarize}
            className="rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs disabled:opacity-50"
          >
            トークを要約
          </button>
          {result && chatId && (
            <>
              <button
                type="button"
                onClick={() => setDraft(chatId, result)}
                className="rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs"
              >
                下書きに挿入
              </button>
              <button
                type="button"
                onClick={() => void sendMessage(chatId, result)}
                className="rounded-lg border border-red-400/50 px-3 py-2 text-xs text-red-300"
              >
                この内容を送信
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs text-red-400">
            {error}
          </p>
        )}
        {result && (
          <div className="mt-4 whitespace-pre-wrap rounded-xl bg-[var(--vy-surface-2)] p-3 text-sm leading-relaxed">
            {result}
          </div>
        )}
        {history.length > 0 && (
          <section aria-label="このセッションのAI会話履歴" className="mt-4 space-y-2">
            <h4 className="text-xs font-semibold">AI会話履歴（自動送信しません）</h4>
            {history.map((item, index) => (
              <p key={`${index}-${item.role}`} className="whitespace-pre-wrap break-words text-xs">
                {item.role === "user" ? "あなた" : "Agent I"}: {item.text}
              </p>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
