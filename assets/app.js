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

  const NAV_META = Object.create(null);
  NAV.forEach((section) => {
    section.items.forEach((item) => {
      NAV_META[item.id] = { label: item.label, group: section.group };
    });
  });

  const liveCache = Object.create(null);
  let liveMode = null;
  let currentId = "home";
  let pollTimer = null;
  let folderHandle = null;
  const POLL_MS = 1500;
  const FS_DB_NAME = "banira-fs";
  const FS_STORE = "handles";
  const FS_KEY_CONTENT = "content-root";
  const PICKER_ID_DIR = "banira-content-folder";
  const PICKER_ID_INDEX = "banira-index-file";

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

  // region 本地文件夹句柄持久化
  function openFsDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(FS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(FS_STORE)) {
          req.result.createObjectStore(FS_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadStoredFolderHandle() {
    if (!window.indexedDB) return null;
    try {
      const db = await openFsDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(FS_STORE, "readonly");
        const get = tx.objectStore(FS_STORE).get(FS_KEY_CONTENT);
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => reject(get.error);
      });
    } catch {
      return null;
    }
  }

  async function saveStoredFolderHandle(handle) {
    if (!window.indexedDB || !handle) return;
    try {
      const db = await openFsDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(FS_STORE, "readwrite");
        tx.objectStore(FS_STORE).put(handle, FS_KEY_CONTENT);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn("无法保存文件夹句柄", err);
    }
  }

  async function ensureReadPermission(handle) {
    if (!handle || !handle.queryPermission) return false;
    const state = await handle.queryPermission({ mode: "read" });
    if (state === "granted") return true;
    if (state === "denied") return false;
    const next = await handle.requestPermission({ mode: "read" });
    return next === "granted";
  }

  async function pickIndexHtmlForStartIn() {
    if (!window.showOpenFilePicker) return null;
    const [handle] = await window.showOpenFilePicker({
      id: PICKER_ID_INDEX,
      multiple: false,
      types: [
        {
          description: "HTML",
          accept: { "text/html": [".html"] },
        },
      ],
    });
    return handle;
  }

  async function resolveDirectoryPickerStartIn() {
    const stored = await loadStoredFolderHandle();
    if (stored) {
      const perm = stored.queryPermission
        ? await stored.queryPermission({ mode: "read" })
        : "granted";
      if (perm !== "denied") return stored;
    }
    if (isFileProtocol()) {
      return pickIndexHtmlForStartIn();
    }
    return undefined;
  }

  async function applyFolderHandle(picked) {
    liveMode = "folder";
    liveCacheClear();
    try {
      folderHandle = await picked.getDirectoryHandle("content");
    } catch {
      folderHandle = picked;
    }
    await saveStoredFolderHandle(folderHandle);
    await scanFolderRecursive(folderHandle);
    setFolderPickUi(false);
    updateLiveBadge();
    setSearchEnabled(true);
    await navigate(currentId, true);
    startPolling();
  }

  async function tryRestoreFolderFromStorage() {
    if (!window.showDirectoryPicker) return false;
    const stored = await loadStoredFolderHandle();
    if (!stored) return false;
    if (!(await ensureReadPermission(stored))) return false;
    folderHandle = stored;
    liveMode = "folder";
    liveCacheClear();
    await scanFolderRecursive(folderHandle);
    setFolderPickUi(false);
    updateLiveBadge();
    setSearchEnabled(true);
    return true;
  }

  async function connectContentFolder() {
    if (!window.showDirectoryPicker) {
      alert("当前浏览器不支持选择文件夹。");
      return;
    }
    try {
      let startIn;
      try {
        startIn = await resolveDirectoryPickerStartIn();
      } catch (err) {
        if (err.name === "AbortError") return;
        throw err;
      }
      const opts = { mode: "read", id: PICKER_ID_DIR };
      if (startIn) opts.startIn = startIn;
      const picked = await window.showDirectoryPicker(opts);
      await applyFolderHandle(picked);
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  }
  // endregion

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
      "<p>可选<strong>仓库根目录</strong>或 <strong>content</strong> 目录。</p>" +
      "<p class=\"connect-prompt-hint\">首次会请先选择本站的 <code>index.html</code>，以便文件夹对话框从项目目录打开；之后将记住上次位置。</p>" +
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

  function parsePedigreeFields(text) {
    const parts = text.split("|").map((p) => p.trim());
    return {
      name: parts[0] || "",
      sub: parts[1] || "",
      id: parts[2] || "",
      children: [],
    };
  }

  function parsePedigreeLineRaw(line) {
    const m = line.match(/^(\s*)(?:[-*]\s+)?(.+)$/);
    const spaces = m ? m[1].length : 0;
    const depth = Math.floor(spaces / 2);
    let content = (m ? m[2] : line).trim();
    content = content.replace(/^[@#]\s*/, "");
    return { depth, node: parsePedigreeFields(content) };
  }

  function buildPedigreeTree(rawLines) {
    const parsed = rawLines.filter((l) => l.trim()).map(parsePedigreeLineRaw);
    if (!parsed.length) return [];

    const maxDepth = Math.max.apply(
      null,
      parsed.map((p) => p.depth)
    );

    if (maxDepth === 0 && parsed.length > 1) {
      const root = Object.assign({}, parsed[0].node, { children: [] });
      parsed.slice(1).forEach((p) => {
        root.children.push(Object.assign({}, p.node, { children: [] }));
      });
      return [root];
    }

    const forest = [];
    const stack = [];

    parsed.forEach(({ depth, node }) => {
      const n = Object.assign({}, node, { children: [] });
      while (stack.length > depth) stack.pop();
      if (depth === 0) {
        forest.push(n);
        stack[0] = n;
      } else {
        const parent = stack[depth - 1];
        if (parent) {
          parent.children.push(n);
          stack[depth] = n;
        } else {
          forest.push(n);
          stack[0] = n;
        }
      }
    });

    return forest;
  }

  function buildPedigreeForest(rawLines) {
    const chunks = [];
    let chunk = [];
    rawLines.forEach((line) => {
      if (!line.trim()) {
        if (chunk.length) {
          chunks.push(chunk);
          chunk = [];
        }
      } else {
        chunk.push(line);
      }
    });
    if (chunk.length) chunks.push(chunk);
    if (!chunks.length) return [];
    return chunks.reduce((all, c) => all.concat(buildPedigreeTree(c)), []);
  }

  const PEDIGREE_LAYOUT = {
    padX: 28,
    padY: 20,
    gapX: 18,
    rowGap: 88,
    boxH: 62,
    minBoxW: 92,
    maxBoxW: 132,
    rootMinW: 108,
    treeGap: 48,
  };

  function pedigreeBoxWidth(node, isRoot) {
    const len = (node.name || "").length + ((node.sub || "").length >> 1);
    const w = Math.max(PEDIGREE_LAYOUT.minBoxW, Math.min(PEDIGREE_LAYOUT.maxBoxW, len * 15 + 36));
    return isRoot ? Math.max(w, PEDIGREE_LAYOUT.rootMinW) : w;
  }

  function measurePedigreeWidth(node, isRoot) {
    if (!node.children || !node.children.length) {
      node._boxW = pedigreeBoxWidth(node, isRoot);
      node._subW = node._boxW;
      return node._subW;
    }
    let sum = 0;
    node.children.forEach((ch, i) => {
      sum += measurePedigreeWidth(ch, false) + (i > 0 ? PEDIGREE_LAYOUT.gapX : 0);
    });
    node._subW = sum;
    node._boxW = pedigreeBoxWidth(node, isRoot);
    return sum;
  }

  function assignPedigreeX(node, left, depth) {
    node._depth = depth;
    node._y = PEDIGREE_LAYOUT.padY + depth * PEDIGREE_LAYOUT.rowGap;
    if (!node.children || !node.children.length) {
      node._x = left + node._boxW / 2;
      return left + node._boxW + PEDIGREE_LAYOUT.gapX;
    }
    let cursor = left;
    node.children.forEach((ch) => {
      cursor = assignPedigreeX(ch, cursor, depth + 1);
    });
    const first = node.children[0]._x;
    const last = node.children[node.children.length - 1]._x;
    node._x = (first + last) / 2;
    return cursor;
  }

  function collectPedigreeNodes(node, list) {
    list.push(node);
    if (node.children) node.children.forEach((ch) => collectPedigreeNodes(ch, list));
  }

  function pedigreeLinkPaths(node) {
    const paths = [];
    if (!node.children || !node.children.length) return paths;
    const top = node._y + PEDIGREE_LAYOUT.boxH;
    const childY = node.children[0]._y;
    const midY = top + (childY - top) * 0.45;
    const px = node._x;
    if (node.children.length === 1) {
      const ch = node.children[0];
      paths.push("M" + px + " " + top + " V" + ch._y);
    } else {
      paths.push("M" + px + " " + top + " V" + midY);
      const x1 = node.children[0]._x;
      const x2 = node.children[node.children.length - 1]._x;
      paths.push("M" + x1 + " " + midY + " H" + x2);
      node.children.forEach((ch) => {
        paths.push("M" + ch._x + " " + midY + " V" + ch._y);
      });
    }
    node.children.forEach((ch) => {
      paths.push.apply(paths, pedigreeLinkPaths(ch));
    });
    return paths;
  }

  function pedigreeNodeFo(node, isRoot) {
    const w = node._boxW;
    const h = PEDIGREE_LAYOUT.boxH;
    const x = node._x - w / 2;
    const y = node._y;
    const gCls = "pedigree-node" + (isRoot ? " pedigree-node--root" : "");
    const innerCls = "pedigree__node" + (node.id ? " wiki-link" : "");
    const title = escapeHtml(node.name);
    const sub = node.sub ? '<span class="pedigree__sub">' + escapeHtml(node.sub) + "</span>" : "";
    const label = node.id
      ? '<a href="#" class="' +
        innerCls +
        '" data-id="' +
        escapeHtml(node.id) +
        '"><span class="pedigree__name">' +
        title +
        "</span>" +
        sub +
        "</a>"
      : '<div class="' +
        innerCls +
        '"><span class="pedigree__name">' +
        title +
        "</span>" +
        sub +
        "</div>";
    let g = '<g class="' + gCls + '">';
    g +=
      '<rect class="pedigree-svg__box" x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      w +
      '" height="' +
      h +
      '" rx="10" ry="10" />';
    g +=
      '<foreignObject overflow="visible" x="' +
      x +
      '" y="' +
      y +
      '" width="' +
      w +
      '" height="' +
      h +
      '"><div xmlns="http://www.w3.org/1999/xhtml" class="pedigree-fo">' +
      label +
      "</div></foreignObject>";
    g += "</g>";
    return g;
  }

  function renderPedigreeSvgTree(root, isRoot) {
    measurePedigreeWidth(root, isRoot);
    assignPedigreeX(root, PEDIGREE_LAYOUT.padX, 0);
    const nodes = [];
    collectPedigreeNodes(root, nodes);
    const paths = pedigreeLinkPaths(root);
    let maxX = PEDIGREE_LAYOUT.padX;
    nodes.forEach((n) => {
      const right = n._x + n._boxW / 2;
      if (right > maxX) maxX = right;
    });
    const w = Math.ceil(maxX + PEDIGREE_LAYOUT.padX);
    let maxDepth = 0;
    nodes.forEach((n) => {
      if (n._depth > maxDepth) maxDepth = n._depth;
    });
    const h2 = Math.ceil(
      PEDIGREE_LAYOUT.padY + maxDepth * PEDIGREE_LAYOUT.rowGap + PEDIGREE_LAYOUT.boxH + PEDIGREE_LAYOUT.padY
    );

    let svg = '<svg class="pedigree-svg" viewBox="0 0 ' + w + " " + h2 + '" width="' + w + '" height="' + h2 + '" role="img">';
    paths.forEach((d) => {
      svg += '<path class="pedigree-svg__link" d="' + d + '" fill="none" />';
    });
    nodes.forEach((n) => {
      svg += pedigreeNodeFo(n, n === root);
    });
    svg += "</svg>";
    return { svg, w, h: h2 };
  }

  function renderPedigree(rawLines) {
    const forest = buildPedigreeForest(rawLines);
    if (!forest.length) return "";
    let html = '<figure class="pedigree">';
    forest.forEach((root, idx) => {
      const tree = renderPedigreeSvgTree(root, true);
      html += '<div class="pedigree-svg-wrap">' + tree.svg + "</div>";
      if (idx < forest.length - 1) {
        html += '<div class="pedigree__split" aria-hidden="true"></div>';
      }
    });
    html += "</figure>";
    return html;
  }

  function renderBody(body) {
    const lines = body.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let inFence = false;
    let fenceKind = "";
    let fenceBuf = [];

    function flushFence() {
      if (!fenceBuf.length) {
        fenceKind = "";
        return;
      }
      if (fenceKind === "pedigree") {
        out.push(renderPedigree(fenceBuf));
      } else {
        out.push("<pre><code>" + escapeHtml(fenceBuf.join("\n")) + "</code></pre>");
      }
      fenceBuf = [];
      fenceKind = "";
    }

    while (i < lines.length) {
      const line = lines[i];
      const fenceMatch = line.trim().match(/^```(\w*)/);

      if (fenceMatch) {
        if (inFence) {
          flushFence();
          inFence = false;
        } else {
          inFence = true;
          fenceKind = fenceMatch[1] || "code";
        }
        i++;
        continue;
      }

      if (inFence) {
        fenceBuf.push(line);
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

    flushFence();
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

  // region 搜索
  const NAV_EXPANDED_KEY = "banira-nav-expanded";
  const NAV_COLLAPSED_KEY_LEGACY = "banira-nav-collapsed";
  const SIDEBAR_COLLAPSED_KEY = "banira-sidebar-collapsed";

  function stripMarkdownForSearch(body) {
    return body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
      .replace(/[#>*_`|~-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getDocSearchRecord(id) {
    const nav = NAV_META[id];
    const raw = liveCache[id];
    if (!raw) {
      const label = nav ? nav.label : id;
      return { id, title: label, group: nav ? nav.group : "", text: label.toLowerCase(), bodyOnly: "" };
    }
    const { meta, body } = parseFrontmatter(raw);
    const title = meta.title || (nav ? nav.label : id);
    const bodyOnly = stripMarkdownForSearch(body).toLowerCase();
    const text = (title + " " + bodyOnly).toLowerCase();
    return { id, title, group: nav ? nav.group : "", text, bodyOnly };
  }

  function searchDocs(query) {
    const q = query.trim().toLowerCase();
    if (!q || needsFolderPick()) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const ids = new Set([...ALL_IDS, ...Object.keys(liveCache)]);
    const scored = [];
    ids.forEach((id) => {
      if (!DOC_PATHS[id] && !liveCache[id]) return;
      const rec = getDocSearchRecord(id);
      const titleLower = rec.title.toLowerCase();
      const labelLower = (NAV_META[id] ? NAV_META[id].label : "").toLowerCase();
      if (!terms.every((t) => rec.text.includes(t) || id.toLowerCase().includes(t))) return;
      let score = 0;
      terms.forEach((t) => {
        if (titleLower.includes(t)) score += 100;
        if (labelLower.includes(t)) score += 80;
        if (id.toLowerCase().includes(t)) score += 60;
        if (rec.bodyOnly.includes(t)) score += 10;
      });
      scored.push({ ...rec, score });
    });
    scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh"));
    return scored.slice(0, 16);
  }

  function makeSearchSnippet(bodyOnly, query) {
    const q = query.trim().toLowerCase();
    if (!q || !bodyOnly) return "";
    const idx = bodyOnly.indexOf(q);
    if (idx < 0) {
      const term = q.split(/\s+/).find((t) => bodyOnly.includes(t));
      if (!term) return bodyOnly.slice(0, 72) + (bodyOnly.length > 72 ? "…" : "");
      const i = bodyOnly.indexOf(term);
      return excerptAround(bodyOnly, i, term.length);
    }
    return excerptAround(bodyOnly, idx, q.length);
  }

  function excerptAround(text, index, len) {
    const start = Math.max(0, index - 28);
    const end = Math.min(text.length, index + len + 40);
    let slice = text.slice(start, end);
    if (start > 0) slice = "…" + slice;
    if (end < text.length) slice += "…";
    return slice;
  }

  function setSearchEnabled(enabled) {
    const input = document.getElementById("doc-search");
    if (!input) return;
    input.disabled = !enabled;
    input.placeholder = enabled ? "搜索设定…" : "连接后可搜索";
    if (!enabled) {
      input.value = "";
      hideSearchResults();
    }
  }

  function hideSearchResults() {
    const panel = document.getElementById("search-results");
    const input = document.getElementById("doc-search");
    if (panel) panel.hidden = true;
    if (input) input.setAttribute("aria-expanded", "false");
  }

  function renderSearchResults(results, query) {
    const panel = document.getElementById("search-results");
    const input = document.getElementById("doc-search");
    if (!panel || !input) return;
    if (!results.length) {
      panel.innerHTML = '<div class="search-results-empty">无匹配结果</div>';
      panel.hidden = false;
      input.setAttribute("aria-expanded", "true");
      return;
    }
    panel.innerHTML = results
      .map((r) => {
        const snippet = makeSearchSnippet(r.bodyOnly, query);
        const meta = r.group ? '<span class="search-result-group">' + escapeHtml(r.group) + "</span>" : "";
        const sn = snippet
          ? '<span class="search-result-snippet">' + escapeHtml(snippet) + "</span>"
          : "";
        return (
          '<button type="button" class="search-result-item" role="option" data-id="' +
          escapeHtml(r.id) +
          '">' +
          '<span class="search-result-title">' +
          escapeHtml(r.title) +
          "</span>" +
          meta +
          sn +
          "</button>"
        );
      })
      .join("");
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    panel.querySelectorAll(".search-result-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        hideSearchResults();
        input.value = "";
        navigate(id);
      });
    });
  }

  function setupSearch() {
    const input = document.getElementById("doc-search");
    const panel = document.getElementById("search-results");
    if (!input || !panel) return;
    let debounceTimer = null;
    const run = () => {
      const q = input.value;
      if (!q.trim()) {
        hideSearchResults();
        return;
      }
      renderSearchResults(searchDocs(q), q);
    };
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(run, 180);
    });
    input.addEventListener("focus", () => {
      if (input.value.trim()) run();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideSearchResults();
        input.blur();
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".toolbar-search-wrap")) hideSearchResults();
    });
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (!input.disabled) input.focus();
      }
    });
  }
  // endregion

  // region 侧栏折叠
  function loadNavExpandedGroups() {
    try {
      const legacy = localStorage.getItem(NAV_COLLAPSED_KEY_LEGACY);
      if (legacy) {
        const collapsed = JSON.parse(legacy);
        const expanded = {};
        NAV.forEach((section) => {
          if (!collapsed[section.group]) expanded[section.group] = true;
        });
        localStorage.setItem(NAV_EXPANDED_KEY, JSON.stringify(expanded));
        localStorage.removeItem(NAV_COLLAPSED_KEY_LEGACY);
        return expanded;
      }
      const raw = localStorage.getItem(NAV_EXPANDED_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveNavExpandedGroups(map) {
    try {
      localStorage.setItem(NAV_EXPANDED_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }

  function setNavGroupExpanded(groupName, expanded) {
    const groupEl = document.querySelector('.nav-group[data-group="' + groupName + '"]');
    if (!groupEl) return;
    const titleEl = groupEl.querySelector(".nav-group-title");
    groupEl.classList.toggle("nav-group--collapsed", !expanded);
    if (titleEl) titleEl.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function persistNavGroupExpanded(groupName, expanded) {
    const map = loadNavExpandedGroups();
    if (expanded) map[groupName] = true;
    else delete map[groupName];
    saveNavExpandedGroups(map);
  }

  function toggleNavGroup(groupName, groupEl, titleEl) {
    const expanded = groupEl.classList.toggle("nav-group--collapsed") === false;
    titleEl.setAttribute("aria-expanded", expanded ? "true" : "false");
    persistNavGroupExpanded(groupName, expanded);
  }

  function ensureNavGroupVisibleForDoc(id) {
    const meta = NAV_META[id];
    if (!meta) return;
    const map = loadNavExpandedGroups();
    if (!map[meta.group]) {
      map[meta.group] = true;
      saveNavExpandedGroups(map);
    }
    setNavGroupExpanded(meta.group, true);
  }

  function setupSidebarCollapse() {
    const collapseBtn = document.getElementById("sidebar-collapse-btn");
    const expandBtn = document.getElementById("sidebar-expand-btn");
    const apply = (collapsed) => {
      document.body.classList.toggle("sidebar-collapsed", collapsed);
      if (collapseBtn) collapseBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      if (expandBtn) expandBtn.hidden = !collapsed;
    };
    apply(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    collapseBtn?.addEventListener("click", () => {
      const collapsed = true;
      apply(collapsed);
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    });
    expandBtn?.addEventListener("click", () => {
      apply(false);
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0");
      document.getElementById("sidebar")?.classList.remove("open");
    });
  }
  // endregion

  // region 路由与 UI
  function setActiveNav(id) {
    ensureNavGroupVisibleForDoc(id);
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
    const expandedGroups = loadNavExpandedGroups();
    NAV.forEach((section) => {
      const g = document.createElement("div");
      g.className = "nav-group";
      g.setAttribute("data-group", section.group);
      const expanded = Boolean(expandedGroups[section.group]);
      if (!expanded) g.classList.add("nav-group--collapsed");

      const t = document.createElement("button");
      t.type = "button";
      t.className = "nav-group-title";
      t.setAttribute("aria-expanded", expanded ? "true" : "false");
      const label = document.createElement("span");
      label.className = "nav-group-label";
      label.textContent = section.group;
      const chevron = document.createElement("span");
      chevron.className = "nav-group-chevron";
      chevron.setAttribute("aria-hidden", "true");
      t.append(label, chevron);
      t.addEventListener("click", () => toggleNavGroup(section.group, g, t));
      g.appendChild(t);

      const body = document.createElement("div");
      body.className = "nav-group-body";
      const inner = document.createElement("div");
      inner.className = "nav-group-body-inner";
      section.items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nav-item";
        btn.setAttribute("data-id", item.id);
        btn.textContent = item.label;
        btn.addEventListener("click", () => navigate(item.id));
        inner.appendChild(btn);
      });
      body.appendChild(inner);
      g.appendChild(body);
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
    setupSearch();
    setupSidebarCollapse();
    document.getElementById("menu-toggle").addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("open");
    });
    const httpOk = location.protocol === "http:" || location.protocol === "https:";
    if (httpOk) {
      const ok = await tryEnableFetchLive();
      if (ok) {
        await preloadLiveDocs();
        setSearchEnabled(true);
      } else showFetchFailedHint();
    } else if (isFileProtocol()) {
      const restored = await tryRestoreFolderFromStorage();
      if (restored) {
        startPolling();
        const start = (location.hash || "#home").slice(1) || "home";
        await navigate(DOC_PATHS[start] ? start : "home");
      } else {
        showConnectPrompt();
      }
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
