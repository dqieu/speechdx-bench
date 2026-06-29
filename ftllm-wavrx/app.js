/* FT-LLM + WavRx leaderboard renderer — an extension of the public SpeechDx
   docs/app.js (same iOS-safe createElement DOM building). Adds: a board switch
   (MAE·MRR / C-index·avg), a 3-way view (raw 27 / merged 19 / by-category), a
   pending band for C-index-less rows, and per-task metric direction. Reads
   window.LEADERBOARD_DATA (decrypted by gate.js). */
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
  const V = () => DATA.boards[board].views[viewKey];
  const hLabel = () => DATA.boards[board].headline_label;
  const strip0 = v => v.toFixed(3).replace(/^0\./, ".").replace(/^-0\./, "-.");
  const fmt = (v, t) => v == null ? "—" : t.dec2 ? v.toFixed(2) : strip0(v);

  let curTasks = [], bestByTask = {}, maxH = 0;

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
  function showTip(html) { tip.innerHTML = html + '<button class="tt-close" aria-label="Dismiss">&times;</button>'; tip.hidden = false; }
  function hideTip() { tip.hidden = true; }
  tip.addEventListener("click", e => { e.stopPropagation(); if (e.target.closest(".tt-close")) hideTip(); });
  document.addEventListener("click", () => { if (!tip.hidden) hideTip(); });
  document.querySelector(".table-wrap").addEventListener("mouseleave", hideTip);

  // ---- sorting ----
  function sortedPlaced(list) {
    const ms = list.slice();
    ms.sort((a, b) => {
      if (sortKey === "model") { const x = a.short.toLowerCase(), y = b.short.toLowerCase(); return x < y ? sortDir : x > y ? -sortDir : 0; }
      let av, bv, lo = false;
      if (sortKey === "headline") { av = a.headline; bv = b.headline; }
      else { av = a.scores[sortKey]; bv = b.scores[sortKey]; const t = curTasks.find(t => t.id === sortKey); lo = t && t.lo; }
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      return (av - bv) * (lo ? -sortDir : sortDir);
    });
    return ms;
  }
  function setSort(key) {
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = key === "model" ? 1 : -1; }
    renderBody(); renderSortIndicators();
  }
  const arrow = () => (sortDir === -1 ? "▼" : "▲");

  // ---- table ----
  const table = document.getElementById("board");
  let hrow, tbody;

  function renderMeta() {
    document.getElementById("meta").innerHTML =
      `${V().models.length} models · ${V().n_tasks} ${viewKey === "category" ? "category columns" : "tasks"} · ` +
      `generated ${DATA.generated} · <a href="${DATA.repo_url}" target="_blank" rel="noopener">repo ↗</a> · ` +
      `by <a href="${DATA.author_url}" target="_blank" rel="noopener">${DATA.author}</a>` +
      ` · <span style="color:#e0af68">*</span> respiratory (c9s/coswara) scores leak-contaminated`;
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
      th.innerHTML = `<div class="th-inner"><span class="task-tnum">${t.tnum}</span>` +
        `<span class="task-label">${t.slabel}</span><span class="task-metric">${t.metric}${t.lo ? "&nbsp;↓" : ""}</span></div>`;
      const tipHtml = `<div class="tt-title">${t.tnum} · ${t.label}</div><div>${t.desc}</div>` +
        `<div class="tt-sub">${t.metric}${t.lo ? " ↓" : ""} · ${catLabel[t.category]}</div>`;
      th.addEventListener("mouseenter", () => showTip(tipHtml));
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

  function modelRow(m, rank) {
    const tr = document.createElement("tr");
    if (m.id === "wavlm_rx") tr.className = "is-star";
    else if (/^OURS_/.test(m.id) || /^(wavlm_|dmel)/.test(m.id)) tr.className = "is-ours";

    const tdM = document.createElement("td");
    tdM.className = "col-model cell-model";
    tdM.innerHTML = `<span class="rank">${rank}</span><span class="name">${m.short}` +
      `${m.leak ? '<sup style="color:#e0af68;cursor:help" title="respiratory (c9s/coswara) scores leak-contaminated — see report">*</sup>' : ''}</span>`;
    const mHtml = `<div class="tt-title">${m.display}${m.leak ? ' *' : ''}</div><div class="tt-sub">${m.host}</div>` +
      `<a class="tt-link" href="${m.repo_url}" target="_blank" rel="noopener">${m.repo} ↗</a>` +
      `<div class="tt-rev">${m.revision} · ${m.revision_date}</div>` +
      (m.leak ? `<div style="color:#e0af68;font-size:11px;margin-top:5px">* c9s/coswara respiratory scores leak-contaminated (cross-task train/test participant overlap, ~25%; see the v3.6 report)</div>` : "");
    tdM.addEventListener("mouseenter", () => showTip(mHtml));
    tdM.addEventListener("click", e => { showTip(mHtml); e.stopPropagation(); });
    tr.appendChild(tdM);

    const tdH = document.createElement("td");
    tdH.className = "col-mrr cell-mrr";
    if (m.headline == null) {
      tdH.innerHTML = `<div class="mrr-val pending">pending</div><div class="cov">cls ${m.cls_mean == null ? "—" : strip0(m.cls_mean)}</div>`;
    } else {
      const w = maxH ? Math.round((m.headline / maxH) * 100) : 0;
      tdH.innerHTML = `<div class="mrr-val">${strip0(m.headline)}</div><div class="mrr-track"><div class="mrr-bar" style="width:${w}%"></div></div>`;
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
    const all = V().models;
    let pending = [], placed;
    if (sortKey === "headline") {
      pending = all.filter(m => m.pending);
      placed = sortedPlaced(all.filter(m => !m.pending));
    } else {
      placed = sortedPlaced(all); pending = [];
    }
    if (pending.length) {
      const band = document.createElement("tr"); band.className = "band-row";
      const td = document.createElement("td"); td.colSpan = curTasks.length + 2;
      td.textContent = "Pending C-index — classification only (Trillium)";
      band.appendChild(td); tbody.appendChild(band);
      pending.forEach(m => tbody.appendChild(modelRow(m, "—")));
    }
    placed.forEach((m, i) => tbody.appendChild(modelRow(m, sortKey === "headline" || sortKey === "model" ? i + 1 : "·")));
  }

  function render() {
    curTasks = V().tasks;
    bestByTask = {};
    curTasks.forEach(t => {
      const vals = V().models.map(m => m.scores[t.id]).filter(v => v != null);
      bestByTask[t.id] = !vals.length ? null : (t.lo ? Math.min.apply(null, vals) : Math.max.apply(null, vals));
    });
    maxH = Math.max.apply(null, V().models.map(m => m.headline || 0));
    renderLegend(); renderMeta();
    table.innerHTML = ""; tbody = null;
    buildHeader(); renderBody(); renderSortIndicators();
  }

  // ---- controls ----
  document.querySelectorAll("#board-switch .seg").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll("#board-switch .seg").forEach(b => b.classList.remove("active"));
    btn.classList.add("active"); board = btn.dataset.board; sortKey = "headline"; sortDir = -1; render();
  }));
  document.querySelectorAll("#view-switch .seg").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll("#view-switch .seg").forEach(b => b.classList.remove("active"));
    btn.classList.add("active"); viewKey = btn.dataset.view; sortKey = "headline"; sortDir = -1; render();
  }));

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
