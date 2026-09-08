import { useStore } from "@/lib/store";

type ControllerMedia = HTMLCanvasElement | HTMLMediaElement;
const sources = new Map<string, { owner: symbol; accountId: string | null; element: ControllerMedia }>();
let sequence = 0;
const ids = new WeakMap<Element, string>();
export function registerControllerMedia(owner: symbol, element: ControllerMedia, accountId: string | null): string {
  let id = ids.get(element);
  if (!id) { id = `controller-media-${++sequence}`; ids.set(element, id); }
  sources.set(id, { owner, accountId, element });
  return id;
}
export function releaseControllerMedia(owner: symbol): void {
  for (const [id, source] of sources) if (source.owner === owner) sources.delete(id);
}
declare global { interface Window { __vylineControllerMedia?: (id: string) => ControllerMedia | undefined } }
if (typeof window !== "undefined") window.__vylineControllerMedia = (id) => {
  const source = sources.get(id);
  return source?.accountId === useStore.getState().accountId && source.element.isConnected ? source.element : undefined;
};
