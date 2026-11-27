"use strict";
(() => {
  var WA_ORIGIN = "https://web.whatsapp.com";
  var SITE_ORIGINS = ["https://pulso-extrefad.pages.dev", "http://localhost", "http://127.0.0.1"];

  function within(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new DOMException(message, "TimeoutError")), ms);
    })]).finally(() => clearTimeout(timer));
  }

  var onWhatsApp = (url) => typeof url === "string" && url.startsWith(WA_ORIGIN + "/");
  var onAllowedSite = (url) => {
    if (typeof url !== "string") return false;
    try {
      const u = new URL(url);
      if (u.origin === "https://pulso-extrefad.pages.dev") return true;
      if (u.protocol === "https:" && u.hostname.endsWith(".pulso-extrefad.pages.dev")) return true;
      if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    } catch {}
    return false;
  };

  chrome.action.onClicked.addListener(async (tab) => {
    let target = tab;
    try {
      if (!onWhatsApp(tab.url)) {
        const existing = await chrome.tabs.query({ url: WA_ORIGIN + "/*" });
        target = existing.find((item) => item.windowId === tab.windowId) || existing[0];
        if (!target) {
          await chrome.tabs.create({ url: WA_ORIGIN + "/" });
          return;
        }
        await chrome.tabs.update(target.id, { active: true });
        if (target.windowId !== tab.windowId) await chrome.windows.update(target.windowId, { focused: true });
      }
      await chrome.tabs.sendMessage(target.id, { channel: "pulso-chrome", what: "toggle" }, { frameId: 0 });
      await chrome.action.setBadgeText({ tabId: target.id, text: "" });
      await chrome.action.setTitle({ tabId: target.id, title: "Pulso · Abrir ou recolher no WhatsApp Web" });
    } catch {
      if (target?.id == null) return;
      await chrome.action.setBadgeText({ tabId: target.id, text: "↻" }).catch(() => {});
      await chrome.action.setTitle({ tabId: target.id, title: "Recarregue o WhatsApp Web para ativar o Pulso" }).catch(() => {});
    }
  });

  var sending = new Set();
  async function dispatch(message, tabId) {
    const publish = message.what === "send";
    if (publish && sending.has(tabId)) throw new Error("Já existe um envio em andamento nesta aba.");
    if (publish) sending.add(tabId);
    try {
      return await within(
        chrome.tabs.sendMessage(tabId, {
          channel: "pulso-chrome",
          what: message.what,
          payload: publish ? message.payload : void 0
        }, { frameId: 0 }),
        publish ? 126e3 : 4e3,
        publish ? "O envio demorou demais. Confira a conversa antes de tentar de novo." : "O WhatsApp não respondeu ao autoteste."
      );
    } catch (error) {
      if (error.message?.includes("Receiving end")) throw new Error("Recarregue a aba do WhatsApp Web e tente novamente.");
      throw error;
    } finally {
      if (publish) sending.delete(tabId);
    }
  }

  async function handleSiteBridge(message, senderTab) {
    const existing = await chrome.tabs.query({ url: WA_ORIGIN + "/*" });
    const target = existing.find((item) => item.windowId === senderTab?.windowId) || existing[0];

    if (message.what === "openWa") {
      if (target) {
        await chrome.tabs.update(target.id, { active: true });
        if (senderTab && target.windowId !== senderTab.windowId) {
          await chrome.windows.update(target.windowId, { focused: true });
        }
        return { ok: true, opened: false };
      }
      await chrome.tabs.create({ url: WA_ORIGIN + "/" });
      return { ok: true, opened: true };
    }

    if (!target) {
      return {
        ok: false,
        level: "incompativel",
        noTab: true,
        detail: "Nenhuma aba do WhatsApp Web aberta. Clique em Abrir WhatsApp Web."
      };
    }

    const res = await dispatch(message, target.id);
    if (message.what === "send" && res?.ok && message.payload?.forward) {
      await chrome.tabs.update(target.id, { active: true }).catch(() => {});
    }
    return res;
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;

    // 1. Painel embutido dentro do próprio WhatsApp Web
    if (
      sender.url === chrome.runtime.getURL("editor.html") &&
      sender.frameId > 0 &&
      sender.tab?.id != null &&
      onWhatsApp(sender.tab.url) &&
      message?.channel === "pulso-editor" &&
      ["status", "send"].includes(message.what)
    ) {
      dispatch(message, sender.tab.id).then(reply, (error) => reply({
        ok: false,
        level: "incompativel",
        detail: error.message,
        detailCode: message.what === "send" && error.name === "TimeoutError" ? "incerto" : void 0
      }));
      return true;
    }

    // 2. Ponte do site Pulso Web (pulso-extrefad.pages.dev) -> aba aberta do WhatsApp Web
    if (
      message?.channel === "pulso-site-bridge" &&
      ["status", "send", "openWa"].includes(message.what) &&
      onAllowedSite(sender.tab?.url)
    ) {
      handleSiteBridge(message, sender.tab).then(reply, (error) => reply({
        ok: false,
        level: "incompativel",
        detail: error.message,
        detailCode: message.what === "send" && error.name === "TimeoutError" ? "incerto" : void 0
      }));
      return true;
    }

    return false;
  });
})();
