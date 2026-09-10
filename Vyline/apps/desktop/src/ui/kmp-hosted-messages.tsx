import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageBubble } from "@/components/message-bubble";
import { useStore } from "@/lib/store";
import { emitAppEvent } from "@/lib/appEvents";
import { useDesignTheme } from "./design-theme";
import { COMPOSE_CHANNEL, COMPOSE_VERSION, matchesKmpContext } from "./compose-contract";
import { NativeControllerSurface } from "./native-controller-surface";
import type { NativePanelSnapshot } from "./native-panel";

const closeInlineController = () => {};

type Slot = { id: string; element: HTMLElement; shadow: ShadowRoot };
type ContentWindow = Window & { __vylineMessageSlots?: Map<string, HTMLElement> };

/** Kotlin owns the list/layout; complex LINE content keeps its existing host renderer. */
export function KmpHostedMessages({
  frame,
  epoch,
  chatId,
  onHeight,
  onModel,
  canJoinCall = false,
  joiningCall = false,
}: {
  frame: HTMLIFrameElement | null;
  epoch: number;
  chatId: string | null;
  onHeight: (id: string, height: number) => void;
  onModel: (id: string, model: NativePanelSnapshot | null, epoch: number, retiredId?: string) => void;
  canJoinCall?: boolean;
  joiningCall?: boolean;
}) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const styles = useMemo(
    () =>
      Array.from(document.styleSheets)
        .map((sheet) => {
          try {
            return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
          } catch {
            return "";
          }
        })
        .join("\n"),
    [frame],
  );

  useEffect(() => {
    setSlots([]);
    if (!frame?.contentWindow || !chatId) return;
    const source = frame.contentWindow as ContentWindow;
    const mount = (id: string) => {
      const message = useStore
        .getState()
        .messages.find((message) => message.id === id && message.chatId === chatId);
      const element = source.__vylineMessageSlots?.get(id);
      if (!message || !element?.isConnected || element.ownerDocument !== frame.contentDocument)
        return;
      const slot = {
        id,
        element,
        shadow: element.shadowRoot ?? element.attachShadow({ mode: "open" }),
      };
      setSlots((current) =>
        current.some((entry) => entry.id === id && entry.element === element)
          ? current
          : [...current.filter((entry) => entry.id !== id), slot],
      );
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== source || event.origin !== location.origin) return;
      let value = event.data;
      if (typeof value === "string") {
        if (value.length > 4096) return;
        try {
          value = JSON.parse(value);
        } catch {
          return;
        }
      }
      if (
        !value ||
        value.channel !== COMPOSE_CHANNEL ||
        value.version !== COMPOSE_VERSION ||
        !matchesKmpContext(value, epoch, chatId) ||
        typeof value.id !== "string" ||
        value.id.length > 512
      )
        return;
      if (value.type === "content-slot") mount(value.id);
      if (value.type === "content-slot-removed")
        setSlots((current) =>
          current.filter((slot) => slot.id !== value.id || slot.element.isConnected),
        );
    };
    window.addEventListener("message", receive);
    // Recover slots created between the first native layout and the host's effect.
    for (const id of source.__vylineMessageSlots?.keys() ?? []) mount(id);
    return () => window.removeEventListener("message", receive);
  }, [frame, epoch, chatId]);

  return slots
    .filter((slot) => slot.element.isConnected)
    .map((slot) =>
      createPortal(
        <HostedMessage
          slot={slot}
          chatId={chatId}
          styles={styles}
          onHeight={onHeight}
          onModel={onModel}
          epoch={epoch}
          canJoinCall={canJoinCall}
          joiningCall={joiningCall}
        />,
        slot.shadow,
        slot.id,
      ),
    );
}

function HostedMessage({
  slot,
  chatId,
  styles,
  onHeight,
  onModel,
  epoch,
  canJoinCall,
  joiningCall,
}: {
  slot: Slot;
  chatId: string | null;
  styles: string;
  onHeight: (id: string, height: number) => void;
  onModel: (id: string, model: NativePanelSnapshot | null, epoch: number, retiredId?: string) => void;
  epoch: number;
  canJoinCall: boolean;
  joiningCall: boolean;
}) {
  const message = useStore((state) =>
    state.messages.find((message) => message.id === slot.id && message.chatId === chatId),
  );
  const chat = useStore((state) => state.chats.find((chat) => chat.id === chatId));
  const { theme, mode, dark } = useDesignTheme();
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const sync = () => {
      const rootStyle = getComputedStyle(document.documentElement);
      for (const property of Array.from(rootStyle)) {
        if (property.startsWith("--vy-"))
          slot.element.style.setProperty(property, rootStyle.getPropertyValue(property));
      }
      slot.element.style.colorScheme = dark ? "dark" : "light";
      slot.element.dataset.vyInteraction = document.documentElement.dataset.vyInteraction;
      slot.element.dataset.animationMode = document.documentElement.dataset.animationMode;
    };
    sync();
    // Display settings can change without a new message or a theme change.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-vy-interaction", "data-animation-mode"],
    });
    return () => observer.disconnect();
  }, [slot.element, theme, mode, dark]);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height > 0) onHeight(slot.id, Math.max(24, Math.min(100_000, Math.ceil(height))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [onHeight, slot.id]);
  if (!message || !chat) return null;
  return (
    <>
      <style>{styles}</style>
      <style>{`:host{display:block;font-family:var(--vy-font-family,system-ui);font-size:14px;color:var(--vy-text)}.vy-kmp-inline-content{width:100%;display:flow-root}.vy-kmp-inline-content [data-vy-message]{padding:0}.vy-kmp-inline-content [data-vy-message-content],.vy-kmp-inline-content .vy-msg-enter{max-width:100%}:host([data-vy-interaction="mobile"]) .vy-message-interaction{touch-action:pan-y;user-select:none;-webkit-user-select:none}:host([data-animation-mode="none"]) *{animation-duration:.001ms!important;transition-duration:.001ms!important}:host([data-animation-mode="feather"]) .vy-msg-enter{animation-duration:90ms}@media(prefers-reduced-motion:reduce){*{animation-duration:.001ms!important;transition-duration:.001ms!important}}`}</style>
      <div ref={content} className="vy-kmp-inline-content">
        <NativeControllerSurface title="メッセージ" chatId={chatId ?? undefined} onClose={closeInlineController}
          onSnapshot={(model, retiredId) => onModel(slot.id, model, epoch, retiredId)}>
        <MessageBubble
          message={message}
          chat={chat}
          showAvatar
          showName
          joiningGroupCall={joiningCall}
          onJoinGroupCall={
            canJoinCall
              ? () => emitAppEvent("chat:ui-command", { chatId: chat.id, action: "join-call" })
              : undefined
          }
        />
        </NativeControllerSurface>
      </div>
    </>
  );
}
