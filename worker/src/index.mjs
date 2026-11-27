const KEEP_ALIVE_MS = 240_000;
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const WA_MAIN_URL = "https://pulso-extrefad.pages.dev/app/wa-main.js";
let cachedWaMain = null;

async function getWaMain() {
  if (cachedWaMain) return cachedWaMain;
  const r = await fetch(WA_MAIN_URL);
  if (!r.ok) throw new Error("Falha ao carregar modulo wa-main.js");
  cachedWaMain = await r.text();
  return cachedWaMain;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === "https://pulso-extrefad.pages.dev") return true;
  try {
    const u = new URL(origin);
    if (u.protocol === "https:" && u.hostname.endsWith(".pulso-extrefad.pages.dev")) return true;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
  } catch {}
  return false;
}

function corsHeaders(origin) {
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  };
  if (origin && isAllowedOrigin(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, X-Pulso-Session";
  }
  return h;
}

function jsonResp(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

function validSid(raw) {
  const s = String(raw || "").trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(s) ? s : null;
}

function mapErr(err) {
  const msg = String((err && err.message) || err || "");
  if (/429|limit exceeded|too many|quota/i.test(msg)) {
    return {
      status: 429,
      detail:
        "Limite diario do navegador em nuvem atingido no momento. Use a Extensao Chrome (ilimitada no PC) ou o app Android/iOS.",
    };
  }
  return { status: 500, detail: "Falha ao comunicar com o WhatsApp Web: " + msg.slice(0, 180) };
}

class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data));
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message || "CDP error"));
          else p.resolve(msg.result);
        }
      } catch {}
    });
    ws.addEventListener("close", () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("CDP connection closed"));
      }
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId = undefined, timeoutMs = 25000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function listActiveSessions(env) {
  const r = await env.BROWSER.fetch("http://fake.host/v1/sessions");
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d.sessions) ? d.sessions : [];
}

async function acquireSession(env) {
  const r = await env.BROWSER.fetch("http://fake.host/v1/devtools/browser?keep_alive=" + KEEP_ALIVE_MS, { method: "POST" });
  const text = await r.text();
  if (!r.ok) throw new Error("code: " + r.status + ": " + text);
  return JSON.parse(text).sessionId;
}

async function connectSession(env, sessionId) {
  const r = await env.BROWSER.fetch("http://fake.host/v1/devtools/browser/" + encodeURIComponent(sessionId), {
    headers: { Upgrade: "websocket" },
  });
  if (!r.webSocket) throw new Error("code: " + r.status + ": " + (await r.text()));
  r.webSocket.accept();
  return new CDPClient(r.webSocket);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attachWhatsAppPage(env, reqSid, createIfMissing) {
  const active = await listActiveSessions(env);
  let sid = reqSid && active.some((s) => s.sessionId === reqSid) ? reqSid : null;
  if (!sid) {
    if (!createIfMissing) return null;
    sid = await acquireSession(env);
  }
  const cdp = await connectSession(env, sid);
  const { targetInfos } = await cdp.send("Target.getTargets");
  let pageTarget = (targetInfos || []).find((t) => t.type === "page" && t.url && t.url.startsWith("https://web.whatsapp.com"));
  if (!pageTarget) pageTarget = (targetInfos || []).find((t) => t.type === "page");
  if (!pageTarget) {
    const created = await cdp.send("Target.createTarget", { url: "about:blank" });
    pageTarget = { targetId: created.targetId, url: "about:blank" };
  }
  const { sessionId: pageSid } = await cdp.send("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });
  await cdp.send("Page.enable", {}, pageSid);
  await cdp.send("Runtime.enable", {}, pageSid);

  if (!pageTarget.url || !pageTarget.url.startsWith("https://web.whatsapp.com")) {
    await cdp.send("Network.enable", {}, pageSid);
    await cdp.send("Network.setUserAgentOverride", {
      userAgent: DESKTOP_UA,
      acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8",
      platform: "Win32",
    }, pageSid);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false }, pageSid);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "try{Object.defineProperty(navigator,'webdriver',{get:()=>false});}catch(e){}",
    }, pageSid);
    await cdp.send("Page.navigate", { url: "https://web.whatsapp.com/" }, pageSid);
  }
  return { sid, cdp, pageSid };
}

async function evalJs(cdp, pageSid, expression, timeoutMs = 20000) {
  const res = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, pageSid, timeoutMs);
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || "JS evaluation error");
  return res.result ? res.result.value : undefined;
}

async function ensureWaMain(cdp, pageSid) {
  const ready = await evalJs(cdp, pageSid, "Boolean(window.__pulsoServerBridgeReady)").catch(() => false);
  if (!ready) {
    const src = await getWaMain();
    await evalJs(cdp, pageSid, src + "\n;window.__pulsoServerBridgeReady = true; true;");
  }
}

async function waRpc(cdp, pageSid, what, payload, timeoutMs = 45000) {
  await ensureWaMain(cdp, pageSid);
  const id = crypto.randomUUID().toLowerCase();
  const expr = `new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve({ ok: false, level: "incompativel", detail: "Tempo esgotado aguardando o WhatsApp Web." });
    }, ${timeoutMs});
    function onMsg(ev) {
      const d = ev.data;
      if (!d || d.channel !== "pulso-integracao-v1" || d.direction !== "response" || d.id !== ${JSON.stringify(id)}) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      resolve(d.result);
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ channel: "pulso-integracao-v1", direction: "request", id: ${JSON.stringify(id)}, what: ${JSON.stringify(what)}, payload: ${JSON.stringify(payload ?? null)} }, location.origin);
  })`;
  return await evalJs(cdp, pageSid, expr, timeoutMs + 3000);
}

async function inspectPage(cdp, pageSid) {
  const info = await evalJs(cdp, pageSid, `(() => {
    const loggedIn = Boolean(document.querySelector("#pane-side") || document.querySelector('[data-testid="chat-list"]'));
    let pairingCode = null;
    const attrEl = document.querySelector("[data-link-code]");
    if (attrEl) {
      const raw = (attrEl.getAttribute("data-link-code") || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (raw.length === 8) pairingCode = raw.slice(0, 4) + "-" + raw.slice(4);
    }
    if (!pairingCode) {
      for (const div of document.querySelectorAll("div")) {
        const spans = Array.from(div.querySelectorAll("span"));
        if (spans.length >= 8 && spans.length <= 16) {
          const chars = spans.map((n) => (n.textContent || "").trim()).filter((t) => /^[A-Z0-9]$/.test(t));
          if (chars.length === 8) { pairingCode = chars.slice(0, 4).join("") + "-" + chars.slice(4).join(""); break; }
        }
      }
    }
    const qrEl = document.querySelector('canvas[aria-label*="QR" i], canvas[aria-label*="Scan" i], [data-ref] canvas, canvas');
    let qrRect = null;
    if (qrEl) {
      const r = qrEl.getBoundingClientRect();
      if (r.width >= 140 && r.height >= 140) qrRect = { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: r.height + 20 };
    }
    const hasPhoneInput = Boolean(document.querySelector('input[aria-label*="telefone" i], input[aria-label*="phone" i], input[type="tel"], form input[type="text"], input[value^="+"]'));
    return { loggedIn, pairingCode, qrRect, hasPhoneInput };
  })()`);

  if (info && info.loggedIn) {
    const st = await waRpc(cdp, pageSid, "status", null, 8000).catch(() => null);
    return {
      loggedIn: true,
      compatible: Boolean(st && (st.level === "compativel" || st.level === "parcial")),
      level: (st && st.level) || "incompativel",
      detail: (st && st.detail) || "WhatsApp conectado.",
      pairingCode: null,
      qrRect: null,
      state: st && st.level !== "incompativel" ? "connected" : "loading",
    };
  }
  return {
    loggedIn: false,
    compatible: false,
    level: "incompativel",
    detail: info && info.pairingCode ? "Codigo gerado. Informe no WhatsApp do celular." : info && (info.qrRect || info.hasPhoneInput) ? "Aguardando login no WhatsApp." : "Carregando WhatsApp Web...",
    pairingCode: info ? info.pairingCode : null,
    qrRect: info ? info.qrRect : null,
    state: info && info.pairingCode ? "pairing" : info && (info.qrRect || info.hasPhoneInput) ? "qr" : "loading",
  };
}

function decodeBase64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function asciiAt(b, start, len) {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[start + i]);
  return s;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin && !isAllowedOrigin(origin)) {
      return new Response(JSON.stringify({ ok: false, detail: "Origem nao autorizada." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === "/api/health" && request.method === "GET") {
      return jsonResp({ ok: true, mode: "cloudflare-browser" }, 200, origin);
    }

    let body = null;
    if (request.method === "POST") {
      try { body = await request.json(); } catch { return jsonResp({ ok: false, detail: "JSON invalido." }, 400, origin); }
    }
    const reqSid = validSid((body && body.sessionId) || url.searchParams.get("sessionId") || request.headers.get("X-Pulso-Session"));

    if (pathname === "/api/session/status" && request.method === "GET") {
      if (!reqSid) return jsonResp({ ok: true, state: "idle", loggedIn: false, compatible: false, detail: "WhatsApp desconectado." }, 200, origin);
      let conn = null;
      try {
        conn = await attachWhatsAppPage(env, reqSid, false);
        if (!conn) return jsonResp({ ok: true, state: "idle", loggedIn: false, compatible: false, detail: "WhatsApp desconectado." }, 200, origin);
        const st = await inspectPage(conn.cdp, conn.pageSid);
        return jsonResp({ ok: true, sessionId: conn.sid, ...st, qrRect: undefined }, 200, origin);
      } catch (err) {
        const m = mapErr(err);
        return jsonResp({ ok: false, detail: m.detail }, m.status, origin);
      } finally { if (conn) conn.cdp.close(); }
    }

    if (pathname === "/api/session/qr" && request.method === "POST") {
      let conn = null;
      try {
        conn = await attachWhatsAppPage(env, reqSid, true);
        for (let i = 0; i < 32; i++) {
          const st = await inspectPage(conn.cdp, conn.pageSid);
          if (st.loggedIn) return jsonResp({ ok: true, sessionId: conn.sid, ...st, qrRect: undefined }, 200, origin);
          await evalJs(conn.cdp, conn.pageSid, `(() => {
            for (const el of document.querySelectorAll('button, a, [role="button"]')) {
              const t = (el.innerText || el.textContent || "").trim();
              if (/qr\\s*code|c[oó]digo\\s*qr/i.test(t)) { el.click(); return true; }
            }
            return false;
          })()`).catch(() => {});
          if (st.qrRect) {
            const shot = await conn.cdp.send("Page.captureScreenshot", { format: "png", clip: { ...st.qrRect, scale: 1 } }, conn.pageSid);
            return jsonResp({
              ok: true,
              sessionId: conn.sid,
              state: "qr",
              loggedIn: false,
              compatible: false,
              qrDataUrl: "data:image/png;base64," + shot.data,
              detail: "Escaneie o QR Code em WhatsApp -> Dispositivos conectados.",
            }, 200, origin);
          }
          await sleep(500);
        }
        return jsonResp({ ok: false, sessionId: conn.sid, detail: "O QR Code demorou para carregar. Tente novamente." }, 504, origin);
      } catch (err) {
        const m = mapErr(err);
        return jsonResp({ ok: false, detail: m.detail }, m.status, origin);
      } finally { if (conn) conn.cdp.close(); }
    }

    if (pathname === "/api/session/pair-phone" && request.method === "POST") {
      const ddi = String((body && body.ddi) || "55").replace(/\D/g, "");
      const phone = String((body && body.phone) || "").replace(/\D/g, "");
      if (!ddi || phone.length < 8) return jsonResp({ ok: false, detail: "Digite o DDD e o numero com pelo menos 8 digitos." }, 400, origin);
      let conn = null;
      try {
        conn = await attachWhatsAppPage(env, reqSid, true);
        for (let i = 0; i < 36; i++) {
          const st = await inspectPage(conn.cdp, conn.pageSid);
          if (st.loggedIn) return jsonResp({ ok: true, sessionId: conn.sid, ...st, qrRect: undefined }, 200, origin);
          if (st.state !== "loading") break;
          await sleep(500);
        }
        const curSt = await inspectPage(conn.cdp, conn.pageSid);
        if (curSt.loggedIn) return jsonResp({ ok: true, sessionId: conn.sid, ...curSt, qrRect: undefined }, 200, origin);
        if (curSt.pairingCode) {
          await conn.cdp.send("Page.reload", {}, conn.pageSid);
          for (let i = 0; i < 28; i++) {
            const st2 = await inspectPage(conn.cdp, conn.pageSid);
            if (st2.loggedIn) return jsonResp({ ok: true, sessionId: conn.sid, ...st2, qrRect: undefined }, 200, origin);
            if (st2.state !== "loading") break;
            await sleep(500);
          }
        }
        const hasInput = await evalJs(conn.cdp, conn.pageSid, `(() => {
          const sels = ['input[aria-label*="telefone" i]', 'input[aria-label*="phone" i]', 'input[type="tel"]', 'form input[type="text"]', 'input[value^="+"]'];
          function vis(el){ if(!el) return false; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; }
          for (const s of sels) for (const el of document.querySelectorAll(s)) if (vis(el)) return true;
          for (const el of document.querySelectorAll('button, a, [role="button"], span')) {
            if (!vis(el) || (el.children && el.children.length > 2)) continue;
            const t = (el.innerText || el.textContent || "").trim();
            if (t && t.length <= 75 && /n[uú]mero de telefone|phone number|conectar com n[uú]mero|entrar com n[uú]mero|link with phone|log in with phone/i.test(t)) {
              (el.closest('button, a, [role="button"]') || el).click();
              return "clicked";
            }
          }
          return false;
        })()`);
        if (hasInput === "clicked") {
          for (let w = 0; w < 20; w++) {
            const ok = await evalJs(conn.cdp, conn.pageSid, `Boolean(document.querySelector('input[aria-label*="telefone" i], input[aria-label*="phone" i], input[type="tel"], form input[type="text"], input[value^="+"]'))`);
            if (ok) break;
            await sleep(300);
          }
        }
        const filled = await evalJs(conn.cdp, conn.pageSid, `((ddi, local) => {
          const sels = ['input[aria-label*="telefone" i]', 'input[aria-label*="phone" i]', 'input[type="tel"]', 'form input[type="text"]', 'input[value^="+"]'];
          function vis(el){ if(!el) return false; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; }
          let inp = null;
          for (const s of sels) { for (const el of document.querySelectorAll(s)) if (vis(el)) { inp = el; break; } if (inp) break; }
          if (!inp) return false;
          inp.focus();
          const cur = (inp.value || "").trim();
          const val = (cur.startsWith("+") || cur === "") ? ("+" + ddi + local) : local;
          try { inp.select(); document.execCommand("selectAll", false, null); document.execCommand("insertText", false, val); } catch(e) {}
          const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
          if (desc && desc.set) desc.set.call(inp, val); else inp.value = val;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })(${JSON.stringify(ddi)}, ${JSON.stringify(phone)})`);
        if (!filled) return jsonResp({ ok: false, sessionId: conn.sid, detail: "Campo de telefone nao encontrado. Tente via QR Code." }, 400, origin);
        await sleep(350);
        await evalJs(conn.cdp, conn.pageSid, `(() => {
          for (const b of document.querySelectorAll('button, [role="button"]')) {
            const r = b.getBoundingClientRect();
            if (!r.width || !r.height || b.disabled) continue;
            if (/^(avan[cç]ar|next|continuar|prosseguir)$/i.test((b.innerText || b.textContent || "").trim())) { b.click(); return true; }
          }
          return false;
        })()`);
        for (let c = 0; c < 34; c++) {
          const st = await inspectPage(conn.cdp, conn.pageSid);
          if (st.loggedIn) return jsonResp({ ok: true, sessionId: conn.sid, ...st, qrRect: undefined }, 200, origin);
          if (st.pairingCode) {
            return jsonResp({
              ok: true,
              sessionId: conn.sid,
              state: "pairing",
              loggedIn: false,
              compatible: false,
              code: st.pairingCode,
              pairingCode: st.pairingCode,
              detail: "Codigo gerado. No WhatsApp: Dispositivos conectados -> Conectar com numero de telefone.",
            }, 200, origin);
          }
          await sleep(500);
        }
        return jsonResp({ ok: false, sessionId: conn.sid, detail: "O WhatsApp nao retornou o codigo. Confira o numero ou tente pelo QR Code." }, 504, origin);
      } catch (err) {
        const m = mapErr(err);
        return jsonResp({ ok: false, detail: m.detail }, m.status, origin);
      } finally { if (conn) conn.cdp.close(); }
    }

    if (pathname === "/api/sticker/send" && request.method === "POST") {
      if (!reqSid) return jsonResp({ ok: false, detail: "Conecte seu WhatsApp primeiro." }, 400, origin);
      const { webpBase64, audioBase64, duration, animated, side } = body || {};
      if (!webpBase64 || typeof webpBase64 !== "string" || webpBase64.length > 3_000_000) {
        return jsonResp({ ok: false, detail: "Arquivo WebP invalido." }, 400, origin);
      }
      const webpBytes = decodeBase64(webpBase64);
      if (webpBytes.length < 12 || webpBytes.length > 2_000_000 || asciiAt(webpBytes, 0, 4) !== "RIFF" || asciiAt(webpBytes, 8, 4) !== "WEBP") {
        return jsonResp({ ok: false, detail: "Cabecalho WebP invalido." }, 400, origin);
      }
      let oggBase64 = null;
      if (audioBase64 && typeof audioBase64 === "string") {
        if (audioBase64.length > 1_500_000) return jsonResp({ ok: false, detail: "Audio excedeu 1 MB." }, 400, origin);
        const audioBytes = decodeBase64(audioBase64);
        if (audioBytes.length >= 4 && asciiAt(audioBytes, 0, 4) === "OggS") {
          oggBase64 = audioBase64;
        } else {
          return jsonResp({ ok: false, detail: "Este navegador gerou WAV em vez de Opus. No iPhone, use o app iOS (.ipa) para figurinhas com som." }, 400, origin);
        }
      }
      let conn = null;
      try {
        conn = await attachWhatsAppPage(env, reqSid, false);
        if (!conn) return jsonResp({ ok: false, detail: "Sessao expirou. Conecte seu WhatsApp novamente." }, 401, origin);
        const st = await inspectPage(conn.cdp, conn.pageSid);
        if (!st.loggedIn) return jsonResp({ ok: false, detail: "WhatsApp desconectado. Conecte acima." }, 401, origin);
        const result = await waRpc(conn.cdp, conn.pageSid, "send", {
          webp: webpBase64,
          ogg: oggBase64,
          duration: oggBase64 ? Math.max(1, Math.round(Number(duration) || 1)) : 0,
          animated: animated === true,
          side: Number.isFinite(Number(side)) ? Math.round(Number(side)) : 512,
          forward: false,
        }, 45000);
        if (!result || !result.ok) return jsonResp(result || { ok: false, detail: "O WhatsApp nao confirmou o envio." }, 400, origin);
        return jsonResp({ ok: true, detail: "Figurinha enviada para a conversa 'Voce' no WhatsApp." }, 200, origin);
      } catch (err) {
        const m = mapErr(err);
        return jsonResp({ ok: false, detail: m.detail }, m.status, origin);
      } finally { if (conn) conn.cdp.close(); }
    }

    if (pathname === "/api/session/logout" && request.method === "POST") {
      if (reqSid) {
        let cdp = null;
        try {
          const active = await listActiveSessions(env);
          if (active.some((s) => s.sessionId === reqSid)) {
            cdp = await connectSession(env, reqSid);
            await cdp.send("Browser.close").catch(() => {});
          }
        } catch {} finally { if (cdp) cdp.close(); }
      }
      return jsonResp({ ok: true, detail: "WhatsApp desconectado." }, 200, origin);
    }

    return jsonResp({ ok: false, detail: "Rota nao encontrada." }, 404, origin);
  },
};
