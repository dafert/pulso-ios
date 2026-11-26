(function () {
  window.__PULSO_WEB__ = true;

  // --- Session ID & Server URL ---
  function getOrCreateSessionId() {
    var key = "pulso_wa_session_id";
    var id = "";
    try { id = localStorage.getItem(key) || ""; } catch (e) {}
    if (!/^[a-zA-Z0-9_-]{12,64}$/.test(id)) {
      id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ("ps-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12));
      try { localStorage.setItem(key, id); } catch (e) {}
    }
    return id;
  }

  function normalizeServerUrl(raw) {
    var s = String(raw || "").trim().replace(/\/+$/, "");
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    return s;
  }

  function detectInitialServerUrl() {
    try {
      var params = new URLSearchParams(location.search);
      var fromQuery = normalizeServerUrl(params.get("server") || "");
      if (fromQuery) {
        localStorage.setItem("pulso_server_url", fromQuery);
        return fromQuery;
      }
    } catch (e) {}
    // If served directly from pulso-server (not github.io), same-origin IS the server!
    if (location.hostname !== "dafert.github.io" && !location.hostname.endsWith(".github.io") && /^https?:$/i.test(location.protocol)) {
      return location.origin;
    }
    try {
      return normalizeServerUrl(localStorage.getItem("pulso_server_url") || "");
    } catch (e) {
      return "";
    }
  }

  var SESSION_ID = getOrCreateSessionId();
  var serverUrl = detectInitialServerUrl();
  var waConnected = false;
  var pollTimer = null;

  function setServerUrl(url) {
    serverUrl = normalizeServerUrl(url);
    try {
      if (serverUrl) localStorage.setItem("pulso_server_url", serverUrl);
      else localStorage.removeItem("pulso_server_url");
    } catch (e) {}
  }

  async function apiCall(path, method, body) {
    if (!serverUrl) {
      throw new Error("Configure a URL do Servidor Pulso acima (ou abra direto pelo servidor) para conectar o WhatsApp.");
    }
    var opts = {
      method: method || "GET",
      headers: { "Content-Type": "application/json", "X-Pulso-Session": SESSION_ID }
    };
    if (body) opts.body = JSON.stringify(Object.assign({ sessionId: SESSION_ID }, body));
    var url = serverUrl + path + (method === "GET" ? (path.indexOf("?") >= 0 ? "&" : "?") + "sessionId=" + encodeURIComponent(SESSION_ID) : "");
    var resp = await fetch(url, opts);
    var data = await resp.json().catch(function () { return { ok: false, detail: "Resposta inválida do servidor." }; });
    if (!resp.ok && data.ok !== false) data.ok = false;
    return data;
  }

  window.__pulsoServerState = function () {
    return { serverUrl: serverUrl, connected: waConnected, sessionId: SESSION_ID };
  };

  window.__pulsoSendViaServer = async function (payload) {
    var data = await apiCall("/api/sticker/send", "POST", payload);
    if (!data || !data.ok) {
      throw new Error((data && data.detail) || "Não foi possível enviar a figurinha pelo servidor.");
    }
    return data;
  };

  // Safe localStorage-backed chrome.storage.local polyfill
  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: async function (key) {
        var out = {};
        try {
          var raw = localStorage.getItem("pulso_web_" + String(key));
          if (raw) out[key] = JSON.parse(raw);
        } catch (e) {}
        return out;
      },
      set: async function (obj) {
        try {
          var keys = Object.keys(obj || {});
          for (var i = 0; i < keys.length; i++) {
            localStorage.setItem("pulso_web_" + keys[i], JSON.stringify(obj[keys[i]]));
          }
        } catch (e) {}
      }
    }
  };

  window.chrome.runtime = {
    sendMessage: async function (msg) {
      if (msg && msg.what === "status") {
        if (!serverUrl) {
          return {
            level: "parcial",
            detail: "Modo local ativo · Conecte o Servidor Pulso acima para logar seu WhatsApp e enviar figurinhas com som."
          };
        }
        try {
          var st = await apiCall("/api/session/status", "GET");
          waConnected = Boolean(st && st.loggedIn && st.compatible);
          updateConnectCard(st);
          if (waConnected) {
            return { level: "compativel", detail: "WhatsApp conectado! Pronto para enviar figurinhas com som." };
          }
          return { level: "incompativel", detail: (st && st.detail) || "Conecte seu WhatsApp no painel acima para enviar com som." };
        } catch (err) {
          return { level: "incompativel", detail: "Servidor Pulso offline ou inacessível (" + serverUrl + ")." };
        }
      }
      return { ok: false, detail: "Ação não suportada." };
    }
  };

  // 16-bit PCM WAV fallback for Safari iOS 17/18 (server converts WAV -> Ogg/Opus via ffmpeg!)
  window.__pulsoEncodeAudioFallback = function (channels, sampleRate) {
    var rate = sampleRate || 48000;
    var left = channels[0];
    var right = channels.length > 1 ? channels[1] : null;
    var len = left.length;
    var dataSize = len * 2;
    var buf = new ArrayBuffer(44 + dataSize);
    var dv = new DataView(buf);
    function writeStr(off, s) {
      for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
    }
    writeStr(0, "RIFF");
    dv.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    writeStr(36, "data");
    dv.setUint32(40, dataSize, true);
    for (var j = 0; j < len; j++) {
      var sample = right ? (left[j] + right[j]) * 0.5 : left[j];
      var clamped = Math.max(-1, Math.min(1, sample));
      dv.setInt16(44 + j * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }
    return new Uint8Array(buf);
  };

  window.__pulsoShareFiles = async function (files, title) {
    if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: files })) return false;
    await navigator.share({ title: title || "Figurinha Pulso", files: files });
    return true;
  };

  // --- UI wiring for WhatsApp Connection Panel + Accessible Validation + PWA Install ---
  function updateConnectCard(st) {
    var badge = document.getElementById("wa-badge");
    var msg = document.getElementById("wa-connect-msg");
    var formsArea = document.getElementById("wa-login-forms");
    var logoutBtn = document.getElementById("wa-logout-btn");
    var codeBox = document.getElementById("wa-code-box");
    var codeVal = document.getElementById("wa-code-value");
    var qrBox = document.getElementById("wa-qr-box");
    if (!badge) return;

    if (!serverUrl) {
      badge.textContent = "⚙️ Servidor não configurado";
      badge.dataset.state = "idle";
      if (formsArea) formsArea.hidden = false;
      if (logoutBtn) logoutBtn.hidden = true;
      return;
    }

    if (st && st.loggedIn) {
      waConnected = true;
      badge.textContent = st.compatible ? "🟢 WhatsApp Conectado" : "🟡 Carregando conversas…";
      badge.dataset.state = st.compatible ? "connected" : "pending";
      if (msg) msg.textContent = st.compatible
        ? "Conectado! Escolha seus vídeos abaixo e envie figurinhas com som direto pro seu WhatsApp."
        : "WhatsApp conectado! Finalizando carregamento dos módulos…";
      if (formsArea) formsArea.hidden = true;
      if (codeBox) codeBox.hidden = true;
      if (qrBox) qrBox.hidden = true;
      if (logoutBtn) logoutBtn.hidden = false;
      if (st.compatible) stopPolling();
      if (typeof window.__pulsoRefreshStatus === "function") window.__pulsoRefreshStatus();
      return;
    }

    waConnected = false;
    if (formsArea) formsArea.hidden = false;
    if (logoutBtn) logoutBtn.hidden = true;

    if (st && st.pairingCode) {
      badge.textContent = "🟡 Aguardando código no celular";
      badge.dataset.state = "pending";
      if (codeBox) codeBox.hidden = false;
      if (codeVal) codeVal.textContent = st.pairingCode;
      if (qrBox) qrBox.hidden = true;
      if (msg) msg.textContent = st.detail || "Cole o código no WhatsApp do seu celular.";
    } else {
      badge.textContent = "⚪ WhatsApp Desconectado";
      badge.dataset.state = "idle";
      if (st && st.detail && msg) msg.textContent = st.detail;
    }
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async function () {
      if (!serverUrl) { stopPolling(); return; }
      try {
        var st = await apiCall("/api/session/status", "GET");
        updateConnectCard(st);
      } catch (e) {}
    }, 2800);
  }

  // Accessible :user-invalid + ARIA synchronization (validate-input-after-interaction)
  function initAccessibleValidation(form) {
    if (!form) return;
    var announcer = document.createElement("div");
    announcer.setAttribute("aria-live", "polite");
    announcer.className = "visually-hidden";
    document.body.append(announcer);
    var announceTimer;
    var flagged = new WeakSet();
    var announced = new WeakSet();

    function linkError(field, shown) {
      var errorId = field.dataset.error;
      if (!errorId) return;
      var ids = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(function (id) { return id && id !== errorId; });
      if (shown) ids.push(errorId);
      if (ids.length) field.setAttribute("aria-describedby", ids.join(" "));
      else field.removeAttribute("aria-describedby");
    }

    function syncAria(field, shouldAnnounce) {
      if (!field || !field.matches || !field.matches("input, select, textarea")) return;
      var invalid = false;
      try { invalid = field.matches(":user-invalid"); } catch (e) { invalid = !field.validity.valid; }
      if (invalid) {
        field.setAttribute("aria-invalid", "true");
        linkError(field, true);
        flagged.add(field);
        if (shouldAnnounce && !announced.has(field)) {
          announced.add(field);
          var errEl = document.getElementById(field.dataset.error);
          if (errEl) {
            clearTimeout(announceTimer);
            announcer.textContent = "";
            announceTimer = setTimeout(function () { announcer.textContent = errEl.textContent.trim(); }, 450);
          }
        }
      } else if (flagged.has(field) || field.getAttribute("aria-invalid") !== "true") {
        field.setAttribute("aria-invalid", "false");
        linkError(field, false);
        flagged.delete(field);
        announced.delete(field);
      }
    }

    form.querySelectorAll("input, select, textarea").forEach(function (f) { syncAria(f, false); });
    form.addEventListener("blur", function (e) { syncAria(e.target, true); }, true);
    form.addEventListener("input", function (e) { if (e.target.hasAttribute("aria-invalid")) syncAria(e.target, false); });
    form.addEventListener("invalid", function (e) { announced.add(e.target); syncAria(e.target, false); }, true);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("web-app");

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }

    var serverInput = document.getElementById("wa-server-url");
    var serverSaveBtn = document.getElementById("wa-server-save");
    var serverDetails = document.getElementById("wa-server-details");
    var phoneForm = document.getElementById("wa-phone-form");
    var ddiInput = document.getElementById("wa-ddi");
    var phoneInput = document.getElementById("wa-phone");
    var pairBtn = document.getElementById("wa-pair-btn");
    var qrBtn = document.getElementById("wa-qr-btn");
    var copyCodeBtn = document.getElementById("wa-copy-code");
    var logoutBtn = document.getElementById("wa-logout-btn");
    var msg = document.getElementById("wa-connect-msg");
    var qrBox = document.getElementById("wa-qr-box");
    var qrImg = document.getElementById("wa-qr-img");
    var codeBox = document.getElementById("wa-code-box");
    var codeVal = document.getElementById("wa-code-value");

    initAccessibleValidation(phoneForm);

    if (serverInput) serverInput.value = serverUrl;
    if (serverDetails && !serverUrl) serverDetails.open = true;

    try {
      var savedPhone = localStorage.getItem("pulso_web_last_phone");
      if (savedPhone && phoneInput) phoneInput.value = savedPhone;
    } catch (e) {}

    if (serverSaveBtn) {
      serverSaveBtn.addEventListener("click", async function () {
        setServerUrl(serverInput ? serverInput.value : "");
        if (!serverUrl) {
          if (msg) msg.textContent = "URL do servidor limpa. Usando modo local (apenas baixar arquivos).";
          updateConnectCard(null);
          return;
        }
        if (msg) msg.textContent = "Testando conexão com " + serverUrl + "…";
        try {
          var h = await fetch(serverUrl + "/api/health").then(function (r) { return r.json(); });
          if (h && h.ok) {
            if (msg) msg.textContent = "✅ Servidor Pulso online! Agora conecte seu WhatsApp abaixo.";
            if (serverDetails) serverDetails.open = false;
            var st = await apiCall("/api/session/status", "GET");
            updateConnectCard(st);
          } else {
            if (msg) msg.textContent = "❌ Servidor não respondeu corretamente.";
          }
        } catch (err) {
          if (msg) msg.textContent = "❌ Não foi possível alcançar " + serverUrl + ". Verifique se o servidor está rodando.";
        }
      });
    }

    if (phoneForm) {
      phoneForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!phoneForm.checkValidity()) {
          phoneForm.reportValidity();
          return;
        }
        var ddi = (ddiInput ? ddiInput.value : "55").replace(/\D/g, "") || "55";
        var phone = (phoneInput ? phoneInput.value : "").replace(/\D/g, "");
        try { localStorage.setItem("pulso_web_last_phone", phone); } catch (err) {}

        pairBtn.setAttribute("aria-disabled", "true");
        if (qrBox) qrBox.hidden = true;
        if (msg) msg.textContent = "Conectando ao WhatsApp e gerando código de 8 dígitos (pode levar ~10s na 1ª vez)…";
        try {
          var res = await apiCall("/api/session/pair-phone", "POST", { ddi: ddi, phone: phone });
          if (res.ok && res.loggedIn) {
            updateConnectCard(res);
          } else if (res.ok && res.code) {
            updateConnectCard({ loggedIn: false, pairingCode: res.code, detail: res.detail });
            startPolling();
          } else {
            if (msg) msg.textContent = "❌ " + (res.detail || "Não foi possível gerar o código.");
          }
        } catch (err) {
          if (msg) msg.textContent = "❌ " + (err.message || "Erro ao comunicar com o servidor.");
        } finally {
          pairBtn.removeAttribute("aria-disabled");
        }
      });
    }

    if (qrBtn) {
      qrBtn.addEventListener("click", async function () {
        qrBtn.setAttribute("aria-disabled", "true");
        if (codeBox) codeBox.hidden = true;
        if (msg) msg.textContent = "Carregando QR Code do WhatsApp (pode levar ~10s na 1ª vez)…";
        try {
          var res = await apiCall("/api/session/qr", "POST", {});
          if (res.ok && res.loggedIn) {
            updateConnectCard(res);
          } else if (res.ok && res.qrDataUrl) {
            if (qrImg) qrImg.src = res.qrDataUrl;
            if (qrBox) qrBox.hidden = false;
            if (msg) msg.textContent = "Escaneie o QR Code no WhatsApp → Dispositivos conectados.";
            startPolling();
          } else {
            if (msg) msg.textContent = "❌ " + (res.detail || "Não foi possível carregar o QR Code.");
          }
        } catch (err) {
          if (msg) msg.textContent = "❌ " + (err.message || "Erro ao comunicar com o servidor.");
        } finally {
          qrBtn.removeAttribute("aria-disabled");
        }
      });
    }

    if (copyCodeBtn) {
      copyCodeBtn.addEventListener("click", async function () {
        var raw = (codeVal ? codeVal.textContent : "").replace(/[^A-Za-z0-9]/g, "");
        if (!raw) return;
        try {
          await navigator.clipboard.writeText(raw);
          if (msg) msg.textContent = "✅ Código " + raw + " copiado! Cole em Dispositivos conectados → Conectar com número.";
        } catch (e) {
          prompt("Copie o código:", raw);
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async function () {
        stopPolling();
        try { await apiCall("/api/session/logout", "POST", {}); } catch (e) {}
        waConnected = false;
        updateConnectCard({ loggedIn: false, detail: "WhatsApp desconectado." });
        if (typeof window.__pulsoRefreshStatus === "function") window.__pulsoRefreshStatus();
      });
    }

    // Check status on load if server URL is configured
    if (serverUrl) {
      apiCall("/api/session/status", "GET").then(updateConnectCard).catch(function () {});
    }

    // Progressive enhancement PWA installation (navigator.install + beforeinstallprompt fallback)
    var installButton = document.getElementById("install-app");
    var installStatus = document.getElementById("install-status");
    if (installButton) {
      var supportsWebInstall = typeof Navigator !== "undefined" && typeof Navigator.prototype.install === "function";
      var deferredInstallPrompt;
      if (supportsWebInstall) installButton.hidden = false;

      window.addEventListener("beforeinstallprompt", function (event) {
        event.preventDefault();
        deferredInstallPrompt = event;
        if (!supportsWebInstall) installButton.hidden = false;
      });

      installButton.addEventListener("click", async function () {
        if (installButton.getAttribute("aria-disabled") === "true") return;
        installButton.setAttribute("aria-disabled", "true");
        try {
          if (supportsWebInstall) {
            await navigator.install();
            if (installStatus) installStatus.textContent = "Pulso Web instalado!";
            installButton.hidden = true;
          } else if (deferredInstallPrompt) {
            var promptEvent = deferredInstallPrompt;
            deferredInstallPrompt = undefined;
            await promptEvent.prompt();
            var choice = await promptEvent.userChoice;
            if (installStatus) {
              installStatus.textContent = choice.outcome === "accepted"
                ? "Pulso Web instalado na tela inicial!"
                : "Instalação cancelada.";
            }
            if (!deferredInstallPrompt) installButton.hidden = true;
          }
        } catch (error) {
          if (installStatus) {
            installStatus.textContent = error && error.name === "AbortError"
              ? "Instalação cancelada."
              : "Não foi possível iniciar a instalação automática.";
          }
        } finally {
          installButton.removeAttribute("aria-disabled");
        }
      });
    }
  });
})();
