/* Password gate. Decrypts window.LB_ENC (AES-GCM / PBKDF2) into
   window.LEADERBOARD_DATA, then loads the public SpeechDx renderer (app.js)
   verbatim so it renders exactly like the public site. */
(function () {
  "use strict";
  var b64 = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };

  async function decrypt(pass, enc) {
    var km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    var key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iter, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  var gate = document.getElementById("gate"),
      form = document.getElementById("gate-form"),
      pass = document.getElementById("gate-pass"),
      msg = document.getElementById("gate-msg"),
      app = document.getElementById("app"),
      go = document.getElementById("gate-go");
  function show(t, c) { msg.textContent = t; msg.className = "gate-msg " + c; msg.hidden = false; }

  // build stamp — proves which gate.js + data.js loaded and that WebCrypto exists
  try {
    var bs = document.getElementById("gate-build");
    if (bs) bs.textContent = "public-backend r9 · " +
      (window.LB_ENC ? ("data " + window.LB_ENC.iter + " iters") : "data missing") +
      (window.crypto && crypto.subtle ? " · webcrypto ✓" : " · webcrypto ✗");
  } catch (e) {}

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!window.LB_ENC) { show("Data failed to load — hard-refresh.", "err"); return; }
    if (!(window.crypto && crypto.subtle)) { show("This browser blocks in-page decryption (use Safari/Chrome over https, not an in-app browser).", "err"); return; }
    go.disabled = true;
    show("Decrypting…", "ok");
    await new Promise(function (r) { setTimeout(r, 0); });
    var data;
    try {
      data = await decrypt(pass.value, window.LB_ENC);
    } catch (err) {
      go.disabled = false; show("Wrong passphrase.", "err"); pass.select(); return;
    }
    window.LEADERBOARD_DATA = data;
    gate.hidden = true; app.hidden = false;
    // load the public renderer now that the data + DOM are ready
    var s = document.createElement("script");
    s.src = "app.js?v=9";
    s.onerror = function () { gate.hidden = false; app.hidden = true; go.disabled = false; show("Failed to load the renderer.", "err"); };
    document.body.appendChild(s);
  });
  pass.focus();
})();
