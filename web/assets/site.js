(async () => {
  const doc = document.documentElement;
  const script = document.currentScript;
  const assetUrl = script?.src || document.querySelector('link[href*="assets/site.css"]')?.href;
  const siteRoot = assetUrl ? new URL("../", assetUrl) : new URL("./", location.href);
  const sourceRoot = new URL("site-src/", siteRoot);
  let config = null;
  let searchIndex = null;

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);

  const loadConfig = async () => {
    if (config) return config;
    const response = await fetch(new URL("content.json", sourceRoot));
    if (!response.ok) throw new Error(`content.json: ${response.status}`);
    config = await response.json();
    return config;
  };

  const pageHref = (page) => new URL(page.slug ? `docs/${page.slug}/` : "docs/", siteRoot).href;

  const renderSidebar = (cfg, currentId) => {
    const pages = new Map(cfg.pages.map((page) => [page.id, page]));
    return cfg.nav.map((group) => `
      <div class="docs-nav-group">
        <strong>${escapeHtml(group.label)}</strong>
        ${group.pages.map((id) => {
          const page = pages.get(id);
          if (!page) return "";
          const current = id === currentId ? ' aria-current="page"' : "";
          return `<a href="${pageHref(page)}"${current}>${escapeHtml(page.title)}</a>`;
        }).join("")}
      </div>`).join("");
  };

  const searchDialog = () => `<div class="search-dialog" data-search-dialog hidden>
    <div class="search-panel" role="dialog" aria-modal="true" aria-label="ドキュメント検索">
      <div class="search-input-row">
        <input type="search" autocomplete="off" placeholder="検索" aria-label="ドキュメントを検索" data-search-input>
        <button class="search-close" type="button" data-search-close>Esc</button>
      </div>
      <div class="search-results" data-search-results></div>
    </div>
  </div>`;

  const renderDoc = async () => {
    const pageId = doc.dataset.pageId;
    if (!pageId) return;
    const cfg = await loadConfig();
    const page = cfg.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error(`Unknown docs page: ${pageId}`);

    const response = await fetch(new URL(`pages/${page.id}.html`, sourceRoot));
    if (!response.ok) throw new Error(`${page.id}.html: ${response.status}`);
    let body = await response.text();
    body = body
      .replaceAll("{{root}}", siteRoot.href)
      .replaceAll("{{repository}}", cfg.site.repository)
      .replaceAll("{{version}}", cfg.site.version);

    const title = page.id === "overview" ? "Vyline Docs" : `${page.title} · Vyline Docs`;
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", page.lead);
    document.body.className = "docs-page";
    document.body.innerHTML = `
      <a class="skip-link" href="#main">本文へ移動</a>
      <header class="docs-topbar">
        <a class="docs-brand" href="${siteRoot.href}">
          <img src="${new URL("assets/mark.svg", siteRoot).href}" width="24" height="24" alt="">
          <span>Vyline <small>Docs</small></span>
        </a>
        <div class="docs-top-actions">
          <button class="docs-nav-toggle" type="button" aria-label="ナビゲーションを開く" aria-expanded="false" data-nav-toggle>☰</button>
          <button class="docs-search-button" type="button" data-search-open><span>ドキュメントを検索</span><kbd>Ctrl K</kbd></button>
          <a class="docs-github" href="${cfg.site.repository}">GitHub</a>
        </div>
      </header>
      <div class="docs-shell">
        <aside class="docs-sidebar" aria-label="ドキュメント">${renderSidebar(cfg, page.id)}</aside>
        <div class="docs-content-shell">
          <main class="docs-main" id="main">
            <article class="doc-article">
              <nav class="doc-breadcrumb" aria-label="パンくず"><a href="${new URL("docs/", siteRoot).href}">Docs</a> / <span>${escapeHtml(page.section)}</span></nav>
              <h1>${escapeHtml(page.title)}</h1>
              <p class="doc-lead">${escapeHtml(page.lead)}</p>
              <div class="doc-body">${body}</div>
              <footer class="doc-footer"><span>Vyline v${escapeHtml(cfg.site.version)}</span><a href="${cfg.site.repository}">tqmane/vyline</a></footer>
            </article>
          </main>
          <aside class="doc-toc" aria-label="このページの目次"><strong>On this page</strong><nav data-toc></nav></aside>
        </div>
      </div>
      ${searchDialog()}`;
  };

  try {
    await renderDoc();
  } catch (error) {
    console.error(error);
    const loading = document.querySelector(".docs-loading-state");
    if (loading) loading.textContent = "ドキュメントを読み込めませんでした。ページを再読み込みしてください。";
    return;
  }

  const navToggle = document.querySelector("[data-nav-toggle]");
  if (navToggle) {
    navToggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    document.querySelectorAll(".docs-sidebar a").forEach((link) => link.addEventListener("click", () => {
      document.body.classList.remove("nav-open");
      navToggle.setAttribute("aria-expanded", "false");
    }));
  }

  document.querySelectorAll(".doc-body pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (!code) return;
    const button = document.createElement("button");
    button.className = "copy-code";
    button.type = "button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "コードをコピー");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || "");
        button.textContent = "Copied";
      } catch {
        button.textContent = "Failed";
      }
      setTimeout(() => (button.textContent = "Copy"), 1300);
    });
    pre.appendChild(button);
  });

  const toc = document.querySelector("[data-toc]");
  if (toc) {
    const headings = [...document.querySelectorAll(".doc-body h2, .doc-body h3")];
    const used = new Set();
    const slugify = (value) => {
      const base = value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
      let slug = base;
      let n = 2;
      while (used.has(slug)) slug = `${base}-${n++}`;
      used.add(slug);
      return slug;
    };
    headings.forEach((heading) => {
      if (!heading.id) heading.id = slugify(heading.textContent || "");
      else used.add(heading.id);
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent || "";
      link.dataset.level = heading.tagName === "H3" ? "3" : "2";
      toc.appendChild(link);
    });
    if (!headings.length) toc.closest(".doc-toc")?.setAttribute("hidden", "");
    if ("IntersectionObserver" in window && headings.length) {
      const links = new Map([...toc.querySelectorAll("a")].map((a) => [a.hash.slice(1), a]));
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (!visible.length) return;
        toc.querySelectorAll("a").forEach((a) => a.classList.remove("is-active"));
        links.get(visible[0].target.id)?.classList.add("is-active");
      }, { rootMargin: "-80px 0px -72% 0px", threshold: [0, 1] });
      headings.forEach((heading) => observer.observe(heading));
    }
  }

  const buildSearchIndex = async () => {
    if (searchIndex) return searchIndex;
    const cfg = await loadConfig();
    searchIndex = await Promise.all(cfg.pages.map(async (page) => {
      try {
        const response = await fetch(new URL(`pages/${page.id}.html`, sourceRoot));
        const source = response.ok ? await response.text() : "";
        const parsed = new DOMParser().parseFromString(source, "text/html");
        return { ...page, text: parsed.body.textContent || "" };
      } catch {
        return { ...page, text: "" };
      }
    }));
    return searchIndex;
  };

  const dialog = document.querySelector("[data-search-dialog]");
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
  const renderResults = async (query) => {
    if (!results) return;
    const q = query.trim().toLowerCase();
    results.replaceChildren();
    if (!q) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "ページ名、設定名、コンポーネント名で検索";
      results.appendChild(empty);
      return;
    }
    const entries = await buildSearchIndex();
    const matches = entries.map((item) => {
      const haystack = `${item.title} ${item.lead} ${item.text}`.toLowerCase();
      const pos = haystack.indexOf(q);
      return pos < 0 ? null : { item, score: pos + (item.title.toLowerCase().includes(q) ? -500 : 0) };
    }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 12);
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "一致するページがありません";
      results.appendChild(empty);
      return;
    }
    matches.forEach(({ item }) => {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = pageHref(item);
      const title = document.createElement("strong");
      title.textContent = item.title;
      const lead = document.createElement("span");
      lead.textContent = item.lead;
      link.append(title, lead);
      results.appendChild(link);
    });
  };
  const openSearch = async () => {
    if (!dialog || !input) return;
    dialog.hidden = false;
    document.body.style.overflow = "hidden";
    input.focus();
    await renderResults(input.value);
  };
  const closeSearch = () => {
    if (!dialog) return;
    dialog.hidden = true;
    document.body.style.overflow = "";
  };
  document.querySelectorAll("[data-search-open]").forEach((button) => button.addEventListener("click", openSearch));
  document.querySelector("[data-search-close]")?.addEventListener("click", closeSearch);
  input?.addEventListener("input", () => renderResults(input.value));
  dialog?.addEventListener("click", (event) => { if (event.target === dialog) closeSearch(); });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    } else if (event.key === "Escape" && dialog && !dialog.hidden) closeSearch();
  });
})();
