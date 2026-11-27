"use strict";
(() => {
  // src/config.ts
  var LIMIT = 1e6;
  var FILE_LIMIT = 64 * 1024 * 1024;
  var QUEUE_LIMIT = 15;
  var QUEUE_BYTES = QUEUE_LIMIT * FILE_LIMIT;
  var CLIP_LIMIT = 12;
  var FRAME_BUDGET = 152 * 1024 * 1024;

  // src/transport.js
  var CHANNEL = "pulso-integracao-v1";
  function within(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new DOMException(message, "TimeoutError")), ms);
    })]).finally(() => clearTimeout(timer));
  }
  function fromBase64(value, limit = 1e6) {
    if (typeof value !== "string" || !value.length || value.length > Math.ceil(limit / 3) * 4) {
      throw new Error("Arquivo preparado fora do limite.");
    }
    const decoded = atob(value);
    if (decoded.length > limit) throw new Error("Arquivo preparado fora do limite.");
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }

  // src/mux.ts
  var utf8 = new TextEncoder();
  var text = new TextDecoder();
  async function sha256(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
    return btoa(String.fromCharCode(...new Uint8Array(digest)));
  }
  var crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    let word = value << 24;
    for (let i = 0; i < 8; i++) word = word & 2147483648 ? word << 1 ^ 79764919 : word << 1;
    return word;
  });

  // src/wa.js
  var modules = {
    chats: ["WAWebChatCollection", "WAWebCollections"],
    messages: ["WAWebMsgCollection", "WAWebCollections"],
    me: ["WAWebUserPrefsMeUser", "WAWebUserPrefsMe"],
    find: ["WAWebFindChatAction", "WAWebFindChat"],
    prep: ["WAWebMediaPrep", "WAWebMediaPreparation"],
    opaque: ["WAWebMediaOpaqueData", "WAWebOpaqueData"],
    upload: ["WAWebUploadManagerMainThread", "WAWebUploadManager"],
    metrics: ["WAWebCreateMediaUploadMetrics"],
    types: ["WAWebMmsMediaTypes", "WAWebMediaTypes"],
    origin: ["WAWebMediaGetUploadOriginForChat"],
    props: ["WAWebABProps"],
    gating: ["WAWebSoundStickerGating"],
    sound: ["WAWebSoundStickerUtils"],
    result: ["WAWebSendMsgResultAction", "WAWebSendMsgResult"],
    ack: ["WAWebAck"],
    modal: ["WAWebModalManager"],
    forward: ["WAWebForwardMessageFlowLoadable", "WAWebForwardMessageFlow"],
    state: ["WAWebStateUtils"],
    react: ["react", "React"]
  };
  function named(name, check) {
    for (const key of ["importNamespace", "require"]) {
      if (typeof window[key] !== "function") continue;
      try {
        const value = window[key](name);
        for (const candidate of [value, value?.default]) if (candidate && check(candidate)) return candidate;
      } catch {
      }
    }
    return null;
  }
  function get(group, check = () => true) {
    for (const name of modules[group]) {
      const value = named(name, check);
      if (value) return value;
    }
    return null;
  }
  var method = (object, name) => typeof object?.[name] === "function";
  var chats = () => get("chats", (value) => value.ChatCollection)?.ChatCollection;
  var opaque = () => get("opaque", (value) => method(value, "createFromData"));
  var prep = () => get("prep", (value) => typeof value === "function" || typeof value.MediaPrep === "function");
  var sender = () => get("result", (value) => value.SendMsgResult?.OK != null)?.SendMsgResult;
  var uploads = () => get("upload", (value) => method(value, "encryptAndUpload"));
  var types = () => get("types", (value) => value.MEDIA_TYPES?.AUDIO != null)?.MEDIA_TYPES;
  var sound = () => get("sound", (value) => method(value, "isCompleteStickerAudio"));
  var me = () => get("me", (value) => ["getMaybeMePnUser", "getMeUserOrThrow", "getMaybeMeLidUser"].some((key) => method(value, key)));
  var modal = () => get("modal", (value) => method(value.ModalManager, "open"));
  var react = () => get("react", (value) => method(value, "createElement"));
  var forwardCheck = (value) => !!(value.ForwardMessageFlowLoadable || value.ForwardMessageFlow || typeof value === "function");
  var soundFlags = ["sound_stickers_consumption_enabled", "sound_stickers_creation_enabled", "sound_stickers_audio_playing_enabled"];
  function compatibility() {
    if (typeof window.require !== "function" && typeof window.importNamespace !== "function") {
      return { level: "incompativel", detail: "A integração ainda está indisponível. Entre no WhatsApp Web e confira novamente." };
    }
    if (!chats() || !opaque() || !prep() || !sender() || !me()) {
      return { level: "incompativel", detail: "Faltam módulos para salvar na sua conversa. Recarregue o WhatsApp Web e confira novamente." };
    }
    const audio = !!(uploads() && types() && sound());
    const forward = !!(modal() && react() && (get("forward", forwardCheck) || typeof window.requireLazy === "function"));
    if (audio && forward) return { level: "compativel", detail: "O autoteste encontrou os módulos de envio, de áudio e de encaminhamento." };
    return { level: "parcial", detail: "Há módulos para salvar a figurinha. Áudio ou encaminhamento podem estar indisponíveis." };
  }
  function enableSound() {
    const undo = [];
    function change(owner, key, replacement) {
      if (!owner) return;
      try {
        const previous = Object.getOwnPropertyDescriptor(owner, key);
        owner[key] = replacement;
        undo.unshift(() => {
          if (owner[key] !== replacement) return;
          if (previous) Object.defineProperty(owner, key, previous);
          else delete owner[key];
        });
      } catch {
      }
    }
    const props = get("props", (value) => method(value, "getABPropConfigValue"));
    if (props) {
      const original = props.getABPropConfigValue;
      change(props, "getABPropConfigValue", function(key, ...rest) {
        return soundFlags.includes(key) ? true : original.call(this, key, ...rest);
      });
    }
    const gating = get("gating", (value) => method(value, "isSoundStickerCreationEnabled"));
    for (const key of ["isSoundStickerCreationEnabled", "isSoundStickerConsumptionEnabled", "isSoundStickerPlaybackEnabled"]) {
      if (method(gating, key)) change(gating, key, () => true);
    }
    return () => {
      for (const restore of undo) {
        try {
          restore();
        } catch {
        }
      }
      undo.length = 0;
    };
  }
  async function selfChat() {
    const preferences = me();
    const collection = chats();
    let first;
    for (const getter of ["getMaybeMePnUser", "getMeUserOrThrow", "getMaybeMeLidUser"]) {
      try {
        const id = preferences[getter]?.();
        if (!id) continue;
        first ||= id;
        const chat = collection.get(id) || collection.get(String(id._serialized || id));
        if (chat) return chat;
      } catch {
      }
    }
    const finder = get("find", (value) => method(value, "findOrCreateLatestChat"));
    if (first && finder) {
      const found = await finder.findOrCreateLatestChat(first, "forwardSelectedModals");
      return found?.chat || found;
    }
    return null;
  }
  function asBase64(value) {
    if (typeof value === "string" || value == null) return value;
    const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
    return btoa(String.fromCharCode(...bytes));
  }
  async function uploadAudio(blob, duration, chat, signal) {
    const mediaTypes = types();
    const checker = sound();
    if (!mediaTypes || !checker) throw new Error("O módulo de áudio está indisponível nesta versão do WhatsApp.");
    let uploadOrigin = 1;
    try {
      uploadOrigin = get("origin", (value) => typeof value === "function")?.(chat) ?? 1;
    } catch {
    }
    const params = {
      blob,
      type: mediaTypes.AUDIO,
      signal,
      uploadQpl: new Proxy({}, { get: () => () => void 0 }),
      uploadOrigin,
      fileOrigin: void 0,
      userUploadAttemptCount: 0,
      forwardedFromWeb: false,
      isViewOnce: false,
      isHdPhoto: false
    };
    const direct = named(modules.upload[0], (value) => method(value, "encryptAndUpload"));
    const backup = named(modules.upload[1], (value) => method(value, "encryptAndUpload"));
    const metrics = get("metrics", (value) => typeof value === "function");
    let result;
    if (direct && metrics) {
      try {
        result = await direct.encryptAndUpload(params, metrics(params));
      } catch (error) {
        if (!backup || signal.aborted) throw error;
      }
    }
    signal.throwIfAborted();
    if (!result && backup) result = await backup.encryptAndUpload(params);
    if (!result) throw new Error("O WhatsApp não retornou o áudio enviado.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const audio = {
      deprecatedMms3Url: result.url || void 0,
      directPath: result.directPath,
      mediaKey: asBase64(result.mediaKey),
      mediaKeyTimestamp: result.mediaKeyTimestamp,
      filehash: await sha256(bytes),
      encFilehash: asBase64(result.encFilehash),
      size: bytes.length,
      mimetype: "audio/ogg; codecs=opus",
      duration
    };
    if (!checker.isCompleteStickerAudio(audio)) throw new Error("O WhatsApp recusou os dados do áudio.");
    return audio;
  }
  async function sendSticker(chat, blob, animated, side, audio) {
    const prepare = prep();
    const Prep = prepare.MediaPrep || prepare;
    const mediaBlob = await opaque().createFromData(blob, "image/webp");
    const dim = side || 512;
    const data = {
      type: "sticker",
      mediaBlob,
      mimetype: "image/webp",
      size: blob.size,
      fullWidth: dim,
      fullHeight: dim,
      isAnimated: animated,
      emojis: ["🔊"]
    };
    const result = await new Prep("sticker", Promise.resolve(data)).sendToChat({ chat, options: audio ? { stickerAudio: audio } : {} });
    if (!result?.msg || result.messageSendResult !== sender()?.OK) throw new Error("O WhatsApp não confirmou que a figurinha foi salva.");
    return result.msg;
  }
  async function waitAck(message, timeoutMs = 35e3) {
    const sent = get("ack", (value) => value.ACK?.SENT != null)?.ACK.SENT ?? 1;
    const messages = get("messages", (value) => method(value.MsgCollection, "get"))?.MsgCollection;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const current = messages?.get(message.id) || message;
      const ack = current.ack ?? current.attributes?.ack;
      if (ack >= sent) return true;
      if (ack < 0) throw new Error("O WhatsApp sinalizou falha no envio. Confira a mensagem na sua conversa antes de tentar de novo.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }
  async function forwardModule() {
    const ready = get("forward", forwardCheck);
    if (ready) return ready;
    if (typeof window.requireLazy !== "function") throw new Error("Encaminhamento indisponível.");
    const loaded = await within(Promise.any(modules.forward.map((name) => new Promise((resolve, reject) => {
      window.requireLazy([name], () => {
        const value = named(name, forwardCheck);
        if (value) resolve(value);
        else reject(new Error("Módulo de encaminhamento ausente."));
      });
    }))), 4500, "O módulo de encaminhamento não respondeu.");
    return loaded;
  }
  function openForward(message, forward, restore) {
    const manager = modal();
    const record = get("messages", (value) => value.MsgCollection)?.MsgCollection?.get(message.id) || message;
    const unproxy = get("state", (value) => method(value, "unproxy"))?.unproxy;
    const close = manager.closeModalManager || (() => manager.ModalManager.close());
    const timer = setTimeout(restore, 12e4);
    const finish = () => {
      clearTimeout(timer);
      restore();
    };
    const element = react().createElement(forward.ForwardMessageFlowLoadable || forward.ForwardMessageFlow || forward, {
      msgs: [unproxy ? unproxy(record) : record],
      onClose(...args) {
        try {
          return close.apply(this, args);
        } finally {
          finish();
        }
      },
      onForward() {
        finish();
      }
    });
    try {
      manager.ModalManager.open(element, { transition: "modal-flow" });
    } catch (error) {
      finish();
      throw error;
    }
  }
  var pendingRestore;
  var restoreTimer;
  function scheduleRestore(fn, ms) {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      restoreTimer = void 0;
      fn();
    }, ms);
  }
  async function publish({ webp, ogg, duration, animated, side, forward }) {
    const status = compatibility();
    if (status.level === "incompativel") return { ...status, ok: false };
    clearTimeout(restoreTimer);
    restoreTimer = void 0;
    if (!pendingRestore && ogg) {
      const undo = enableSound();
      pendingRestore = () => {
        undo();
        pendingRestore = void 0;
      };
    }
    const restore = () => {
      clearTimeout(restoreTimer);
      restoreTimer = void 0;
      pendingRestore?.();
    };
    let modalOpen = false;
    let submitting = false;
    try {
      const chat = await within(selfChat(), 1e4, "A busca pela sua conversa demorou demais.");
      if (!chat) throw new Error("Abra sua conversa “Você” no WhatsApp Web e tente novamente.");
      const seconds = Math.max(1, Math.round(duration));
      const audio = ogg ? await within(uploadAudio(ogg, seconds, chat, new AbortController().signal), 45e3, "O envio do áudio demorou demais.") : null;
      submitting = true;
      const message = await within(
        sendSticker(chat, webp, animated, side, audio),
        45e3,
        "O envio demorou demais. Confira a conversa antes de tentar de novo."
      );
      await waitAck(message, forward ? 35e3 : 25e3);
      if (!forward) {
        if (pendingRestore) scheduleRestore(pendingRestore, 2e4);
        return { ok: true, detail: "Figurinha salva na sua conversa." };
      }
      try {
        const module = await forwardModule();
        openForward(message, module, () => {
          if (pendingRestore) scheduleRestore(pendingRestore, 4e3);
        });
        modalOpen = true;
        return { ok: true, detail: "Figurinha salva. Escolha os destinatários na janela Encaminhar do WhatsApp.", detailCode: "encaminhar" };
      } catch {
        if (pendingRestore) scheduleRestore(pendingRestore, 15e3);
        return { ok: true, detail: "Figurinha salva na sua conversa. Use o menu da mensagem para encaminhar.", detailCode: "salva" };
      }
    } catch (error) {
      if (pendingRestore) scheduleRestore(pendingRestore, 5e3);
      return {
        ok: false,
        detail: error.message || "A integração falhou. Confira sua conversa antes de tentar novamente.",
        detailCode: submitting && error.name === "TimeoutError" ? "incerto" : void 0
      };
    } finally {
      if (!modalOpen && !pendingRestore) restore();
    }
  }

  // src/main.js
  var busy = false;
  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.channel !== CHANNEL || data.direction !== "request" || typeof data.id !== "string" || data.id.length !== 36) return;
    const reply = (result) => window.postMessage({ channel: CHANNEL, direction: "response", id: data.id, result }, location.origin);
    if (data.what === "status") {
      reply(compatibility());
      return;
    }
    if (data.what !== "send") return;
    if (busy) {
      reply({ ok: false, detail: "Aguarde o término do envio em andamento." });
      return;
    }
    busy = true;
    try {
      const payload = data.payload;
      const image = fromBase64(payload.webp, LIMIT);
      const audio = payload.ogg ? fromBase64(payload.ogg, LIMIT) : null;
      const duration = payload.duration;
      const decoder = new TextDecoder();
      if (decoder.decode(image.subarray(0, 4)) !== "RIFF" || decoder.decode(image.subarray(8, 12)) !== "WEBP" || audio && (decoder.decode(audio.subarray(0, 4)) !== "OggS" || !(duration > 0 && duration <= CLIP_LIMIT))) {
        throw new Error("O arquivo preparado é inválido.");
      }
      reply(await publish({
        webp: new Blob([image], { type: "image/webp" }),
        ogg: audio ? new Blob([audio], { type: "audio/ogg; codecs=opus" }) : null,
        duration,
        animated: payload.animated === true,
        side: Number.isFinite(payload.side) && payload.side >= 64 && payload.side <= 512 ? Math.round(payload.side) : 512,
        forward: payload.forward !== false
      }));
    } catch (error) {
      reply({ ok: false, detail: error.message || "Falha ao preparar o envio." });
    } finally {
      busy = false;
    }
  });
})();
