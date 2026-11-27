import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright-core";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const MAX_SESSIONS = Math.max(1, Number(process.env.MAX_SESSIONS || 5));
const SESSION_IDLE_MS = 1000 * 60 * 30; // 30 minutes
const SESSIONS_ROOT = path.join(__dirname, ".sessions");
fs.mkdirSync(SESSIONS_ROOT, { recursive: true });

const waMainCandidates = [
  path.join(__dirname, "wa-main.js"),
  path.resolve(__dirname, "..", "Pulso", "Web", "wa-main.js"),
];
const waMainPath = waMainCandidates.find((p) => fs.existsSync(p));
if (!waMainPath) {
  throw new Error("wa-main.js nao encontrado. Copie Pulso/Web/wa-main.js para server/wa-main.js");
}
const WA_MAIN_SOURCE = fs.readFileSync(waMainPath, "utf8");

const STATIC_APP_DIR = path.resolve(__dirname, "..", "docs", "app");

function findBrowserExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined; // Uses Playwright's bundled Chromium (Docker / Linux)
}

function validSessionId(raw) {
  const s = String(raw || "").trim();
  return /^[a-zA-Z0-9_-]{12,64}$/.test(s) ? s : null;
}

// --- WebP EXIF sound-sha256 updater (for server-converted Ogg/Opus from Safari WAV) ---
function webpChunks(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("WebP invalido.");
  }
  const chunks = [];
  let off = 12;
  while (off + 8 <= buf.length) {
    const name = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const next = off + 8 + size + (size & 1);
    if (next > buf.length) break;
    chunks.push({ name, data: buf.subarray(off + 8, off + 8 + size) });
    off = next;
  }
  return chunks;
}

function buildChunk(name, data) {
  const pad = data.length & 1;
  const out = Buffer.alloc(8 + data.length + pad);
  out.write(name, 0, 4, "ascii");
  out.writeUInt32LE(data.length, 4);
  data.copy(out, 8);
  return out;
}

function buildExif(pack, author, oggBuffer) {
  const name = String(pack || "").trim().slice(0, 128);
  const publisher = String(author || "").trim().slice(0, 128);
  let id = crypto.randomUUID();
  if (name || publisher) {
    const hex = crypto.createHash("sha256").update(`stickers-con-sonido|${name}|${publisher}`).digest("hex").slice(0, 32);
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const payload = {
    "sticker-pack-id": id,
    "sticker-pack-name": name || undefined,
    "sticker-pack-publisher": publisher || undefined,
    emojis: ["🔊"],
    "sound-sha256": oggBuffer ? crypto.createHash("sha256").update(oggBuffer).digest("base64") : undefined,
  };
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const head = Buffer.alloc(26);
  head.set([77, 77, 0, 42], 0);
  head.writeUInt32BE(8, 4);
  head.writeUInt16BE(1, 8);
  head.writeUInt16BE(22337, 10);
  head.writeUInt16BE(7, 12);
  head.writeUInt32BE(json.length, 14);
  head.writeUInt32BE(26, 18);
  return Buffer.concat([head, json]);
}

function patchWebpWithOggHash(webpBuffer, oggBuffer, pack, author, side = 512) {
  const parts = webpChunks(webpBuffer);
  const existingVp8x = parts.find((p) => p.name === "VP8X");
  let vp8xData;
  if (existingVp8x) {
    vp8xData = Buffer.from(existingVp8x.data);
  } else {
    vp8xData = Buffer.alloc(10);
    const hasAlpha = parts.some((p) => p.name === "ALPH" || (p.name === "VP8L" && (p.data[4] & 16) !== 0));
    vp8xData[0] = hasAlpha ? 16 : 0;
    const dim = Math.max(1, Math.min(512, side)) - 1;
    vp8xData[4] = dim & 255;
    vp8xData[5] = (dim >>> 8) & 255;
    vp8xData[6] = (dim >>> 16) & 255;
    vp8xData[7] = dim & 255;
    vp8xData[8] = (dim >>> 8) & 255;
    vp8xData[9] = (dim >>> 16) & 255;
  }
  vp8xData[0] |= 8; // EXIF flag
  const exif = buildExif(pack, author, oggBuffer);
  const body = [
    buildChunk("VP8X", vp8xData),
    ...parts.filter((p) => p.name !== "VP8X" && p.name !== "EXIF").map((p) => buildChunk(p.name, p.data)),
    buildChunk("EXIF", exif),
  ];
  const bodyLen = body.reduce((s, b) => s + b.length, 0);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(4 + bodyLen, 4);
  header.write("WEBP", 8, 4, "ascii");
  return Buffer.concat([header, ...body]);
}

const FFMPEG_BIN = (ffmpegPath && fs.existsSync(ffmpegPath)) ? ffmpegPath : "ffmpeg";

async function convertAudioToOggOpus(inputBuffer, ext = "wav") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-opus-"));
  const safeExt = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : "wav";
  const inFile = path.join(tmpDir, `in.${safeExt}`);
  const outFile = path.join(tmpDir, "out.ogg");
  try {
    fs.writeFileSync(inFile, inputBuffer);
    await execFileAsync(FFMPEG_BIN, [
      "-y",
      "-i", inFile,
      "-vn",
      "-c:a", "libopus",
      "-b:a", "48k",
      "-vbr", "on",
      "-compression_level", "10",
      "-ar", "48000",
      "-ac", "1",
      "-f", "ogg",
      outFile,
    ], { timeout: 25_000 });
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- Session Pool ---
const sessions = new Map();

async function closeSession(sessionId, wipeDisk = false) {
  const s = sessions.get(sessionId);
  if (s) {
    sessions.delete(sessionId);
    try { await s.context.close(); } catch {}
  }
  if (wipeDisk) {
    const dir = path.join(SESSIONS_ROOT, sessionId);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function evictIfNeeded(keepId) {
  if (sessions.size < MAX_SESSIONS) return;
  let oldest = null;
  for (const [id, s] of sessions.entries()) {
    if (id === keepId || s.busy) continue;
    if (!oldest || s.lastActive < oldest.lastActive) oldest = { id, lastActive: s.lastActive };
  }
  if (oldest) await closeSession(oldest.id, false);
}

async function getOrCreateSession(sessionId) {
  let s = sessions.get(sessionId);
  if (s && s.page && !s.page.isClosed()) {
    s.lastActive = Date.now();
    return s;
  }
  await evictIfNeeded(sessionId);
  const profileDir = path.join(SESSIONS_ROOT, sessionId);
  fs.mkdirSync(profileDir, { recursive: true });

  const executablePath = findBrowserExecutable();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    executablePath,
    viewport: { width: 1280, height: 860 },
    locale: "pt-BR",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await context.addInitScript(WA_MAIN_SOURCE);

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(25_000);

  s = {
    id: sessionId,
    context,
    page,
    lastActive: Date.now(),
    busy: false,
    queue: Promise.resolve(),
  };
  sessions.set(sessionId, s);

  await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  return s;
}

function runSerialized(session, fn) {
  const next = session.queue.then(async () => {
    session.busy = true;
    session.lastActive = Date.now();
    try {
      return await fn();
    } finally {
      session.busy = false;
      session.lastActive = Date.now();
    }
  });
  session.queue = next.catch(() => {});
  return next;
}

async function ensureWaMainInjected(page) {
  const already = await page.evaluate(() => Boolean(window.__pulsoServerBridgeReady)).catch(() => false);
  if (!already) {
    await page.addScriptTag({ content: WA_MAIN_SOURCE }).catch(() => {});
    await page.evaluate(() => { window.__pulsoServerBridgeReady = true; }).catch(() => {});
  }
}

async function waRpc(page, what, payload = null, timeoutMs = 150_000) {
  await ensureWaMainInjected(page);
  const id = crypto.randomUUID().toLowerCase();
  return await page.evaluate(
    ({ id, what, payload, timeoutMs }) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          window.removeEventListener("message", onMsg);
          resolve({ ok: false, level: "incompativel", detail: "Tempo esgotado aguardando o WhatsApp Web." });
        }, timeoutMs);
        function onMsg(event) {
          const d = event.data;
          if (!d || d.channel !== "pulso-integracao-v1" || d.direction !== "response" || d.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener("message", onMsg);
          resolve(d.result);
        }
        window.addEventListener("message", onMsg);
        window.postMessage({ channel: "pulso-integracao-v1", direction: "request", id, what, payload }, location.origin);
      });
    },
    { id, what, payload, timeoutMs }
  );
}

async function inspectPage(page) {
  const info = await page.evaluate(() => {
    const loggedIn = Boolean(document.querySelector("#pane-side") || document.querySelector('[data-testid="chat-list"]'));
    let pairingCode = null;
    const attrEl = document.querySelector("[data-link-code]");
    if (attrEl) {
      const raw = (attrEl.getAttribute("data-link-code") || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (raw.length === 8) pairingCode = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    }
    if (!pairingCode) {
      for (const div of document.querySelectorAll("div")) {
        const spans = Array.from(div.querySelectorAll("span"));
        if (spans.length >= 8 && spans.length <= 16) {
          const chars = spans.map((n) => (n.textContent || "").trim()).filter((t) => /^[A-Z0-9]$/.test(t));
          if (chars.length === 8) {
            pairingCode = `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
            break;
          }
        }
      }
    }
    const hasQr = Boolean(document.querySelector('canvas[aria-label*="QR" i], canvas[aria-label*="Scan" i], [data-ref] canvas, canvas'));
    const hasPhoneInput = Boolean(document.querySelector('input[aria-label*="telefone" i], input[aria-label*="phone" i], input[type="tel"], form input[type="text"], input[value^="+"]'));
    return { loggedIn, pairingCode, hasQr, hasPhoneInput };
  });

  if (info.loggedIn) {
    const status = await waRpc(page, "status", null, 8_000);
    return {
      loggedIn: true,
      compatible: status?.level === "compativel" || status?.level === "parcial",
      level: status?.level || "incompativel",
      detail: status?.detail || "WhatsApp conectado.",
      pairingCode: null,
      state: status?.level === "incompativel" ? "loading" : "connected",
    };
  }
  return {
    loggedIn: false,
    compatible: false,
    level: "incompativel",
    detail: info.pairingCode
      ? "Código gerado! Cole no WhatsApp do seu celular."
      : info.hasQr || info.hasPhoneInput
        ? "Aguardando login no WhatsApp."
        : "Carregando WhatsApp Web no servidor…",
    pairingCode: info.pairingCode,
    state: info.pairingCode ? "pairing" : (info.hasQr || info.hasPhoneInput) ? "qr" : "loading",
  };
}

// Cleanup idle sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (!s.busy && now - s.lastActive > SESSION_IDLE_MS) {
      closeSession(id, false).catch(() => {});
    }
  }
}, 5 * 60_000).unref();

// --- Express HTTP App ---
const app = express();
app.use(express.json({ limit: "25mb" }));

// CORS for GitHub Pages (https://dafert.github.io) and local testing
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Pulso-Session");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    version: "0.9.9",
    ffmpeg: Boolean(ffmpegPath),
    browser: findBrowserExecutable() || "playwright-chromium",
    activeSessions: sessions.size,
  });
});

app.get("/api/session/status", async (req, res) => {
  const sessionId = validSessionId(req.query.sessionId || req.headers["x-pulso-session"]);
  if (!sessionId) return res.status(400).json({ ok: false, detail: "sessionId inválido." });
  const existing = sessions.get(sessionId);
  if (!existing) {
    // Check if there is a persisted profile on disk from a previous run
    const profileDir = path.join(SESSIONS_ROOT, sessionId);
    if (!fs.existsSync(profileDir)) {
      return res.json({ ok: true, state: "idle", loggedIn: false, compatible: false, detail: "WhatsApp desconectado." });
    }
  }
  try {
    const s = await getOrCreateSession(sessionId);
    const st = await runSerialized(s, () => inspectPage(s.page));
    res.json({ ok: true, ...st });
  } catch (err) {
    res.status(500).json({ ok: false, detail: err.message || "Falha ao consultar sessão." });
  }
});

app.post("/api/session/qr", async (req, res) => {
  const sessionId = validSessionId(req.body?.sessionId || req.headers["x-pulso-session"]);
  if (!sessionId) return res.status(400).json({ ok: false, detail: "sessionId inválido." });
  try {
    const s = await getOrCreateSession(sessionId);
    const out = await runSerialized(s, async () => {
      const page = s.page;
      // Wait for login UI or chat list
      for (let i = 0; i < 40; i++) {
        const st = await inspectPage(page);
        if (st.loggedIn) return { ok: true, ...st };
        // If on phone screen, switch back to QR code
        const qrLink = page.locator("button, a, span[role='button'], div[role='button']").filter({ hasText: /qr\s*code|c[oó]digo\s*qr/i }).first();
        if (await qrLink.isVisible().catch(() => false)) {
          await qrLink.click().catch(() => {});
          await page.waitForTimeout(500);
        }
        const canvas = page.locator('canvas[aria-label*="QR" i], canvas[aria-label*="Scan" i], [data-ref] canvas, canvas').first();
        if (await canvas.isVisible().catch(() => false)) {
          const box = await canvas.boundingBox();
          if (box && box.width >= 150 && box.height >= 150) {
            const png = await canvas.screenshot({ type: "png" });
            return {
              ok: true,
              state: "qr",
              loggedIn: false,
              compatible: false,
              qrDataUrl: "data:image/png;base64," + png.toString("base64"),
              detail: "Escaneie o QR Code no WhatsApp → Dispositivos conectados.",
            };
          }
        }
        await page.waitForTimeout(500);
      }
      return { ok: false, detail: "Não foi possível carregar o QR Code do WhatsApp Web. Tente novamente." };
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, detail: err.message || "Falha ao obter QR Code." });
  }
});

app.post("/api/session/pair-phone", async (req, res) => {
  const sessionId = validSessionId(req.body?.sessionId || req.headers["x-pulso-session"]);
  if (!sessionId) return res.status(400).json({ ok: false, detail: "sessionId inválido." });
  const ddi = String(req.body?.ddi || "55").replace(/\D/g, "");
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  if (!ddi || phone.length < 8) {
    return res.status(400).json({ ok: false, detail: "Digite o DDD + seu número de telefone (ex: 11999999999)." });
  }

  try {
    const s = await getOrCreateSession(sessionId);
    const out = await runSerialized(s, async () => {
      const page = s.page;
      // Wait for WhatsApp Web to finish loading splash screen
      for (let i = 0; i < 45; i++) {
        const st = await inspectPage(page);
        if (st.loggedIn) return { ok: true, ...st };
        if (st.state !== "loading") break;
        await page.waitForTimeout(500);
      }

      // If an old code is showing, reload cleanly so user gets a fresh code
      const currentSt = await inspectPage(page);
      if (currentSt.loggedIn) return { ok: true, ...currentSt };
      if (currentSt.pairingCode) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        for (let i = 0; i < 35; i++) {
          const st2 = await inspectPage(page);
          if (st2.loggedIn) return { ok: true, ...st2 };
          if (st2.state !== "loading") break;
          await page.waitForTimeout(500);
        }
      }

      // 1. Click "Entrar com número de telefone" / "Log in with phone number" if phone input not yet visible
      const phoneInputSelector = 'input[aria-label*="telefone" i], input[aria-label*="phone" i], input[type="tel"], form input[type="text"], input[value^="+"]';
      let input = page.locator(phoneInputSelector).first();
      if (!(await input.isVisible().catch(() => false))) {
        const phoneBtn = page.locator("button, a, span[role='button'], div[role='button'], span").filter({
          hasText: /n[uú]mero de telefone|phone number|conectar com n[uú]mero|entrar com n[uú]mero|link with phone|log in with phone/i,
        }).first();
        await phoneBtn.waitFor({ state: "visible", timeout: 15_000 });
        await phoneBtn.click();
        await input.waitFor({ state: "visible", timeout: 15_000 });
      }

      // 2. Type phone number cleanly using real Playwright keyboard events
      await input.click();
      const existingVal = (await input.inputValue().catch(() => "")).trim();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      const fullPlus = `+${ddi}${phone}`;
      if (existingVal.startsWith("+") || existingVal === "") {
        await page.keyboard.type(fullPlus, { delay: 25 });
      } else {
        await page.keyboard.type(phone, { delay: 25 });
      }
      await page.waitForTimeout(400);

      // 3. Click Avançar / Next
      const nextBtn = page.locator("button, [role='button']").filter({
        hasText: /^(avan[cç]ar|next|continuar|prosseguir)$/i,
      }).first();
      await nextBtn.waitFor({ state: "visible", timeout: 10_000 });
      await nextBtn.click();

      // 4. Wait for 8-char pairing code
      for (let i = 0; i < 45; i++) {
        const st = await inspectPage(page);
        if (st.loggedIn) return { ok: true, ...st };
        if (st.pairingCode) {
          return {
            ok: true,
            state: "pairing",
            loggedIn: false,
            compatible: false,
            code: st.pairingCode,
            pairingCode: st.pairingCode,
            detail: "Código gerado! No WhatsApp: Dispositivos conectados → Conectar com número de telefone.",
          };
        }
        // Check for visible error alert from WhatsApp
        const errText = await page.evaluate(() => {
          const alert = document.querySelector('[role="alert"]');
          return alert ? (alert.textContent || "").trim() : "";
        });
        if (errText && /inv[aá]lid|incorret|tente novamente|try again|erro|error/i.test(errText)) {
          return { ok: false, detail: `WhatsApp: ${errText}` };
        }
        await page.waitForTimeout(500);
      }

      return { ok: false, detail: "O WhatsApp não retornou o código de 8 dígitos. Confira o DDD/número ou tente via QR Code." };
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, detail: err.message || "Falha ao solicitar código no WhatsApp." });
  }
});

app.post("/api/sticker/send", async (req, res) => {
  const sessionId = validSessionId(req.body?.sessionId || req.headers["x-pulso-session"]);
  if (!sessionId) return res.status(400).json({ ok: false, detail: "sessionId inválido." });

  const { webpBase64, audioBase64, audioExt, duration, animated, side, pack, author } = req.body || {};
  if (!webpBase64 || typeof webpBase64 !== "string") {
    return res.status(400).json({ ok: false, detail: "Arquivo WebP ausente." });
  }

  try {
    let webpBuf = Buffer.from(webpBase64, "base64");
    let oggBase64 = null;
    if (audioBase64 && typeof audioBase64 === "string") {
      const audioBuf = Buffer.from(audioBase64, "base64");
      const isAlreadyOgg = audioBuf.length >= 4 && audioBuf.toString("ascii", 0, 4) === "OggS";
      if (isAlreadyOgg) {
        oggBase64 = audioBase64;
      } else {
        // Safari iOS sent WAV -> convert cleanly to 48kHz Ogg/Opus and update WebP EXIF sound-sha256!
        const oggBuf = await convertAudioToOggOpus(audioBuf, audioExt || "wav");
        if (oggBuf.length > 1_000_000) {
          return res.status(400).json({ ok: false, detail: "Áudio Opus excedeu 1 MB. Reduza a duração do trecho." });
        }
        oggBase64 = oggBuf.toString("base64");
        webpBuf = patchWebpWithOggHash(webpBuf, oggBuf, pack || "", author || "", Number(side) || 512);
      }
    }

    const s = await getOrCreateSession(sessionId);
    const result = await runSerialized(s, async () => {
      const st = await inspectPage(s.page);
      if (!st.loggedIn) {
        return { ok: false, level: "incompativel", detail: "Conecte seu WhatsApp primeiro (pelo número ou QR Code)!" };
      }
      return await waRpc(s.page, "send", {
        webp: webpBuf.toString("base64"),
        ogg: oggBase64,
        duration: oggBase64 ? Math.max(1, Math.round(Number(duration) || 1)) : 0,
        animated: animated === true,
        side: Number.isFinite(Number(side)) ? Math.round(Number(side)) : 512,
        forward: false,
      }, 150_000);
    });

    if (!result?.ok) {
      return res.status(400).json(result || { ok: false, detail: "O WhatsApp não confirmou o envio." });
    }
    res.json({
      ok: true,
      detail: "🔊 Figurinha com som enviada para sua conversa 'Você' no WhatsApp!",
    });
  } catch (err) {
    res.status(500).json({ ok: false, detail: err.message || "Falha ao enviar figurinha no servidor." });
  }
});

app.post("/api/session/logout", async (req, res) => {
  const sessionId = validSessionId(req.body?.sessionId || req.headers["x-pulso-session"]);
  if (!sessionId) return res.status(400).json({ ok: false, detail: "sessionId inválido." });
  await closeSession(sessionId, true);
  res.json({ ok: true, detail: "Sessão encerrada e dados removidos do servidor." });
});

// Serve the Pulso Web App directly from `/` as well!
if (fs.existsSync(STATIC_APP_DIR)) {
  app.use("/", express.static(STATIC_APP_DIR));
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Pulso Server v0.9.9 ativo em http://localhost:${PORT}`);
  console.log(`Browser: ${findBrowserExecutable() || "playwright-chromium"} | ffmpeg: ${ffmpegPath ? "OK" : "AUSENTE"}`);
});
