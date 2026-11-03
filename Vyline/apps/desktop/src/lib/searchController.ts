import type {
  MessageSearchClient,
  SearchContext,
  SearchDirection,
  SearchHit,
} from "../api/messageSearch";
import { maskPrivacyText, type NoncallSettings } from "./settingsPreferences";

export type SearchState = {
  open: boolean;
  query: string;
  regex: boolean;
  hits: SearchHit[];
  index: number;
  nextCursor: string | null;
  loading: boolean;
  contextLoading: boolean;
  error: string;
  window: SearchContext | null;
  scrollId: string | null;
};
const emptyState = (): SearchState => ({
  open: false,
  query: "",
  regex: false,
  hits: [],
  index: 0,
  nextCursor: null,
  loading: false,
  contextLoading: false,
  error: "",
  window: null,
  scrollId: null,
});

/** One controller per mounted pane. It never writes search history into the shared store. */
export class MessageSearchController {
  private state = emptyState();
  private listeners = new Set<() => void>();
  private searchRequest: AbortController | null = null;
  private contextRequest: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private generation = 0;
  private deletedIds = new Set<string>();

  constructor(
    private client: MessageSearchClient,
    private loadedIds: () => Set<string>,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<SearchState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private abort() {
    this.generation++;
    clearTimeout(this.timer);
    this.searchRequest?.abort();
    this.contextRequest?.abort();
    this.searchRequest = this.contextRequest = null;
  }
  open = () => this.update({ open: true });
  close = () => {
    this.abort();
    this.update(emptyState());
  };
  cancel = () => {
    this.abort();
    this.update({ loading: false, contextLoading: false, error: "検索を中断しました" });
  };
  activate = () => {
    this.disposed = false;
  };
  dispose = () => {
    this.abort();
    this.update(emptyState());
    this.disposed = true;
  };
  setQuery = (query: string) => {
    this.abort();
    this.update({
      query,
      open: true,
      hits: [],
      index: 0,
      nextCursor: null,
      error: "",
      loading: !!query.trim(),
      contextLoading: false,
      window: null,
      scrollId: null,
    });
    if (query.trim() && !this.disposed)
      this.timer = setTimeout(() => void this.loadResults(false), 180);
  };
  setRegex = (regex: boolean) => {
    this.update({ regex });
    this.setQuery(this.state.query);
  };
  retry = () => this.setQuery(this.state.query);
  private async loadResults(append: boolean) {
    const request = new AbortController();
    this.searchRequest?.abort();
    this.searchRequest = request;
    this.update({ loading: true, error: "" });
    try {
      const page = await this.client.search(
        this.state.query,
        this.state.regex,
        append ? this.state.nextCursor : null,
        request.signal,
      );
      if (request.signal.aborted || this.disposed) return;
      const hits = [
        ...new Map(
          [...(append ? this.state.hits : []), ...page.hits]
            .filter((hit) => !this.deletedIds.has(hit.id))
            .map((hit) => [hit.id, hit]),
        ).values(),
      ];
      this.update({ hits, nextCursor: page.nextCursor, loading: false });
      if (!append && hits.length) await this.select(0);
    } catch (error) {
      if (!request.signal.aborted)
        this.update({
          loading: false,
          error: error instanceof Error ? error.message : "検索に失敗しました",
        });
    }
  }
  more = () => {
    if (this.state.nextCursor && !this.state.loading) return this.loadResults(true);
    return Promise.resolve();
  };
  next = async () => {
    if (this.state.loading) return;
    const generation = this.generation;
    const next = this.state.index + 1;
    if (next === this.state.hits.length && this.state.nextCursor) await this.more();
    if (generation !== this.generation || (next >= this.state.hits.length && this.state.nextCursor))
      return;
    if (this.state.hits.length) await this.select(next % this.state.hits.length);
  };
  previous = () =>
    this.select((this.state.index - 1 + this.state.hits.length) % this.state.hits.length);
  select = async (index: number) => {
    const hit = this.state.hits[index];
    if (!hit || this.disposed) return;
    this.contextRequest?.abort();
    this.update({ index, error: "", contextLoading: false, scrollId: hit.id });
    if (this.state.window?.messages.some((message) => message.id === hit.id)) return;
    if (this.loadedIds().has(hit.id)) {
      this.update({ window: null });
      return;
    }
    await this.loadContext(hit.id, "around");
  };
  private async loadContext(messageId: string, direction: SearchDirection) {
    const request = new AbortController();
    this.contextRequest?.abort();
    this.contextRequest = request;
    this.update({ contextLoading: true, error: "" });
    try {
      const result = await this.client.context(messageId, direction, request.signal);
      if (request.signal.aborted || this.disposed) return;
      const window = {
        ...result,
        messages: result.messages.filter((message) => !this.deletedIds.has(message.id)),
      };
      if (!window.messages.some((message) => message.id === messageId))
        throw new Error("メッセージは履歴から削除されています");
      this.update({ window, scrollId: messageId, contextLoading: false });
    } catch (error) {
      if (!request.signal.aborted)
        this.update({
          contextLoading: false,
          error: error instanceof Error ? error.message : "履歴を読み込めませんでした",
        });
    }
  }
  pageContext = (direction: "before" | "after") => {
    if (this.state.contextLoading || !this.state.window) return;
    const messages = this.state.window.messages;
    const anchor = direction === "before" ? messages[0] : messages.at(-1);
    if (anchor) return this.loadContext(anchor.id, direction);
  };
  latest = () => {
    this.contextRequest?.abort();
    this.update({ window: null, contextLoading: false, scrollId: null });
  };
  removeMessage = (id: string) => {
    this.deletedIds.add(id);
    this.contextRequest?.abort();
    const hits = this.state.hits.filter((hit) => hit.id !== id);
    this.update({
      hits,
      index: Math.min(this.state.index, Math.max(0, hits.length - 1)),
      contextLoading: false,
      scrollId: this.state.scrollId === id ? null : this.state.scrollId,
      window: this.state.window
        ? {
            ...this.state.window,
            messages: this.state.window.messages.filter((message) => message.id !== id),
          }
        : null,
    });
  };
}

export function searchPresentation(state: SearchState, settings: { streamerMode: boolean } & Partial<NoncallSettings>) {
  return {
    open: state.open,
    query: state.query,
    index: state.index,
    count: state.hits.length,
    activeId: state.hits[state.index]?.id ?? null,
    regex: state.regex,
    loading: state.loading,
    contextLoading: state.contextLoading,
    error: state.error,
    limited: !!state.nextCursor,
    hasMore: !!state.nextCursor,
    limit: 100,
    results: state.hits.map((hit) => ({
      id: hit.id,
      text: maskPrivacyText(hit.text, settings).slice(0, 160),
      createdTime: hit.createdTime,
    })),
    scrollId: state.scrollId,
    historyWindow: state.window
      ? { hasOlder: state.window.hasOlder, hasNewer: state.window.hasNewer }
      : null,
  };
}

/** Shared by the React chat and the native/controller event path. */
export function dispatchSearchCommand(
  controller: MessageSearchController,
  action: string,
  value?: string,
): boolean {
  switch (action) {
    case "search":
      controller.open();
      break;
    case "search-query":
      controller.setQuery(value ?? "");
      break;
    case "search-close":
      controller.close();
      break;
    case "search-next":
      void controller.next();
      break;
    case "search-previous":
      void controller.previous();
      break;
    case "search-regex":
      controller.setRegex(value === undefined ? !controller.getSnapshot().regex : value === "true");
      break;
    case "search-more":
      void controller.more();
      break;
    case "search-select":
      void controller.select(controller.getSnapshot().hits.findIndex((hit) => hit.id === value));
      break;
    case "search-cancel":
      controller.cancel();
      break;
    case "search-retry":
      controller.retry();
      break;
    case "search-older":
      void controller.pageContext("before");
      break;
    case "search-newer":
      void controller.pageContext("after");
      break;
    case "search-latest":
      controller.latest();
      break;
    default:
      return false;
  }
  return true;
}
