(() => {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem("vyline-docs-theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    root.dataset.theme = storedTheme;
  } else if (matchMedia("(prefers-color-scheme: dark)").matches) {
    root.dataset.theme = "dark";
  }

  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("vyline-docs-theme", next);
  });

  const githubIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1.01.07 1.54 1.06 1.54 1.06.89 1.57 2.35 1.12 2.92.85.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.32 9.32 0 0 1 12 6.66c.85 0 1.7.12 2.5.35 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.8-4.58 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"/>
    </svg>`;
  document.querySelectorAll('a.icon-btn[href*="github.com"]').forEach((link) => {
    link.innerHTML = githubIcon;
    link.setAttribute("aria-label", "GitHub");
    link.setAttribute("title", "GitHub");
  });

  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    const navItems = [
      ["はじめに", [["ドキュメント", "/docs/"], ["Quick Start", "/docs/quick-start/"]]],
      ["インストール", [
        ["Linux", "/docs/linux/"],
        ["Raspberry Pi", "/docs/raspberry-pi/"],
        ["__android__", [
          ["セットアップ", "/docs/android/"],
          ["Kernel", "/docs/android-kernel/"],
          ["Networking", "/docs/android-network/"],
          ["詳細ガイド", "/docs/android-complete/"],
        ]],
      ]],
      ["運用", [["Portainer（任意）", "/docs/portainer/"], ["外部アクセス（任意）", "/docs/remote-access/"], ["更新とバックアップ", "/docs/updates-backups/"]]],
      ["仕組み", [["Architecture", "/docs/architecture/"], ["LINE Protocol & E2EE", "/docs/protocol/"], ["Persistence & Storage", "/docs/persistence/"], ["Access Model & Security", "/docs/access-model/"]]],
      ["開発", [["Submodules & Source Map", "/docs/submodules/"], ["Developer Guide", "/docs/developer/"], ["Plugins & Themes", "/docs/plugins-themes/"]]],
      ["リファレンス", [["Configuration Reference", "/docs/configuration/"], ["Troubleshooting", "/docs/troubleshooting/"], ["A–Z Index", "/docs/index-a-z/"]]],
    ];
    const currentPath = location.pathname.endsWith("/") ? location.pathname : `${location.pathname}/`;
    const link = ([label, href]) => `<a class="nav-link${currentPath === href ? " active" : ""}" href="${href}">${label}</a>`;
    sidebar.innerHTML = navItems.map(([title, items]) => {
      const links = items.map((item) => {
        if (item[0] !== "__android__") return link(item);
        const children = item[1];
        const active = children.some(([, href]) => href === currentPath);
        return `<div class="nav-tree${active ? " open" : ""}">
          <button class="nav-parent" type="button" aria-expanded="${active ? "true" : "false"}">
            <span>Android</span>
            <svg class="nav-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5 5-5 5"/></svg>
          </button>
          <div class="nav-children-wrap"><div class="nav-children">${children.map(link).join("")}</div></div>
        </div>`;
      }).join("");
      return `<div class="nav-group"><div class="nav-title">${title}</div>${links}</div>`;
    }).join("");

    sidebar.querySelectorAll(".nav-tree").forEach((tree) => {
      const toggle = tree.querySelector(".nav-parent");
      toggle?.addEventListener("click", () => {
        const open = tree.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
      });
    });
  }
  document.querySelector("[data-menu]")?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
  });
  sidebar?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => sidebar.classList.remove("open"));
  });

  document.querySelectorAll(".content pre").forEach((pre) => {
    const button = document.createElement("button");
    button.className = "copy";
    button.type = "button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "コードをコピー");
    button.addEventListener("click", async () => {
      try {
        const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
        await navigator.clipboard.writeText(code);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Failed";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 1200);
    });
    pre.prepend(button);
  });

  document.querySelectorAll(".content h2[id], .content h3[id]").forEach((heading) => {
    const anchor = document.createElement("a");
    anchor.className = "anchor";
    anchor.href = `#${heading.id}`;
    anchor.textContent = "#";
    anchor.setAttribute("aria-label", `${heading.textContent ?? "見出し"}へのリンク`);
    heading.append(anchor);
  });

  const tocLinks = [...document.querySelectorAll(".toc a")];
  const tocHeadings = tocLinks
    .map((link) => document.querySelector(link.getAttribute("href") ?? ""))
    .filter((heading) => heading instanceof HTMLElement);
  if (tocLinks.length && tocHeadings.length) {
    let scheduled = false;
    const updateToc = () => {
      scheduled = false;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let activeId = atBottom ? tocHeadings.at(-1)?.id : tocHeadings[0]?.id;
      if (!atBottom) {
        const marker = window.scrollY + 96;
        for (const heading of tocHeadings) {
          if (heading.offsetTop <= marker) activeId = heading.id;
          else break;
        }
      }
      tocLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${activeId}`));
    };
    const scheduleToc = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(updateToc);
    };
    addEventListener("scroll", scheduleToc, { passive: true });
    addEventListener("resize", scheduleToc);
    updateToc();
  }

  const pages = [
    ["ドキュメント", "/docs/", "導入・運用・内部構造・開発資料", "overview start docs wiki documentation"],
    ["Quick Start", "/docs/quick-start/", "Docker Composeで起動する最短手順", "docker compose install start"],
    ["Linux", "/docs/linux/", "Linuxホストへの導入", "ubuntu debian fedora rhel arch opensuse alpine"],
    ["Raspberry Pi", "/docs/raspberry-pi/", "Raspberry Pi OS 64-bitでの運用", "raspberry pi arm64 aarch64"],
    ["Android / セットアップ", "/docs/android/", "root済みarm64 AndroidをDockerホスト化する入口", "android termux chroot docker root"],
    ["Android / Kernel", "/docs/android-kernel/", "AndroidでDockerを動かすkernel要件", "kernel config cgroup overlayfs netfilter"],
    ["Android / Networking", "/docs/android-network/", "Android固有のDockerネットワーク診断", "iptables routing netd bridge dnat nft legacy"],
    ["Android / 詳細ガイド", "/docs/android-complete/", "Android構築を最初から最後まで詳説", "android complete setup termux chroot overlay f2fs"],
    ["Portainer（任意）", "/docs/portainer/", "任意のDocker管理UI", "portainer stack redeploy optional"],
    ["外部アクセス（任意）", "/docs/remote-access/", "必要な場合だけ使うTailscale・Cloudflare等の外部アクセス構成", "remote tailscale cloudflare tunnel access optional"],
    ["更新とバックアップ", "/docs/updates-backups/", "更新・バックアップ・復元", "update backup restore ghcr"],
    ["Architecture", "/docs/architecture/", "Frontend・Backend・Protocolの責務", "architecture frontend backend protocol"],
    ["Protocol & E2EE", "/docs/protocol/", "ログイン・transport・E2EE・Talk", "protocol e2ee login talk rpc"],
    ["Persistence", "/docs/persistence/", "data・storage・DB・メディア", "storage data sqlite media backup"],
    ["Access Model", "/docs/access-model/", "LAN・サブデバイス・remote owner", "security lan subdevice remote owner"],
    ["Configuration", "/docs/configuration/", "Composeと環境変数", "env environment variable port host"],
    ["Submodules", "/docs/submodules/", "protocol・plugin・themes・tools", "git submodule source map"],
    ["Developer Guide", "/docs/developer/", "開発環境・検証コマンド", "developer bun typecheck lint test"],
    ["Plugins & Themes", "/docs/plugins-themes/", "Plugin SDKとテーマ", "plugin theme sdk permissions"],
    ["Troubleshooting", "/docs/troubleshooting/", "症状別の切り分け", "error troubleshooting logs healthz"],
    ["A–Z Index", "/docs/index-a-z/", "用語と設定名から探す", "index glossary"],
  ];

  const dialog = document.querySelector(".search-modal");
  const input = document.querySelector(".search-input");
  const results = document.querySelector(".results");

  const openSearch = () => {
    if (!(dialog instanceof HTMLDialogElement)) return;
    dialog.showModal();
    requestAnimationFrame(() => input?.focus());
  };

  document.querySelector("[data-search]")?.addEventListener("click", openSearch);
  addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    } else if (event.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
      event.preventDefault();
      openSearch();
    }
  });

  input?.addEventListener("input", () => {
    if (!results) return;
    const query = input.value.trim().toLowerCase();
    if (!query) {
      results.innerHTML = '<div class="search-empty">ページ名・設定名・コマンドで検索</div>';
      return;
    }
    const terms = query.split(/\s+/);
    const matches = pages.filter(([title, , description, keywords]) => {
      const haystack = `${title} ${description} ${keywords}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).slice(0, 12);
    results.innerHTML = matches.length
      ? matches.map(([title, url, description]) => `<a class="result" href="${url}"><b>${title}</b><span>${description}</span></a>`).join("")
      : '<div class="search-empty">一致するページがありません</div>';
  });
})();
