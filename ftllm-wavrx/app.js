/* FT-LLM + WavRx leaderboard. The data ships AES-GCM-encrypted (window.LB_ENC);
   the gate passphrase decrypts it in-browser into window.LB_DATA, then the table
   renders. Two boards (A: C-index·avg, B: MAE·MRR) × a raw⇄merged task toggle.
   Render is a single innerHTML pass + event delegation (iOS-robust). */
(function () {
  "use strict";

  // build stamp — proves which app.js + data.js actually loaded (cache check)
  try {
    var _bs = document.getElementById("gate-build");
    if (_bs) _bs.textContent = "app r8 · " +
      (window.LB_ENC ? ("data " + window.LB_ENC.iter + " iters") : "data missing") +
      (window.crypto && crypto.subtle ? " · webcrypto ✓" : " · webcrypto ✗");
  } catch (e) {}

  // ---------- crypto gate ----------
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decrypt(pass, enc, onStep) {
    const step = s => onStep && onStep(s);
    step("import");
    const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass),
      "PBKDF2", false, ["deriveKey"]);
    step("derive");
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iter, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    step("decrypt");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.ct));
    step("parse");
    return JSON.parse(new TextDecoder().decode(pt));
  }

  const gate = document.getElementById("gate");
  const gateForm = document.getElementById("gate-form");
  const gatePass = document.getElementById("gate-pass");
  const gateMsg = document.getElementById("gate-msg");
  const appEl = document.getElementById("app");
  function showMsg(t, cls) { gateMsg.textContent = t; gateMsg.className = "gate-msg " + cls; gateMsg.hidden = false; }

  gateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!window.LB_ENC) { showMsg("Data failed to load — hard-refresh the page.", "err"); return; }
    if (!(window.crypto && crypto.subtle)) {
      showMsg("This browser blocks in-page decryption (needs https / Safari, not an in-app browser).", "err");
      return;
    }
    const go = document.getElementById("gate-go");
    go.disabled = true;
    let step = "start";
    showMsg("Decrypting…", "ok");
    const watchdog = setTimeout(() => {
      if (!gate.hidden) {
        showMsg("Stuck at “" + step + "”. Tell the author this message.", "err");
        go.disabled = false;
      }
    }, 12000);
    await new Promise(r => setTimeout(r, 0));

    let data;
    try {
      data = await decrypt(gatePass.value, window.LB_ENC, s => { step = s; showMsg("Decrypting… (" + s + ")", "ok"); });
    } catch (err) {
      clearTimeout(watchdog); go.disabled = false;
      showMsg("Couldn’t unlock — wrong passphrase, or WebCrypto error (" + ((err && (err.name || err.message)) || "?") + ").", "err");
      gatePass.select();
      return;
    }
    clearTimeout(watchdog);
    window.LB_DATA = data;
    showMsg("Rendering…", "ok");
    const w2 = setTimeout(() => {
      if (appEl.hidden) { showMsg("Stuck while building the table — tell the author this message.", "err"); go.disabled = false; }
    }, 8000);
    await new Promise(r => setTimeout(r, 0));
    try {
      boot(data);                                 // single innerHTML build into hidden #app
      gate.hidden = true; appEl.hidden = false;
      clearTimeout(w2);
    } catch (err) {
      clearTimeout(w2); go.disabled = false;
      showMsg("Decrypted, but rendering failed: " + ((err && err.message) || err), "err");
    }
  });
  gatePass.focus();

  // ---------- main render (one innerHTML pass + delegation) ----------
  function boot(DATA) {
    const catColor = {}, catRgb = {}, catLabel = {};
    DATA.categories.forEach(c => {
      catColor[c.code] = c.color; catLabel[c.code] = c.label;
      const h = c.color.replace("#", "");
      catRgb[c.code] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(" ");
    });
    const REG = new Set(DATA.reg_ids);
    const modelById = {}; DATA.models.forEach(m => modelById[m.id] = m);

    let board = "B", merged = true, sortKey = "headline", sortDir = -1;
    const view = () => (merged ? DATA.views.merged : DATA.views.raw);
    const visibleModels = () => DATA.models.filter(m => merged || m.has_raw);
    const headline = m => board === "A" ? (merged ? m.avg_merged : m.avg_raw) : (merged ? m.mrr_merged : m.mrr_raw);
    const clsMean = m => merged ? m.cls_mean_merged : m.cls_mean_raw;
    const coverage = m => merged ? m.cov_merged : m.cov_raw;
    const cellVal = (m, t) => REG.has(t.id)
      ? (board === "A" ? m.reg_cindex[t.id] : m.reg_mae[t.id])
      : (merged ? m.cls_merged[t.id] : (m.cls_raw ? m.cls_raw[t.id] : null));
    const lowerBetter = t => REG.has(t.id) && board === "B";

    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const strip0 = v => v.toFixed(3).replace(/^0\./, ".").replace(/^-0\./, "-.");
    const fmtCell = (v, t) => v == null ? "—" : (REG.has(t.id) && board === "B") ? v.toFixed(2) : strip0(v);
    const fmtHead = v => v == null ? null : strip0(v);

    document.getElementById("legend").innerHTML =
      `<div class="legend-group"><span class="legend-title">Clinical category</span>` +
      DATA.categories.map(c => `<span class="legend-item"><span class="swatch-cat" style="background:rgb(${catRgb[c.code]} / .85)"></span>${c.label}</span>`).join("") +
      `</div>`;

    // ---- tooltip (delegated triggers) ----
    const tip = document.getElementById("tooltip");
    const showTip = html => { tip.innerHTML = html + '<button class="tt-close" aria-label="Dismiss">&times;</button>'; tip.hidden = false; };
    const hideTip = () => { tip.hidden = true; };
    tip.addEventListener("click", e => { e.stopPropagation(); if (e.target.closest(".tt-close")) hideTip(); });
    document.addEventListener("click", () => { if (!tip.hidden) hideTip(); });

    const KIND = { "ft-llm": ["FT-LLM", "badge-ft"], "zs-llm": ["zero-shot", "badge-zs"],
      "ours-probe": ["WavRx", "badge-rx"], "ours-encoder": ["ours", "badge-ft"], "encoder": [null, null] };

    const taskTip = t => `<div class="tt-title">${t.members.join(" · ")} · ${esc(t.slabel)}</div>` +
      `<div class="tt-sub">${catLabel[t.category]} · ${REG.has(t.id) ? (board === "A" ? "concordance index" : "MAE ↓") : "ROC-AUC ↑"}</div><div>${esc(t.desc)}</div>`;
    const modelTip = m => {
      const cov = coverage(m);
      return `<div class="tt-title">${esc(m.display)}</div><div class="tt-sub">${(KIND[m.kind] || [])[0] || "external encoder"}</div><div>${esc(m.note)}</div>` +
        (board === "B" && cov != null ? `<div class="tt-sub" style="margin-top:6px">MRR over ${cov} / ${view().task_ids.length} tasks</div>` : "") +
        (board === "A" && headline(m) == null ? `<div class="tt-sub" style="margin-top:6px">classification mean ${strip0(clsMean(m))} · C-index pending</div>` : "");
    };

    // ---- sorting / aggregates ----
    function setSort(key) { if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = key === "model" ? 1 : -1; } render(); }
    function cmp(a, b, get, dir) { const av = get(a), bv = get(b); if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1; return (av - bv) * dir; }
    function sortModels(list) {
      const l = list.slice();
      if (sortKey === "model") l.sort((a, b) => { const x = a.display.toLowerCase(), y = b.display.toLowerCase(); return x < y ? sortDir : x > y ? -sortDir : 0; });
      else if (sortKey === "headline") l.sort((a, b) => cmp(a, b, headline, sortDir));
      else { const t = view().tasks.find(t => t.id === sortKey); const dir = (t && lowerBetter(t)) ? -sortDir : sortDir; l.sort((a, b) => cmp(a, b, m => cellVal(m, t), dir)); }
      return l;
    }
    function bestByTask() {
      const best = {};
      view().tasks.forEach(t => {
        const vals = visibleModels().map(m => cellVal(m, t)).filter(v => v != null);
        best[t.id] = !vals.length ? null : lowerBetter(t) ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
      });
      return best;
    }
    const maxHeadline = list => { const vs = list.map(headline).filter(v => v != null); return vs.length ? Math.max.apply(null, vs) : 0; };

    function rowHtml(m, rank, best, maxH) {
      const rc = m.kind === "ours-probe" ? "is-star" : (m.ours ? "is-ours" : "");
      const [blabel, bcls] = KIND[m.kind] || [null, null];
      const badge = blabel ? `<span class="badge ${bcls}">${blabel}</span>` : "";
      let s = `<tr class="${rc}"><td class="col-model cell-model" data-mid="${m.id}"><span class="rank">${rank}</span><span class="name">${esc(m.display)}</span>${badge}</td>`;
      const hv = headline(m);
      if (hv == null) s += `<td class="col-head cell-head"><div class="hv pending">pending</div><div class="cov">cls ${strip0(clsMean(m))}</div></td>`;
      else {
        const w = maxH ? Math.round((hv / maxH) * 100) : 0;
        s += `<td class="col-head cell-head"><div class="hv">${fmtHead(hv)}</div>` +
          (board === "B" ? `<div class="cov">${coverage(m)}/${view().task_ids.length}</div>` : "") +
          `<div class="track"><div class="bar" style="width:${w}%"></div></div></td>`;
      }
      view().tasks.forEach(t => {
        const v = cellVal(m, t);
        const top = (v != null && best[t.id] != null && v === best[t.id]) ? " top1" : "";
        s += `<td class="cell-score${top}${v == null ? " na" : ""}" style="--cat-rgb:${catRgb[t.category]}">${fmtCell(v, t)}</td>`;
      });
      return s + `</tr>`;
    }

    const board_note = document.getElementById("board-note");
    const table = document.getElementById("board");

    function render() {
      const v = view(), arrow = sortDir === -1 ? " ▼" : " ▲";
      document.getElementById("meta").innerHTML =
        `${visibleModels().length} models · ${v.task_ids.length} tasks ` +
        `(${v.task_ids.length - DATA.reg_ids.length} classification + ${DATA.reg_ids.length} regression) · ` +
        `generated ${DATA.generated} · <span class="small">${esc(DATA.source)}</span>`;
      board_note.innerHTML = board === "A"
        ? `<b>Board A · C-index · average.</b> Regression = concordance index; ranked by the mean over the visible tasks ` +
          `(the published <b>avg</b> in the merged view). The <b>30B LoRA-SFT</b>, <b>30B base</b> and <b>WavRx</b> have no ` +
          `C-index yet (Trillium-blocked) → shown in a <b>pending</b> band, classification only.`
        : `<b>Board B · MAE · MRR.</b> Regression = mean absolute error (lower better); ranked by <b>mean reciprocal rank</b> ` +
          `over the visible tasks — so the 30B arms and <b>WavRx</b> are fully placed here. The two 7B SFT rows are MRR'd over ` +
          `the tasks they cover (their regression was scored with the C-index, not MAE).`;
      document.getElementById("hint-extra").textContent = merged ? ""
        : "Raw per-corpus view — the 7B SFT/base rows exist at merged granularity only and are hidden here.";

      const sa = k => sortKey === k ? " sort-active" : "";
      let h = `<thead><tr><th class="col-model th-sortable${sa("model")}" data-key="model"><div class="th-inner">Model${sortKey === "model" ? arrow : ""}</div></th>` +
        `<th class="col-head th-sortable${sa("headline")}" data-key="headline"><div class="th-inner">${board === "A" ? "avg" : "MRR"}${sortKey === "headline" ? arrow : ""}</div></th>`;
      v.tasks.forEach(t => {
        const metric = REG.has(t.id) ? (board === "A" ? "C-idx" : "MAE ↓") : "AUC";
        h += `<th class="th-task th-sortable${sa(t.id)}" data-key="${t.id}" data-tid="${t.id}" style="--cat:${catColor[t.category]}">` +
          `<div class="th-inner"><span class="task-tnum">${t.members.join("·")}</span>` +
          `<span class="task-label">${esc(t.slabel)}</span>` +
          `<span class="task-metric">${metric}${sortKey === t.id ? arrow : ""}</span></div></th>`;
      });
      h += `</tr></thead>`;

      const vis = visibleModels(), best = bestByTask();
      let pending = [], placed;
      if (board === "A" && sortKey === "headline") {
        pending = vis.filter(m => headline(m) == null).sort((a, b) => (clsMean(b) || 0) - (clsMean(a) || 0));
        placed = sortModels(vis.filter(m => headline(m) != null));
      } else placed = sortModels(vis);
      const maxH = maxHeadline(vis);

      let b = "<tbody>";
      if (pending.length) {
        b += `<tr class="band-row"><td colspan="${v.tasks.length + 2}">Pending C-index — classification only</td></tr>`;
        pending.forEach(m => b += rowHtml(m, "—", best, maxH));
      }
      placed.forEach((m, i) => b += rowHtml(m, (sortKey === "headline" || sortKey === "model") ? String(i + 1) : "·", best, maxH));
      b += "</tbody>";

      table.innerHTML = h + b;
    }

    // ---- delegated events (attached once) ----
    table.addEventListener("click", e => {
      const th = e.target.closest("th[data-key]");
      if (th) { setSort(th.dataset.key); return; }
      const md = e.target.closest("td.cell-model");
      if (md && modelById[md.dataset.mid]) { showTip(modelTip(modelById[md.dataset.mid])); e.stopPropagation(); }
    });
    table.addEventListener("mouseover", e => {
      const th = e.target.closest("th[data-tid]");
      if (th) { const t = view().tasks.find(t => t.id === th.dataset.tid); if (t) showTip(taskTip(t)); return; }
      const md = e.target.closest("td.cell-model");
      if (md && modelById[md.dataset.mid]) showTip(modelTip(modelById[md.dataset.mid]));
    });
    table.addEventListener("mouseleave", hideTip);

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
