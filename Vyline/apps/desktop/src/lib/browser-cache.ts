/** Refresh fixed-name UI loaders even on browsers without Clear-Site-Data support. */
export async function refreshBrowserUiAssets() {
  const documents = [new URL(location.href), new URL("/dist/ui-compose/index.html", location.origin)];
  const assets = new Set<string>();
  const observed = new Set<string>();
  const collect = (timing: Performance) => {
    for (const entry of timing.getEntriesByType("resource")) {
      const url = new URL(entry.name);
      if (url.origin === location.origin && url.pathname.startsWith("/dist/ui-compose/") && !url.pathname.endsWith(".wasm")) observed.add(url.href);
    }
  };
  collect(performance);
  for (const frame of document.querySelectorAll("iframe")) {
    if (new URL(frame.src, location.href).origin !== location.origin) continue;
    // Unrelated sandboxed frames may have an opaque origin despite a same-origin src.
    try { if (frame.contentWindow) collect(frame.contentWindow.performance); } catch { /* Opaque frames are outside this app's cache scope. */ }
  }
  for (const url of documents) {
    const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
    if (!response.ok) throw new Error("画面の再取得に失敗しました。通信状態を確認してください。");
    const html = new DOMParser().parseFromString(await response.text(), "text/html");
    for (const node of html.querySelectorAll('script[src],link[rel="stylesheet"][href],link[rel="modulepreload"][href]')) {
      const asset = new URL(node.getAttribute("src") || node.getAttribute("href")!, url);
      if (asset.origin === location.origin && /^\/(assets|dist\/ui-compose|src|@vite)\//.test(asset.pathname)) assets.add(asset.href);
    }
  }
  await Promise.all([...new Set([...assets, ...observed])].map(async (url) => {
    const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
    if (response.status === 404 && !assets.has(url)) return; // Removed assets from the previous build are no longer needed.
    if (!response.ok) throw new Error("表示ファイルを更新できませんでした。もう一度お試しください。");
    await response.arrayBuffer();
  }));
}
