(() => {
  "use strict";

  const currentScript = document.currentScript;
  const siteRoot = currentScript ? new URL("../", currentScript.src) : new URL("../", location.href);
  const toUrl = (path = "") => new URL(path.replace(/^\//, ""), siteRoot).href;

  const groups = [
    {
      label: "はじめに",
      pages: [
        ["", "ドキュメント", "導入・運用・内部設計の入口"],
        ["quick-start", "Quick Start", "Docker Compose で起動する"],
      ],
    },
    {
      label: "セットアップ",
      pages: [
        ["configuration", "設定", "Compose と環境変数"],
        ["linux", "Linux", "一般的な Linux ホスト"],
        ["raspberry-pi", "Raspberry Pi / SBC", "arm64 SBC での運用"],
        ["portainer", "Portainer", "Stack と更新"],
        ["remote-access", "外部アクセス", "VPN / Access / reverse proxy"],
      ],
    },
    {
      label: "データと運用",
      pages: [
        ["persistence", "永続化", "data / storage の役割"],
        ["updates-backups", "更新とバックアップ", "recreate と退避"],
        ["access-model", "アクセス制御", "LAN と owner trust"],
      ],
    },
    {
      label: "Android ホスト",
      pages: [
        ["android", "Android", "root 済み端末を Docker ホストにする"],
        ["android-kernel", "Kernel 要件", "cgroup / namespaces / overlay"],
        ["android-network", "Network", "netd と Docker bridge"],
        ["android-complete", "完全構築ガイド", "Android ホストの通し手順"],
      ],
    },
    {
      label: "仕組み",
      pages: [
        ["architecture", "Architecture", "Frontend から LINE まで"],
        ["protocol", "Protocol / E2EE", "RPC・login・暗号化"],
        ["submodules", "Submodules", "Protocol / Plugin / Themes / Tools"],
      ],
    },
    {
      label: "開発",
      pages: [
        ["developer", "Developer Guide", "Bun とモノレポの開発手順"],
        ["plugins-themes", "Plugins / Themes", "拡張 API と preset"],
      ],
    },
    {
      label: "リファレンス",
      pages: [
        ["troubleshooting", "Troubleshooting", "症状から切り分ける"],
        ["index-a-z", "A–Z Index", "用語と設定の索引"],
      ],
    },
  ];

  const searchHints = {
    "": "docs wiki overview getting started",
    "quick-start": "docker compose ghcr install 3000 data storage",
    configuration: "env environment VYLINE_BIND_ADDRESS PORT LAN_ACCESS TRUST_REMOTE_OWNER timezone",
    linux: "linux docker amd64 arm64 debian ubuntu fedora arch opensuse alpine",
    "raspberry-pi": "raspberry pi sbc arm64 aarch64 storage memory",
    portainer: "portainer stack redeploy pull image",
    "remote-access": "tailscale wireguard cloudflare access tunnel reverse proxy internet",
    persistence: "data storage database media cache token session bind mount",
    "updates-backups": "backup restore docker pull recreate update snapshot",
    "access-model": "security lan owner trust proxy token session access",
    android: "android root docker host termux chroot arm64",
    "android-kernel": "kernel cgroup namespace overlayfs binder selinux config",
    "android-network": "android network netd iptables nft bridge routing docker0",
    "android-complete": "android complete guide docker termux kernel network restore",
    architecture: "react vite hono bun backend frontend service client manager architecture",
    protocol: "protocol rpc thrift e2ee letter sealing login talk obs",
    submodules: "git submodule vyline-api vyline-plugin vyline-theme vyline-search",
    developer: "development bun typecheck lint test build workspace",
    "plugins-themes": "plugin sdk permissions theme vytheme preset",
    troubleshooting: "error issue logs healthz permissions network storage login",
    "index-a-z": "index glossary reference",
  };

  const flatPages = groups.flatMap((group) => group.pages.map(([slug, title, desc]) => ({ slug, title, desc, group: group.label })));

  const body = document.body;
  if (!body.classList.contains("docs")) return;

  const currentSlug = body.dataset.page || "";
  const main = document.querySelector(".doc-main");
  const article = document.querySelector(".doc-content");
  if (!main || !article) return;

  const svg = {
    menu: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    theme: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.4 0-.8-.1-1.2A7 7 0 0 1 12 3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    github: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8a9.4 9.4 0 0 0-3 18.3c.5.1.6-.2.6-.5v-1.8c-2.7.6-3.3-1.1-3.3-1.1-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.6 2.4 1.1 2.9.9.1-.7.4-1.1.7-1.3-2.2-.3-4.5-1.1-4.5-4.7 0-1 .4-1.9 1-2.6-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.7.7 1 1.6 1 2.6 0 3.6-2.3 4.4-4.5 4.7.4.3.7.9.7 1.7v2.5c0 .3.2.6.7.5A9.4 9.4 0 0 0 12 2.8Z" fill="currentColor"/></svg>',
  };

  const header = document.createElement("header");
  header.className = "docs-header";
  header.innerHTML = `
    <button class="icon-button menu-button" type="button" data-menu aria-label="ナビゲーションを開く">${svg.menu}</button>
    <a class="docs-brand" href="${toUrl("")}"><img src="${toUrl("assets/mark.svg")}" alt=""><span>Vyline</span><small>Docs</small></a>
    <div class="header-spacer"></div>
    <button class="docs-search" type="button" data-search aria-label="ドキュメントを検索">${svg.search}<span>ドキュメントを検索</span><kbd>Ctrl K</kbd></button>
    <a class="icon-button" href="https://github.com/tqmane/vyline" aria-label="GitHub">${svg.github}</a>
    <button class="icon-button" type="button" data-theme-toggle aria-label="配色を切り替える">${svg.theme}</button>`;

  const sidebar = document.createElement("aside");
  sidebar.className = "docs-sidebar";
  sidebar.setAttribute("aria-label", "ドキュメント");
  for (const group of groups) {
    const section = document.createElement("nav");
    section.className = "nav-section";
    const heading = document.createElement("p");
    heading.className = "nav-section-title";
    heading.textContent = group.label;
    section.appendChild(heading);
    for (const [slug, title] of group.pages) {
      const link = document.createElement("a");
      link.className = "nav-link";
      link.href = toUrl(slug ? `docs/${slug}/` : "docs/");
      link.textContent = title;
      if (slug === currentSlug) link.setAttribute("aria-current", "page");
      section.appendChild(link);
    }
    sidebar.appendChild(section);
  }

  const toc = document.createElement("aside");
  toc.className = "docs-toc";
  toc.setAttribute("aria-label", "このページの目次");
  const tocHeading = document.createElement("p");
  tocHeading.className = "toc-label";
  tocHeading.textContent = "このページ";
  toc.appendChild(tocHeading);

  const shell = document.createElement("div");
  shell.className = "docs-shell";
  main.before(header);
  main.before(shell);
  shell.append(sidebar, main, toc);

  const makeSlug = (text) => text
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const headings = [...article.querySelectorAll("h2, h3")];
  headings.forEach((heading, index) => {
    if (!heading.id) heading.id = makeSlug(heading.textContent) || `section-${index + 1}`;
    const anchor = document.createElement("a");
    anchor.className = "heading-anchor";
    anchor.href = `#${heading.id}`;
    anchor.textContent = "#";
    anchor.setAttribute("aria-label", "この見出しへのリンク");
    heading.appendChild(anchor);

    const link = document.createElement("a");
    link.className = `toc-link level-${heading.tagName === "H3" ? "3" : "2"}`;
    link.href = `#${heading.id}`;
    link.textContent = heading.childNodes[0]?.textContent?.trim() || heading.textContent.replace(/#$/, "").trim();
    toc.appendChild(link);
  });

  if (!headings.length) toc.hidden = true;

  article.querySelectorAll("pre").forEach((pre) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector("code")?.textContent || pre.textContent || "");
        button.textContent = "Copied";
        setTimeout(() => { button.textContent = "Copy"; }, 1200);
      } catch {
        button.textContent = "Select";
      }
    });
    pre.appendChild(button);
  });

  const currentIndex = flatPages.findIndex((page) => page.slug === currentSlug);
  if (currentIndex >= 0) {
    const nav = document.createElement("nav");
    nav.className = "page-footer-nav";
    nav.setAttribute("aria-label", "前後のページ");
    const previous = flatPages[currentIndex - 1];
    const next = flatPages[currentIndex + 1];
    if (previous) {
      const link = document.createElement("a");
      link.href = toUrl(previous.slug ? `docs/${previous.slug}/` : "docs/");
      link.innerHTML = `<small>前へ</small>${previous.title}`;
      nav.appendChild(link);
    } else {
      nav.appendChild(document.createElement("span"));
    }
    if (next) {
      const link = document.createElement("a");
      link.className = "next";
      link.href = toUrl(next.slug ? `docs/${next.slug}/` : "docs/");
      link.innerHTML = `<small>次へ</small>${next.title}`;
      nav.appendChild(link);
    }
    article.appendChild(nav);
  }

  const dialog = document.createElement("dialog");
  dialog.className = "search-dialog";
  dialog.innerHTML = `
    <form class="search-box" method="dialog">
      ${svg.search}
      <input type="search" autocomplete="off" spellcheck="false" placeholder="ページ名・設定名・用語" aria-label="検索語">
      <button value="cancel" aria-label="閉じる">Esc</button>
    </form>
    <div class="search-results"><div class="search-empty">ページ名、設定名、用語を入力してください。</div></div>`;
  body.appendChild(dialog);

  const input = dialog.querySelector("input");
  const results = dialog.querySelector(".search-results");
  const openSearch = () => {
    if (!dialog.open) dialog.showModal();
    input?.focus();
  };

  const renderSearch = () => {
    if (!input || !results) return;
    const query = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (!query) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "ページ名、設定名、用語を入力してください。";
      results.appendChild(empty);
      return;
    }
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = flatPages
      .map((page) => {
        const title = page.title.toLowerCase();
        const haystack = `${page.title} ${page.desc} ${page.group} ${searchHints[page.slug] || ""}`.toLowerCase();
        const score = terms.reduce((total, term) => total + (title.includes(term) ? 8 : 0) + (haystack.includes(term) ? 2 : 0), 0);
        return { page, score };
      })
      .filter(({ score }) => score >= terms.length * 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "一致するページがありません。";
      results.appendChild(empty);
      return;
    }
    for (const { page } of matches) {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = toUrl(page.slug ? `docs/${page.slug}/` : "docs/");
      const title = document.createElement("b");
      title.textContent = page.title;
      const desc = document.createElement("span");
      desc.textContent = page.desc;
      link.append(title, desc);
      results.appendChild(link);
    }
  };

  header.querySelector("[data-search]")?.addEventListener("click", openSearch);
  input?.addEventListener("input", renderSearch);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  const savedTheme = localStorage.getItem("vyline-docs-theme");
  if (savedTheme === "dark" || savedTheme === "light") {
    document.documentElement.dataset.theme = savedTheme;
  } else if (matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.dataset.theme = "dark";
  }
  header.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("vyline-docs-theme", next);
  });

  header.querySelector("[data-menu]")?.addEventListener("click", () => sidebar.classList.toggle("open"));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a")) sidebar.classList.remove("open");
  });

  addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    } else if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      openSearch();
    }
  });

  const tocLinks = [...toc.querySelectorAll(".toc-link")];
  if (tocLinks.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        tocLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
      }
    }, { rootMargin: "-90px 0px -68% 0px" });
    headings.filter((heading) => heading.tagName === "H2").forEach((heading) => observer.observe(heading));
  }
})();