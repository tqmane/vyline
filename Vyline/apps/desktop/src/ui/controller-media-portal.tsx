import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@/lib/store";
import { useDesignTheme } from "./design-theme";

let generation = 0;
const listeners = new Map<string, (element: HTMLElement | null) => void>();
type MediaWindow = Window & { __vylineMediaSlots?: Map<string, HTMLElement> };
if (typeof window !== "undefined") window.addEventListener("message", (event) => {
  const frame = document.querySelector<HTMLIFrameElement>('.vy-kmp-host > iframe');
  if (event.source !== frame?.contentWindow || event.origin !== location.origin) return;
  const value = event.data;
  if (!value || value.channel !== "vyline-ui" || value.version !== 1 || typeof value.id !== "string" || value.id.length > 512) return;
  if (value.type === "media-slot-removed") { listeners.get(value.id)?.(null); return; }
  if (value.type !== "media-slot") return;
  const element = (event.source as MediaWindow).__vylineMediaSlots?.get(value.id);
  if (element?.isConnected && element.ownerDocument === frame.contentDocument) listeners.get(value.id)?.(element);
});

/** A stable React portal container preserves every media ref/stream while Kotlin places the media widget. */
export function ControllerMediaPortal({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const accountId = useStore((state) => state.accountId);
  const { mode, dark } = useDesignTheme();
  const [id] = useState(() => `controller-portal-${++generation}`);
  const [container] = useState(() => document.createElement("div"));
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const inline = useRef<HTMLDivElement>(null);
  const owner = useRef(accountId);
  const styles = useMemo(() => [...document.styleSheets].map((sheet) => {
    try { return [...sheet.cssRules].map((rule) => rule.cssText).join("\n"); } catch { return ""; }
  }).join("\n"), []);
  useLayoutEffect(() => {
    container.style.cssText = "width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;";
    const root = getComputedStyle(document.documentElement);
    for (const key of [...root]) if (key.startsWith("--vy-")) container.style.setProperty(key, root.getPropertyValue(key));
    container.dataset.uiMode = mode;
    container.style.colorScheme = dark ? "dark" : "light";
  }, [container, mode, dark]);
  useEffect(() => {
    const update = (element: HTMLElement | null) => { if (owner.current === useStore.getState().accountId) setTarget(element); };
    listeners.set(id, update);
    const frame = document.querySelector<HTMLIFrameElement>('.vy-kmp-host > iframe');
    update((frame?.contentWindow as MediaWindow | null)?.__vylineMediaSlots?.get(id) ?? null);
    return () => { listeners.delete(id); container.remove(); };
  }, [id, container]);
  useLayoutEffect(() => {
    const destination = active ? target && (target.shadowRoot ?? target.attachShadow({ mode: "open" })) : inline.current;
    if (!destination) { container.remove(); return; }
    destination.appendChild(container);
    for (const video of container.querySelectorAll("video")) if (video.autoplay || video.srcObject) void video.play().catch(() => undefined);
    return () => container.remove();
  }, [target, container, active]);
  return <>
    <div ref={inline} data-native-media-portal={active ? id : undefined} aria-label="映像レイアウト" style={active ? undefined : { display: "flex", flex: 1, minHeight: 0 }} />
    {createPortal(<><style>{styles}</style>{children}</>, container)}
  </>;
}
