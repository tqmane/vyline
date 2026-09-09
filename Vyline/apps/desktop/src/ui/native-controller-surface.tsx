import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useStore } from "@/lib/store";
import {
  usePublishNativePanel,
  type NativePanelControl,
  type NativePanelSnapshot,
} from "./native-panel";
import { publishNativeMenu, unpublishNativeMenu } from "./native-menu";
import { lineCdnProxy } from "@/utils/lineMedia";
import { registerControllerMedia, releaseControllerMedia } from "./controller-media";

const ControllerPresentation = createContext<RefObject<HTMLDivElement | null> | null>(null);
export const useControllerPresentation = () => useContext(ControllerPresentation) !== null;
export const useControllerPortalTarget = () => useContext(ControllerPresentation)?.current;

/**
 * Existing specialist controllers still own forms, requests, validation and callbacks.
 * Project their live form values/actions to Kotlin; their DOM is inert and never presented.
 * No CSS geometry, theme styling or browser credentials are copied to the renderer.
 */
export function NativeControllerSurface({
  title,
  onClose,
  children,
  chatId,
  onSnapshot,
  persistent = false,
  native = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  chatId?: string;
  onSnapshot?: (value: NativePanelSnapshot | null, retiredId?: string) => void;
  persistent?: boolean;
  native?: boolean;
}) {
  const accountId = useStore((state) => state.accountId);
  const container = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleRef = useRef(title);
  closeRef.current = onClose;
  titleRef.current = title;
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);
  const [presentation, setPresentation] = useState<{
    title: string;
    items: NativePanelControl[];
    close?: () => void;
    modal?: boolean;
    compact?: boolean;
    callLayout?: string;
  }>({ title, items: [] });
  const ids = useRef(new WeakMap<Element, string>());
  const nextId = useRef(0);
  const menuOwner = useRef(Symbol("controller-menu"));
  const mediaOwner = useRef(Symbol("controller-media"));
  const schedule = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (!native) return;
    const root = container.current!;
    const realm = root.ownerDocument.defaultView as Window & typeof globalThis;
    const {
      HTMLInputElement,
      HTMLTextAreaElement,
      HTMLSelectElement,
      HTMLButtonElement,
      HTMLAnchorElement,
      HTMLImageElement,
      HTMLVideoElement,
      HTMLAudioElement,
      HTMLCanvasElement,
      HTMLLabelElement,
      HTMLDialogElement,
      HTMLElement,
      SVGElement,
      Event,
      MouseEvent,
      KeyboardEvent,
      XMLSerializer,
      Node,
      MutationObserver,
    } = realm;
    let frame = 0;
    let disposed = false;
    let menuSignature = "";
    const identity = (node: Element) => {
      let id = ids.current.get(node);
      if (!id) {
        id = `control-${++nextId.current}`;
        ids.current.set(node, id);
      }
      return id;
    };
    const imageUrl = (value: string | undefined) => {
      if (!value) return value;
      try {
        const target = new URL(value, root.ownerDocument.baseURI);
        return target.protocol === "https:" && /(^|\.)line-scdn\.net$/.test(target.hostname)
          ? lineCdnProxy(target.href)
          : target.href;
      } catch {
        return value;
      }
    };
    const label = (node: Element) =>
      node.getAttribute("aria-label") ||
      node.getAttribute("title") ||
      (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
        ? node.labels?.[0]?.textContent?.trim() || node.placeholder
        : "") ||
      node.textContent?.trim() ||
      node.querySelector("img")?.alt ||
      "操作";
    const click = (node: HTMLElement) => {
      if (!node.isConnected) return;
      node.click();
      schedule.current();
      // Hold duplicate activation until the controller's next rendered state exists.
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    const change = (
      node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      value: string,
    ) => {
      if (!node.isConnected || node.disabled) return;
      if (node instanceof HTMLInputElement && ["checkbox", "radio"].includes(node.type)) {
        if (node.checked !== (value === "true")) node.click();
      } else {
        const prototype =
          node instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : node instanceof HTMLSelectElement
              ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype;
        // Use the native setter so React's value tracker observes a real input transition.
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(node, value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      }
      schedule.current();
    };
    const project = (node: Element): NativePanelControl[] => {
      if (node.hasAttribute("data-native-call-recording")) return [{ id: identity(node), kind: "text", label: node.textContent ?? "", live: true }];
      if (node instanceof HTMLInputElement && node.hasAttribute("data-native-call-width"))
        return [
          {
            id: identity(node),
            kind: "call-width",
            label: label(node),
            value: node.value,
            onChange: (value) => change(node, value),
          },
        ];
      if (node instanceof SVGElement && node.getAttribute("data-native-image") === "true")
        return [
          {
            id: identity(node),
            kind: "image",
            label: label(node),
            url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(node))}`,
          },
        ];
      if (node.matches('script,style,svg,[aria-hidden="true"],[hidden]')) return [];
      const computed = realm.getComputedStyle(node);
      if (computed.display === "none" || computed.visibility === "hidden") return [];
      const id = identity(node);
      if (node.hasAttribute("data-native-call-participant")) return [{ id, kind: "avatar", label: node.getAttribute("data-call-name") ?? "参加者",
        value: node.getAttribute("data-call-glyph") ?? "", url: imageUrl(node.getAttribute("data-call-avatar") || undefined), color: node.getAttribute("data-call-color") ?? undefined,
        description: node.getAttribute("data-call-status") ?? "参加中", size: 56 }];
      if (node.hasAttribute("data-native-call-summary"))
        return [
          {
            id,
            kind: "call-summary",
            label: node.getAttribute("data-call-name") ?? "通話",
            value: node.getAttribute("data-call-glyph") ?? "",
          url: imageUrl(node.getAttribute("data-call-avatar") || undefined),
            description: node.getAttribute("data-call-status") ?? "",
            caption: node.getAttribute("data-call-duration") ?? "",
            largeImage: node.getAttribute("data-call-show-avatar") === "true",
          },
        ];
      for (const kind of ["call-header", "call-summary", "call-controls"] as const) {
        if (node.hasAttribute(`data-native-${kind}`))
          return [{ id, kind, label: "", items: [...node.children].flatMap(project) }];
      }
      if (node.tagName === "DETAILS") {
        const summary = node.querySelector("summary");
        return [
          {
            id,
            kind: "section",
            label: "",
            items: [
              ...(summary
                ? [
                    {
                      id: identity(summary),
                      kind: "button" as const,
                      label: label(summary),
                      primary: node.hasAttribute("open"),
                      onClick: () => click(summary),
                    },
                  ]
                : []),
              ...(node.hasAttribute("open")
                ? [...node.children].filter((child) => child !== summary).flatMap(project)
                : []),
            ],
          },
        ];
      }
      if (node.getAttribute("data-native-media-portal"))
        return [
          {
            id,
            kind: "portal",
            label: label(node),
            value: node.getAttribute("data-native-media-portal")!,
          },
        ];
      if (node.getAttribute("role") === "menu") return [];
      if (node.tagName === "PRE")
        return [
          {
            id,
            kind: "input",
            label: node.getAttribute("aria-label") || "内容",
            value: node.textContent ?? "",
            multiline: true,
            readOnly: true,
          },
        ];
      const nativeImage = node.getAttribute("data-native-image-url");
      if (nativeImage)
        return [
          {
            id,
            kind: node.getAttribute("data-native-action") === "true" ? "button" : "image",
            label: label(node),
            url: imageUrl(nativeImage),
            largeImage: true,
            onClick: () => click(node as HTMLElement),
          },
        ];
      if (node.getAttribute("data-native-box") === "true")
        return [
          {
            id,
            kind: "section",
            label: "",
            items: [
              ...[...node.children].flatMap(project),
              ...(node.getAttribute("data-native-action") === "true"
                ? [
                    {
                      id: `${id}-open`,
                      kind: "button" as const,
                      label: node.getAttribute("aria-label") || "カードを開く",
                      onClick: () => click(node as HTMLElement),
                    },
                  ]
                : []),
            ],
          },
        ];
      if (node instanceof HTMLElement && node.dataset.nativeSceneSize) {
        const fieldId = (attribute: string, uid: string) => {
          const field = [...root.querySelectorAll(`[${attribute}]`)].find(
            (field) => field.getAttribute(attribute) === uid,
          );
          return field ? identity(field) : "";
        };
        return [
          {
            id,
            kind: "scene",
            label: "組み合わせスタンプの配置",
            sceneSize: Number(node.dataset.nativeSceneSize),
            minSize: Number(node.dataset.nativeMinSize),
            maxSize: Number(node.dataset.nativeMaxSize),
            layers: [...node.querySelectorAll<HTMLElement>("[data-native-layer]")].map((layer) => ({
              id: layer.dataset.nativeLayer!,
              label: layer.querySelector("img")?.alt || "スタンプ",
              url: layer.querySelector("img")?.src || "",
              x: Number(layer.dataset.nativeX),
              y: Number(layer.dataset.nativeY),
              size: Number(layer.dataset.nativeSize),
              xId: fieldId("data-native-combo-x", layer.dataset.nativeLayer!),
              yId: fieldId("data-native-combo-y", layer.dataset.nativeLayer!),
              sizeId: fieldId("data-native-combo-size", layer.dataset.nativeLayer!),
              removeId: fieldId("data-native-combo-remove", layer.dataset.nativeLayer!),
            })),
          },
        ];
      }
      if (node instanceof HTMLLabelElement) {
        const file = node.querySelector<HTMLInputElement>('input[type="file"]');
        if (file)
          return [
            {
              id,
              kind: "button",
              label: label(node),
              disabled: file.disabled,
              onClick: () => click(file),
            },
          ];
      }
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        if (node instanceof HTMLInputElement && node.type === "hidden") return [];
        const type = node instanceof HTMLInputElement ? node.type : "textarea";
        if (type === "file")
          return [
            {
              id,
              kind: "button",
              label: label(node),
              disabled: node.disabled,
              onClick: () => click(node),
            },
          ];
        if (type === "checkbox" || type === "radio")
          return [
            {
              id,
              kind: "toggle",
              label: label(node),
              value: String((node as HTMLInputElement).checked),
              disabled: node.disabled,
              onChange: (value) => change(node, value),
            },
          ];
        return [
          {
            id,
            kind: "input",
            label: label(node),
            value: node.value,
            disabled: node.disabled,
            readOnly: node.readOnly,
            multiline: type === "textarea",
            secret: type === "password",
            onChange: (value) => change(node, value),
            onSelection: (start, end) => {
              if (
                type === "textarea" ||
                ["text", "search", "password", "tel", "url"].includes(type)
              )
                node.setSelectionRange(start, end);
            },
          },
        ];
      }
      if (node instanceof HTMLSelectElement)
        return [
          {
            id,
            kind: "select",
            label:
              node.labels?.[0]?.textContent?.trim() || node.getAttribute("aria-label") || "選択",
            value: node.value,
            options: [...node.options].map((option) => ({
              value: option.value,
              label: option.text,
            })),
            disabled: node.disabled,
            onChange: (value) => change(node, value),
          },
        ];
      if (
        node instanceof HTMLButtonElement ||
        (node instanceof HTMLAnchorElement && node.hasAttribute("href")) ||
        node.getAttribute("role") === "button" ||
        node.getAttribute("role") === "switch" ||
        node.getAttribute("data-native-action") === "true"
      ) {
        const element = node as HTMLElement;
        const disabled =
          node.getAttribute("aria-disabled") === "true" ||
          (node instanceof HTMLButtonElement && node.disabled);
        const image = node.querySelector("img");
        const title = label(node);
        if (node.getAttribute("role") === "switch")
          return [
            {
              id,
              kind: "toggle",
              label: title,
              value: String(node.getAttribute("aria-checked") === "true"),
              disabled,
              onChange: (value) => {
                if (value !== String(node.getAttribute("aria-checked") === "true")) click(element);
              },
            },
          ];
        const secondary = node.getAttribute("data-native-context") === "true";
        return [
          {
            id,
            kind: "button",
            label: title,
            disabled,
            primary:
              node.getAttribute("aria-current") === "page" ||
              node.getAttribute("aria-pressed") === "true" ||
              node.getAttribute("aria-selected") === "true",
            symbol:
              node.querySelector("[data-call-icon]")?.getAttribute("data-call-icon") ?? undefined,
          caption: node.getAttribute("data-native-caption") || node.textContent?.trim() || title,
            danger:
              /vy-danger|text-red|bg-red/.test(node.className) ||
              node.querySelector('[data-call-icon="hangup"]') !== null,
            url: imageUrl(image?.currentSrc || image?.src),
            showLabel: !!node.textContent?.trim(),
            onClick: () => click(element),
            secondary,
            onSecondary: secondary
              ? (x, y) => {
                  element.dispatchEvent(
                    new MouseEvent("contextmenu", {
                      bubbles: true,
                      cancelable: true,
                      clientX: x,
                      clientY: y,
                    }),
                  );
                  schedule.current();
                }
              : undefined,
          },
        ];
      }
      if (node instanceof HTMLImageElement)
        return [
          {
            id,
            kind: "image",
            label: node.alt || "画像",
            url: imageUrl(node.currentSrc || node.src),
          },
        ];
      if (
        node instanceof HTMLCanvasElement ||
        ((node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) && node.srcObject)
      )
        return [
          {
            id,
            kind: "media",
            label: node.getAttribute("aria-label") || "映像",
            value: node instanceof HTMLCanvasElement ? "canvas" : "stream",
            mediaId: registerControllerMedia(mediaOwner.current, node, accountId),
            mediaVersion:
              node instanceof HTMLCanvasElement
                ? `${node.width}:${node.height}`
                : String((node.srcObject as MediaStream | null)?.id ?? ""),
          },
        ];
      if (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) {
        const autoplay = node.autoplay || node.getAttribute("data-native-autoplay") === "true";
        if (node.autoplay) {
          node.setAttribute("data-native-autoplay", "true");
          node.autoplay = false;
          node.pause();
        }
        if (node.preload !== "none") node.preload = "none";
        return [
          {
            id,
            kind: "media",
            label: node.getAttribute("aria-label") || "メディア",
            value: node instanceof HTMLVideoElement ? "video" : "audio",
            url: node.currentSrc || node.src,
            autoplay,
          },
        ];
      }
      if (
        node.matches("h1,h2,h3,h4,h5,h6,p,pre,output,legend") &&
        !node.querySelector("button,input,select,textarea,a[href]")
      )
        return node.textContent?.trim()
          ? [
              {
                id,
                kind: "text",
                label: node.textContent.trim(),
                live: node.getAttribute("role") === "status" || node.hasAttribute("aria-live"),
              },
            ]
          : [];
      const children = [...node.children].flatMap(project);
      if (node.getAttribute("data-native-strip") === "true")
        return [{ id, kind: "strip", label: "", items: children }];
      if (node.tagName === "NAV")
        return [
          {
            id,
            kind: "navigation",
            label: node.getAttribute("aria-label") || "カテゴリ",
            items: children,
          },
        ];
      if (node.classList.contains("vy-settings-card"))
        return [{ id, kind: "section", label: "", items: children }];
      if (!node.children.length && node.textContent?.trim())
        return [{ id, kind: "text", label: node.textContent.trim() }];
      // Settings' existing preference row supplies the label and explanation for its control.
      if (node.classList.contains("vy-settings-row")) {
        const controls = children.filter((child) => child.kind !== "text");
        const text = children.filter((child) => child.kind === "text");
        if (controls.length === 1 && text.length)
          return [
            {
              ...controls[0]!,
              label: text[0]!.label,
              description: text
                .slice(1)
                .map((entry) => entry.label)
                .join("\n"),
            },
          ];
      }
      if (
        node.classList.contains("grid") &&
        children.length > 1 &&
        children.every((child) => child.kind === "button" && child.url)
      )
        return [{ id, kind: "grid", label: "", items: children }];
      const ownText = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent?.trim())
        .filter(Boolean)
        .join(" ");
      return ownText ? [{ id: `${id}-text`, kind: "text", label: ownText }, ...children] : children;
    };
    const sync = () => {
      frame = 0;
      if (disposed) return;
      const dialogs = [...root.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"]')];
      const current = dialogs.at(-1) ?? root;
      const menu = root.querySelector<HTMLElement>('[role="menu"]');
      if (menu) {
        const controls = [...menu.children]
          .flatMap(project)
          .filter((item) => item.kind === "button");
        const signature = JSON.stringify(controls);
        if (signature !== menuSignature) {
          menuSignature = signature;
          publishNativeMenu(menuOwner.current, {
            accountId,
            getAccountId: () => useStore.getState().accountId,
            x: parseFloat(menu.style.left) || 16,
            y: parseFloat(menu.style.top) || 16,
            items: controls.map((control) => ({
              label: control.label,
              danger: control.danger,
              onClick: () => {
                void control.onClick?.();
              },
            })),
            onClose: () => {
              menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
              menu.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')?.click();
              schedule.current();
            },
          });
        }
      } else if (menuSignature) {
        menuSignature = "";
        unpublishNativeMenu(menuOwner.current);
      }
      const close =
        current === root
          ? undefined
          : () => {
              const button = current.querySelector<HTMLButtonElement>(
                'button[aria-label="閉じる"]',
              );
              if (button) click(button);
              else if (current instanceof HTMLDialogElement)
                current.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
              else closeRef.current();
            };
      const callLayout =
        root.querySelector<HTMLElement>("[data-call-panel]")?.dataset.callPanel ??
        (persistent && root.querySelector('[role="alert"]') ? "incoming" : undefined);
      const next = {
        title: current.getAttribute("aria-label") || titleRef.current,
        items: [...current.children].flatMap(project),
        close,
        modal: current !== root,
        callLayout,
        compact: callLayout === "minimized" || callLayout === "incoming",
      };
      setPresentation((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    schedule.current = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(sync);
    };
    const observer = new MutationObserver(schedule.current);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    root.addEventListener("load", schedule.current, true);
    root.addEventListener("loadedmetadata", schedule.current, true);
    sync();
    return () => {
      disposed = true;
      observer.disconnect();
      root.removeEventListener("load", schedule.current, true);
      root.removeEventListener("loadedmetadata", schedule.current, true);
      cancelAnimationFrame(frame);
      schedule.current = () => {};
      unpublishNativeMenu(menuOwner.current);
      releaseControllerMedia(mediaOwner.current);
    };
  }, [accountId, native]);
  usePublishNativePanel(
    {
      accountId,
      title: presentation.title,
      items: presentation.items,
      onClose: presentation.close ?? onClose,
      modal: presentation.modal,
      compact: presentation.compact,
      callLayout: presentation.callLayout,
      chatId: onSnapshot ? chatId : undefined,
      persistent,
    },
    native,
    onSnapshot,
  );
  useLayoutEffect(() => schedule.current());
  return (
    <ControllerPresentation.Provider value={native ? container : null}>
      <div
        ref={container}
        data-native-controller={native ? "" : undefined}
        aria-hidden={native || undefined}
        inert={native}
        style={
          native
            ? {
                position: "fixed",
                left: 0,
                top: 0,
                width: 900,
                height: 900,
                overflow: "hidden",
                transform: "translateX(-10000px)",
                contain: "strict",
                opacity: 0,
                pointerEvents: "none",
              }
            : { display: "contents" }
        }
      >
        {mounted ? children : null}
      </div>
    </ControllerPresentation.Provider>
  );
}
