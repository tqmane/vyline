(() => {
  const root = document.documentElement;
  const locale = root.lang.toLowerCase().startsWith("zh")
    ? "zh-cn"
    : root.lang.toLowerCase().startsWith("en")
      ? "en"
      : "ja";
  const localePrefixes = { ja: "", en: "/en", "zh-cn": "/zh-cn" };
  const localePrefix = localePrefixes[locale];
  const localePath = (path, targetLocale = locale) => `${localePrefixes[targetLocale]}${path}`;
  const basePath = location.pathname.replace(/^\/(?:en|zh-cn)(?=\/)/, "") || "/";
  const copyLabels = {
    ja: { copy: "Copy", copied: "Copied", failed: "Failed", aria: "コードをコピー" },
    en: { copy: "Copy", copied: "Copied", failed: "Failed", aria: "Copy code" },
    "zh-cn": { copy: "复制", copied: "已复制", failed: "失败", aria: "复制代码" },
  }[locale];
  const searchText = {
    ja: { empty: "ページ名・設定名・コマンドで検索", none: "一致するページがありません" },
    en: { empty: "Search by page, setting, or command", none: "No matching pages" },
    "zh-cn": { empty: "按页面、设置或命令搜索", none: "没有匹配的页面" },
  }[locale];
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

  const brand = document.querySelector(".docs-header .brand");
  if (brand instanceof HTMLAnchorElement) brand.href = localePath("/");

  const githubLink = document.querySelector('a.icon-btn[href*="github.com"]');
  const themeButton = document.querySelector("[data-theme-toggle]");
  if (githubLink && themeButton) {
    const actions = document.createElement("div");
    actions.className = "header-actions";

    const languageLabels = {
      ja: { short: "JA", name: "日本語" },
      en: { short: "EN", name: "English" },
      "zh-cn": { short: "中文", name: "简体中文" },
    };
    const language = document.createElement("div");
    language.className = "lang-picker";
    language.innerHTML = `
      <button class="lang-trigger" type="button" aria-label="Language" aria-haspopup="menu" aria-expanded="false">
        <svg class="lang-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h10M9 3v2m1.8 0c-.8 3.7-3.1 6.8-6.3 8.7m2.2-5.2c1.5 2.1 3.5 3.8 5.8 4.8M14 19l3.6-9 3.6 9M15.3 16h4.6"/></svg>
        <span>${languageLabels[locale].short}</span>
        <svg class="lang-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>
      </button>
      <div class="lang-menu" role="menu">
        ${Object.entries(languageLabels).map(([key, label]) => `
          <a role="menuitem" class="lang-option${key === locale ? " active" : ""}" href="${localePath(basePath, key)}${location.search}${location.hash}">
            <span>${label.name}</span><small>${label.short}</small>
          </a>`).join("")}
      </div>`;
    const languageTrigger = language.querySelector(".lang-trigger");
    languageTrigger?.addEventListener("click", () => {
      const open = language.classList.toggle("open");
      languageTrigger.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (event) => {
      if (language.contains(event.target)) return;
      language.classList.remove("open");
      languageTrigger?.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !language.classList.contains("open")) return;
      language.classList.remove("open");
      languageTrigger?.setAttribute("aria-expanded", "false");
      languageTrigger?.focus();
    });

    githubLink.before(actions);
    actions.append(language, githubLink, themeButton);
  }

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
    const navItems = {
      ja: [
        ["はじめに", [["ドキュメント", "/docs/"], ["Quick Start", "/docs/quick-start/"]]],
        ["インストール", [["Linux", "/docs/linux/"], ["Raspberry Pi", "/docs/raspberry-pi/"], ["__android__", [["セットアップ", "/docs/android/"], ["Kernel", "/docs/android-kernel/"], ["Networking", "/docs/android-network/"], ["詳細ガイド", "/docs/android-complete/"]]]]],
        ["運用", [["Portainer（任意）", "/docs/portainer/"], ["外部アクセス（任意）", "/docs/remote-access/"], ["更新とバックアップ", "/docs/updates-backups/"]]],
        ["仕組み", [["Architecture", "/docs/architecture/"], ["LINE Protocol & E2EE", "/docs/protocol/"], ["Persistence & Storage", "/docs/persistence/"], ["Access Model & Security", "/docs/access-model/"]]],
        ["開発", [["Submodules & Source Map", "/docs/submodules/"], ["Developer Guide", "/docs/developer/"], ["Plugins & Themes", "/docs/plugins-themes/"]]],
        ["リファレンス", [["Configuration Reference", "/docs/configuration/"], ["Troubleshooting", "/docs/troubleshooting/"], ["A–Z Index", "/docs/index-a-z/"]]],
      ],
      en: [
        ["GET STARTED", [["Documentation", "/docs/"], ["Quick Start", "/docs/quick-start/"]]],
        ["INSTALL", [["Linux", "/docs/linux/"], ["Raspberry Pi", "/docs/raspberry-pi/"], ["__android__", [["Setup", "/docs/android/"], ["Kernel", "/docs/android-kernel/"], ["Networking", "/docs/android-network/"], ["Complete Guide", "/docs/android-complete/"]]]]],
        ["OPERATIONS", [["Portainer (optional)", "/docs/portainer/"], ["Remote Access (optional)", "/docs/remote-access/"], ["Updates & Backups", "/docs/updates-backups/"]]],
        ["INTERNALS", [["Architecture", "/docs/architecture/"], ["LINE Protocol & E2EE", "/docs/protocol/"], ["Persistence & Storage", "/docs/persistence/"], ["Access Model & Security", "/docs/access-model/"]]],
        ["DEVELOPMENT", [["Submodules & Source Map", "/docs/submodules/"], ["Developer Guide", "/docs/developer/"], ["Plugins & Themes", "/docs/plugins-themes/"]]],
        ["REFERENCE", [["Configuration Reference", "/docs/configuration/"], ["Troubleshooting", "/docs/troubleshooting/"], ["A–Z Index", "/docs/index-a-z/"]]],
      ],
      "zh-cn": [
        ["开始使用", [["文档", "/docs/"], ["快速开始", "/docs/quick-start/"]]],
        ["安装", [["Linux", "/docs/linux/"], ["Raspberry Pi", "/docs/raspberry-pi/"], ["__android__", [["设置", "/docs/android/"], ["内核", "/docs/android-kernel/"], ["网络", "/docs/android-network/"], ["完整指南", "/docs/android-complete/"]]]]],
        ["运维", [["Portainer（可选）", "/docs/portainer/"], ["远程访问（可选）", "/docs/remote-access/"], ["更新与备份", "/docs/updates-backups/"]]],
        ["内部机制", [["架构", "/docs/architecture/"], ["LINE 协议与 E2EE", "/docs/protocol/"], ["持久化与存储", "/docs/persistence/"], ["访问模型与安全", "/docs/access-model/"]]],
        ["开发", [["子模块与源码地图", "/docs/submodules/"], ["开发者指南", "/docs/developer/"], ["插件与主题", "/docs/plugins-themes/"]]],
        ["参考", [["配置参考", "/docs/configuration/"], ["故障排查", "/docs/troubleshooting/"], ["A–Z 索引", "/docs/index-a-z/"]]],
      ],
    }[locale];
    const currentPath = basePath.endsWith("/") ? basePath : `${basePath}/`;
    const link = ([label, href]) => `<a class="nav-link${currentPath === href ? " active" : ""}" href="${localePath(href)}">${label}</a>`;
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
    button.textContent = copyLabels.copy;
    button.setAttribute("aria-label", copyLabels.aria);
    button.addEventListener("click", async () => {
      try {
        const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
        await navigator.clipboard.writeText(code);
        button.textContent = copyLabels.copied;
      } catch {
        button.textContent = copyLabels.failed;
      }
      setTimeout(() => { button.textContent = copyLabels.copy; }, 1200);
    });
    pre.prepend(button);
  });

  document.querySelectorAll(".content h2[id], .content h3[id]").forEach((heading) => {
    const anchor = document.createElement("a");
    anchor.className = "anchor";
    anchor.href = `#${heading.id}`;
    anchor.textContent = "#";
    const headingLabel = heading.textContent ?? (locale === "ja" ? "見出し" : locale === "en" ? "heading" : "标题");
    anchor.setAttribute("aria-label", locale === "ja" ? `${headingLabel}へのリンク` : locale === "en" ? `Link to ${headingLabel}` : `${headingLabel}的链接`);
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

  const pages = {
    ja: [
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
    ],
    en: [
      ["Documentation", "/docs/", "Installation, operations, internals, and development", "overview start docs wiki documentation"],
      ["Quick Start", "/docs/quick-start/", "Shortest path to start with Docker Compose", "docker compose install start"],
      ["Linux", "/docs/linux/", "Install on a Linux host", "ubuntu debian fedora rhel arch opensuse alpine"],
      ["Raspberry Pi", "/docs/raspberry-pi/", "Run on Raspberry Pi OS 64-bit", "raspberry pi arm64 aarch64"],
      ["Android / Setup", "/docs/android/", "Turn a rooted arm64 Android device into a Docker host", "android termux chroot docker root"],
      ["Android / Kernel", "/docs/android-kernel/", "Kernel requirements for Docker on Android", "kernel config cgroup overlayfs netfilter"],
      ["Android / Networking", "/docs/android-network/", "Diagnose Android-specific Docker networking", "iptables routing netd bridge dnat nft legacy"],
      ["Android / Complete Guide", "/docs/android-complete/", "Full Android setup from start to finish", "android complete setup termux chroot overlay f2fs"],
      ["Portainer (optional)", "/docs/portainer/", "Optional Docker management UI", "portainer stack redeploy optional"],
      ["Remote Access (optional)", "/docs/remote-access/", "Tailscale, Cloudflare, and other optional remote access", "remote tailscale cloudflare tunnel access optional"],
      ["Updates & Backups", "/docs/updates-backups/", "Update, backup, and restore", "update backup restore ghcr"],
      ["Architecture", "/docs/architecture/", "Frontend, Backend, and Protocol responsibilities", "architecture frontend backend protocol"],
      ["Protocol & E2EE", "/docs/protocol/", "Login, transport, E2EE, and Talk", "protocol e2ee login talk rpc"],
      ["Persistence", "/docs/persistence/", "data, storage, DB, and media", "storage data sqlite media backup"],
      ["Access Model", "/docs/access-model/", "LAN, subdevices, and remote owner access", "security lan subdevice remote owner"],
      ["Configuration", "/docs/configuration/", "Compose and environment variables", "env environment variable port host"],
      ["Submodules", "/docs/submodules/", "protocol, plugin, themes, and tools", "git submodule source map"],
      ["Developer Guide", "/docs/developer/", "Development environment and verification commands", "developer bun typecheck lint test"],
      ["Plugins & Themes", "/docs/plugins-themes/", "Plugin SDK and themes", "plugin theme sdk permissions"],
      ["Troubleshooting", "/docs/troubleshooting/", "Diagnose by symptom", "error troubleshooting logs healthz"],
      ["A–Z Index", "/docs/index-a-z/", "Find pages by term or setting", "index glossary"],
    ],
    "zh-cn": [
      ["文档", "/docs/", "安装、运维、内部机制与开发资料", "overview start docs wiki documentation"],
      ["快速开始", "/docs/quick-start/", "使用 Docker Compose 启动的最短步骤", "docker compose install start"],
      ["Linux", "/docs/linux/", "在 Linux 主机上安装", "ubuntu debian fedora rhel arch opensuse alpine"],
      ["Raspberry Pi", "/docs/raspberry-pi/", "在 Raspberry Pi OS 64-bit 上运行", "raspberry pi arm64 aarch64"],
      ["Android / 设置", "/docs/android/", "将已 root 的 arm64 Android 设备作为 Docker 主机", "android termux chroot docker root"],
      ["Android / 内核", "/docs/android-kernel/", "Android 上运行 Docker 的内核要求", "kernel config cgroup overlayfs netfilter"],
      ["Android / 网络", "/docs/android-network/", "诊断 Android 特有的 Docker 网络问题", "iptables routing netd bridge dnat nft legacy"],
      ["Android / 完整指南", "/docs/android-complete/", "从头到尾完成 Android 环境搭建", "android complete setup termux chroot overlay f2fs"],
      ["Portainer（可选）", "/docs/portainer/", "可选的 Docker 管理界面", "portainer stack redeploy optional"],
      ["远程访问（可选）", "/docs/remote-access/", "Tailscale、Cloudflare 等可选远程访问方案", "remote tailscale cloudflare tunnel access optional"],
      ["更新与备份", "/docs/updates-backups/", "更新、备份与恢复", "update backup restore ghcr"],
      ["架构", "/docs/architecture/", "Frontend、Backend 与 Protocol 的职责", "architecture frontend backend protocol"],
      ["协议与 E2EE", "/docs/protocol/", "登录、transport、E2EE 与 Talk", "protocol e2ee login talk rpc"],
      ["持久化", "/docs/persistence/", "data、storage、DB 与媒体", "storage data sqlite media backup"],
      ["访问模型", "/docs/access-model/", "LAN、子设备与 remote owner", "security lan subdevice remote owner"],
      ["配置", "/docs/configuration/", "Compose 与环境变量", "env environment variable port host"],
      ["子模块", "/docs/submodules/", "protocol、plugin、themes 与 tools", "git submodule source map"],
      ["开发者指南", "/docs/developer/", "开发环境与验证命令", "developer bun typecheck lint test"],
      ["插件与主题", "/docs/plugins-themes/", "Plugin SDK 与主题", "plugin theme sdk permissions"],
      ["故障排查", "/docs/troubleshooting/", "按症状排查问题", "error troubleshooting logs healthz"],
      ["A–Z 索引", "/docs/index-a-z/", "按术语或设置查找页面", "index glossary"],
    ],
  }[locale].map(([title, url, description, keywords]) => [title, localePath(url), description, keywords]);

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
      results.innerHTML = `<div class="search-empty">${searchText.empty}</div>`;
      return;
    }
    const terms = query.split(/\s+/);
    const matches = pages.filter(([title, , description, keywords]) => {
      const haystack = `${title} ${description} ${keywords}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).slice(0, 12);
    results.innerHTML = matches.length
      ? matches.map(([title, url, description]) => `<a class="result" href="${url}"><b>${title}</b><span>${description}</span></a>`).join("")
      : `<div class="search-empty">${searchText.none}</div>`;
  });
})();
