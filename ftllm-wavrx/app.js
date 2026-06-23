/* FT-LLM + WavRx leaderboard. The data ships AES-GCM-encrypted (window.LB_ENC);
   the gate passphrase decrypts it in-browser into window.LB_DATA, then the table
   renders. Two boards (A: C-index·avg, B: MAE·MRR) × a raw⇄merged task toggle. */
(function () {
  "use strict";

  // ---------- crypto gate ----------
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decrypt(pass, enc) {
    const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass),
      "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iter, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  const gate = document.getElementById("gate");
  const gateForm = document.getElementById("gate-form");
  const gatePass = document.getElementById("gate-pass");
  const gateMsg = document.getElementById("gate-msg");
  const appEl = document.getElementById("app");

  gateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!window.LB_ENC) { showMsg("Data failed to load — hard-refresh the page.", "err"); return; }
    if (!(window.crypto && crypto.subtle)) {
      showMsg("This browser blocks in-page decryption (needs https / Safari, not an in-app browser).", "err");
      return;
    }
    const go = document.getElementById("gate-go");
    go.disabled = true;
    showMsg("Decrypting…", "ok");
    // let the message paint before the (CPU-heavy on mobile) key derivation
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    const slow = setTimeout(() => showMsg("Still working… key-stretching is slow on some phones, hang on.", "ok"), 2500);

    let data;
    try {
      data = await decrypt(gatePass.value, window.LB_ENC);
    } catch (err) {
      clearTimeout(slow); go.disabled = false;
      showMsg("Wrong passphrase.", "err"); gatePass.select();
      return;
    }
    clearTimeout(slow);
    try {                                  // render errors must not masquerade as a decrypt hang
      window.LB_DATA = data;
      gate.hidden = true; appEl.hidden = false;
      boot(data);
    } catch (err) {
      gate.hidden = false; go.disabled = false;
      showMsg("Decrypted, but failed to render: " + err.message, "err");
    }
  });
  function showMsg(t, cls) { gateMsg.textContent = t; gateMsg.className = "gate-msg " + cls; gateMsg.hidden = false; }
  gatePass.focus();

  // ---------- main render ----------
  function boot(DATA) {
    const catColor = {}, catRgb = {}, catLabel = {};
    DATA.categories.forEach(c => {
      catColor[c.code] = c.color; catLabel[c.code] = c.label;
      const h = c.color.replace("#", "");
      catRgb[c.code] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(" ");
    });
    const REG = new Set(DATA.reg_ids);

    // state
    let board = "B";          // "A" = C-index·avg, "B" = MAE·MRR
    let merged = true;        // "Average similar tasks" — default ON
    let sortKey = "headline", sortDir = -1;

    const view = () => (merged ? DATA.views.merged : DATA.views.raw);
    const visibleModels = () => DATA.models.filter(m => merged || m.has_raw);

    // per-model accessors for the current board/view
    const headline = m => board === "A"
      ? (merged ? m.avg_merged : m.avg_raw)
      : (merged ? m.mrr_merged : m.mrr_raw);
    const clsMean = m => merged ? m.cls_mean_merged : m.cls_mean_raw;
    const coverage = m => merged ? m.cov_merged : m.cov_raw;
    const cellVal = (m, t) => REG.has(t.id)
      ? (board === "A" ? m.reg_cindex[t.id] : m.reg_mae[t.id])
      : (merged ? m.cls_merged[t.id] : (m.cls_raw ? m.cls_raw[t.id] : null));
    // regression direction: C-index higher-better, MAE lower-better
    const lowerBetter = t => REG.has(t.id) && board === "B";

    const fmtCell = (v, t) => v == null ? "—"
      : (REG.has(t.id) && board === "B") ? v.toFixed(2)
      : v.toFixed(3).replace(/^0\./, ".").replace(/^-0\./, "-.");
    const fmtHead = v => v == null ? null : v.toFixed(3).replace(/^0\./, ".");

    // ---- legend ----
    document.getElementById("legend").innerHTML =
      `<div class="legend-group"><span class="legend-title">Clinical category</span>` +
      DATA.categories.map(c =>
        `<span class="legend-item"><span class="swatch-cat" style="background:rgb(${catRgb[c.code]} / .85)"></span>${c.label}</span>`
      ).join("") + `</div>`;

    // ---- tooltip ----
    const tip = document.getElementById("tooltip");
    const showTip = html => { tip.innerHTML = html + '<button class="tt-close" aria-label="Dismiss">&times;</button>'; tip.hidden = false; };
    const hideTip = () => { tip.hidden = true; };
    tip.addEventListener("click", e => { e.stopPropagation(); if (e.target.closest(".tt-close")) hideTip(); });
    document.addEventListener("click", () => { if (!tip.hidden) hideTip(); });
    document.querySelector(".table-wrap").addEventListener("mouseleave", hideTip);

    const KIND = { "ft-llm": ["FT-LLM", "badge-ft"], "zs-llm": ["zero-shot", "badge-zs"],
      "ours-probe": ["WavRx", "badge-rx"], "ours-encoder": ["ours", "badge-ft"], "encoder": [null, null] };

    const table = document.getElementById("board");
    let hrow, tbody;

    function renderMeta() {
      const v = view();
      document.getElementById("meta").innerHTML =
        `${visibleModels().length} models · ${v.task_ids.length} tasks ` +
        `(${v.task_ids.length - DATA.reg_ids.length} classification + ${DATA.reg_ids.length} regression) · ` +
        `generated ${DATA.generated} · <span class="small">${DATA.source}</span>`;
      const note = document.getElementById("board-note");
      if (board === "A") note.innerHTML =
        `<b>Board A · C-index · average.</b> Regression = concordance index; ranked by the mean over the visible tasks ` +
        `(the published <b>avg</b> in the merged view). The <b>30B LoRA-SFT</b>, <b>30B base</b> and <b>WavRx</b> have no ` +
        `C-index yet (Trillium-blocked) → shown in a <b>pending</b> band, classification only.`;
      else note.innerHTML =
        `<b>Board B · MAE · MRR.</b> Regression = mean absolute error (lower better); ranked by <b>mean reciprocal rank</b> ` +
        `over the visible tasks — so the 30B arms and <b>WavRx</b> are fully placed here. The two 7B SFT rows are MRR'd over ` +
        `the tasks they cover (their regression was scored with the C-index, not MAE).`;
      document.getElementById("hint-extra").textContent = merged ? ""
        : "Raw per-corpus view — the 7B SFT/base rows exist at merged granularity only and are hidden here.";
    }

    function buildHeader() {
      const thead = document.createElement("thead");
      hrow = document.createElement("tr");

      const thM = document.createElement("th");
      thM.className = "col-model th-sortable"; thM.dataset.key = "model";
      thM.innerHTML = `<div class="th-inner">Model</div>`;
      hrow.appendChild(thM);

      const thH = document.createElement("th");
      thH.className = "col-head th-sortable"; thH.dataset.key = "headline";
      thH.innerHTML = `<div class="th-inner">${board === "A" ? "avg" : "MRR"}</div>`;
      hrow.appendChild(thH);

      view().tasks.forEach(t => {
        const th = document.createElement("th");
        th.className = "th-task th-sortable"; th.dataset.key = t.id;
        th.style.setProperty("--cat", catColor[t.category]);
        const metric = REG.has(t.id) ? (board === "A" ? "C-idx" : "MAE&nbsp;↓") : "AUC";
        th.innerHTML = `<div class="th-inner"><span class="task-tnum">${t.members.join("·")}</span>` +
          `<span class="task-label">${t.slabel}</span><span class="task-metric">${metric}</span></div>`;
        const ttl = `<div class="tt-title">${t.members.join(" · ")} · ${t.slabel}</div>` +
          `<div class="tt-sub">${catLabel[t.category]} · ${REG.has(t.id) ? (board === "A" ? "concordance index" : "MAE ↓") : "ROC-AUC ↑"}</div>` +
          `<div>${t.desc}</div>`;
        th.addEventListener("mouseenter", () => showTip(ttl));
        th.addEventListener("click", e => { showTip(ttl); e.stopPropagation(); });
        hrow.appendChild(th);
      });

      thead.appendChild(hrow); table.appendChild(thead);
      hrow.querySelectorAll(".th-sortable").forEach(th =>
        th.addEventListener("click", () => setSort(th.dataset.key)));
    }

    function setSort(key) {
      if (sortKey === key) sortDir *= -1;
      else { sortKey = key; sortDir = key === "model" ? 1 : -1; }
      renderBody(); renderSortIndicators();
    }
    function renderSortIndicators() {
      hrow.querySelectorAll(".th-sortable").forEach(th => {
        th.querySelector(".sort-arrow")?.remove();
        th.classList.toggle("sort-active", th.dataset.key === sortKey);
        if (th.dataset.key === sortKey) {
          const s = document.createElement("span");
          s.className = "sort-arrow"; s.textContent = sortDir === -1 ? "▼" : "▲";
          th.querySelector(".th-inner").appendChild(s);
        }
      });
    }

    function cmp(a, b, getVal, dir) {
      const av = getVal(a), bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      return (av - bv) * dir;
    }
    function sortModels(list) {
      const l = list.slice();
      if (sortKey === "model") l.sort((a, b) => {
        const x = a.display.toLowerCase(), y = b.display.toLowerCase();
        return x < y ? sortDir : x > y ? -sortDir : 0;
      });
      else if (sortKey === "headline") l.sort((a, b) => cmp(a, b, headline, sortDir));
      else {
        const t = view().tasks.find(t => t.id === sortKey);
        const dir = (t && lowerBetter(t)) ? -sortDir : sortDir;   // MAE: smaller is better
        l.sort((a, b) => cmp(a, b, m => cellVal(m, t), dir));
      }
      return l;
    }

    function bestByTask() {
      const best = {};
      view().tasks.forEach(t => {
        const vals = visibleModels().map(m => cellVal(m, t)).filter(v => v != null);
        best[t.id] = !vals.length ? null
          : lowerBetter(t) ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
      });
      return best;
    }

    function maxHeadline(list) {
      const vs = list.map(headline).filter(v => v != null);
      return vs.length ? Math.max.apply(null, vs) : 0;
    }

    function renderBody() {
      if (tbody) tbody.remove();
      tbody = document.createElement("tbody");
      table.appendChild(tbody);
      const best = bestByTask();
      const vis = visibleModels();

      // Board A on default sort: pending band (no avg) on top, then placed-by-avg.
      let pending = [], placed = vis;
      if (board === "A" && sortKey === "headline") {
        pending = vis.filter(m => headline(m) == null).sort((a, b) => (clsMean(b) || 0) - (clsMean(a) || 0));
        placed = sortModels(vis.filter(m => headline(m) != null));
      } else {
        placed = sortModels(vis);
      }
      const maxH = maxHeadline(vis);

      if (pending.length) {
        const band = document.createElement("tr"); band.className = "band-row";
        const td = document.createElement("td");
        td.colSpan = view().tasks.length + 2;
        td.textContent = "Pending C-index — classification only";
        band.appendChild(td); tbody.appendChild(band);
        pending.forEach(m => tbody.appendChild(modelRow(m, "—", best, maxH, true)));
      }
      placed.forEach((m, i) => tbody.appendChild(
        modelRow(m, sortKey === "headline" || sortKey === "model" ? String(i + 1) : "·", best, maxH, false)));
    }

    function modelRow(m, rank, best, maxH, isPending) {
      const tr = document.createElement("tr");
      if (m.kind === "ours-probe") tr.className = "is-star";
      else if (m.ours) tr.className = "is-ours";

      // model cell
      const tdM = document.createElement("td");
      tdM.className = "col-model cell-model";
      const [blabel, bcls] = KIND[m.kind] || [null, null];
      const badge = blabel ? `<span class="badge ${bcls}">${blabel}</span>` : "";
      tdM.innerHTML = `<span class="rank">${rank}</span><span class="name">${m.display}</span>${badge}`;
      const cov = coverage(m);
      const mTip = `<div class="tt-title">${m.display}</div>` +
        `<div class="tt-sub">${(KIND[m.kind] || [])[0] || "external encoder"}</div>` +
        `<div>${m.note}</div>` +
        (board === "B" && cov != null ? `<div class="tt-sub" style="margin-top:6px">MRR over ${cov} / ${view().task_ids.length} tasks</div>` : "") +
        (board === "A" && isPending ? `<div class="tt-sub" style="margin-top:6px">classification mean ${(clsMean(m)).toFixed(3).replace(/^0\./, ".")} · C-index pending</div>` : "");
      tdM.addEventListener("mouseenter", () => showTip(mTip));
      tdM.addEventListener("click", e => { showTip(mTip); e.stopPropagation(); });
      tr.appendChild(tdM);

      // headline cell
      const tdH = document.createElement("td");
      tdH.className = "col-head cell-head";
      const hv = headline(m);
      if (hv == null) {
        tdH.innerHTML = `<div class="hv pending">pending</div>` +
          `<div class="cov">cls ${(clsMean(m)).toFixed(3).replace(/^0\./, ".")}</div>`;
      } else {
        const w = maxH ? Math.round((hv / maxH) * 100) : 0;
        tdH.innerHTML = `<div class="hv">${fmtHead(hv)}</div>` +
          (board === "B" ? `<div class="cov">${cov}/${view().task_ids.length}</div>` : "") +
          `<div class="track"><div class="bar" style="width:${w}%"></div></div>`;
      }
      tr.appendChild(tdH);

      // task cells
      view().tasks.forEach(t => {
        const v = cellVal(m, t);
        const td = document.createElement("td");
        td.className = "cell-score" + (v == null ? " na" : "");
        td.style.setProperty("--cat-rgb", catRgb[t.category]);
        if (v != null && best[t.id] != null && v === best[t.id]) td.classList.add("top1");
        td.textContent = fmtCell(v, t);
        tr.appendChild(td);
      });
      return tr;
    }

    function render() {
      table.innerHTML = ""; tbody = null;
      renderMeta(); buildHeader(); renderBody(); renderSortIndicators();
    }

    // ---- controls ----
    document.querySelectorAll(".seg").forEach(btn => btn.addEventListener("click", () => {
      document.querySelectorAll(".seg").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      board = btn.dataset.board; sortKey = "headline"; sortDir = -1; render();
    }));
    const mergeCb = document.getElementById("merge-toggle");
    mergeCb.checked = merged;
    mergeCb.addEventListener("change", () => { merged = mergeCb.checked; render(); });

    const themeBtn = document.getElementById("theme-toggle");
    const themeLabel = () => { themeBtn.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾"; };
    themeBtn.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme === "dark";
      document.documentElement.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("ftlb-theme", document.documentElement.dataset.theme); } catch (e) {}
      themeLabel();
    });
    themeLabel();

    render();
  }
})();
