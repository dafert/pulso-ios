(function () {
  window.__PULSO_IOS__ = true;
  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("ios-app");
    var dropStrong = document.querySelector("#soltar strong");
    if (dropStrong) dropStrong.textContent = "Escolher vídeo ou imagem";
    var dropSpan = document.querySelector("#soltar > span:nth-of-type(2)");
    if (dropSpan) dropSpan.textContent = "abre a Galeria ou Arquivos do iPhone";
    var help = document.querySelector("#etapa-1 .help");
    if (help) help.textContent = "Até 64 MiB por arquivo (até 15 na fila).";
  });
  var pending = new Map();
  var nextId = 1;

  window.__pulsoNativeResolve = function (id, value) {
    var entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.resolve(value);
  };

  function callNative(action, payload) {
    return new Promise(function (resolve, reject) {
      var id = "r" + (nextId++);
      pending.set(id, { resolve: resolve, reject: reject });
      try {
        window.webkit.messageHandlers.pulsoEditor.postMessage(
          Object.assign({ action: action, id: id }, payload || {})
        );
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  }

  window.__pulsoClosePanel = function () {
    try {
      window.webkit.messageHandlers.pulsoEditor.postMessage({ action: "close" });
    } catch (e) {}
  };

  function u8ToB64(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 12288) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 12288));
    }
    return btoa(out);
  }

  function b64ToU8(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  window.__pulsoEncodeOpusNative = async function (monoFloat32, bitrate) {
    var bytes = new Uint8Array(monoFloat32.buffer, monoFloat32.byteOffset, monoFloat32.byteLength);
    var res = await callNative("encodeOpus", {
      pcmBase64: u8ToB64(bytes),
      bitrate: Math.round(bitrate || 32000)
    });
    if (!res || !res.ok || !res.oggBase64) {
      throw new Error((res && res.error) || "Falha no codificador Opus nativo do iOS.");
    }
    return b64ToU8(res.oggBase64);
  };

  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: async function (key) {
        var raw = await callNative("storageGet", { key: String(key) });
        var result = {};
        if (raw && typeof raw === "object") result[key] = raw;
        return result;
      },
      set: async function (obj) {
        var keys = Object.keys(obj || {});
        for (var i = 0; i < keys.length; i++) {
          await callNative("storageSet", { key: keys[i], value: JSON.stringify(obj[keys[i]]) });
        }
      }
    }
  };
  window.chrome.runtime = {
    sendMessage: function (msg) {
      return callNative("waRequest", { what: msg.what, payload: msg.payload || null });
    }
  };
})();
