(function () {
  "use strict";

  // region 导航与文档路径
  const NAV = [
    { group: "入门", items: [{ id: "home", label: "首页" }, { id: "memory", label: "项目记忆" }] },
    {
      group: "香草酱",
      items: [
        { id: "characters-index", label: "角色索引" },
        { id: "vanilla-progenitor", label: "芯酱" },
        { id: "vanilla-dark-tea", label: "黑茶酱" },
        { id: "vanilla-black-tea", label: "红茶酱" },
        { id: "vanilla-oolong-tea", label: "青茶酱" },
        { id: "vanilla-yellow-tea", label: "黄茶酱" },
        { id: "vanilla-white-tea", label: "白茶酱" },
        { id: "vanilla-green-tea", label: "绿茶酱" },
      ],
    },
    {
      group: "世界观",
      items: [
        { id: "worldbuilding-overview", label: "总览" },
        { id: "01-era", label: "源历" },
        { id: "02-source-substance", label: "源质" },
        { id: "03-derived-energy", label: "衍能与电力" },
        { id: "04-magic-system", label: "魔法体系" },
        { id: "05-androids", label: "仿生人" },
        { id: "06-undercurrent", label: "暗流" },
        { id: "07-vanilla-core-institute", label: "绿芯院区" },
        { id: "08-vanilla-core-network", label: "总署与院所" },
      ],
    },
    {
      group: "资料",
      items: [{ id: "glossary", label: "术语表" }, { id: "timeline", label: "年表" }],
    },
    {
      group: "编写",
      items: [{ id: "guide", label: "编写说明" }],
    },
  ];

  const DOC_PATHS = {};
  const ALL_IDS = [];

  function registerPath(id, relativePath) {
    DOC_PATHS[id] = relativePath;
    ALL_IDS.push(id);
  }

  function pathForId(id) {
    if (id === "home") return "content/home.banira";
    if (id === "memory") return "content/memory.banira";
    if (id === "characters-index") return "content/characters/characters-index.banira";
    if (id === "worldbuilding-overview") return "content/worldbuilding/worldbuilding-overview.banira";
    if (id.startsWith("vanilla-")) return "content/characters/" + id + ".banira";
    if (/^\d{2}-/.test(id)) return "content/worldbuilding/" + id + ".banira";
    if (id === "glossary" || id === "timeline") return "content/lore/" + id + ".banira";
    if (id === "guide") return "content/guide.banira";
    return null;
  }

  NAV.forEach((section) => {
    section.items.forEach((item) => {
      const p = pathForId(item.id);
      if (p) registerPath(item.id, p);
    });
  });

  const liveCache = Object.create(null);
  let liveMode = null;
  let currentId = "home";
  let pollTimer = null;
  let folderHandle = null;
  const POLL_MS = 1500;

  function isFileProtocol() {
    return location.protocol === "file:";
  }

  function isContentReady() {
    return liveMode === "fetch" || liveMode === "folder";
  }

  function needsFolderPick() {
    return isFileProtocol() && liveMode !== "folder";
  }
  // endregion

  // region 文档加载
  function getDoc(id) {
    if (liveCache[id]) return liveCache[id];
    if (needsFolderPick()) return null;
    return null;
  }

  function hasDoc(id) {
    if (needsFolderPick()) return false;
    return Boolean(liveCache[id] || (liveMode === "fetch" && DOC_PATHS[id]) || getDoc(id));
  }

  function parseIdFromRaw(raw) {
    const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---/);
    if (!m) return null;
    const fm = m[0];
    const idLine = fm.match(/^id:\s*(.+)$/m);
    return idLine ? idLine[1].trim() : null;
  }

  async function fetchBanira(relativePath) {
    const url = relativePath + (relativePath.includes("?") ? "&" : "?") + "_=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed");
    return res.text();
  }

  function pathForLiveMode(fullPath) {
    if (liveMode === "folder") return fullPath.replace(/^content\//, "");
    return fullPath;
  }

  async function loadDocLive(id) {
    const path = DOC_PATHS[id];
    if (!path) return null;
    if (liveMode === "folder" && folderHandle) {
      return readBaniraFromFolder(pathForLiveMode(path));
    }
    if (liveMode === "fetch") {
      return fetchBanira(path);
    }
    return null;
  }

  async function readBaniraFromFolder(relativePath) {
    const parts = relativePath.split("/");
    let dir = folderHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    return file.text();
  }

  async function scanFolderRecursive(dirHandle) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".banira")) {
        const file = await entry.getFile();
        const text = await file.text();
        const id = parseIdFromRaw(text) || entry.name.replace(/\.banira$/, "");
        liveCache[id] = text;
      } else if (entry.kind === "directory" && entry.name !== ".git") {
        await scanFolderRecursive(entry);
      }
    }
  }

  async function connectContentFolder() {
    if (!window.showDirectoryPicker) {
      alert("当前浏览器不支持选择文件夹。");
      return;
    }
    try {
      const picked = await window.showDirectoryPicker({ mode: "read" });
      liveMode = "folder";
      liveCacheClear();
      try {
        folderHandle = await picked.getDirectoryHandle("content");
      } catch {
        folderHandle = picked;
      }
      await scanFolderRecursive(folderHandle);
      setFolderPickUi(false);
      updateLiveBadge();
      await navigate(currentId, true);
      startPolling();
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }

  function liveCacheClear() {
    Object.keys(liveCache).forEach((k) => delete liveCache[k]);
  }

  async function tryEnableFetchLive() {
    const probe = DOC_PATHS.home;
    try {
      const text = await fetchBanira(probe);
      liveMode = "fetch";
      const id = parseIdFromRaw(text) || "home";
      liveCache[id] = text;
      updateLiveBadge();
      startPolling();
      return true;
    } catch {
      return false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(refreshCurrentDoc, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function refreshCurrentDoc() {
    if (!liveMode || !currentId) return;
    try {
      const fresh = await loadDocLive(currentId);
      if (fresh == null) return;
      if (liveCache[currentId] !== fresh) {
        liveCache[currentId] = fresh;
        renderDoc(currentId);
        flashLiveIndicator();
      }
    } catch {
      /* 文件写入中可能短暂失败，忽略 */
    }
  }

  function updateLiveBadge() {
    const badge = document.getElementById("live-badge");
    if (!badge) return;
    if (liveMode === "fetch") {
      badge.textContent = "实时";
      badge.className = "live-badge live-badge--on";
      badge.title = "";
    } else if (liveMode === "folder") {
      badge.textContent = "实时";
      badge.className = "live-badge live-badge--on";
      badge.title = "";
    } else if (needsFolderPick()) {
      badge.textContent = "未连接";
      badge.className = "live-badge live-badge--warn";
      badge.title = "";
    } else {
      badge.textContent = "无数据";
      badge.className = "live-badge live-badge--warn";
      badge.title = "";
    }
  }

  function setFolderPickUi(awaiting) {
    document.body.classList.toggle("awaiting-folder", awaiting);
  }

  function showConnectPrompt() {
    setFolderPickUi(true);
    const article = document.getElementById("article");
    const titleEl = document.getElementById("page-title");
    titleEl.textContent = "";
    document.title = "香草芯 · 设定库";
    article.innerHTML =
      '<div class="connect-prompt">' +
      "<h2>请选择设定文件夹</h2>" +
      "<p>请选择包含设定的文件夹后继续。</p>" +
      "<p>可选<strong>仓库根目录</strong>或<strong>content</strong> 目录。</p>" +
      '<button type="button" class="connect-prompt-btn" id="connect-prompt-btn">选择文件夹</button>' +
      "</div>";
    document.getElementById("connect-prompt-btn").addEventListener("click", connectContentFolder);
    document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.remove("active"));
  }

  function flashLiveIndicator() {
    const badge = document.getElementById("live-badge");
    if (!badge) return;
    badge.classList.add("live-badge--flash");
    setTimeout(() => badge.classList.remove("live-badge--flash"), 400);
  }
  // endregion

  // region Banira 解析与渲染
  function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: raw };
    const meta = {};
    match[1].split(/\r?\n/).forEach((line) => {
      const idx = line.indexOf(":");
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return { meta, body: match[2] };
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inlineFormat(text) {
    let s = escapeHtml(text);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) => {
      const t = label || id;
      return `<a href="#" class="wiki-link" data-id="${escapeHtml(id.trim())}">${escapeHtml(t.trim())}</a>`;
    });
    return s;
  }

  function renderBody(body) {
    const lines = body.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let inPre = false;
    let preBuf = [];

    function flushPre() {
      if (preBuf.length) {
        out.push("<pre><code>" + escapeHtml(preBuf.join("\n")) + "</code></pre>");
        preBuf = [];
      }
    }

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim().startsWith("```")) {
        if (inPre) {
          flushPre();
          inPre = false;
        } else inPre = true;
        i++;
        continue;
      }

      if (inPre) {
        preBuf.push(line);
        i++;
        continue;
      }

      if (/^## /.test(line)) {
        out.push("<h2>" + inlineFormat(line.slice(3)) + "</h2>");
        i++;
        continue;
      }
      if (/^### /.test(line)) {
        out.push("<h3>" + inlineFormat(line.slice(4)) + "</h3>");
        i++;
        continue;
      }

      if (/^\|.+\|$/.test(line.trim())) {
        const tableRows = [];
        while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
          tableRows.push(lines[i].trim());
          i++;
        }
        if (tableRows.length >= 2) {
          const parseRow = (r) =>
            r
              .slice(1, -1)
              .split("|")
              .map((c) => c.trim());
          const header = parseRow(tableRows[0]);
          const bodyRows = tableRows.slice(2).map(parseRow);
          let tbl = "<table><thead><tr>";
          header.forEach((h) => {
            tbl += "<th>" + inlineFormat(h) + "</th>";
          });
          tbl += "</tr></thead><tbody>";
          bodyRows.forEach((row) => {
            tbl += "<tr>";
            row.forEach((c) => {
              tbl += "<td>" + inlineFormat(c) + "</td>";
            });
            tbl += "</tr>";
          });
          tbl += "</tbody></table>";
          out.push(tbl);
        }
        continue;
      }

      if (/^> /.test(line)) {
        const quotes = [];
        while (i < lines.length && /^> /.test(lines[i])) {
          quotes.push(lines[i].slice(2));
          i++;
        }
        out.push("<blockquote><p>" + inlineFormat(quotes.join(" ")) + "</p></blockquote>");
        continue;
      }

      if (/^[-*] /.test(line) || /^- \[[ x]\]/.test(line)) {
        const isTodo = /^- \[[ x]\]/.test(line);
        const tag = isTodo ? 'ul class="todo"' : "ul";
        out.push("<" + tag + ">");
        while (i < lines.length && (/^[-*] /.test(lines[i]) || /^- \[[ x]\]/.test(lines[i]))) {
          const m = lines[i].match(/^- \[([ x])\] (.+)$/);
          if (m) {
            const done = m[1] === "x" ? ' class="done"' : "";
            out.push("<li" + done + ">" + inlineFormat(m[2]) + "</li>");
          } else {
            out.push("<li>" + inlineFormat(lines[i].replace(/^[-*] /, "")) + "</li>");
          }
          i++;
        }
        out.push("</ul>");
        continue;
      }

      if (line.trim() === "") {
        i++;
        continue;
      }

      out.push("<p>" + inlineFormat(line) + "</p>");
      i++;
    }

    flushPre();
    return out.join("\n");
  }

  function renderDoc(id) {
    if (needsFolderPick()) {
      showConnectPrompt();
      return;
    }

    const raw = getDoc(id);
    const article = document.getElementById("article");
    const titleEl = document.getElementById("page-title");
    setFolderPickUi(false);

    if (!raw) {
      titleEl.textContent = "未找到";
      article.innerHTML =
        '<div class="empty-state"><p>文档不存在：' +
        escapeHtml(id) +
        "</p><p>实时模式下请确认 content/ 路径正确。</p></div>";
      return;
    }

    const { meta, body } = parseFrontmatter(raw);
    const title = meta.title || id;
    titleEl.textContent = title;
    document.title = title + " · 香草芯";
    article.innerHTML = renderBody(body);

    article.querySelectorAll(".wiki-link").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        navigate(a.getAttribute("data-id"));
      });
    });
  }
  // endregion

  // region 路由与 UI
  function setActiveNav(id) {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-id") === id);
    });
  }

  async function navigate(id, skipHash) {
    if (needsFolderPick()) {
      currentId = id;
      if (!skipHash) location.hash = id;
      showConnectPrompt();
      document.getElementById("sidebar").classList.remove("open");
      return;
    }
    if (!DOC_PATHS[id] && !getDoc(id)) return;
    currentId = id;
    if (!skipHash) location.hash = id;
    setActiveNav(id);
    document.getElementById("sidebar").classList.remove("open");

    if (liveMode && DOC_PATHS[id]) {
      try {
        const fresh = await loadDocLive(id);
        if (fresh) liveCache[id] = fresh;
      } catch (e) {
        console.warn("load live doc", id, e);
      }
    }
    renderDoc(id);
  }

  function buildSidebar() {
    const container = document.getElementById("nav-root");
    NAV.forEach((section) => {
      const g = document.createElement("div");
      g.className = "nav-group";
      const t = document.createElement("div");
      t.className = "nav-group-title";
      t.textContent = section.group;
      g.appendChild(t);
      section.items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nav-item";
        btn.setAttribute("data-id", item.id);
        btn.textContent = item.label;
        btn.addEventListener("click", () => navigate(item.id));
        g.appendChild(btn);
      });
      container.appendChild(g);
    });
  }

  async function preloadLiveDocs() {
    if (liveMode !== "fetch") return;
    await Promise.all(
      ALL_IDS.map(async (id) => {
        try {
          liveCache[id] = await loadDocLive(id);
        } catch {
          /* 单篇失败不阻断 */
        }
      })
    );
  }

  async function init() {
    buildSidebar();
    document.getElementById("menu-toggle").addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("open");
    });
    const httpOk = location.protocol === "http:" || location.protocol === "https:";
    if (httpOk) {
      const ok = await tryEnableFetchLive();
      if (ok) await preloadLiveDocs();
      else showFetchFailedHint();
    } else if (isFileProtocol()) {
      showConnectPrompt();
      updateLiveBadge();
      window.addEventListener("hashchange", () => {
        if (needsFolderPick()) showConnectPrompt();
      });
      return;
    }

    updateLiveBadge();

    window.addEventListener("hashchange", () => {
      const id = (location.hash || "#home").slice(1) || "home";
      if (DOC_PATHS[id]) navigate(id, true);
    });

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && liveMode) refreshCurrentDoc();
    });

    const start = (location.hash || "#home").slice(1) || "home";
    if (isContentReady()) await navigate(DOC_PATHS[start] ? start : "home");
  }

  function showFetchFailedHint() {
    setFolderPickUi(true);
    document.getElementById("page-title").textContent = "";
    document.getElementById("article").innerHTML =
      '<div class="connect-prompt">' +
      "<h2>无法加载 content</h2>" +
      "<p>无法读取 <code>content</code> 目录。</p>" +
      "</div>";
  }
  // endregion

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
