(function () {
  window.__PULSO_WEB__ = true;

  var DEFAULT_CLOUD_API = "https://pulso-api.daviddaguerdegodoy.workers.dev";
  var EXT_CHANNEL = "pulso-ext-bridge-v1";

  function normalizeServerUrl(raw) {
    var s = String(raw || "").trim().replace(/\/+$/, "");
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    return s;
  }

  function detectApiUrl() {
    try {
      var params = new URLSearchParams(location.search);
      var fromQuery = normalizeServerUrl(params.get("server") || "");
      if (fromQuery) return fromQuery;
    } catch (e) {}
    if ((location.hostname === "localhost" || location.hostname === "127.0.0.1") && location.port) {
      return location.origin;
    }
    return DEFAULT_CLOUD_API;
  }

  function loadSessionId() {
    try { return localStorage.getItem("pulso_cf_session_id") || ""; } catch (e) { return ""; }
  }
  function saveSessionId(id) {
    sessionId = String(id || "").trim();
    try {
      if (sessionId) localStorage.setItem("pulso_cf_session_id", sessionId);
      else localStorage.removeItem("pulso_cf_session_id");
    } catch (e) {}
  }

  var apiUrl = detectApiUrl();
  var sessionId = loadSessionId();
  var waConnected = false;
  var pollTimer = null;

  // --- Ponte com a Extensão Pulso (conecta direto na aba aberta do WhatsApp Web) ---
  var extAvailable = false;
  var extConnected = false;
  var extPending = new Map();

  function extRequest(what, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = "ext-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
      var timer = setTimeout(function () {
        extPending.delete(id);
        reject(new Error("Tempo esgotado na comunicação com a aba do WhatsApp Web."));
      }, timeoutMs || 8000);
      extPending.set(id, { resolve: resolve, reject: reject, timer: timer });
      window.postMessage({ channel: EXT_CHANNEL, direction: "request", id: id, what: what, payload: payload }, location.origin);
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var d = event.data;
    if (!d || d.channel !== EXT_CHANNEL) return;
    if (d.direction === "event" && d.type === "ready") {
      extAvailable = true;
      checkExtStatus();
      return;
    }
    if (d.direction === "response" && extPending.has(d.id)) {
      var p = extPending.get(d.id);
      extPending.delete(d.id);
      clearTimeout(p.timer);
      p.resolve(d.result);
    }
  });

  async function checkExtStatus() {
    if (!extAvailable) return false;
    try {
      var st = await extRequest("status", null, 4500);
      extConnected = Boolean(st && (st.level === "compativel" || st.level === "parcial"));
      updateConnectCard({
        viaExtension: true,
        loggedIn: extConnected,
        compatible: extConnected,
        noTab: Boolean(st && st.noTab),
        detail: (st && st.detail) || (extConnected ? "Conectado à sua aba aberta do WhatsApp Web." : "Abra o WhatsApp Web em uma aba para enviar direto.")
      });
      return extConnected;
    } catch (e) {
      extConnected = false;
      return false;
    }
  }

  async function apiCall(path, method, body) {
    var headers = { "Content-Type": "application/json" };
    if (sessionId) headers["X-Pulso-Session"] = sessionId;
    var opts = { method: method || "GET", headers: headers };
    if (body !== undefined) {
      opts.body = JSON.stringify(Object.assign(sessionId ? { sessionId: sessionId } : {}, body));
    }
    var url = apiUrl + path;
    if ((method || "GET") === "GET" && sessionId) {
      url += (path.indexOf("?") >= 0 ? "&" : "?") + "sessionId=" + encodeURIComponent(sessionId);
    }
    var resp = await fetch(url, opts);
    var data = await resp.json().catch(function () { return { ok: false, detail: "Resposta inválida do servidor." }; });
    if (data && data.sessionId) saveSessionId(data.sessionId);
    if (!resp.ok && data.ok !== false) data.ok = false;
    return data;
  }

  window.__pulsoServerState = function () {
    return {
      serverUrl: apiUrl,
      connected: extConnected || waConnected,
      viaExtension: extConnected,
      sessionId: sessionId
    };
  };

  window.__pulsoSendViaServer = async function (payload) {
    if (extAvailable) {
      var extOk = await checkExtStatus();
      if (extOk) {
        var extRes = await extRequest("send", {
          webp: payload.webpBase64,
          ogg: payload.audioBase64 || null,
          duration: payload.duration || 0,
          animated: Boolean(payload.animated),
          side: payload.side || 512,
          forward: Boolean(payload.forward)
        }, 125000);
        if (!extRes || !extRes.ok) {
          throw new Error((extRes && extRes.detail) || "Não foi possível enviar para a aba do WhatsApp Web.");
        }
        return extRes;
      }
    }
    var data = await apiCall("/api/sticker/send", "POST", payload);
    if (!data || !data.ok) {
      throw new Error((data && data.detail) || "Não foi possível enviar a figurinha.");
    }
    return data;
  };

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
        if (extAvailable) {
          var ok = await checkExtStatus();
          if (ok) {
            return { level: "compativel", detail: "WhatsApp Web conectado pela aba aberta." };
          }
        }
        if (sessionId) {
          try {
            var st = await apiCall("/api/session/status", "GET");
            waConnected = Boolean(st && st.loggedIn && st.compatible);
            updateConnectCard(st);
            if (waConnected) {
              return { level: "compativel", detail: "WhatsApp Web conectado. Pronto para enviar com som." };
            }
          } catch (e) {}
        }
        return {
          level: "parcial",
          detail: "Editor pronto. Conecte seu WhatsApp Web abaixo para enviar direto ou baixe a figurinha."
        };
      }
      return { ok: false, detail: "Ação não suportada." };
    }
  };

  // Fallback PCM 16-bit WAV para navegadores sem AudioEncoder Opus
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

  function syncSendButtons() {
    var sendBtn = document.getElementById("enviar");
    var quickSend = document.getElementById("enviar-rapido");
    var hint = document.getElementById("web-export-hint");
    var connected = extConnected || waConnected;
    if (sendBtn) {
      sendBtn.textContent = connected ? "Enviar para o WhatsApp Web" : "Baixar figurinha e áudio";
    }
    if (quickSend) quickSend.hidden = !connected;
    if (hint) hint.hidden = connected;
  }

  function updateConnectCard(st) {
    var badge = document.getElementById("wa-badge");
    var msg = document.getElementById("wa-connect-msg");
    var formsArea = document.getElementById("wa-login-forms");
    var logoutBtn = document.getElementById("wa-logout-btn");
    var openTabBtn = document.getElementById("wa-open-tab-btn");
    var extTip = document.getElementById("wa-ext-tip");
    var codeBox = document.getElementById("wa-code-box");
    var codeVal = document.getElementById("wa-code-value");
    var qrBox = document.getElementById("wa-qr-box");
    if (!badge) return;

    if (extAvailable && extTip) extTip.hidden = true;
    if (openTabBtn) openTabBtn.hidden = !extAvailable;

    if (st && st.viaExtension && st.loggedIn) {
      extConnected = true;
      badge.textContent = "WhatsApp Web conectado (aba aberta)";
      badge.dataset.state = "connected";
      if (msg) msg.textContent = "Aba do WhatsApp Web detectada. Escolha um vídeo abaixo e clique em Enviar para o WhatsApp Web.";
      if (formsArea) formsArea.hidden = true;
      if (codeBox) codeBox.hidden = true;
      if (qrBox) qrBox.hidden = true;
      if (logoutBtn) logoutBtn.hidden = true;
      stopPolling();
      syncSendButtons();
      return;
    }

    if (st && !st.viaExtension && st.loggedIn) {
      waConnected = true;
      badge.textContent = st.compatible ? "WhatsApp Web conectado" : "Carregando conversas…";
      badge.dataset.state = st.compatible ? "connected" : "pending";
      if (msg) msg.textContent = st.compatible
        ? "Conectado. Escolha um vídeo abaixo e clique em Enviar para o WhatsApp Web."
        : "Finalizando carregamento das conversas…";
      if (formsArea) formsArea.hidden = true;
      if (codeBox) codeBox.hidden = true;
      if (qrBox) qrBox.hidden = true;
      if (logoutBtn) logoutBtn.hidden = false;
      if (st.compatible) stopPolling();
      syncSendButtons();
      if (typeof window.__pulsoRefreshStatus === "function") window.__pulsoRefreshStatus();
      return;
    }

    if (!st || !st.viaExtension) waConnected = false;
    if (formsArea) formsArea.hidden = false;
    if (logoutBtn) logoutBtn.hidden = !sessionId;

    if (st && st.pairingCode) {
      badge.textContent = "Aguardando código no celular";
      badge.dataset.state = "pending";
      if (codeBox) codeBox.hidden = false;
      if (codeVal) codeVal.textContent = st.pairingCode;
      if (qrBox) qrBox.hidden = true;
      if (msg) msg.textContent = st.detail || "Informe o código no WhatsApp do seu celular.";
    } else {
      badge.textContent = extAvailable ? "Abra o WhatsApp Web ou conecte abaixo" : "Desconectado";
      badge.dataset.state = "idle";
      if (st && st.detail && msg) msg.textContent = st.detail;
    }
    syncSendButtons();
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async function () {
      if (!sessionId) { stopPolling(); return; }
      try {
        var st = await apiCall("/api/session/status", "GET");
        if (st && st.state === "idle") {
          saveSessionId("");
          stopPolling();
        }
        updateConnectCard(st);
      } catch (e) {}
    }, 3500);
  }

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

    var phoneForm = document.getElementById("wa-phone-form");
    var ddiInput = document.getElementById("wa-ddi");
    var phoneInput = document.getElementById("wa-phone");
    var pairBtn = document.getElementById("wa-pair-btn");
    var qrBtn = document.getElementById("wa-qr-btn");
    var copyCodeBtn = document.getElementById("wa-copy-code");
    var logoutBtn = document.getElementById("wa-logout-btn");
    var openTabBtn = document.getElementById("wa-open-tab-btn");
    var quickSendBtn = document.getElementById("enviar-rapido");
    var msg = document.getElementById("wa-connect-msg");
    var qrBox = document.getElementById("wa-qr-box");
    var qrImg = document.getElementById("wa-qr-img");
    var codeBox = document.getElementById("wa-code-box");
    var codeVal = document.getElementById("wa-code-value");

    initAccessibleValidation(phoneForm);
    syncSendButtons();

    // Ping na extensão Pulso caso esteja instalada no navegador
    window.postMessage({ channel: EXT_CHANNEL, direction: "request", what: "ping" }, location.origin);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && extAvailable) checkExtStatus();
    });

    try {
      var savedPhone = localStorage.getItem("pulso_web_last_phone");
      if (savedPhone && phoneInput) phoneInput.value = savedPhone;
    } catch (e) {}

    if (quickSendBtn) {
      quickSendBtn.addEventListener("click", function () {
        var sendBtn = document.getElementById("enviar");
        if (sendBtn && !sendBtn.disabled) sendBtn.click();
        else {
          var statusEl = document.getElementById("status");
          if (statusEl) statusEl.textContent = "Escolha um vídeo primeiro para enviar.";
        }
      });
    }

    if (openTabBtn) {
      openTabBtn.addEventListener("click", function () {
        if (extAvailable) extRequest("openWa", null, 4000).catch(function () {});
        else window.open("https://web.whatsapp.com/", "_blank", "noopener");
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
        if (msg) msg.textContent = "Conectando ao WhatsApp Web e gerando código de 8 dígitos…";
        try {
          var res = await apiCall("/api/session/pair-phone", "POST", { ddi: ddi, phone: phone });
          if (res.ok && res.loggedIn) {
            updateConnectCard(res);
          } else if (res.ok && res.code) {
            updateConnectCard({ loggedIn: false, pairingCode: res.code, detail: res.detail });
            startPolling();
          } else {
            if (msg) msg.textContent = res.detail || "Não foi possível gerar o código.";
          }
        } catch (err) {
          if (msg) msg.textContent = err.message || "Erro ao comunicar com o WhatsApp Web.";
        } finally {
          pairBtn.removeAttribute("aria-disabled");
        }
      });
    }

    if (qrBtn) {
      qrBtn.addEventListener("click", async function () {
        qrBtn.setAttribute("aria-disabled", "true");
        if (codeBox) codeBox.hidden = true;
        if (msg) msg.textContent = "Carregando QR Code do WhatsApp Web…";
        try {
          var res = await apiCall("/api/session/qr", "POST", {});
          if (res.ok && res.loggedIn) {
            updateConnectCard(res);
          } else if (res.ok && res.qrDataUrl) {
            if (qrImg) qrImg.src = res.qrDataUrl;
            if (qrBox) qrBox.hidden = false;
            if (msg) msg.textContent = "Escaneie o QR Code em WhatsApp → Dispositivos conectados.";
            startPolling();
          } else {
            if (msg) msg.textContent = res.detail || "Não foi possível carregar o QR Code.";
          }
        } catch (err) {
          if (msg) msg.textContent = err.message || "Erro ao comunicar com o WhatsApp Web.";
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
          if (msg) msg.textContent = "Código " + raw + " copiado.";
        } catch (e) {
          prompt("Copie o código:", raw);
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async function () {
        stopPolling();
        try { await apiCall("/api/session/logout", "POST", {}); } catch (e) {}
        saveSessionId("");
        waConnected = false;
        updateConnectCard({ loggedIn: false, detail: "WhatsApp desconectado." });
        if (typeof window.__pulsoRefreshStatus === "function") window.__pulsoRefreshStatus();
      });
    }

    // Reaproveita sessão já ativa sem gastar cota na abertura da página
    if (sessionId) {
      apiCall("/api/session/status", "GET")
        .then(function (st) {
          if (st && st.state === "idle") saveSessionId("");
          updateConnectCard(st);
        })
        .catch(function () {});
    }

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
            if (installStatus) installStatus.textContent = "Pulso instalado.";
            installButton.hidden = true;
          } else if (deferredInstallPrompt) {
            var promptEvent = deferredInstallPrompt;
            deferredInstallPrompt = undefined;
            await promptEvent.prompt();
            var choice = await promptEvent.userChoice;
            if (installStatus) {
              installStatus.textContent = choice.outcome === "accepted"
                ? "Pulso instalado na tela inicial."
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
