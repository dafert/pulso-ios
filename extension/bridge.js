"use strict";
(() => {
  // src/transport.js
  var CHANNEL = "pulso-integracao-v1";
  var PANEL_CHANNEL = "pulso-painel-v1";

  // src/brand.js
  var BRAND = Object.freeze({
    name: "Pulso",
    version: "0.9.7",
    description: "Crie figurinhas com som no seu navegador.",
    icon: "icons/pulso"
  });

  // src/panel.js
  var css = `
  :host{all:initial!important;position:fixed!important;z-index:2147483647!important;inset:auto 16px 16px auto!important;color-scheme:light dark!important}
  [hidden]{display:none!important}
  .dock{display:flex;flex-direction:column;align-items:flex-end;gap:10px;font:600 14px/1.4 system-ui,sans-serif;color:#fff}
  button{font:inherit;cursor:pointer}
  .launcher{display:flex;align-items:center;gap:7px;padding:0 13px 0 10px;height:44px;border:1px solid #fff5;
    border-radius:999px;background:#6137a4;color:#fff;box-shadow:0 5px 18px #24163562}
  .launcher:hover{background:#7247b4}
  button:focus-visible{outline:3px solid #ffad81;outline-offset:3px}
  svg{width:21px;height:21px;display:block}
  .panel{position:relative;width:min(920px,calc(100vw - 32px));height:min(880px,calc(100dvh - 86px));overflow:hidden;
    border:1px solid #9c83ba;border-radius:17px;background:#fbfaf7;box-shadow:0 14px 48px #20152c66}
  iframe{width:100%;height:100%;display:block;border:0}
  .notice{box-sizing:border-box;position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:.6rem;
    padding:1rem;text-align:center;background:#fbfaf7;color:#32243d}
  .notice button{border:0;border-radius:8px;background:#6137a4;color:#fff;padding:.5rem .7rem}
  @media(prefers-color-scheme:dark){.panel,.notice{background:#21192a;color:#f6edfa}}
  @media(max-width:560px){
    :host{inset:auto 10px 10px auto!important}
    .panel{width:calc(100vw - 20px);height:calc(100dvh - 74px)}
  }
`;
  function mountPanel() {
    const url = chrome.runtime.getURL("editor.html");
    const origin = new URL(url).origin;
    const host = document.createElement("div");
    host.id = "pulso-painel";
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
    const dock = document.createElement("div");
    dock.className = "dock";
    const panel2 = document.createElement("section");
    panel2.className = "panel";
    panel2.id = "editor";
    panel2.setAttribute("aria-label", "Editor de figurinhas " + BRAND.name);
    panel2.hidden = true;
    const notice = document.createElement("div");
    notice.className = "notice";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Tentar novamente";
    notice.append(status, retry);
    const launcher = document.createElement("button");
    launcher.className = "launcher";
    launcher.type = "button";
    launcher.setAttribute("aria-controls", panel2.id);
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Abrir " + BRAND.name);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const pulse = document.createElementNS(svg.namespaceURI, "path");
    pulse.setAttribute("d", "M3 13h4l3-6 3.5 10 2.5-5H21");
    pulse.setAttribute("fill", "none");
    pulse.setAttribute("stroke", "#ffcfb3");
    pulse.setAttribute("stroke-width", "2.2");
    pulse.setAttribute("stroke-linecap", "round");
    pulse.setAttribute("stroke-linejoin", "round");
    svg.append(pulse);
    launcher.append(svg, document.createTextNode(BRAND.name));
    dock.append(panel2, launcher);
    shadow.append(dock);
    document.body.append(host);
    let frame;
    let loaded = false;
    let timer;
    function load() {
      clearTimeout(timer);
      frame?.remove();
      loaded = false;
      notice.hidden = false;
      status.textContent = "Abrindo o editor…";
      retry.hidden = true;
      frame = document.createElement("iframe");
      frame.title = "Editor do " + BRAND.name;
      frame.allow = "autoplay 'src'";
      frame.src = url;
      panel2.replaceChildren(frame, notice);
      timer = setTimeout(() => {
        status.textContent = "O painel demorou para abrir. Tente novamente ou recarregue o WhatsApp Web.";
        retry.hidden = false;
      }, 7e3);
    }
    function visible(show, focus = true) {
      panel2.hidden = !show;
      launcher.setAttribute("aria-expanded", String(show));
      launcher.setAttribute("aria-label", (show ? "Recolher " : "Abrir ") + BRAND.name);
      if (show) {
        if (!frame) load();
        if (loaded) frame.focus();
      } else {
        if (loaded) frame.contentWindow.postMessage({ channel: PANEL_CHANNEL, what: "hidden" }, origin);
        if (focus) launcher.focus();
      }
    }
    const toggle = () => visible(panel2.hidden);
    retry.addEventListener("click", load);
    launcher.addEventListener("click", toggle);
    window.addEventListener("message", (event) => {
      if (!frame || event.source !== frame.contentWindow || event.origin !== origin || event.data?.channel !== PANEL_CHANNEL) return;
      if (event.data.what === "ready") {
        clearTimeout(timer);
        loaded = true;
        notice.hidden = true;
        if (!panel2.hidden && (document.activeElement === host || document.activeElement === document.body)) frame.focus();
      } else if (event.data.what === "close") {
        visible(false, event.data.reason !== "encaminhar");
      }
    });
    return { toggle };
  }

  // src/bridge.js
  var panel = mountPanel();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== "pulso-chrome") return false;
    if (message.what === "toggle") {
      panel.toggle();
      reply({ ok: true });
      return false;
    }
    if (!["status", "send"].includes(message.what)) return false;
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      window.removeEventListener("message", receive);
      reply({ ok: false, level: "incompativel", detail: "A integração demorou demais. Confira a conversa antes de repetir um envio.", detailCode: message.what === "send" ? "incerto" : "" });
    }, message.what === "send" ? 12e4 : 3500);
    function receive(event) {
      const data = event.data;
      if (event.source !== window || event.origin !== location.origin || data?.channel !== CHANNEL || data.direction !== "response" || data.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      const { ok, level, detail, detailCode } = data.result || {};
      reply({
        ok: ok === true,
        level: ["compativel", "parcial", "incompativel"].includes(level) ? level : void 0,
        detail: typeof detail === "string" ? detail.slice(0, 300) : "",
        detailCode: typeof detailCode === "string" ? detailCode.slice(0, 40) : ""
      });
    }
    window.addEventListener("message", receive);
    window.postMessage({ channel: CHANNEL, direction: "request", id, what: message.what, payload: message.payload }, location.origin);
    return true;
  });
})();
