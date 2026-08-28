/* SpeechDx Leaderboard — private extended roster — shared with the public
   SpeechDx docs/app.js (same iOS-safe createElement DOM building). Adds: a board switch
   (MAE·MRR / C-index·avg), a 3-way view (raw 27 / merged 19 / by-category), a
   pending band for C-index-less rows, and per-task metric direction. Reads
   window.LEADERBOARD_DATA. */
(function () {
  "use strict";

  const DATA = window.LEADERBOARD_DATA;
  if (!DATA) { document.getElementById("board").textContent = "data failed to load."; return; }

  const catColor = {}, catRgb = {}, catLabel = {};
  DATA.categories.forEach(c => {
    catColor[c.code] = c.color; catLabel[c.code] = c.label;
    const h = c.color.replace("#", "");
    catRgb[c.code] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(" ");
  });

  // ---- state ----
  let board = "mae", viewKey = "merged", sortKey = "headline", sortDir = -1;
  let customOrder = null;   // array of model ids — a user drag-to-compare arrangement
  let dragModelId = null;
  const TRACKS = DATA.tracks || [
    { code: "avg_pool", label: "Avg Pool" },
    { code: "asp", label: "ASP" },
    { code: "lora", label: "LoRA" },
    { code: "llm", label: "LLM" }
  ];
  const trackLabel = Object.fromEntries(TRACKS.map(t => [t.code, t.label]));
  const trackMeta = Object.fromEntries(TRACKS.map(t => [t.code, t]));
  function applyTrackColors(el, code) {
    const t = trackMeta[code] || {};
    el.style.setProperty("--track-color", t.color || "#2563eb");
    el.style.setProperty("--track-color-dark", t.dark_color || t.color || "#60a5fa");
  }
  const DEFAULT_TRACK = TRACKS.some(t => t.code === "avg_pool") ? "avg_pool" : TRACKS[0].code;
  const activeTracks = new Set([DEFAULT_TRACK]);
  const V = () => DATA.boards[board].views[viewKey];
  const visible = () => V().models.filter(m => activeTracks.has(m.track));
  const hLabel = () => DATA.boards[board].headline_label;
  const strip0 = v => v.toFixed(3).replace(/^0\./, ".").replace(/^-0\./, "-.");
  const fmt = (v, t) => v == null ? "—" : t.dec2 ? v.toFixed(2) : strip0(v);

  let curTasks = [], bestByTask = {}, visibleMrr = {}, maxH = 0;

  function recomputeVisibleMrr() {
    visibleMrr = {};
    if (board !== "mae") return;
    const sums = {}, counts = {}, models = visible().filter(m => !m.partial);
    models.forEach(m => { sums[m.id] = 0; counts[m.id] = 0; });
    curTasks.forEach(t => {
      const rows = models.filter(m => m.scores[t.id] != null)
        .sort((a, b) => (a.scores[t.id] - b.scores[t.id]) * (t.lo ? 1 : -1));
      let rank = 0, previous = null;
      rows.forEach((m, i) => {
        const value = m.scores[t.id];
        if (previous === null || value !== previous) rank = i + 1;
        sums[m.id] += 1 / rank; counts[m.id] += 1; previous = value;
      });
    });
    models.forEach(m => { visibleMrr[m.id] = counts[m.id] ? sums[m.id] / counts[m.id] : null; });
  }

  const headlineOf = m => board === "mae" ? visibleMrr[m.id] : m.headline;

  // ---- legend ----
  const legend = document.getElementById("legend");
  function renderLegend() {
    legend.innerHTML =
      `<div class="legend-group"><span class="legend-title">Category</span>` +
      DATA.categories.map(c => `<span class="legend-item"><span class="swatch-cat" style="background:rgb(${catRgb[c.code]} / .85)"></span>${c.label}</span>`).join("") +
      `</div><div class="legend-group"><span class="legend-title">${hLabel()}</span>` +
      `<span class="legend-item">${DATA.boards[board].headline_desc}</span></div>`;
  }

  // ---- tooltip ----
  const tip = document.getElementById("tooltip");
  function showTip(html, variant) {
    tip.className = "tooltip" + (variant ? ` tooltip-${variant}` : "");
    tip.innerHTML = html + '<button class="tt-close" aria-label="Dismiss">&times;</button>';
    tip.hidden = false;
  }
  function hideTip() { tip.hidden = true; }
  tip.addEventListener("click", e => { e.stopPropagation(); if (e.target.closest(".tt-close")) hideTip(); });
  document.addEventListener("click", () => { if (!tip.hidden) hideTip(); });

  function trackMethodHtml(t) {
    const method = t.methodology || {};
    const summary = method.summary ? `<div class="tt-method-summary">${method.summary}</div>` : "";
    const sections = (method.sections || []).map(s => {
      const items = (s.items || []).map(item => `<li>${item}</li>`).join("");
      const layout = s.items_layout === "single" ? " tt-method-list-single" : "";
      const list = items ? `<ul class="tt-method-list${layout}">${items}</ul>` : "";
      return `<div class="tt-method-section"><div class="tt-method-label">${s.label}</div><div>${s.text}</div>${list}</div>`;
    }).join("");
    const paper = method.paper_url ?
      `<a class="tt-link tt-paper" href="${method.paper_url}" target="_blank" rel="noopener">${method.paper_label || "Methodology paper"} ↗</a>` : "";
    return `<div class="tt-title">${t.label} methodology</div>` +
      summary + paper + sections;
  }

  // ---- sorting ----
  function sortedPlaced(list) {
    const ms = list.slice();
    if (sortKey === "custom" && customOrder) {
      const order = new Map(customOrder.map((id, i) => [id, i]));
      ms.sort((a, b) => (order.has(a.id) ? order.get(a.id) : Infinity) - (order.has(b.id) ? order.get(b.id) : Infinity));
      return ms;
    }
    ms.sort((a, b) => {
      if (sortKey === "model") { const x = a.short.toLowerCase(), y = b.short.toLowerCase(); return x < y ? sortDir : x > y ? -sortDir : 0; }
      let av, bv, lo = false;
      if (sortKey === "headline") { av = headlineOf(a); bv = headlineOf(b); }
      else { av = a.scores[sortKey]; bv = b.scores[sortKey]; const t = curTasks.find(t => t.id === sortKey); lo = t && t.lo; }
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      return (av - bv) * (lo ? -sortDir : sortDir);
    });
    return ms;
  }
  function setSort(key) {
    customOrder = null;
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = key === "model" ? 1 : -1; }
    renderBody(); renderSortIndicators(); updateResetOrderBtn();
  }
  const arrow = () => (sortDir === -1 ? "▼" : "▲");

  // ---- drag-to-compare: pick up a model row and drop it next to another;
  // every other row keeps its relative order. This becomes a "custom" sort
  // so later re-renders (track toggles) don't silently discard the arrangement.
  function reorderCustom(sourceId, targetId, before) {
    let order = (sortKey === "custom" && customOrder) ? customOrder.slice() : sortedPlaced(visible()).map(m => m.id);
    order = order.filter(id => id !== sourceId);
    let idx = order.indexOf(targetId);
    if (idx === -1) idx = order.length;
    order.splice(before ? idx : idx + 1, 0, sourceId);
    customOrder = order;
    sortKey = "custom"; sortDir = 1;
    render();
  }
  function resetOrder() {
    customOrder = null; sortKey = "headline"; sortDir = -1;
    render();
  }
  function updateResetOrderBtn() {
    if (resetOrderBtn) resetOrderBtn.hidden = sortKey !== "custom";
  }

  // ---- table ----
  const table = document.getElementById("board");
  let hrow, tbody;

  function renderMeta() {
    const paperLink = DATA.paper_url ?
      ` · <a href="${DATA.paper_url}" target="_blank" rel="noopener">paper ↗</a>` : "";
    const leakNote = visible().some(m => m.leak) ?
      ` · <span style="color:#e0af68">*</span> respiratory (c9s/coswara) scores leak-contaminated` : "";
    document.getElementById("meta").innerHTML =
      `${visible().length}${activeTracks.size < TRACKS.length ? ` of ${V().models.length}` : ""} models · ${V().n_tasks} ${viewKey === "category" ? "category columns" : "tasks"} · ` +
      `generated ${DATA.generated} · <a href="${DATA.repo_url}" target="_blank" rel="noopener">repo ↗</a>${paperLink} · ` +
      `by <a href="${DATA.author_url}" target="_blank" rel="noopener">${DATA.author}</a>${leakNote}`;
  }

  function buildHeader() {
    const thead = document.createElement("thead");
    hrow = document.createElement("tr");
    const thModel = document.createElement("th");
    thModel.className = "col-model th-sortable"; thModel.dataset.key = "model";
    thModel.innerHTML = `<div class="th-inner">Model</div>`;
    hrow.appendChild(thModel);
    const thH = document.createElement("th");
    thH.className = "col-mrr th-sortable"; thH.dataset.key = "headline";
    thH.innerHTML = `<div class="th-inner">${hLabel()}</div>`;
    hrow.appendChild(thH);
    curTasks.forEach(t => {
      const th = document.createElement("th");
      th.className = "th-task th-sortable"; th.dataset.key = t.id;
      th.style.setProperty("--cat", catColor[t.category]);
      const tnum = board === "cindex" && t.id === "torgo_sevR" && t.tnum === "T11" ? "T11*" : t.tnum;
      th.innerHTML = `<div class="th-inner"><span class="task-tnum">${tnum}</span>` +
        `<span class="task-label">${t.slabel}</span><span class="task-metric">${t.metric}${t.lo ? "&nbsp;↓" : ""}</span></div>`;
      const tipHtml = `<div class="tt-title">${t.tnum} · ${t.label}</div><div>${t.desc}</div>` +
        `<div class="tt-sub">${t.metric}${t.lo ? " ↓" : ""} · ${catLabel[t.category]}</div>`;
      th.addEventListener("click", e => { showTip(tipHtml); e.stopPropagation(); });
      hrow.appendChild(th);
    });
    thead.appendChild(hrow); table.appendChild(thead);
    hrow.querySelectorAll(".th-sortable").forEach(th => th.addEventListener("click", () => setSort(th.dataset.key)));
  }

  function renderSortIndicators() {
    hrow.querySelectorAll(".th-sortable").forEach(th => {
      th.querySelector(".sort-arrow")?.remove();
      th.classList.toggle("sort-active", th.dataset.key === sortKey);
      if (th.dataset.key === sortKey) {
        const s = document.createElement("span"); s.className = "sort-arrow"; s.textContent = arrow();
        th.querySelector(".th-inner").appendChild(s);
      }
    });
  }

  function modelNames(m) {
    if (!m.model_family_id) return { short: m.short, display: m.display };
    const visibleTracks = new Set(
      visible().filter(other => other.model_family_id === m.model_family_id).map(other => other.track)
    );
    const suffix = m.track_tag && visibleTracks.size > 1 ? ` · ${m.track_tag}` : "";
    return {
      short: m.short + suffix,
      display: m.display + suffix
    };
  }

  function modelRow(m, rank) {
    const tr = document.createElement("tr");
    tr.className = "track-row";
    tr.draggable = true;
    tr.dataset.modelId = m.id;
    applyTrackColors(tr, m.track);

    const rowNote = m.leak ?
      "respiratory (c9s/coswara) scores leak-contaminated — see the v3.6 report" : m.headline_note;
    const names = modelNames(m);
    const noteMarker = rowNote && !(m.id === "wavlm_rx" && names.short.includes("*"));
    const repoLink = m.repo && m.repo_url ?
      `<a class="tt-link" href="${m.repo_url}" target="_blank" rel="noopener">${m.repo} ↗</a>` : "";

    const tdM = document.createElement("td");
    tdM.className = "col-model cell-model";
    tdM.innerHTML = `<span class="drag-handle" title="Drag to compare next to another model">⠿</span>` +
      `<span class="rank">${rank}</span><span class="name">${names.short}` +
      `${noteMarker ? `<sup style="color:#e0af68;cursor:help" title="${rowNote.replace(/"/g, "&quot;")}">*</sup>` : ''}</span>`;
    const mHtml = `<div class="tt-title">${names.display}${noteMarker ? ' *' : ''}</div><div class="tt-sub">${m.host}</div>` +
      repoLink +
      `<div class="tt-rev">Track: ${trackLabel[m.track] || m.track} · ${m.revision} · ${m.revision_date}</div>` +
      (m.id === "wavlm_rx" ? `<div style="font-size:11px;margin-top:5px">WavRx uses its specialized two-branch head and is grouped in the ASP track.</div>` : "") +
      (rowNote ? `<div style="color:#e0af68;font-size:11px;margin-top:5px">* ${rowNote}</div>` : "");
    tdM.addEventListener("click", e => { showTip(mHtml); e.stopPropagation(); });
    tr.appendChild(tdM);

    const tdH = document.createElement("td");
    tdH.className = "col-mrr cell-mrr";
    const headline = headlineOf(m);
    if (headline == null) {
      tdH.innerHTML = m.partial ?
        `<div class="mrr-val pending">provisional</div><div class="cov">${m.coverage}/${curTasks.length} shown</div>` :
        `<div class="mrr-val pending">pending</div><div class="cov">cls ${m.cls_mean == null ? "—" : strip0(m.cls_mean)}</div>`;
    } else {
      const w = maxH ? Math.round((headline / maxH) * 100) : 0;
      const note = board === "cindex" && m.track === "lora" && m.headline_note ?
        `<sup style="color:#e0af68;cursor:help" title="${m.headline_note}">*</sup>` : "";
      tdH.innerHTML = `<div class="mrr-val">${strip0(headline)}${note}</div><div class="mrr-track"><div class="mrr-bar" style="width:${w}%"></div></div>`;
    }
    tr.appendChild(tdH);

    curTasks.forEach(t => {
      const v = m.scores[t.id];
      const td = document.createElement("td");
      td.className = "cell-score" + (v == null ? " na" : "");
      td.style.setProperty("--cat-rgb", catRgb[t.category]);
      if (v != null && bestByTask[t.id] != null && v === bestByTask[t.id]) td.classList.add("top1");
      td.textContent = fmt(v, t);
      tr.appendChild(td);
    });
    return tr;
  }

  function renderBody() {
    if (tbody) tbody.remove();
    tbody = document.createElement("tbody"); table.appendChild(tbody);
    const all = visible();
    let pending = [], placed;
    if (sortKey === "headline") {
      pending = all.filter(m => m.pending);
      placed = sortedPlaced(all.filter(m => !m.pending));
    } else {
      placed = sortedPlaced(all); pending = [];
    }
    placed.forEach((m, i) => tbody.appendChild(modelRow(m, sortKey === "headline" || sortKey === "model" ? i + 1 : "·")));
    if (pending.length) {
      const band = document.createElement("tr"); band.className = "band-row";
      const td = document.createElement("td"); td.colSpan = curTasks.length + 2;
      td.textContent = pending.some(m => m.partial) ?
        "Provisional / partial attempts — excluded from headline ranking" : "Pending C-index — classification only";
      band.appendChild(td); tbody.appendChild(band);
      pending.forEach(m => tbody.appendChild(modelRow(m, "—")));
    }
  }

  function render() {
    curTasks = V().tasks;
    recomputeVisibleMrr();
    bestByTask = {};
    curTasks.forEach(t => {
      const vals = visible().map(m => m.scores[t.id]).filter(v => v != null);
      bestByTask[t.id] = !vals.length ? null : (t.lo ? Math.min.apply(null, vals) : Math.max.apply(null, vals));
    });
    maxH = Math.max.apply(null, visible().map(m => headlineOf(m) || 0));
    renderLegend(); renderMeta();
    table.innerHTML = ""; tbody = null;
    buildHeader(); renderBody(); renderSortIndicators(); updateResetOrderBtn();
  }

  // ---- controls ----
  document.querySelectorAll("#board-switch .seg").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll("#board-switch .seg").forEach(b => b.classList.remove("active"));
    btn.classList.add("active"); board = btn.dataset.board; sortKey = "headline"; sortDir = -1; customOrder = null; render();
  }));
  document.querySelectorAll("#view-switch .seg").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll("#view-switch .seg").forEach(b => b.classList.remove("active"));
    btn.classList.add("active"); viewKey = btn.dataset.view; sortKey = "headline"; sortDir = -1; customOrder = null; render();
  }));

  const resetOrderBtn = document.getElementById("reset-order");
  if (resetOrderBtn) resetOrderBtn.addEventListener("click", e => { e.stopPropagation(); resetOrder(); });

  // ---- view-settings popover (mobile only — on desktop this markup just sits
  // inline in .controls via CSS, and toggling ".open" there is a no-op) ----
  const viewSettingsToggle = document.getElementById("view-settings-toggle");
  const viewSettingsPanel = document.getElementById("view-settings-panel");
  if (viewSettingsToggle && viewSettingsPanel) {
    viewSettingsToggle.addEventListener("click", e => {
      e.stopPropagation();
      const willOpen = !viewSettingsPanel.classList.contains("open");
      viewSettingsPanel.classList.toggle("open", willOpen);
      viewSettingsToggle.setAttribute("aria-expanded", String(willOpen));
    });
    viewSettingsPanel.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", () => {
      if (viewSettingsPanel.classList.contains("open")) {
        viewSettingsPanel.classList.remove("open");
        viewSettingsToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Track toggles; ranks, bars, counts and top-1 marks always use the shown tracks.
  const trackSwitch = document.getElementById("track-switch");
  if (trackSwitch) {
    TRACKS.forEach(t => {
      const isActive = activeTracks.has(t.code);
      const control = document.createElement("span");
      control.className = "track-control" + (isActive ? " active" : "");
      applyTrackColors(control, t.code);
      const btn = document.createElement("button");
      btn.className = "seg track-toggle" + (isActive ? " active" : ""); btn.type = "button"; btn.dataset.track = t.code;
      btn.setAttribute("aria-pressed", String(isActive)); btn.textContent = t.label;
      btn.title = `Show or hide the ${t.label} track (ranks, bars and top-1 marks recompute)`;
      btn.addEventListener("click", () => {
        if (activeTracks.has(t.code)) {
          if (activeTracks.size === 1) return;
          activeTracks.delete(t.code);
        } else {
          activeTracks.add(t.code);
        }
        btn.classList.toggle("active", activeTracks.has(t.code));
        control.classList.toggle("active", activeTracks.has(t.code));
        btn.setAttribute("aria-pressed", String(activeTracks.has(t.code)));
        render();
      });
      const info = document.createElement("button");
      info.className = "track-info"; info.type = "button"; info.textContent = "i";
      info.setAttribute("aria-label", `${t.label} methodology`);
      info.title = `${t.label} methodology`;
      info.addEventListener("click", e => { showTip(trackMethodHtml(t), "method"); e.stopPropagation(); });
      control.appendChild(btn); control.appendChild(info); trackSwitch.appendChild(control);
    });
  }

  // ---- drag-and-drop wiring (delegated on the table, since tbody is rebuilt on every render) ----
  function clearDragOverClasses() {
    table.querySelectorAll(".drag-over-top,.drag-over-bottom").forEach(el => el.classList.remove("drag-over-top", "drag-over-bottom"));
  }
  table.addEventListener("dragstart", e => {
    const tr = e.target.closest("tr.track-row");
    if (!tr) { e.preventDefault(); return; }
    dragModelId = tr.dataset.modelId;
    tr.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragModelId); } catch (err) {}
  });
  table.addEventListener("dragover", e => {
    if (!dragModelId) return;
    const tr = e.target.closest("tr.track-row");
    if (!tr || tr.dataset.modelId === dragModelId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = tr.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    clearDragOverClasses();
    tr.classList.add(before ? "drag-over-top" : "drag-over-bottom");
  });
  table.addEventListener("dragleave", e => {
    const tr = e.target.closest("tr.track-row");
    if (tr && !tr.contains(e.relatedTarget)) tr.classList.remove("drag-over-top", "drag-over-bottom");
  });
  table.addEventListener("drop", e => {
    const tr = e.target.closest("tr.track-row");
    clearDragOverClasses();
    if (!tr || !dragModelId || tr.dataset.modelId === dragModelId) return;
    e.preventDefault();
    const rect = tr.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    reorderCustom(dragModelId, tr.dataset.modelId, before);
  });
  table.addEventListener("dragend", () => {
    dragModelId = null;
    table.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
    clearDragOverClasses();
  });

  // ---- CSV export (all board x view combinations, zipped; each sheet has every track) ----
  function csvEscape(v) {
    if (v == null) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    return "﻿" + rows.map(r => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
  }
  function buildSheetCsv(boardKey, vKey) {
    const b = DATA.boards[boardKey], v = b.views[vKey];
    const header = ["Rank", "Model", "Host", "Track", b.headline_label]
      .concat(v.tasks.map(t => `${t.tnum} ${t.slabel} (${t.metric}${t.lo ? " lower better" : ""})`));
    const rows = [header];
    v.models.forEach(m => {
      const row = [m.rank, m.display, m.host, trackLabel[m.track] || m.track, m.headline];
      v.tasks.forEach(t => row.push(m.scores[t.id]));
      rows.push(row);
    });
    return toCsv(rows);
  }

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      let c = (crc ^ data[i]) & 0xFF;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function dosDateTime(d) {
    return {
      time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f),
      date: (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)
    };
  }
  // Minimal STORED-method (uncompressed) ZIP writer — no external deps.
  function buildZip(files) {
    const encoder = new TextEncoder();
    const { time: dosTime, date: dosDate } = dosDateTime(new Date());
    const localParts = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const nameBytes = encoder.encode(f.name), data = f.data, crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true); dv.setUint16(10, dosTime, true); dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      localParts.push(local, data);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0, true); cdv.setUint16(10, 0, true); cdv.setUint16(12, dosTime, true); cdv.setUint16(14, dosDate, true);
      cdv.setUint32(16, crc, true); cdv.setUint32(20, data.length, true); cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, nameBytes.length, true); cdv.setUint16(30, 0, true); cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true); cdv.setUint16(36, 0, true); cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += local.length + data.length;
    });
    const centralOffset = offset;
    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true); edv.setUint16(8, files.length, true); edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true); edv.setUint32(16, centralOffset, true);
    return new Blob([...localParts, ...central, end], { type: "application/zip" });
  }

  function exportCsvZip() {
    const files = [];
    Object.keys(DATA.boards).forEach(boardKey => {
      const b = DATA.boards[boardKey];
      Object.keys(b.views).forEach(vKey => {
        const v = b.views[vKey];
        const viewTag = vKey === "category" ? "by_category" : `${vKey}${v.n_tasks}`;
        const csv = buildSheetCsv(boardKey, vKey);
        files.push({ name: `${boardKey}_${viewTag}.csv`, data: new TextEncoder().encode(csv) });
      });
    });
    const blob = buildZip(files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "speechdx-extended-leaderboard.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const exportBtn = document.getElementById("export-csv");
  if (exportBtn) exportBtn.addEventListener("click", e => { e.stopPropagation(); exportCsvZip(); });

  const themeBtn = document.getElementById("theme-toggle");
  function themeLabel() { if (themeBtn) themeBtn.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾"; }
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme === "dark";
      document.documentElement.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("ftlb-theme", document.documentElement.dataset.theme); } catch (e) {}
      themeLabel();
    });
    themeLabel();
  }

  render();
})();
