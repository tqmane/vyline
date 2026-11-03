import { afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FlexMessageView } from "./flex-message";
import { RichMessageView } from "./rich-message";
import { openFlexAction } from "../lib/flex/tokens";
import type { FlexContainer, RichMarkup } from "../lib/flex/types";
import { useStore } from "../lib/store";

const url = "https://privacy.example/secret";
const initial = useStore.getInitialState();
const originalState = useStore.getState();
const originalSettings = initial.settings;
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  mock.restore();
  initial.settings = originalSettings;
  useStore.setState(originalState, true);
  for (const [key, descriptor] of [["window", windowDescriptor], ["navigator", navigatorDescriptor]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function settings(maskUrls: boolean, streamerMode = true) {
  const next = { ...originalSettings, streamerMode, streamerMaskNames: false,
    streamerMaskAvatars: false, streamerMaskUrls: maskUrls };
  useStore.setState({ settings: next });
  // React's server renderer reads Zustand's initial snapshot.
  initial.settings = next;
  return next;
}

const flex: FlexContainer = { type: "carousel", contents: [{ type: "bubble", action: { type: "uri", uri: url },
  body: { type: "box", layout: "vertical", action: { type: "uri", uri: url }, contents: [
    { type: "text", text: url },
    { type: "text", contents: [{ type: "span", text: url }] },
    { type: "span", text: url },
    { type: "image", url: "/demo/image.png", action: { type: "uri", uri: url, label: url } },
    { type: "icon", url: "/demo/icon.png", action: { type: "uri", uri: url, label: url } },
    { type: "button", action: { type: "clipboard", text: url, label: url } },
  ] } }] };
const rich: RichMarkup = { canvas: { width: 100, height: 100, initialScene: "scene" },
  scenes: { scene: { listeners: [{ action: "open", params: [0, 0, 100, 100] }] } },
  actions: { open: { type: "uri", text: url, params: { linkUri: url } } } };

test("Flex masks nested text, span/button/accessibility labels and fallback without mutating its source", () => {
  settings(true);
  const before = JSON.stringify(flex);
  const html = renderToStaticMarkup(<FlexMessageView container={flex} altText={url} />);
  expect(html).not.toContain(url);
  expect(html).toContain("[URL]");
  expect(html).not.toContain('data-native-action="true"');
  expect(renderToStaticMarkup(<FlexMessageView container={null as unknown as FlexContainer} altText={url} />)).not.toContain(url);
  expect(JSON.stringify(flex)).toBe(before);
});

test("Flex retains original text and actions when URL masking is disabled independently", () => {
  settings(false);
  const html = renderToStaticMarkup(<FlexMessageView container={flex} altText={url} />);
  expect(html).toContain(url);
  expect(html).toContain('data-native-action="true"');
});

test("Rich masks fallback/image alt text and removes masked external hotspots without mutating markup", () => {
  settings(true);
  const before = JSON.stringify(rich);
  expect(renderToStaticMarkup(<RichMessageView altText={url} />)).not.toContain(url);
  const html = renderToStaticMarkup(<RichMessageView imageUrl="/demo/rich.png" markup={rich} altText={url} />);
  expect(html).not.toContain(url);
  expect(html).not.toContain("<button");
  expect(JSON.stringify(rich)).toBe(before);
});

test("Rich retains original accessibility labels and external hotspots without a URL mask", () => {
  settings(false);
  const html = renderToStaticMarkup(<RichMessageView imageUrl="/demo/rich.png" markup={rich} altText={url} />);
  expect(html).toContain(url);
  expect(html).toContain("<button");
});

function actionSpies() {
  const open = mock(() => null);
  const writeText = mock(async (_text: string) => {});
  Object.defineProperty(globalThis, "window", { configurable: true, value: { open } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText } } });
  return { open, writeText };
}

test("masked external actions neither navigate nor copy URLs; plain clipboard actions still work", () => {
  const current = settings(true);
  const { open, writeText } = actionSpies();
  const action = { type: "clipboard", text: `copy ${url}` };
  openFlexAction({ type: "uri", uri: url }, current);
  openFlexAction(action, current);
  expect(open).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  expect(action.text).toBe(`copy ${url}`);
  openFlexAction({ type: "clipboard", text: "plain code 1234" }, current);
  expect(writeText).toHaveBeenCalledWith("plain code 1234");
});

test("explicit unmasked actions dispatch their unchanged URI and clipboard data", () => {
  const { open, writeText } = actionSpies();
  for (const current of [settings(false), settings(true, false)]) {
    openFlexAction({ type: "uri", uri: url }, current);
    openFlexAction({ type: "clipboard", text: url }, current);
  }
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(writeText).toHaveBeenCalledWith(url);
});
