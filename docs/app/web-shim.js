(function () {
  window.__PULSO_WEB__ = true;

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

  var hasOpusWebCodecs = typeof window.AudioEncoder === "function";
  window.chrome.runtime = {
    sendMessage: async function (msg) {
      if (msg && msg.what === "status") {
        return {
          level: "compativel",
          detail: hasOpusWebCodecs
            ? "Modo Navegador ativo · Processamento 100% local (WebP animado + Ogg/Opus)."
            : "Modo Navegador (Safari) · WebP animado via WASM + prévia de áudio WAV local."
        };
      }
      return {
        ok: false,
        detail: "No modo navegador, salve ou compartilhe os arquivos abaixo (o WhatsApp bloqueia envio direto por sites comuns)."
      };
    }
  };

  // Clean 16-bit PCM WAV fallback for browsers without WebCodecs AudioEncoder (e.g. Safari iOS 17/18)
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
    if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: files })) {
      return false;
    }
    await navigator.share({
      title: title || "Figurinha Pulso",
      files: files
    });
    return true;
  };

  // Progressive enhancement PWA installation (navigator.install + beforeinstallprompt fallback)
  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("web-app");

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }

    var installButton = document.getElementById("install-app");
    var installStatus = document.getElementById("install-status");
    if (!installButton) return;

    var supportsWebInstall = typeof Navigator !== "undefined" && typeof Navigator.prototype.install === "function";
    var deferredInstallPrompt;

    if (supportsWebInstall) {
      installButton.hidden = false;
    }

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (!supportsWebInstall) {
        installButton.hidden = false;
      }
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
          if (!deferredInstallPrompt) {
            installButton.hidden = true;
          }
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
  });
})();
