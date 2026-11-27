(function () {
  window.__PULSO_ANDROID__ = true;

  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("ios-app");
    var dropStrong = document.querySelector("#soltar strong");
    if (dropStrong) dropStrong.textContent = "Escolher vídeo ou imagem";
    var dropSpan = document.querySelector("#soltar > span:nth-of-type(2)");
    if (dropSpan) dropSpan.textContent = "abre a Galeria ou Arquivos do Android";
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
      var id = "a" + (nextId++);
      pending.set(id, { resolve: resolve, reject: reject });
      try {
        window.PulsoAndroid.postMessage(JSON.stringify(Object.assign({ action: action, id: id }, payload || {})));
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  }

  window.__pulsoClosePanel = function () {
    try {
      window.PulsoAndroid.postMessage(JSON.stringify({ action: "close" }));
    } catch (e) {}
  };

  window.__pulsoOpenWhatsAppLogin = function () {
    return callNative("openWhatsAppTab", {});
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
