"use strict";
(() => {
  const CHANNEL = "pulso-ext-bridge-v1";
  const ALLOWED = new Set(["status", "send", "openWa"]);

  function announce() {
    window.postMessage({ channel: CHANNEL, direction: "event", type: "ready" }, location.origin);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || msg.direction !== "request") return;
    if (msg.what === "ping") {
      announce();
      return;
    }
    if (!ALLOWED.has(msg.what) || typeof msg.id !== "string" || !msg.id) return;

    chrome.runtime.sendMessage(
      { channel: "pulso-site-bridge", what: msg.what, payload: msg.payload },
      (result) => {
        const err = chrome.runtime.lastError;
        const out = err
          ? { ok: false, level: "incompativel", detail: "Extensão recarregada. Atualize a página." }
          : (result || { ok: false, level: "incompativel", detail: "Sem resposta da extensão." });
        window.postMessage(
          { channel: CHANNEL, direction: "response", id: msg.id, result: out },
          location.origin
        );
      }
    );
  });

  announce();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") announce();
  });
})();
