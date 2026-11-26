"use strict";
(() => {
  // src/brand.js
  var BRAND = Object.freeze({
    name: "Pulso",
    version: "0.9.8",
    description: "Crie figurinhas com som no seu navegador.",
    icon: "icons/pulso"
  });

  // src/config.ts
  var SIDE = 512;
  var LIMIT = 1e6;
  var stickerUploadLimit = (animated) => animated ? 47e4 : 1e5;
  var FILE_LIMIT = 64 * 1024 * 1024;
  var QUEUE_LIMIT = 15;
  var QUEUE_BYTES = QUEUE_LIMIT * FILE_LIMIT;
  var CLIP_LIMIT = 12;
  var AUDIO_RATE = 48e3;
  var MAX_SOURCE_PIXELS = 17e6;
  var MAX_FRAMES = 240;
  var FRAME_BUDGET = 48 * 1024 * 1024;
  function clamp(value, minimum, maximum2) {
    return Math.min(maximum2, Math.max(minimum, value));
  }

  // src/crop.ts
  function geometry(width, height, borders, crop, side) {
    const rect = crop.remove ? borders : { x: 0, y: 0, width: 1, height: 1 };
    const source = { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height };
    if (crop.mode === "cortar") {
      const size = Math.min(source.width, source.height) / clamp(crop.zoom, 1, 4);
      return {
        source: {
          x: clamp(width * crop.focus.x - size / 2, source.x, source.x + source.width - size),
          y: clamp(height * crop.focus.y - size / 2, source.y, source.y + source.height - size),
          width: size,
          height: size
        },
        target: { x: 0, y: 0, width: side, height: side }
      };
    }
    const scale = side / Math.max(source.width, source.height);
    const w = crop.mode === "esticar" ? side : source.width * scale;
    const h = crop.mode === "esticar" ? side : source.height * scale;
    return { source, target: { x: (side - w) / 2, y: (side - h) / 2, width: w, height: h } };
  }

  // src/mux.ts
  var utf8 = new TextEncoder();
  var text = new TextDecoder();
  function concat(parts) {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }
  var view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var tag = (bytes, offset) => text.decode(bytes.subarray(offset, offset + 4));
  function webpChunks(bytes) {
    if (bytes.length < 12 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WEBP" || view(bytes).getUint32(4, true) !== bytes.length - 8) throw new Error("Cabeçalho WebP inválido.");
    const chunks = [];
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const size = view(bytes).getUint32(offset + 4, true);
      const next = offset + 8 + size + (size & 1);
      if (next > bytes.length) throw new Error("Bloco WebP incompleto.");
      chunks.push({ name: tag(bytes, offset), data: bytes.subarray(offset + 8, offset + 8 + size) });
      offset = next;
    }
    if (offset !== bytes.length) throw new Error("Preenchimento WebP inválido.");
    return chunks;
  }
  function chunk(name, bytes) {
    const result = new Uint8Array(8 + bytes.length + (bytes.length & 1));
    result.set(utf8.encode(name));
    view(result).setUint32(4, bytes.length, true);
    result.set(bytes, 8);
    return result;
  }
  function riff(parts) {
    const header = new Uint8Array(12);
    header.set(utf8.encode("RIFF"));
    view(header).setUint32(4, 4 + parts.reduce((sum, part) => sum + part.length, 0), true);
    header.set(utf8.encode("WEBP"), 8);
    return concat([header, ...parts]);
  }
  function u24(bytes, offset, value) {
    bytes[offset] = value;
    bytes[offset + 1] = value >>> 8;
    bytes[offset + 2] = value >>> 16;
  }
  function vp8x(flags, side = SIDE) {
    const result = new Uint8Array(10);
    result[0] = flags;
    u24(result, 4, side - 1);
    u24(result, 7, side - 1);
    return result;
  }
  function containsAlpha(parts) {
    return parts.some((part) => part.name === "ALPH" || part.name === "VP8L" && (part.data[4] & 16) !== 0);
  }
  function animationFallback(frames, side = SIDE) {
    let alpha = false;
    const blocks = frames.map((frame) => {
      const parts = webpChunks(frame.bytes).filter((part) => ["ALPH", "VP8 ", "VP8L"].includes(part.name));
      alpha ||= containsAlpha(parts);
      const header = new Uint8Array(16);
      u24(header, 6, side - 1);
      u24(header, 9, side - 1);
      u24(header, 12, Math.max(1, Math.min(16777215, frame.duration)));
      header[15] = 2;
      return chunk("ANMF", concat([header, ...parts.map((part) => chunk(part.name, part.data))]));
    });
    return riff([chunk("VP8X", vp8x(2 | (alpha ? 16 : 0), side)), chunk("ANIM", new Uint8Array(6)), ...blocks]);
  }
  async function sha256(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
    return btoa(String.fromCharCode(...new Uint8Array(digest)));
  }
  async function exifFor(pack, author, ogg) {
    const name = pack.trim().slice(0, 128);
    const publisher = author.trim().slice(0, 128);
    let id = crypto.randomUUID();
    if (name || publisher) {
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode("stickers-con-sonido|" + name + "|" + publisher)));
      const hex = Array.from(bytes.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
      id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
    }
    const json = utf8.encode(JSON.stringify({
      "sticker-pack-id": id,
      "sticker-pack-name": name || void 0,
      "sticker-pack-publisher": publisher || void 0,
      emojis: ["🔊"],
      "sound-sha256": ogg ? await sha256(ogg) : void 0
    }));
    const result = new Uint8Array(26 + json.length);
    const dv = view(result);
    result.set([77, 77, 0, 42]);
    dv.setUint32(4, 8);
    dv.setUint16(8, 1);
    dv.setUint16(10, 22337);
    dv.setUint16(12, 7);
    dv.setUint32(14, json.length);
    dv.setUint32(18, 26);
    result.set(json, 26);
    return result;
  }
  function withExif(bytes, exif, side = SIDE) {
    const parts = webpChunks(bytes);
    const head = parts.find((part) => part.name === "VP8X")?.data.slice() ?? vp8x(containsAlpha(parts) ? 16 : 0, side);
    head[0] |= 8;
    return riff([chunk("VP8X", head), ...parts.filter((part) => part.name !== "VP8X" && part.name !== "EXIF").map((part) => chunk(part.name, part.data)), chunk("EXIF", exif)]);
  }
  var crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    let word = value << 24;
    for (let i = 0; i < 8; i++) word = word & 2147483648 ? word << 1 ^ 79764919 : word << 1;
    return word;
  });
  function oggCrc(bytes) {
    let crc = 0;
    for (const byte of bytes) crc = crc << 8 ^ crcTable[crc >>> 24 ^ byte];
    return crc >>> 0;
  }
  function oggPage(flags, granule, serial, index, packets) {
    const laces = [];
    for (const packet of packets) {
      let length = packet.length;
      while (length >= 255) {
        laces.push(255);
        length -= 255;
      }
      laces.push(length);
    }
    if (laces.length > 255) throw new Error("Página Ogg excede 255 segmentos.");
    const head = new Uint8Array(27 + laces.length);
    const dv = view(head);
    head.set(utf8.encode("OggS"));
    head[5] = flags;
    dv.setBigUint64(6, BigInt(granule), true);
    dv.setUint32(14, serial, true);
    dv.setUint32(18, index, true);
    head[26] = laces.length;
    head.set(laces, 27);
    const page = concat([head, ...packets]);
    view(page).setUint32(22, oggCrc(page), true);
    return page;
  }
  function muxOpus(packets, channels, preSkip, length, vendor) {
    const serial = crypto.getRandomValues(new Uint32Array(1))[0];
    const header = new Uint8Array(19);
    header.set(utf8.encode("OpusHead"));
    header[8] = 1;
    header[9] = channels;
    view(header).setUint16(10, preSkip, true);
    view(header).setUint32(12, AUDIO_RATE, true);
    const app = utf8.encode(vendor);
    const tags = new Uint8Array(16 + app.length);
    tags.set(utf8.encode("OpusTags"));
    view(tags).setUint32(8, app.length, true);
    tags.set(app, 12);
    const pages = [oggPage(2, 0, serial, 0, [header]), oggPage(0, 0, serial, 1, [tags])];
    let position = 0;
    const final = length + preSkip;
    const groupSize = 20;
    for (let i = 0; i < packets.length && position < final; i += groupSize) {
      const group = [];
      for (const packet of packets.slice(i, i + groupSize)) {
        group.push(packet.bytes);
        position += packet.samples;
        if (position >= final) break;
      }
      const end = position >= final;
      pages.push(oggPage(end ? 4 : 0, end ? final : position, serial, pages.length, group));
    }
    if (position < final || !packets.length) throw new Error("O encoder devolveu menos amostras Opus do que o esperado.");
    return concat(pages);
  }

  // src/transport.js
  var PANEL_CHANNEL = "pulso-painel-v1";
  var WA_ORIGIN = "https://web.whatsapp.com";
  function within(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new DOMException(message, "TimeoutError")), ms);
    })]).finally(() => clearTimeout(timer));
  }
  function toBase64(bytes) {
    let result = "";
    for (let i = 0; i < bytes.length; i += 12288) result += String.fromCharCode(...bytes.subarray(i, i + 12288));
    return btoa(result);
  }

  // src/audio.ts
  var shelf = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  var rlb = [1, -2, 1, -1.99004745483398, 0.99007225036621];
  function biquad(input, coefficients) {
    const [b0, b1, b2, a1, a2] = coefficients;
    let before = 0;
    let previous = 0;
    for (let i = 0; i < input.length; i++) {
      const value = input[i];
      input[i] = b0 * value + previous;
      previous = b1 * value - a1 * input[i] + before;
      before = b2 * value - a2 * input[i];
    }
    return input;
  }
  function effect(frequency, gain) {
    const angle = 2 * Math.PI * frequency / AUDIO_RATE;
    const alpha = Math.sin(angle) / Math.SQRT2;
    const cos = Math.cos(angle);
    if (gain !== void 0) {
      const a = 10 ** (gain / 40);
      const norm2 = 1 + alpha / a;
      return [(1 + alpha * a) / norm2, -2 * cos / norm2, (1 - alpha * a) / norm2, -2 * cos / norm2, (1 - alpha / a) / norm2];
    }
    const norm = 1 + alpha;
    return [(1 + cos) / (2 * norm), -(1 + cos) / norm, (1 + cos) / (2 * norm), -2 * cos / norm, (1 - alpha) / norm];
  }
  function loudness(channels) {
    if (!channels.length || !channels[0].length) return -Infinity;
    const block = 19200;
    const hop = 4800;
    const length = channels[0].length;
    const power = new Float64Array(length);
    for (const channel of channels) {
      const weighted = biquad(biquad(channel.slice(), shelf), rlb);
      for (let i = 0; i < length; i++) power[i] += weighted[i] ** 2;
    }
    const energies = [];
    const energy = (from, to) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += power[i];
      return sum;
    };
    if (length < block) {
      energies.push(energy(0, length) / block);
    } else {
      let sum = energy(0, block);
      energies.push(sum / block);
      for (let i = hop; i + block <= length; i += hop) {
        sum += energy(i + block - hop, i + block) - energy(i - hop, i);
        energies.push(sum / block);
      }
    }
    const toLufs = (mean2) => -0.691 + 10 * Math.log10(mean2);
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const gated = energies.filter((value) => toLufs(value) >= -70);
    if (!gated.length) return -Infinity;
    const relative = toLufs(mean(gated)) - 10;
    return toLufs(mean(gated.filter((value) => toLufs(value) >= relative)));
  }
  var radius = 8;
  var phases = [0.25, 0.5, 0.75].map((phase) => {
    const weights = Array.from({ length: radius * 2 }, (_, i) => {
      const distance = i - radius + 1 - phase;
      const sinc = Math.sin(Math.PI * distance) / (Math.PI * distance);
      return sinc * (0.5 + 0.5 * Math.cos(Math.PI * distance / radius));
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((weight) => weight / sum);
  });
  function peakEnvelope(channels) {
    const len = channels[0].length;
    const result = new Float32Array(len);
    for (const channel of channels) {
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const cur = channel[i];
        const absCur = cur < 0 ? -cur : cur;
        const mid = (prev + cur) * 0.5;
        const absMid = mid < 0 ? -mid : mid;
        const p = absCur > absMid ? absCur : absMid;
        if (p > result[i]) result[i] = p;
        prev = cur;
      }
    }
    return result;
  }
  function maximum(samples) {
    let maximum2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      if (v > maximum2) maximum2 = v;
    }
    return maximum2;
  }
  function truePeak(channels) {
    let peak = 0;
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i++) {
        const v = channel[i] < 0 ? -channel[i] : channel[i];
        if (v > peak) peak = v;
      }
    }
    return 20 * Math.log10(peak);
  }
  function trimSilence(channels) {
    const length = channels[0].length;
    const step2 = 480;
    const threshold = 10 ** (-55 / 10);
    let first = length;
    let last = 0;
    for (let start = 0; start < length; start += step2) {
      const end = Math.min(length, start + step2);
      const active2 = channels.some((channel) => {
        let sum = 0;
        for (let i = start; i < end; i++) sum += channel[i] ** 2;
        return sum / (end - start) > threshold;
      });
      if (active2) {
        first = Math.min(first, start);
        last = end;
      }
    }
    if (last === 0) return { channels, offset: 0 };
    const guard = Math.round(AUDIO_RATE * 0.1);
    const offset = Math.max(0, first - guard);
    return { channels: channels.map((channel) => channel.slice(offset, Math.min(length, last + guard))), offset };
  }
  function detectSignal(channels) {
    if (channels.length === 1) return "voice";
    const [left, right] = channels;
    let difference = 0;
    let energy = 0;
    for (let i = 0; i < left.length; i += 4) {
      difference += (left[i] - right[i]) ** 2;
      energy += left[i] ** 2 + right[i] ** 2;
    }
    return energy && difference / energy > 0.055 ? "music" : "voice";
  }
  function processPcm(input, options, attenuation = 0) {
    const signal = options.voice ? "voice" : detectSignal(input);
    let channels = input.map((channel) => biquad(channel.slice(), effect(80)));
    if (signal === "voice" && channels.length === 2) {
      channels = [channels[0].map((sample, i) => (sample + channels[1][i]) / 2)];
    }
    const trimmed = options.trim ? trimSilence(channels) : { channels, offset: 0 };
    channels = trimmed.channels;
    for (const channel of channels) {
      if (options.voice) biquad(channel, effect(2700, 3));
      const fade = Math.min(960, Math.floor(channel.length / 2));
      for (let i = 0; i < fade; i++) {
        channel[i] *= i / fade;
        channel[channel.length - 1 - i] *= i / fade;
      }
    }
    const original = loudness(channels);
    const gainDb = options.normalize && Number.isFinite(original) ? clamp(-16 - original, -36, 30) : 0;
    const gain = 10 ** ((gainDb - attenuation) / 20);
    const ceiling = 10 ** ((-1.05 - attenuation) / 20);
    const envelope = peakEnvelope(channels);
    const horizon = 240;
    const attack = new Float32Array(envelope.length);
    let reduction = 1;
    for (let i = envelope.length - 1; i >= 0; i--) {
      const requested = envelope[i] ? Math.min(1, ceiling / (gain * envelope[i])) : 1;
      reduction = Math.min(requested, reduction + (1 - reduction) / (horizon / 5));
      attack[i] = reduction;
    }
    reduction = 1;
    for (let i = 0; i < envelope.length; i++) {
      reduction = Math.min(attack[i], reduction + (1 - reduction) / 1750);
      for (const channel of channels) channel[i] *= gain * reduction;
    }
    const peak = maximum(peakEnvelope(channels));
    const correction = peak > ceiling ? ceiling / peak : 1;
    if (correction < 1) for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] *= correction;
    return { channels, signal, lufs: loudness(channels), dbtp: 20 * Math.log10(peak * correction), offset: trimmed.offset };
  }
  function opusPacketSamples(bytes) {
    if (!bytes.length) throw new Error("Pacote Opus vazio.");
    const configuration = bytes[0] >>> 3;
    const perFrame = configuration >= 16 ? [120, 240, 480, 960][configuration % 4] : configuration >= 12 ? [480, 960][configuration % 2] : [480, 960, 1920, 2880][configuration % 4];
    const mode = bytes[0] & 3;
    const frames = mode === 0 ? 1 : mode === 3 ? (bytes[1] ?? 0) & 63 : 2;
    const samples = frames * perFrame;
    if (!samples || samples > 5760) throw new Error("Pacote Opus com duração inválida.");
    return samples;
  }
  function audioQueueSpace(encoder, signal) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        encoder.removeEventListener("dequeue", dequeue);
        signal?.removeEventListener("abort", abort);
      };
      function dequeue() {
        cleanup();
        resolve();
      }
      function abort() {
        cleanup();
        reject(signal?.reason || new DOMException("Codificação cancelada.", "AbortError"));
      }
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("O codificador de áudio demorou demais."));
      }, 6e3);
      encoder.addEventListener("dequeue", dequeue, { once: true });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  async function opusPass(pcm, bitrate, vendor, complexity, abortSignal) {
    const { channels, signal } = pcm;
    const config = {
      codec: "opus",
      sampleRate: AUDIO_RATE,
      numberOfChannels: channels.length,
      bitrate,
      bitrateMode: "variable",
      opus: { format: "opus", signal, application: signal === "voice" ? "voip" : "audio", complexity, frameDuration: 2e4 }
    };
    const support = await AudioEncoder.isConfigSupported(config).catch(() => null);
    if (!support?.supported) throw new Error("Este navegador não oferece codificação Opus.");
    const packets = [];
    let preSkip = 312;
    let failure;
    const encoder = new AudioEncoder({
      output(chunk2, metadata) {
        const description = metadata?.decoderConfig?.description;
        if (description) {
          const bytes2 = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
          if (bytes2.length >= 19 && new TextDecoder().decode(bytes2.subarray(0, 8)) === "OpusHead") preSkip = bytes2[10] | bytes2[11] << 8;
        }
        const bytes = new Uint8Array(chunk2.byteLength);
        chunk2.copyTo(bytes);
        try {
          packets.push({ bytes, samples: opusPacketSamples(bytes) });
        } catch (error) {
          failure = error;
        }
      },
      error(error) {
        failure = error;
      }
    });
    const length = channels[0].length;
    try {
      encoder.configure(config);
      const BLOCK = 960 * 25;
      for (let start = 0; start < length + 960; start += BLOCK) {
        abortSignal?.throwIfAborted();
        const framesInBlock = Math.min(BLOCK, Math.ceil((length + 960 - start) / 960) * 960);
        const planar = new Float32Array(framesInBlock * channels.length);
        channels.forEach((channel, i) => {
          const end = Math.min(channel.length, start + framesInBlock);
          if (end > start) planar.set(channel.subarray(start, end), i * framesInBlock);
        });
        const frame = new AudioData({
          format: "f32-planar",
          sampleRate: AUDIO_RATE,
          numberOfFrames: framesInBlock,
          numberOfChannels: channels.length,
          timestamp: Math.round(start * 1e6 / AUDIO_RATE),
          data: planar
        });
        try {
          encoder.encode(frame);
        } finally {
          frame.close();
        }
        if (encoder.encodeQueueSize > 8) await audioQueueSpace(encoder, abortSignal);
        if (failure) throw failure;
      }
      await new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          abortSignal?.removeEventListener("abort", abort);
        };
        const finish = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(abortSignal?.reason || new DOMException("Codificação cancelada.", "AbortError"));
        const timer = setTimeout(() => finish(new Error("O codificador de áudio não concluiu.")), 6e3);
        abortSignal?.addEventListener("abort", abort, { once: true });
        if (abortSignal?.aborted) {
          abort();
          return;
        }
        encoder.flush().then(() => finish(), (error) => finish(error));
      });
      if (failure) throw failure;
    } finally {
      if (encoder.state !== "closed") encoder.close();
    }
    return muxOpus(packets, channels.length, preSkip, length, vendor);
  }
  async function encodeAudio(channels, options, vendor, attenuation = 0, lowResource = false, signal) {
    const pcm = processPcm(channels, options, attenuation);
    const duration = pcm.channels[0].length / AUDIO_RATE;
    const target = 95e4;
    if (typeof window.__pulsoEncodeOpusNative === "function" && (typeof AudioEncoder !== "function" || window.__PULSO_IOS__)) {
      const mono = pcm.channels.length === 1 ? pcm.channels[0] : Float32Array.from(pcm.channels[0], (s, i) => (s + pcm.channels[1][i]) / 2);
      const bitrate = Math.min(48e3, Math.max(16e3, Math.floor(target * 7.5 / Math.max(0.1, duration))));
      const bytes = await window.__pulsoEncodeOpusNative(mono, bitrate);
      if (bytes.length > 1e6) throw new Error("O áudio excedeu 1 MB. Reduza o trecho.");
      return {
        bytes,
        duration,
        channels: 1,
        signal: pcm.signal,
        lufs: pcm.lufs,
        dbtp: pcm.dbtp,
        offset: pcm.offset / AUDIO_RATE
      };
    }
    if (typeof AudioEncoder !== "function") throw new Error("A codificação Opus requer um navegador Chromium atualizado.");
    const maxBitrate = lowResource ? 96e3 : pcm.channels.length === 1 ? 112e3 : 256e3;
    const complexity = lowResource ? 5 : 10;
    let bitrate = Math.min(maxBitrate, Math.floor(target * 7.8 / duration));
    let bytes = await opusPass(pcm, bitrate, vendor, complexity, signal);
    for (let retry = 0; retry < 4 && bytes.length > target; retry++) {
      signal?.throwIfAborted();
      bitrate = Math.max(12e3, Math.floor(bitrate * target / bytes.length * 0.96));
      bytes = await opusPass(pcm, bitrate, vendor, complexity, signal);
    }
    if (bytes.length > 1e6) throw new Error("O áudio excedeu 1 MB. Reduza o trecho.");
    return {
      bytes,
      duration,
      channels: pcm.channels.length,
      signal: pcm.signal,
      lufs: pcm.lufs,
      dbtp: pcm.dbtp,
      offset: pcm.offset / AUDIO_RATE
    };
  }

  // src/editor-media.js
  var imageTypes = {
    gif: "image/gif",
    png: "image/png",
    apng: "image/png",
    webp: "image/webp",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    avif: "image/avif",
    bmp: "image/bmp"
  };
  var imageType = (file) => imageTypes[file.name.split(".").at(-1).toLowerCase()] || (/^image\/(gif|png|webp|jpeg|avif|bmp)$/.test(file.type) ? file.type : "");
  var isVideo = (file) => /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i.test(file.name);
  function betweenEvents(node, event, signal, trigger) {
    return new Promise((resolve, reject) => {
      let timer;
      function clear() {
        clearTimeout(timer);
        node.removeEventListener(event, success);
        node.removeEventListener("error", error);
        signal.removeEventListener("abort", cancelled);
      }
      function success() {
        clear();
        resolve();
      }
      function error() {
        clear();
        reject(new Error("O navegador não conseguiu abrir este formato."));
      }
      function cancelled() {
        clear();
        reject(signal.reason);
      }
      if (signal.aborted) {
        cancelled();
        return;
      }
      node.addEventListener(event, success, { once: true });
      node.addEventListener("error", error, { once: true });
      signal.addEventListener("abort", cancelled, { once: true });
      timer = setTimeout(() => {
        clear();
        reject(new Error("A leitura do arquivo demorou demais."));
      }, 15e3);
      try {
        trigger();
      } catch (failure) {
        clear();
        reject(failure);
      }
    });
  }
  async function loadMedia(file, kind, signal, source = "loadedmetadata") {
    const element = document.createElement(kind);
    element.muted = true;
    element.preload = source === "loadedmetadata" ? "metadata" : "auto";
    const url = URL.createObjectURL(file);
    const dispose = () => {
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
    };
    try {
      await betweenEvents(element, source, signal, () => {
        element.src = url;
      });
      return { element, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }
  function validate(width, height) {
    if (!width || !height || width * height > MAX_SOURCE_PIXELS || Math.max(width, height) > 8192) {
      throw new Error("O vídeo excede o limite de 17 megapixels ou 8192 px por lado.");
    }
  }
  async function videoMetadata(file, signal) {
    const { element: video, dispose } = await loadMedia(file, "video", signal);
    try {
      const { videoWidth: width, videoHeight: height, duration } = video;
      validate(width, height);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Não foi possível ler a duração do vídeo.");
      return { duration, width, height };
    } finally {
      dispose();
    }
  }
  var workerDisabled = Boolean(window.__PULSO_IOS__);
  var yieldUi = () => new Promise((resolve) => setTimeout(resolve, 0));
  function makeCanvas(width, height, willReadFrequently = false) {
    if (typeof OffscreenCanvas === "function") {
      try {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d", willReadFrequently ? { willReadFrequently: true } : void 0);
        if (context) {
          context.imageSmoothingQuality = "high";
          return {
            canvas,
            context,
            toBitmap: () => canvas.transferToImageBitmap(),
            toWebpBlob: (quality) => canvas.convertToBlob({ type: "image/webp", quality })
          };
        }
      } catch {
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", willReadFrequently ? { willReadFrequently: true } : void 0);
    context.imageSmoothingQuality = "high";
    return {
      canvas,
      context,
      toBitmap: () => createImageBitmap(canvas),
      toWebpBlob: (quality) => new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Falha ao codificar quadro WebP no navegador.")), "image/webp", quality);
      })
    };
  }
  async function captureViaVideo(file, range, analysis, signal, progress2, requestedFps = 0) {
    const { element: video, dispose } = await loadMedia(file, "video", signal, "loadeddata");
    const frames = [];
    try {
      const width = video.videoWidth;
      const height = video.videoHeight;
      validate(width, height);
      const startOffset = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const duration = Math.max(0.01, video.duration - startOffset);
      const length = Math.max(0.01, Math.min(range.end, duration) - range.start);
      const defaultFps = length > 8 ? 10 : 12;
      const targetFps = analysis ? Math.min(2, 4 / length) : Math.min(20, requestedFps || defaultFps);
      const fps = Math.min(targetFps, MAX_FRAMES / length);
      const count = Math.max(1, Math.round(length * fps));
      const maxDim = analysis ? 192 : 512;
      const scale = Math.min(1, maxDim / Math.max(width, height), Math.sqrt(FRAME_BUDGET / (4 * width * height * count)));
      const targetW = Math.max(1, Math.floor(width * scale));
      const targetH = Math.max(1, Math.floor(height * scale));
      const surface2 = makeCanvas(targetW, targetH);
      const maxT = Math.max(0, video.duration - 1e-3);
      for (let i = 0; i < count; i++) {
        signal.throwIfAborted();
        const rawTime = startOffset + range.start + (i + 0.5) / fps;
        const time = Math.min(maxT, rawTime);
        if (Math.abs(video.currentTime - time) > 5e-4) {
          await betweenEvents(video, "seeked", signal, () => {
            video.currentTime = time;
          });
        }
        surface2.context.clearRect(0, 0, targetW, targetH);
        surface2.context.drawImage(video, 0, 0, targetW, targetH);
        const bitmap = await surface2.toBitmap();
        frames.push({ image: bitmap, time: (i + 0.5) / fps });
        if (i % 5 === 0) progress2("Lendo vídeo com o decodificador do navegador…", 0.1 + 0.24 * i / count);
      }
      return { frames, length, duration, captureFps: fps, animated: true, decoder: "Vídeo do navegador" };
    } catch (error) {
      frames.forEach((frame) => frame.image.close());
      throw error;
    } finally {
      dispose();
    }
  }
  async function decodeImageLocal(file, range, type, analysis, signal) {
    if (typeof ImageDecoder !== "function" || !await ImageDecoder.isTypeSupported(type).catch(() => false)) {
      const bitmap = await createImageBitmap(file);
      try {
        validate(bitmap.width, bitmap.height);
        const scale = Math.min(1, 576 / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.floor(bitmap.width * scale));
        const h = Math.max(1, Math.floor(bitmap.height * scale));
        const s = makeCanvas(w, h);
        s.context.drawImage(bitmap, 0, 0, w, h);
        return {
          frames: [{ image: await s.toBitmap(), time: 0 }],
          length: 0,
          duration: 0,
          animated: false,
          decoder: "Imagem do navegador"
        };
      } finally {
        bitmap.close();
      }
    }
    const decoder = new ImageDecoder({ data: file.stream(), type, preferAnimation: true });
    const frames = [];
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      if (!track?.frameCount) throw new Error("Arquivo de imagem sem quadros legíveis.");
      if (track.frameCount > 1500) throw new Error("A animação contém mais de 1500 quadros.");
      const animated = track.frameCount > 1;
      const start2 = range.start;
      const end = Math.min(range.end, start2 + CLIP_LIMIT);
      const fps = analysis ? 4 : Math.min(20, MAX_FRAMES / Math.max(1, end - start2));
      const maxCount = animated ? Math.min(MAX_FRAMES, Math.ceil((end - start2) * fps) + 1) : 1;
      let time = 0;
      let surface2 = null;
      for (let i = 0; i < track.frameCount; i++) {
        signal.throwIfAborted();
        const { image } = await decoder.decode({ frameIndex: i });
        try {
          const w = image.displayWidth;
          const h = image.displayHeight;
          validate(w, h);
          const scale = Math.min(1, 576 / Math.max(w, h), Math.sqrt(FRAME_BUDGET / (4 * w * h * Math.max(1, maxCount))));
          const dw = Math.max(1, Math.floor(w * scale));
          const dh = Math.max(1, Math.floor(h * scale));
          if (!surface2 || surface2.canvas.width !== dw || surface2.canvas.height !== dh) surface2 = makeCanvas(dw, dh);
          const shouldTake = !frames.length && time >= start2 || frames.length && frames.length < maxCount && time < end && time - start2 - frames.at(-1).time >= 0.86 / fps;
          if (shouldTake || !animated && i === 0) {
            surface2.context.clearRect(0, 0, dw, dh);
            surface2.context.drawImage(image, 0, 0, dw, dh);
            frames.push({ image: await surface2.toBitmap(), time: Math.max(0, time - start2) });
          }
          time += Math.max(0.01, (image.duration || 1e5) / 1e6);
        } finally {
          image.close();
        }
        if (time >= end && !analysis) break;
        if (time >= 120) break;
      }
      if (!frames.length) throw new Error("Nenhum quadro decodificado para o trecho.");
      return {
        frames,
        length: animated ? Math.max(0.01, Math.min(end, time) - start2) : 0,
        duration: animated ? time : 0,
        animated,
        decoder: "ImageDecoder"
      };
    } catch (error) {
      frames.forEach((frame) => frame.image.close());
      throw error;
    } finally {
      decoder.close();
    }
  }
  function visiblePixel(pixels, index) {
    return pixels.data[index * 4 + 3] > 20;
  }
  function darkPixel(pixels, index) {
    const offset = index * 4;
    return visiblePixel(pixels, index) && Math.max(pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]) < 26;
  }
  function detectBordersLocal(frames) {
    if (!frames.length) return { x: 0, y: 0, width: 1, height: 1 };
    const { width, height } = frames[0];
    function edge(horizontal, reverse) {
      const extent = horizontal ? height : width;
      const length = horizontal ? width : height;
      let count = 0;
      while (count < Math.floor(extent * 0.42)) {
        const line = reverse ? extent - 1 - count : count;
        const indices = Array.from({ length }, (_, i) => horizontal ? line * width + i : i * width + line);
        const blank = frames.every((frame) => indices.filter((index) => !visiblePixel(frame, index) || darkPixel(frame, index)).length >= length * 0.985);
        if (!blank) break;
        count++;
      }
      return count;
    }
    function colorEdge(horizontal, reverse) {
      const extent = horizontal ? height : width;
      const length = horizontal ? width : height;
      const start2 = Math.floor(length * 0.2);
      const end = Math.ceil(length * 0.8);
      const limit = Math.floor(extent * 0.34);
      const pixel = (line, i) => {
        const edgePosition = reverse ? extent - 1 - line : line;
        return 4 * (horizontal ? edgePosition * width + i : i * width + edgePosition);
      };
      const center = pixel(0, Math.floor(length / 2));
      const base = frames[0].data.slice(center, center + 4);
      const matches = (data, index) => data[index + 3] > 245 && [0, 1, 2].every((channel) => Math.abs(data[index + channel] - base[channel]) <= 9);
      let count = 0;
      while (count < limit && frames.every((frame) => {
        for (let i = start2; i < end; i++) if (!matches(frame.data, pixel(count, i))) return false;
        return true;
      })) count++;
      return count >= Math.max(2, Math.round(extent * 0.02)) && count < limit ? { count, base } : null;
    }
    function sides(horizontal) {
      const a = edge(horizontal, false);
      const b = edge(horizontal, true);
      if (a || b) return [a, b];
      const leading = colorEdge(horizontal, false);
      const trailing = colorEdge(horizontal, true);
      const similar2 = leading && trailing && [0, 1, 2].every((i) => Math.abs(leading.base[i] - trailing.base[i]) <= 9);
      return similar2 ? [leading.count, trailing.count] : [0, 0];
    }
    let [left, right] = sides(false);
    let [top, bottom] = sides(true);
    const hasSubject = frames.some((frame) => {
      let contrast = 0;
      for (let y = top; y < height - bottom; y++) {
        for (let x = left; x < width - right; x++) {
          const index = y * width + x;
          if (visiblePixel(frame, index) && !darkPixel(frame, index)) contrast++;
        }
      }
      return contrast >= Math.max(1, width * height * 8e-3);
    });
    if (!hasSubject) left = right = top = bottom = 0;
    return { x: left / width, y: top / height, width: (width - left - right) / width, height: (height - top - bottom) / height };
  }
  function suggestFocusLocal(frames, rect) {
    if (!frames.length) return { x: 0.5, y: 0.5 };
    const { width, height } = frames[0];
    const luminance = (frame, index) => {
      const i = index * 4;
      return (0.2126 * frame.data[i] + 0.7152 * frame.data[i + 1] + 0.0722 * frame.data[i + 2]) * frame.data[i + 3] / 255;
    };
    let sum = 0;
    let cx = 0;
    let cy = 0;
    for (let f = 0; f < frames.length; f++) {
      const frame = frames[f];
      for (let y = Math.max(1, Math.ceil(rect.y * height)); y < Math.min(height - 1, (rect.y + rect.height) * height); y++) {
        for (let x = Math.max(1, Math.ceil(rect.x * width)); x < Math.min(width - 1, (rect.x + rect.width) * width); x++) {
          const i = y * width + x;
          const detail = Math.abs(luminance(frame, i - 1) - luminance(frame, i + 1)) + Math.abs(luminance(frame, i - width) - luminance(frame, i + width));
          const movement = f ? Math.abs(luminance(frame, i) - luminance(frames[f - 1], i)) : 0;
          const weight = Math.max(0, detail - 10) + 2.5 * Math.max(0, movement - 13);
          sum += weight;
          cx += weight * (x + 0.5) / width;
          cy += weight * (y + 0.5) / height;
        }
      }
    }
    return sum ? { x: cx / sum, y: cy / sum } : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  function inspectFramesLocal(frames) {
    const sample = [];
    const count = Math.min(frames.length, 9);
    const s = makeCanvas(96, 96, true);
    for (let i = 0; i < count; i++) {
      const frame = frames[Math.round(i * (frames.length - 1) / Math.max(1, count - 1))];
      s.context.clearRect(0, 0, 96, 96);
      s.context.drawImage(frame.image, 0, 0, 96, 96);
      sample.push(s.context.getImageData(0, 0, 96, 96));
    }
    const borders = detectBordersLocal(sample);
    return { borders, focus: suggestFocusLocal(sample, borders) };
  }
  function* combinationsLocal(preset, available, requested, still, force512 = false) {
    if (force512) {
      if (still) {
        yield { side: 512, fps: 0 };
        return;
      }
      const ceiling512 = requested || 15;
      const maxFps512 = Math.min(ceiling512, Math.max(1, Math.round(available)));
      const fpsList = [maxFps512, 15, 12, 10, 8, 6, 5, 4, 3, 2];
      const seen512 = /* @__PURE__ */ new Set();
      for (const rawFps of fpsList) {
        const fps = Math.min(rawFps, maxFps512);
        if (seen512.has(fps)) continue;
        seen512.add(fps);
        yield { side: 512, fps };
      }
      return;
    }
    const maxSide = preset === "leve" ? 384 : 512;
    const ceiling = requested || (preset === "maxima" ? 24 : preset === "leve" ? 15 : 20);
    const maxFps = Math.min(ceiling, Math.max(1, Math.round(available)));
    const sides = [512, 448, 384, 320, 256, 192, 128, 64].filter((side) => side <= maxSide);
    if (still) {
      for (const side of sides) yield { side, fps: 0 };
      return;
    }
    const ladder = [
      [512, maxFps],
      [512, 15],
      [384, 15],
      [384, 12],
      [320, 12],
      [320, 10],
      [256, 10],
      [256, 8],
      [192, 8],
      [192, 6],
      [160, 6],
      [128, 6],
      [128, 5],
      [96, 5],
      [64, 5],
      [64, 3],
      [64, 2]
    ];
    const seen = /* @__PURE__ */ new Set();
    for (const [rawSide, rawFps] of ladder) {
      const side = Math.min(rawSide, maxSide);
      const fps = Math.min(rawFps, maxFps);
      const id = side + "@" + fps;
      if (seen.has(id)) continue;
      seen.add(id);
      yield { side, fps };
    }
  }
  function rendererLocal(borders, crop) {
    const surfaces = new Map();
    function render(image, side = SIDE) {
      let out = surfaces.get(side);
      if (!out) {
        out = makeCanvas(side, side, false);
        surfaces.set(side, out);
      }
      const { source: s, target: t } = geometry(image.width, image.height, borders, crop, side);
      out.context.clearRect(0, 0, side, side);
      out.context.drawImage(image, s.x, s.y, s.width, s.height, t.x, t.y, t.width, t.height);
      return out;
    }
    return render;
  }
  function signaturesLocal(frames) {
    const s = makeCanvas(32, 32, true);
    return frames.map((frame) => {
      s.context.clearRect(0, 0, 32, 32);
      s.context.drawImage(frame.image, 0, 0, 32, 32);
      const pixels = s.context.getImageData(0, 0, 32, 32).data;
      return { ...frame, pixels };
    });
  }
  function samePixelsLocal(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) > 3 || Math.abs(a[i + 1] - b[i + 1]) > 3 || Math.abs(a[i + 2] - b[i + 2]) > 3 || Math.abs(a[i + 3] - b[i + 3]) > 3) return false;
    }
    return true;
  }
  function scheduleLocal(frames, fps, length) {
    if (!fps || frames.length <= 1) return [{ ...frames[0], timestamp: 0, duration: Math.max(1, Math.round(length * 1e3)) }];
    const totalMs = Math.max(1, Math.round(length * 1e3));
    const count = Math.max(1, Math.round(length * fps));
    const out = [];
    let cursor = 0;
    for (let k = 0; k < count; k++) {
      const startMs = Math.round(k * 1e3 / fps);
      const endMs = k === count - 1 ? totalMs : Math.min(totalMs, Math.round((k + 1) * 1e3 / fps));
      const durMs = Math.max(1, endMs - startMs);
      const targetSec = (k + 0.5) / fps;
      while (cursor + 1 < frames.length && Math.abs(frames[cursor + 1].time - targetSec) <= Math.abs(frames[cursor].time - targetSec)) cursor++;
      const frame = frames[cursor];
      const prev = out.at(-1);
      if (prev && (prev.image === frame.image || samePixelsLocal(prev.pixels, frame.pixels))) {
        prev.duration += durMs;
      } else {
        out.push({ ...frame, timestamp: startMs, duration: durMs });
      }
    }
    if (out.length === 1 && totalMs > 1) {
      const half = Math.max(1, Math.floor(totalMs / 2));
      out[0].duration = half;
      out.push({ ...out[0], timestamp: half, duration: Math.max(1, totalMs - half) });
    }
    return out;
  }
  function metricsLocal(reference, result, width, height) {
    const luma = (data, offset) => (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) * data[offset + 3] / 255;
    let ssim = 0;
    let error = 0;
    let blocks = 0;
    for (let y = 0; y < height; y += 8) {
      for (let x = 0; x < width; x += 8) {
        let sx = 0, sy = 0, xx = 0, yy = 0, xy = 0, n = 0;
        for (let j = y; j < Math.min(height, y + 8); j++) {
          for (let i = x; i < Math.min(width, x + 8); i++) {
            const offset = 4 * (j * width + i);
            const a2 = luma(reference, offset);
            const b2 = luma(result, offset);
            sx += a2;
            sy += b2;
            xx += a2 * a2;
            yy += b2 * b2;
            xy += a2 * b2;
            n++;
            error += ((a2 - b2) ** 2 + (reference[offset + 3] - result[offset + 3]) ** 2) / 2;
          }
        }
        const a = sx / n;
        const b = sy / n;
        const alpha = (2 * a * b + 6.5025) / (a * a + b * b + 6.5025);
        const contrast = (2 * (xy / n - a * b) + 58.5225) / (xx / n - a * a + yy / n - b * b + 58.5225);
        ssim += alpha * contrast;
        blocks++;
      }
    }
    return { ssim: ssim / blocks, mse: error / (width * height) };
  }
  async function compareLocal(bytes, scheduled, render) {
    if (typeof ImageDecoder !== "function") return null;
    let decoder;
    try {
      decoder = new ImageDecoder({ type: "image/webp", data: bytes });
      await decoder.tracks.ready;
      const sample = makeCanvas(128, 128, true);
      const count = decoder.tracks.selectedTrack.frameCount;
      const indices = [.../* @__PURE__ */ new Set([0, Math.floor(count / 2), count - 1])];
      let ssim = 0;
      let mse = 0;
      for (const index of indices) {
        const { image } = await decoder.decode({ frameIndex: index });
        let ideal;
        try {
          const time = image.timestamp / 1e3;
          ideal = scheduled.findLast((frame) => frame.timestamp <= time) || scheduled[0];
          sample.context.clearRect(0, 0, 128, 128);
          sample.context.drawImage(image, 0, 0, 128, 128);
        } finally {
          image.close();
        }
        const actual = sample.context.getImageData(0, 0, 128, 128);
        sample.context.clearRect(0, 0, 128, 128);
        sample.context.drawImage(render(ideal.image, SIDE, false).canvas, 0, 0, 128, 128);
        const reference = sample.context.getImageData(0, 0, 128, 128);
        const score = metricsLocal(reference.data, actual.data, 128, 128);
        ssim += score.ssim;
        mse += score.mse;
      }
      return { ssim: ssim / indices.length, psnr: mse ? 10 * Math.log10(255 ** 2 / (mse / indices.length)) : Infinity };
    } catch {
      return null;
    } finally {
      decoder?.close();
    }
  }
  var __webpWasmPromise = null;
  var __canvasWebpSupported = null;
  async function supportsCanvasWebp() {
    if (__canvasWebpSupported !== null) return __canvasWebpSupported;
    try {
      const c = makeCanvas(4, 4, false);
      const b = await c.toWebpBlob(0.5);
      __canvasWebpSupported = b && b.type === "image/webp";
    } catch {
      __canvasWebpSupported = false;
    }
    return __canvasWebpSupported;
  }
  async function getWebpWasm() {
    if (!__webpWasmPromise && typeof window.__PulsoWebpModule === "function") {
      __webpWasmPromise = window.__PulsoWebpModule({
        locateFile: (name) => new URL(name, window.location.href).href
      });
    }
    return __webpWasmPromise ? await __webpWasmPromise : null;
  }
  async function encodeWebpLocal(source, options, borders, exif, progress2, budget, signal, force512 = false) {
    const still = options.still || !source.animated;
    const maximum2 = options.preset === "maxima";
    const light = options.preset === "leve";
    const limit = budget ?? (force512 ? (still ? 95e3 : 47e4) : (maximum2 ? LIMIT : stickerUploadLimit(!still)));
    const render = rendererLocal(borders, options);
    const frames = signaturesLocal(source.frames);
    const available = source.length ? (frames.length - 1) / source.length : 1;
    const qBySide = { 512: 75, 448: 72, 384: 68, 320: 64, 256: 60, 192: 55, 160: 52, 128: 48, 96: 45, 64: 40 };
    const comboList = [...combinationsLocal(options.preset, available, options.fps, still, force512)];
    const canCanvasWebp = await supportsCanvasWebp();
    const wasm = canCanvasWebp ? null : await getWebpWasm();
    if (!canCanvasWebp && !wasm) throw new Error("Codificador WebP indisponível neste dispositivo.");

    const sampleCount = Math.min(5, frames.length);
    const sampleFrames = Array.from({ length: sampleCount }, (_, i) => frames[Math.round(i * (frames.length - 1) / Math.max(1, sampleCount - 1))]);
    const avgCache = new Map();

    async function encodeSingleWasm(image, side, q) {
      const ptr = wasm._prepare_encoder(side, 0, 0);
      if (!ptr) throw new Error("Falha ao iniciar libwebp WASM.");
      try {
        const rgba = render(image, side).context.getImageData(0, 0, side, side).data;
        wasm.HEAPU8.set(rgba, ptr);
        if (!wasm._append_frame(0, q, 0, 0, 0)) throw new Error("Falha ao codificar quadro WebP.");
        const outPtr = wasm._finish_encoder(1);
        if (!outPtr) throw new Error("Falha ao finalizar quadro WebP.");
        return wasm.HEAPU8.slice(outPtr, outPtr + wasm._output_size());
      } finally {
        wasm._release_encoder();
      }
    }

    async function avgFrameBytes(side, q) {
      const k = side + ":" + q;
      if (avgCache.has(k)) return avgCache.get(k);
      let sum = 0;
      for (const frame of sampleFrames) {
        signal.throwIfAborted();
        if (canCanvasWebp) {
          const blob = await render(frame.image, side).toWebpBlob(q / 100);
          sum += blob.size;
        } else {
          const b = await encodeSingleWasm(frame.image, side, q);
          sum += b.length;
        }
      }
      const avg = sum / sampleFrames.length;
      avgCache.set(k, avg);
      return avg;
    }

    async function encodeAll(plan, side, quality) {
      if (canCanvasWebp) {
        const encoded = [];
        for (let i = 0; i < plan.length; i++) {
          signal.throwIfAborted();
          const frame = plan[i];
          const blob = await render(frame.image, side).toWebpBlob(quality / 100);
          encoded.push({ bytes: new Uint8Array(await blob.arrayBuffer()), duration: frame.duration });
          if (i % 12 === 0) {
            progress2("Codificando " + side + " px (" + (i + 1) + " de " + plan.length + ")…", 0.45 + 0.48 * (i + 1) / plan.length);
            await yieldUi();
          }
        }
        return withExif(still ? encoded[0].bytes : animationFallback(encoded, side), exif, side);
      }
      const ptr = wasm._prepare_encoder(side, Number(!still), 0);
      if (!ptr) throw new Error("Não foi possível iniciar o WebP em WASM.");
      try {
        for (let i = 0; i < plan.length; i++) {
          signal.throwIfAborted();
          const frame = plan[i];
          const rgba = render(frame.image, side).context.getImageData(0, 0, side, side).data;
          wasm.HEAPU8.set(rgba, ptr);
          if (!wasm._append_frame(frame.timestamp, quality, 0, 0, 0)) {
            throw new Error("Erro ao codificar quadro WebP em WASM.");
          }
          if (i % 8 === 0) {
            progress2("Codificando " + side + " px (" + (i + 1) + " de " + plan.length + ")…", 0.45 + 0.48 * (i + 1) / plan.length);
            await yieldUi();
          }
        }
        const final = plan.at(-1);
        const outPtr = wasm._finish_encoder(final.timestamp + final.duration);
        if (!outPtr) throw new Error("Erro ao finalizar WebP em WASM.");
        return withExif(wasm.HEAPU8.slice(outPtr, outPtr + wasm._output_size()), exif, side);
      } finally {
        wasm._release_encoder();
      }
    }

    progress2("Escolhendo resolução e qualidade…", 0.36);
    const safeLimit = limit * 0.94;
    let chosen = null;
    for (const { side, fps } of comboList) {
      signal.throwIfAborted();
      const plan = scheduleLocal(frames, fps, source.length);
      const qHi = light ? Math.min(68, qBySide[side] || 55) : maximum2 ? Math.min(88, (qBySide[side] || 60) + 12) : (qBySide[side] || 60);
      const qLo = force512 ? 10 : (side <= 128 ? 14 : 20);
      const avgHi = await avgFrameBytes(side, qHi);
      const estHi = (avgHi + 32) * plan.length + exif.length + 128;
      if (estHi <= safeLimit) {
        chosen = { side, fps, plan, quality: qHi, qLo };
        break;
      }
      const avgLo = await avgFrameBytes(side, qLo);
      const estLo = (avgLo + 32) * plan.length + exif.length + 128;
      if (estLo <= safeLimit) {
        const t = avgHi > avgLo ? (safeLimit - exif.length - 128 - (avgLo + 32) * plan.length) / ((avgHi - avgLo) * plan.length) : 0;
        const qEst = Math.max(qLo, Math.min(qHi, Math.round(qLo + Math.max(0, Math.min(1, t)) * (qHi - qLo))));
        chosen = { side, fps, plan, quality: qEst, qLo };
        break;
      }
    }
    if (!chosen) {
      const last = comboList.at(-1);
      chosen = { side: last.side, fps: last.fps, plan: scheduleLocal(frames, last.fps, source.length), quality: 15, qLo: 10 };
    }
    let { side, fps, plan, quality, qLo } = chosen;
    let bytes = await encodeAll(plan, side, quality);
    if (bytes.length > limit) {
      const ratio = limit / bytes.length;
      const nextQ = Math.max(qLo, Math.min(quality - 8, Math.floor(quality * ratio * 0.85)));
      if (nextQ < quality) {
        quality = nextQ;
        bytes = await encodeAll(plan, side, quality);
      }
    }
    if (bytes.length > limit) {
      const idx = comboList.findIndex((c) => c.side === side && c.fps === fps);
      for (let i = Math.max(0, idx + 1); i < comboList.length && bytes.length > limit; i++) {
        side = comboList[i].side;
        fps = comboList[i].fps;
        plan = scheduleLocal(frames, fps, source.length);
        quality = force512 ? 12 : (side <= 128 ? 14 : 22);
        bytes = await encodeAll(plan, side, quality);
      }
    }
    if (bytes.length > limit && force512 && quality > 8) {
      quality = 8;
      bytes = await encodeAll(plan, side, quality);
    }
    if (bytes.length > limit) {
      throw new Error("A figurinha ultrapassa o limite para este envio. Reduza o trecho visual ou escolha um enquadramento mais simples.");
    }
    return {
      bytes,
      quality,
      side,
      fps,
      frames: webpChunks(bytes).filter((part) => part.name === "ANMF").length || 1,
      animated: webpChunks(bytes).some((part) => part.name === "ANIM"),
      codec: canCanvasWebp ? "WebP rápido (navegador)" : "libwebp WASM (iOS)",
      score: null
    };
  }
  async function runLocally(data, signal, progress2, existingSource = null) {
    signal.throwIfAborted();
    if (data.what === "measure-audio") return { lufs: loudness(data.pcm), dbtp: truePeak(data.pcm) };
    if (data.what === "audio") {
      const failure = new Error("Modo compatível do editor ativo.");
      failure.name = "WorkerCrashedError";
      throw failure;
    }
    let source = existingSource;
    try {
      if (!source) {
        progress2("Processando no editor (modo compatível)…", 0.08);
        if (data.imageType) source = await decodeImageLocal(data.file, data.range, data.imageType, data.what === "inspect", signal);
        else source = await captureViaVideo(data.file, data.range, data.what === "inspect", signal, progress2, data.options?.fps);
      }
      signal.throwIfAborted();
      const framing = data.framing ?? inspectFramesLocal(source.frames);
      if (data.what === "inspect") return { ...framing, duration: source.duration, animated: source.animated, decoder: source.decoder };
      const exif = await exifFor(data.pack, data.author, data.ogg);
      const options = data.suggestFocus ? { ...data.options, focus: framing.focus } : data.options;
      const webp = await encodeWebpLocal(source, options, framing.borders, exif, progress2, data.budget, signal, data.force512 === true);
      return { webp, framing, duration: source.length, decoder: source.decoder };
    } finally {
      source?.frames.forEach((frame) => frame.image.close());
    }
  }
  function workerTask(data, parent, progress2) {
    return new Promise((resolve, reject) => {
      let worker;
      let workerResponded = false;
      let recoveringLocal = false;
      const controller = new AbortController();
      const signal = controller.signal;
      const timedAudio = data.what === "audio";
      const timer = setTimeout(() => finish(new DOMException(timedAudio ? "A codificação do áudio demorou mais de um minuto." : "O processamento passou de quatro minutos. Reduza o trecho ou use Leve.", "TimeoutError")), timedAudio ? 6e4 : 24e4);
      let ended = false;
      let stage = data.what === "inspect" ? "análise do arquivo" : data.what === "audio" ? "codificação do áudio" : data.what === "measure-audio" ? "medição do áudio" : "preparação da figurinha";
      function finish(error, result) {
        if (ended) return;
        ended = true;
        parent.removeEventListener("abort", cancel);
        clearTimeout(timer);
        controller.abort(error);
        worker?.terminate();
        if (error) {
          const detail = error instanceof Error ? error.message : String(error);
          const file = data.file?.name;
          const wrapped = new Error(`${file ? `Arquivo “${file}” · ` : ""}${stage}: ${detail}`, { cause: error });
          wrapped.name = error?.name || "Error";
          reject(wrapped);
        } else resolve(result);
      }
      function cancel() {
        finish(parent.reason);
      }
      parent.addEventListener("abort", cancel, { once: true });
      if (parent.aborted) {
        cancel();
        return;
      }
      async function recoverLocally(error) {
        if (ended || recoveringLocal) return;
        if (data.what === "audio") {
          finish(error);
          return;
        }
        recoveringLocal = true;
        worker?.terminate();
        worker = void 0;
        if (!workerResponded) workerDisabled = true;
        try {
          stage = "processamento no editor";
          const result = await runLocally(data, signal, progress2);
          finish(null, result);
        } catch (fallbackError) {
          finish(fallbackError);
        }
      }
      if (workerDisabled || typeof Worker !== "function") {
        void recoverLocally(Object.assign(new Error("Worker indisponível."), { name: "WorkerCrashedError" }));
        return;
      }
      function attachWorker() {
        worker.onerror = (event) => {
          event.preventDefault();
          const detail = [
            event.message,
            event.error?.message,
            event.lineno && `linha ${event.lineno}`,
            event.colno && `coluna ${event.colno}`
          ].filter(Boolean).join(" · ");
          const failure = new Error(detail || "O navegador encerrou o Worker antes de concluir a tarefa.", { cause: event.error });
          failure.name = "WorkerCrashedError";
          void recoverLocally(failure);
        };
        worker.onmessageerror = () => {
          const failure = new Error("O navegador não conseguiu ler o resultado do processamento.");
          failure.name = "WorkerCrashedError";
          void recoverLocally(failure);
        };
        worker.onmessage = async ({ data: answer }) => {
          workerResponded = true;
          switch (answer.type) {
            case "progress":
              stage = answer.stage;
              progress2(answer.stage, answer.value);
              break;
            case "fallback":
              try {
                stage = "leitura do vídeo no navegador";
                const source = await captureViaVideo(data.file, data.range, data.what === "inspect", signal, progress2, data.options?.fps);
                if (ended || signal.aborted) {
                  source.frames.forEach((frame) => frame.image.close());
                  break;
                }
                worker.postMessage({ ...data, source }, source.frames.map((frame) => frame.image));
              } catch (error) {
                finish(error);
              }
              break;
            case "done":
              finish(null, answer.result);
              break;
            case "error":
              stage = answer.stage || stage;
              finish(new Error(answer.error));
              break;
            default:
              break;
          }
        };
      }
      try {
        worker = new Worker("media-worker.js");
        attachWorker();
        worker.postMessage(data, data.pcm?.map((channel) => channel.buffer) || []);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        failure.name = "WorkerCrashedError";
        void recoverLocally(failure);
      }
    });
  }
  async function loadAudio(file, signal, knownDuration) {
    if (file.size > FILE_LIMIT || !file.size) throw new Error("Áudio vazio ou maior que 64 MiB.");
    let duration = knownDuration;
    if (!duration) {
      const media2 = await loadMedia(file, "audio", signal);
      try {
        duration = media2.element.duration;
      } finally {
        media2.dispose();
      }
    }
    if (!Number.isFinite(duration) || duration > 120) throw new Error("Use um áudio de até dois minutos.");
    const decoder = new OfflineAudioContext(1, 1, AUDIO_RATE);
    const packed = await file.arrayBuffer();
    signal.throwIfAborted();
    const decoded = await decoder.decodeAudioData(packed);
    signal.throwIfAborted();
    if (!decoded.length || decoded.duration > 120.1 || decoded.numberOfChannels > 8) throw new Error("O áudio ultrapassa o limite de duração ou canais.");
    return decoded;
  }
  function samplesOf(buffer, range) {
    const start = Math.max(0, Math.round(range.start * AUDIO_RATE));
    const end = Math.min(buffer.length, start + Math.round(CLIP_LIMIT * AUDIO_RATE), Math.round(range.end * AUDIO_RATE));
    if (start >= end) throw new Error("O trecho não contém amostras de áudio.");
    if (buffer.numberOfChannels <= 2) {
      return Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice(start, end));
    }
    const left = buffer.getChannelData(0).slice(start, end);
    const right = buffer.getChannelData(1).slice(start, end);
    for (let index = 2; index < buffer.numberOfChannels; index++) {
      const channel = buffer.getChannelData(index).subarray(start, end);
      for (let i = 0; i < left.length; i++) {
        left[i] += channel[i] * 0.35;
        right[i] += channel[i] * 0.35;
      }
    }
    return [left, right];
  }
  function waveform(buffer) {
    const samples = buffer.getChannelData(0);
    return Array.from({ length: 240 }, (_, i) => {
      let peak = 0;
      const start = Math.floor(i * samples.length / 240);
      const end = Math.floor((i + 1) * samples.length / 240);
      const hop = Math.max(1, Math.floor((end - start) / 72));
      for (let offset = start; offset < end; offset += hop) peak = Math.max(peak, Math.abs(samples[offset]));
      return peak;
    });
  }
  async function renderAudio(buffer, range, audioOptions, signal, progress2) {
    let attenuation = 0;
    let lowResourceAudio = workerDisabled;
    const offline = new OfflineAudioContext(1, 1, AUDIO_RATE);
    const encodeLocally = async () => {
      const channels = samplesOf(buffer, range);
      const mono = channels.length === 1 ? channels[0].slice() : Float32Array.from(channels[0], (sample, index) => (sample + channels[1][index]) / 2);
      progress2("Processando o áudio em mono no editor…", 0.24);
      const localResult = await encodeAudio([mono], audioOptions, BRAND.name, attenuation, true, signal);
      localResult.safeAudio = true;
      return localResult;
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      let result;
      if (lowResourceAudio) {
        result = await encodeLocally();
      } else {
        const data = { what: "audio", pcm: samplesOf(buffer, range), audioOptions, attenuation, lowResourceAudio };
        try {
          result = await workerTask(data, signal, progress2);
        } catch (error) {
          if (!["WorkerCrashedError", "TimeoutError"].includes(error.name)) throw error;
          lowResourceAudio = true;
          progress2("O navegador encerrou o Worker. Reprocessando em mono no editor…", 0.24);
          result = await encodeLocally();
        }
      }
      progress2("Conferindo o pico do áudio final…", 0.8);
      const decoded = await offline.decodeAudioData(result.bytes.slice().buffer);
      signal.throwIfAborted();
      if (Math.abs(decoded.duration - result.duration) > 4e-3) throw new Error("A duração do áudio codificado não corresponde ao trecho selecionado.");
      const pcm = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index).slice());
      const measured = { lufs: loudness(pcm), dbtp: truePeak(pcm) };
      if (measured.dbtp <= -1) return { ...result, ...measured, safeAudio: lowResourceAudio };
      attenuation += measured.dbtp + 1.25;
    }
    throw new Error("O pico do áudio final passou do limite. Tente outro trecho ou desative a normalização.");
  }

  // src/editor.js
  var by = (id) => document.getElementById(id);
  var el = Object.fromEntries([...document.querySelectorAll("[id]")].map((node) => [node.id, node]));
  var storageKey = "pulso-preferencias";
  var embedded = Boolean(window.__PULSO_IOS__) || (window.parent !== window && location.ancestorOrigins?.length === 1 && location.ancestorOrigins[0] === WA_ORIGIN);
  var tellPanel = (what, reason) => {
    if (window.__PULSO_IOS__) {
      if (what === "close" && typeof window.__pulsoClosePanel === "function") window.__pulsoClosePanel();
      return;
    }
    if (embedded) window.parent.postMessage({ channel: PANEL_CHANNEL, what, reason }, WA_ORIGIN);
  };
  window.__pulsoOnShow = () => { if (typeof checkCompatibility === "function") checkCompatibility(); };
  window.__pulsoOnHide = () => {
    if (el && el.player) el.player.pause();
    if (typeof media !== "undefined" && media instanceof HTMLVideoElement) media.pause();
  };
  var defaults = {
    mode: "cortar",
    remove: true,
    normalize: true,
    trim: false,
    voice: false,
    preset: "equilibrado",
    fps: 0,
    still: false,
    tone: "auto",
    destination: "encaminhar",
    pack: "",
    author: ""
  };
  var enums = {
    mode: ["cortar", "ajustar", "esticar"],
    preset: ["maxima", "equilibrado", "leve"],
    tone: ["auto", "claro", "escuro"],
    destination: ["encaminhar", "salvar"],
    fps: [0, 30, 24, 20, 15, 10, 5]
  };
  var preferences = { ...defaults };
  var jobs = [];
  var active = null;
  var operation;
  var step = 1;
  var media;
  var previewFrame = 0;
  var drag;
  var audioTimeline = false;
  var cachedAudio;
  var dark = matchMedia("(prefers-color-scheme: dark)");
  var fmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  var sec = (time) => fmt.format(time) + " s";
  var kb = (bytes) => fmt.format(bytes / 1e3) + " kB";
  var zeroRect = { x: 0, y: 0, width: 1, height: 1 };
  var friendly = (error) => error?.message || "Ocorreu um erro ao ler o arquivo. Tente novamente.";
  document.title = BRAND.name + " · Editor de figurinhas";
  el.nome.textContent = BRAND.name + " · " + BRAND.version;
  el.marca.src = BRAND.icon + ".svg";
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  var path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  svg.append(path);
  el["icone-arquivo"].append(svg);
  function status(text2, error = false) {
    if (el.status.textContent !== text2) el.status.textContent = text2;
    el.status.dataset.error = error;
  }
  function progress(text2, value) {
    const batch = operation?.batch;
    if (batch?.total) {
      status("Figurinha " + (batch.index + 1) + " de " + batch.total + " · " + text2);
      value = (batch.index + value) / batch.total;
    } else {
      status(text2);
    }
    el.progresso.value = Math.max(el.progresso.value, value);
  }
  function setStep(value, focus = false) {
    step = value;
    for (const button of document.querySelectorAll("[data-step]")) {
      const selected = Number(button.dataset.step) === value;
      if (selected) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      by("etapa-" + button.dataset.step).hidden = !selected;
    }
    renderControls();
    if (focus) {
      const heading = by("etapa-" + value).querySelector("h2");
      heading.tabIndex = -1;
      heading.focus();
    }
  }
  function save(changes) {
    preferences = { ...preferences, ...changes };
    chrome.storage.local.set({ [storageKey]: preferences }).catch(() => {
    });
  }
  function refreshTone() {
    const tone = preferences.tone;
    document.querySelector(".phone").dataset.tone = tone === "auto" ? dark.matches ? "escuro" : "claro" : tone;
    drawWaveform();
  }
  function renderControls() {
    const busy = !!operation;
    const ready = !!active?.inspected && !busy;
    document.querySelectorAll(".settings input,.settings select,.settings button,.timeline input").forEach((control) => {
      control.disabled = busy || !ready && !!control.closest(".step:not(#etapa-1)");
    });
    for (const button of document.querySelectorAll("[data-step]")) button.disabled = busy || !ready && button.dataset.step !== "1";
    el.automatico.disabled = !ready;
    el.voltar.disabled = busy || step === 1;
    el.proximo.disabled = !ready || step === 5;
    el["pre-ouvir"].disabled = !ready || active?.sound === "mudo";
    el["baixar-webp"].disabled = !ready || !active?.result;
    el["baixar-ogg"].disabled = !ready || !active?.audio;
    el.zoom.disabled = !ready || active?.options.mode !== "cortar";
    el.foco.disabled = el.zoom.disabled;
    el.desfazer.disabled = !ready || !active?.options.remove;
    el.progresso.hidden = !operation?.cancelable;
    el.cancelar.hidden = !operation?.cancelable;
    el.cancelar.textContent = operation?.batch ? "Parar fila" : "Cancelar";
    el["acoes-fila"].hidden = !jobs.length;
    el["enviar-fila"].disabled = busy || !jobs.some(batchEligible);
    if (el["enviar-fila-pacote"]) {
      el["enviar-fila-pacote"].hidden = !window.__PULSO_IOS__;
      el["enviar-fila-pacote"].disabled = busy || !jobs.length;
      el["enviar-fila-pacote"].textContent = `📦 Pacote da fila (${jobs.length}) · sem login`;
    }
    if (el["enviar-pacote"]) {
      el["enviar-pacote"].hidden = !window.__PULSO_IOS__;
      el["enviar-pacote"].disabled = !ready;
    }
    const pending = jobs.filter(batchEligible).length;
    const uncertain = jobs.filter((job) => job.deliveryUncertain).length;
    el["enviar-fila"].textContent = pending ? `🔊 Enviar fila com som · ${pending}` : uncertain ? `Confira ${uncertain} no WhatsApp` : "Fila enviada";
    el.resultado.dataset.drag = ready && active.options.mode === "cortar";
  }
  async function perform(task, cancelable = true, batch = false) {
    if (operation) return;
    const controller = new AbortController();
    operation = { controller, cancelable, batch: batch ? {} : null };
    el.progresso.value = 0;
    progress("Preparando…", 0.02);
    renderControls();
    try {
      await task(controller.signal);
    } catch (error) {
      status(controller.signal.aborted ? "Processamento cancelado. Você pode tentar novamente." : friendly(error), !controller.signal.aborted);
    } finally {
      operation = null;
      renderControls();
    }
  }
  function clearResult(job) {
    if (job.result?.url) URL.revokeObjectURL(job.result.url);
    job.result = null;
  }
  function clearAudio(job) {
    if (job.audio?.url) URL.revokeObjectURL(job.audio.url);
    job.audio = null;
    clearResult(job);
  }
  function releaseJob(job) {
    clearAudio(job);
    if (job.extraUrl) URL.revokeObjectURL(job.extraUrl);
    URL.revokeObjectURL(job.url);
  }
  function refreshQueue() {
    el["total-fila"].textContent = jobs.length + " de " + QUEUE_LIMIT;
    const rows = jobs.map((job) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const note = job.delivered ? "Enviada" : job.deliveryUncertain ? "Confira o envio no WhatsApp" : job.batchError;
      button.textContent = (job.delivered ? "✓ " : note ? "⚠ " : "") + job.file.name;
      button.title = note ? job.file.name + " · " + note : job.file.name;
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(job === active));
      button.addEventListener("click", () => activate(job));
      const detail = document.createElement("span");
      detail.className = "queue-note";
      detail.textContent = note || "";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remover " + job.file.name);
      remove.addEventListener("click", () => removeJob(job));
      item.append(button, remove, detail);
      return item;
    });
    el.fila.replaceChildren(...rows);
    renderControls();
  }
  function setOptions(job) {
    el.modo.value = job.options.mode;
    el.bordas.checked = job.options.remove;
    el.zoom.value = job.options.zoom;
    el["zoom-valor"].value = fmt.format(job.options.zoom) + "×";
    el.som.value = job.sound;
    el["som-extra"].hidden = job.sound !== "extra";
    el["faixa-nome"].textContent = job.extra?.name || (job.sound === "mudo" ? "A figurinha será criada sem áudio." : "");
    el.normalizar.checked = job.audioOptions.normalize;
    el.silencio.checked = job.audioOptions.trim;
    el.voz.checked = job.audioOptions.voice;
    el.preset.value = job.options.preset;
    el.fps.value = job.options.fps;
    el.fixa.checked = job.options.still;
    el.pacote.value = job.pack;
    el.autor.value = job.author;
    const border = job.framing?.borders;
    el["bordas-info"].textContent = border ? border.width < 0.99 || border.height < 0.99 ? "Bordas detectadas em amostras do arquivo." : "Nenhuma borda removível detectada." : "Aguardando análise das bordas.";
    el["arquivo-info"].textContent = job.file.name + " · " + kb(job.file.size) + (job.duration ? " · " + sec(job.duration) : "");
    if (media instanceof HTMLVideoElement) media.muted = job.sound !== "original";
    renderControls();
  }
  function updatePreview() {
    const result = active?.result;
    const audio = active?.audio;
    const previewAudioUrl = audio?.url || (active?.sound === "extra" ? active.extraUrl : active?.sound === "original" && !active.imageType ? active.url : null);
    for (const id of ["webp", "celular-webp"]) {
      const image = by(id);
      if (result) {
        if (image.getAttribute("src") !== result.url) image.src = result.url;
      } else image.removeAttribute("src");
      image.hidden = !result;
    }
    for (const id of ["rascunho", "celular-canvas"]) by(id).hidden = !media || !!result;
    el["resultado-vazio"].hidden = !!media || !!result;
    el["celular-vazio"].hidden = !!media || !!result;
    const playerUrl = previewAudioUrl ? new URL(previewAudioUrl, location.href).href : "";
    if (playerUrl && el.player.src !== playerUrl) {
      el.player.pause();
      el.player.src = previewAudioUrl;
    }
    if (!playerUrl && el.player.getAttribute("src")) {
      el.player.pause();
      el.player.removeAttribute("src");
      el.player.load();
    }
    el["previa-audio"].hidden = !previewAudioUrl;
    el["rotulo-audio"].textContent = audio ? "Áudio processado" : active?.sound === "extra" ? "Áudio selecionado" : "Áudio do vídeo";
    el["tamanho-webp"].value = result?.bytes.length || 0;
    el["tamanho-ogg"].value = audio?.bytes.length || 0;
    el["peso-webp"].value = (result ? kb(result.bytes.length) : "—") + " / 1 MB";
    el["peso-ogg"].value = (audio ? kb(audio.bytes.length) : "—") + " / 1 MB";
    const audioInfo = audio || (active?.sound === "extra" ? active.extraAudioInfo : active?.originalAudioInfo);
    el["audio-info"].textContent = audioInfo ? [
      sec(audioInfo.duration),
      audioInfo.channels === 2 ? "estéreo" : "mono",
      audio?.safeAudio ? "modo compatível" : "",
      audio ? Number.isFinite(audio.lufs) ? fmt.format(audio.lufs) + " LUFS" : "abaixo do limiar de medição" : "áudio de origem",
      audio ? Number.isFinite(audio.dbtp) ? fmt.format(audio.dbtp) + " dBTP" : "silêncio" : ""
    ].filter(Boolean).join(" · ") : "";
    el.medicao.textContent = result ? [
      result.codec,
      result.side + " px de detalhe",
      result.animated ? sec(result.duration) + " · " + result.frames + " quadros" : "estática",
      result.score ? "SSIM " + result.score.ssim.toFixed(3).replace(".", ",") + " · PSNR " + (Number.isFinite(result.score.psnr) ? fmt.format(result.score.psnr) : "∞") + " dB" : "Métrica visual indisponível"
    ].join(" · ") : "";
    renderDraft();
    renderControls();
  }
  function showOriginal(job) {
    if (media instanceof HTMLVideoElement) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    el.player.pause();
    el.original.replaceChildren();
    if (!job) {
      media = null;
      const span = document.createElement("span");
      span.textContent = "Escolha um arquivo";
      el.original.append(span);
      return;
    }
    media = document.createElement(job.imageType ? "img" : "video");
    if (job.imageType) media.alt = "Arquivo original";
    else {
      media.controls = true;
      media.muted = job.sound !== "original";
      media.playsInline = true;
      media.preload = "auto";
      media.setAttribute("aria-label", "Vídeo original");
    }
    for (const event of ["load", "loadeddata", "seeked", "timeupdate", "play", "pause"]) media.addEventListener(event, renderDraft);
    media.src = job.url;
    el.original.append(media);
  }
  function sourceSize() {
    return media ? [media.videoWidth ?? media.naturalWidth, media.videoHeight ?? media.naturalHeight] : [0, 0];
  }
  function renderDraft() {
    cancelAnimationFrame(previewFrame);
    if (!active || !media || active.result) return;
    const [width, height] = sourceSize();
    if (!width || !height || media instanceof HTMLVideoElement && media.readyState < 2) return;
    const canvas = el.rascunho;
    const phone = el["celular-canvas"];
    const { source: s, target: t } = geometry(width, height, active.framing?.borders ?? zeroRect, active.options, 512);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, 512, 512);
    ctx.drawImage(media, s.x, s.y, s.width, s.height, t.x, t.y, t.width, t.height);
    const mobile = phone.getContext("2d");
    mobile.clearRect(0, 0, phone.width, phone.height);
    mobile.drawImage(canvas, 0, 0, phone.width, phone.height);
    if (media instanceof HTMLVideoElement && !media.paused) previewFrame = requestAnimationFrame(renderDraft);
  }
  function timelineInfo() {
    if (audioTimeline && active?.sound === "extra" && active.extraLength) {
      return { range: active.extraRange, length: active.extraLength, caption: "Trecho do áudio separado", wave: active.extraWave };
    }
    return {
      range: active?.range,
      length: active?.duration,
      caption: active?.wave ? "Trecho visual e áudio" : "Trecho visual",
      wave: active?.wave
    };
  }
  function drawWaveform() {
    const { range, wave, length } = timelineInfo();
    if (!range || !length) return;
    const canvas = el.onda;
    const ctx = canvas.getContext("2d");
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue("--accent");
    const sub = style.getPropertyValue("--sub");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = style.getPropertyValue("--tint");
    ctx.fillRect(canvas.width * range.start / length, 0, canvas.width * (range.end - range.start) / length, canvas.height);
    if (!wave) {
      ctx.fillStyle = sub;
      ctx.fillRect(0, canvas.height / 2, canvas.width, 1);
      return;
    }
    const bar = canvas.width / wave.length;
    wave.forEach((peak, i) => {
      const scaled = Math.max(2, canvas.height * Math.sqrt(peak) * 0.9);
      const time = i / wave.length * length;
      ctx.fillStyle = time >= range.start && time <= range.end ? accent : sub;
      ctx.fillRect(i * bar, (canvas.height - scaled) / 2, Math.max(1, bar - 1), scaled);
    });
  }
  function refreshTimeline() {
    const { range, length, caption } = timelineInfo();
    el.timeline.hidden = !range || !length;
    el["trilha-extra"].hidden = !(active?.sound === "extra" && active.extraLength && active.duration);
    el["tempo-alvo"].checked = audioTimeline;
    if (el.timeline.hidden) return;
    el["timeline-titulo"].textContent = caption;
    el.inicio.max = el.fim.max = length;
    el.inicio.value = range.start;
    el.fim.value = range.end;
    el["tempo-inicio"].value = sec(range.start);
    el["tempo-fim"].value = sec(range.end);
    el.inicio.setAttribute("aria-valuetext", sec(range.start));
    el.fim.setAttribute("aria-valuetext", sec(range.end));
    el.tempo.value = sec(range.end - range.start) + " de " + sec(length);
    drawWaveform();
  }
  function rangeChange(which) {
    if (!active || operation) return;
    const { range, length } = timelineInfo();
    if (!range || !length) return;
    const min = Math.min(length, 0.1);
    const value = Number(by(which).value);
    if (which === "inicio") {
      range.start = clamp(value, 0, Math.max(0, range.end - min));
      if (range.end - range.start > CLIP_LIMIT) range.end = range.start + CLIP_LIMIT;
    } else {
      range.end = clamp(value, Math.min(length, range.start + min), length);
      if (range.end - range.start > CLIP_LIMIT) range.start = range.end - CLIP_LIMIT;
    }
    if (!audioTimeline && media instanceof HTMLVideoElement && media.readyState >= 1) media.currentTime = Math.max(0, Math.min(length - 1e-3, range.start));
    if (audioTimeline || active.sound === "original") clearAudio(active);
    else clearResult(active);
    refreshTimeline();
    updatePreview();
  }
  async function readAudio(job, signal) {
    if (job.sound === "mudo" || job.sound === "original" && job.imageType) return null;
    const file = job.sound === "extra" ? job.extra : job.file;
    if (!file) throw new Error("Escolha a faixa de áudio separada.");
    if (cachedAudio?.file === file) return cachedAudio.buffer;
    let buffer;
    try {
      buffer = await loadAudio(file, signal, job.sound === "original" ? job.duration : void 0);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error(`Não foi possível decodificar “${file.name}”. ${error.message}`);
    }
    cachedAudio = { file, buffer };
    const info = { duration: buffer.duration, channels: buffer.numberOfChannels };
    if (job.sound === "extra") job.extraAudioInfo = info;
    else job.originalAudioInfo = info;
    return buffer;
  }
  async function analyze(job, signal) {
    let visualDuration;
    if (!job.imageType) {
      try {
        visualDuration = (await videoMetadata(job.file, signal)).duration;
      } catch {
        signal.throwIfAborted();
      }
    }
    const end = Math.min(CLIP_LIMIT, visualDuration ?? CLIP_LIMIT);
    const framing = await workerTask({ what: "inspect", file: job.file, imageType: job.imageType, range: { start: 0, end } }, signal, progress);
    job.duration = visualDuration ?? framing.duration;
    job.range = { start: 0, end: job.duration ? Math.min(job.duration, CLIP_LIMIT) : 0.1 };
    job.framing = framing;
    job.options.focus = framing.focus;
    if (!job.imageType && job.sound === "original" && job.duration <= 120) {
      try {
        job.wave = waveform(await readAudio(job, signal));
      } catch {
        signal.throwIfAborted();
      }
    }
    job.inspected = true;
    setOptions(job);
    refreshTimeline();
    updatePreview();
    status("Arquivo pronto para ajustar. Você também pode usar Automático.");
  }
  function activate(job) {
    if (operation) return;
    if (active !== job) {
      active = job;
      cachedAudio = void 0;
      audioTimeline = !job.duration && !!job.extraLength;
      showOriginal(job);
    }
    setOptions(job);
    refreshTimeline();
    updatePreview();
    refreshQueue();
    if (!job.inspected) return perform((signal) => analyze(job, signal));
    status(job.result ? "Figurinha pronta para conferir, baixar ou enviar." : "Arquivo selecionado.");
  }
  function removeJob(job) {
    if (operation) return;
    const index = jobs.indexOf(job);
    if (index < 0) return;
    jobs.splice(index, 1);
    releaseJob(job);
    if (active === job) {
      active = null;
      cachedAudio = void 0;
      audioTimeline = false;
      if (jobs.length) activate(jobs[Math.min(index, jobs.length - 1)]);
      else {
        showOriginal(null);
        el["arquivo-info"].textContent = "";
        setStep(1);
        refreshTimeline();
        updatePreview();
        status("Escolha um arquivo para começar.");
      }
    }
    refreshQueue();
  }
  function queueBytes(except) {
    return jobs.reduce((total, job) => total + job.file.size + (job === except ? 0 : job.extra?.size || 0), 0);
  }
  function addFiles(files) {
    if (operation) return;
    const added = [];
    let rejected = 0;
    for (const file of files) {
      const type = imageType(file);
      if (!file.size || file.size > FILE_LIMIT || !type && !isVideo(file) || jobs.length >= QUEUE_LIMIT || queueBytes() + file.size > QUEUE_BYTES) {
        rejected++;
        continue;
      }
      const job = {
        file,
        imageType: type,
        url: URL.createObjectURL(file),
        options: {
          mode: preferences.mode,
          remove: preferences.remove,
          zoom: 1,
          focus: { x: 0.5, y: 0.5 },
          preset: preferences.preset,
          fps: preferences.fps,
          still: preferences.still
        },
        audioOptions: { normalize: preferences.normalize, trim: preferences.trim, voice: preferences.voice },
        sound: type ? "mudo" : "original",
        pack: preferences.pack,
        author: preferences.author
      };
      jobs.push(job);
      added.push(job);
    }
    refreshQueue();
    if (added.length) {
      setStep(1);
      Promise.resolve(activate(added[0])).then(() => {
        if (rejected && added[0].inspected) status("Alguns arquivos ficaram fora da fila por formato, tamanho ou limite da fila.", true);
      });
    } else if (rejected) status("Nenhum arquivo aceito. Confira o formato, o limite de 64 MiB e o tamanho da fila.", true);
  }
  async function prepareAudio(job, signal, allowMissing) {
    if (job.audio || job.sound === "mudo") return;
    let audio;
    try {
      audio = await readAudio(job, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (job.sound === "extra" || !allowMissing) {
        throw new Error(job.sound === "extra" && !job.extra ? error.message : `${error.message} Escolha um áudio separado ou selecione Sem som.`);
      }
      job.audioWarning = true;
    }
    if (!audio) return;
    const range = job.sound === "extra" ? job.extraRange : job.range;
    const rendered = await renderAudio(audio, range, job.audioOptions, signal, progress);
    job.audioWarning = false;
    job.audio = { ...rendered, url: URL.createObjectURL(new Blob([rendered.bytes], { type: "audio/ogg; codecs=opus" })) };
  }
  async function prepare(job, signal, automatic = false, inBatch = false, budget, force512 = false) {
    if (!job.range) {
      if (!job.imageType) {
        try {
          job.duration = (await videoMetadata(job.file, signal)).duration;
        } catch {
          signal.throwIfAborted();
        }
      }
      job.range = { start: 0, end: Math.min(CLIP_LIMIT, job.duration || CLIP_LIMIT) };
    }
    if (automatic) {
      Object.assign(job.options, {
        mode: "cortar",
        remove: true,
        zoom: 1,
        focus: job.framing?.focus || job.options.focus,
        fps: 0,
        still: false
      });
      clearResult(job);
      if (!job.audioOptions.normalize) {
        job.audioOptions.normalize = true;
        clearAudio(job);
      }
      if (!inBatch) {
        setOptions(job);
        updatePreview();
      }
    }
    if (!force512) {
      await prepareAudio(job, signal, true);
      cachedAudio = void 0;
      if (inBatch && job.audioWarning && job.sound !== "mudo") {
        throw new Error("Áudio do vídeo ilegível. Escolha Sem som ou uma faixa separada.");
      }
    }
    const suggestFocus = !job.framing;
    let videoRange = !force512 && job.sound === "original" && job.audio?.duration
      ? {
          start: job.range.start + (job.audio.offset || 0),
          end: Math.min(job.duration || job.range.end, job.range.start + (job.audio.offset || 0) + job.audio.duration)
        }
      : job.range;
    if (force512 && videoRange.end - videoRange.start > 9.5) {
      videoRange = { start: videoRange.start, end: videoRange.start + 9.5 };
    }
    const answer = await workerTask({
      what: "encode",
      file: job.file,
      imageType: job.imageType,
      range: videoRange,
      options: budget || force512 ? { ...job.options, preset: "equilibrado" } : job.options,
      suggestFocus,
      budget,
      force512,
      pack: job.pack,
      author: job.author,
      ogg: force512 ? null : (job.audio?.bytes ?? null)
    }, signal, progress);
    signal.throwIfAborted();
    clearResult(job);
    job.metadataDirty = false;
    job.result = {
      ...answer.webp,
      duration: answer.duration,
      decoder: answer.decoder,
      url: URL.createObjectURL(new Blob([answer.webp.bytes], { type: "image/webp" }))
    };
    if (suggestFocus) job.options.focus = answer.framing.focus;
    job.framing = { ...answer.framing, focus: job.framing?.focus ?? answer.framing.focus };
    if (job === active) updatePreview();
    refreshQueue();
    if (!inBatch) {
      const audioMessage = job.audioWarning && !job.audio ? " O áudio do vídeo não pôde ser lido. Escolha uma faixa separada ou Sem som." : "";
      setStep(5, true);
      status("Figurinha pronta · " + answer.decoder + " · " + answer.webp.codec + "." + audioMessage);
    }
  }
  async function retag(job) {
    if (!job.result || !job.metadataDirty) return;
    const result = job.result;
    const exif = await exifFor(job.pack, job.author, job.audio?.bytes ?? null);
    if (job.result !== result) return;
    const bytes = withExif(result.bytes, exif);
    if (bytes.length > LIMIT) {
      clearResult(job);
      if (active === job) updatePreview();
      throw new Error("Os novos metadados ultrapassaram o limite. Prepare a figurinha novamente.");
    }
    URL.revokeObjectURL(result.url);
    result.bytes = bytes;
    result.url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
    if (active === job) updatePreview();
    job.metadataDirty = false;
  }
  async function checkCompatibility() {
    el.rever.disabled = true;
    el.compatibilidade.textContent = "Verificando o WhatsApp Web…";
    try {
      const result = await within(chrome.runtime.sendMessage({ channel: "pulso-editor", what: "status" }), 5e3, "O autoteste demorou demais.");
      const level = result.level || "incompativel";
      const titles = { compativel: "Compatível", parcial: "Parcial", incompativel: "WhatsApp (som) desconectado" };
      el.compatibilidade.dataset.level = level;
      if (window.__PULSO_IOS__ && level === "incompativel") {
        el.compatibilidade.textContent = "WhatsApp (som) desconectado · Use Pacote (sem login) ou conecte seu número.";
      } else {
        el.compatibilidade.textContent = titles[level] + " · " + result.detail;
      }
      if (el["conectar-wa"]) el["conectar-wa"].hidden = !(window.__PULSO_IOS__ && level === "incompativel");
    } catch (error) {
      el.compatibilidade.dataset.level = "incompativel";
      el.compatibilidade.textContent = window.__PULSO_IOS__
        ? "WhatsApp (som) desconectado · Use Pacote (sem login) ou conecte seu número."
        : "Incompatível · " + friendly(error);
      if (el["conectar-wa"]) el["conectar-wa"].hidden = !window.__PULSO_IOS__;
    } finally {
      el.rever.disabled = false;
    }
  }
  async function buildTrayPngBase64(webpUrl) {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 96;
    const ctx = c.getContext("2d");
    try {
      const img = new Image();
      img.src = webpUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      ctx.clearRect(0, 0, 96, 96);
      ctx.drawImage(img, 0, 0, 96, 96);
    } catch {
      ctx.fillStyle = "#6137a4";
      ctx.fillRect(0, 0, 96, 96);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 46px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P", 48, 50);
    }
    return c.toDataURL("image/png").split(",")[1];
  }
  async function sendJobsAsPack(targetJobs, signal) {
    if (typeof window.__pulsoExportStickerPack !== "function") {
      throw new Error("Exportação de pacote disponível apenas no app Pulso iOS.");
    }
    if (!targetJobs.length) throw new Error("Escolha ao menos um vídeo ou imagem primeiro.");
    const list = targetJobs.slice(0, 30);
    if (operation?.batch) operation.batch.total = list.length;
    for (const [index, job] of list.entries()) {
      signal.throwIfAborted();
      if (operation?.batch) operation.batch.index = index;
      const r = job.result;
      const needsPackEncode = !r || r.side !== 512 || r.bytes.length > (r.animated ? 485e3 : 98e3) || (r.animated && r.duration > 9.8);
      if (needsPackEncode) {
        progress("Preparando 512×512 para pacote (" + job.file.name + ")…", 0.1);
        await prepare(job, signal, false, true, null, true);
      }
    }
    signal.throwIfAborted();
    const isAnimatedPack = list.some((j) => j.result?.animated);
    progress("Montando pacote para o WhatsApp…", 0.92);
    const stickers = [];
    for (const job of list) {
      let bytes = job.result.bytes;
      if (isAnimatedPack && !job.result.animated) {
        bytes = animationFallback([{ bytes, duration: 500 }, { bytes, duration: 500 }], 512);
      }
      stickers.push({ webpBase64: toBase64(bytes), emojis: ["🔥"] });
    }
    const trayPngBase64 = await buildTrayPngBase64(list[0].result.url);
    const packName = (active?.pack || preferences.pack || "Pulso Stickers").trim() || "Pulso Stickers";
    const publisher = (active?.author || preferences.author || "Pulso").trim() || "Pulso";
    const resp = await window.__pulsoExportStickerPack({
      name: packName,
      publisher,
      animated: isAnimatedPack,
      trayPngBase64,
      stickers
    });
    if (!resp?.ok) throw new Error(resp?.detail || "Não foi possível abrir o WhatsApp para importar o pacote.");
    status(resp.detail || "Pacote enviado para o WhatsApp! Toque em Salvar no WhatsApp.");
  }
  async function prepareForSend(job, signal) {
    await retag(job);
    while (job.result.bytes.length > stickerUploadLimit(job.result.animated)) {
      const budget = stickerUploadLimit(job.result.animated);
      await prepare(job, signal, false, true, budget);
    }
  }
  async function sendPrepared(job, forward) {
    if (job.audioWarning && job.sound !== "mudo") throw new Error("Escolha Sem som ou prepare uma faixa separada antes de enviar.");
    if (job.sentResult === job.result) throw new Error("Essa figurinha já foi salva na sua conversa.");
    progress("Enviando para a sua conversa…", 0.95);
    let result;
    try {
      result = await within(chrome.runtime.sendMessage({ channel: "pulso-editor", what: "send", payload: {
        webp: toBase64(job.result.bytes),
        ogg: job.audio ? toBase64(job.audio.bytes) : null,
        duration: job.audio ? Math.max(1, Math.round(job.audio.duration)) : 0,
        animated: job.result.animated,
        side: job.result.side || SIDE,
        forward
      } }), 155e3, "O envio demorou demais. Confira sua conversa antes de repetir.");
    } catch (error) {
      job.deliveryUncertain = true;
      refreshQueue();
      throw error;
    }
    if (!result?.ok) {
      if (!result || result.detailCode === "incerto") job.deliveryUncertain = true;
      refreshQueue();
      throw new Error(result?.detail || "O WhatsApp não confirmou o envio.");
    }
    job.sentResult = job.result;
    job.delivered = true;
    job.deliveryUncertain = false;
    job.batchError = "";
    refreshQueue();
    return result;
  }
  async function send(job, signal) {
    if (!job.result) {
      await prepare(job, signal);
      status("Confira a prévia e clique em Enviar pelo WhatsApp para confirmar.");
      return;
    }
    await prepareForSend(job, signal);
    signal.throwIfAborted();
    operation.cancelable = false;
    renderControls();
    const result = await sendPrepared(job, preferences.destination === "encaminhar");
    status(result.detail);
    if (result.detailCode === "encaminhar") tellPanel("close", "encaminhar");
  }
  var batchEligible = (job) => !job.delivered && !job.deliveryUncertain;
  async function sendQueue(signal) {
    const pending = jobs.filter(batchEligible);
    operation.batch.total = pending.length;
    let sent = 0;
    let invalid = 0;
    let sendError;
    for (const [index, job] of pending.entries()) {
      if (signal.aborted) break;
      operation.batch.index = index;
      progress("Preparando " + job.file.name + "…", 0.02);
      try {
        if (!job.result) await prepare(job, signal, false, true);
        await prepareForSend(job, signal);
        if (job.audioWarning && job.sound !== "mudo") throw new Error("Áudio ilegível. Escolha Sem som ou uma faixa separada.");
      } catch (error) {
        if (signal.aborted) break;
        job.batchError = friendly(error);
        invalid++;
        refreshQueue();
        continue;
      }
      if (signal.aborted) break;
      try {
        await sendPrepared(job, false);
        sent++;
        if (index + 1 < pending.length && !signal.aborted) {
          progress("Aguardando WhatsApp antes da próxima figurinha…", 0.98);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      } catch (error) {
        sendError = friendly(error);
        job.batchError = sendError;
        invalid++;
        refreshQueue();
        if (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
    }
    const summary = sent + " de " + pending.length + " figurinhas enviadas para a sua conversa.";
    if (signal.aborted) status(summary + " Fila interrompida.");
    else if (invalid || sendError) status(summary + " Confira os avisos nos itens da fila.", true);
    else status(summary);
  }
  function download(url, suffix) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = active.file.name.replace(/\.[^.]+$/, "") + "." + suffix;
    anchor.click();
  }
  function framingChange(change) {
    if (!active || operation) return;
    change(active.options);
    clearResult(active);
    setOptions(active);
    updatePreview();
  }
  function pan(deltaX, deltaY) {
    const [w, h] = sourceSize();
    if (!w || !h) return;
    framingChange((options) => {
      const { source } = geometry(w, h, active.framing?.borders ?? zeroRect, options, 512);
      options.focus = {
        x: clamp((source.x + source.width / 2) / w + deltaX * source.width / w, 0, 1),
        y: clamp((source.y + source.height / 2) / h + deltaY * source.height / h, 0, 1)
      };
    });
  }
  el.resultado.addEventListener("pointerdown", (event) => {
    if (!active?.inspected || active.options.mode !== "cortar" || operation) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    el.resultado.setPointerCapture(event.pointerId);
  });
  el.resultado.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    const size = el.resultado.clientWidth || 1;
    pan((drag.x - event.clientX) / size, (drag.y - event.clientY) / size);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) el.resultado.addEventListener(event, () => {
    drag = null;
  });
  el.resultado.addEventListener("keydown", (event) => {
    if (!active?.inspected || active.options.mode !== "cortar" || operation) return;
    const moves = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (!Object.hasOwn(moves, event.key)) return;
    event.preventDefault();
    const [dx, dy] = moves[event.key];
    pan(dx * (event.shiftKey ? 0.12 : 0.035), dy * (event.shiftKey ? 0.12 : 0.035));
  });
  for (const button of document.querySelectorAll("[data-step]")) button.addEventListener("click", () => setStep(Number(button.dataset.step), true));
  el.voltar.addEventListener("click", () => setStep(step - 1, true));
  el.proximo.addEventListener("click", () => setStep(step + 1, true));
  el.arquivo.addEventListener("change", () => {
    addFiles([...el.arquivo.files]);
    el.arquivo.value = "";
  });
  el.soltar.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!operation) el.soltar.classList.add("dragging");
  });
  el.soltar.addEventListener("dragleave", () => el.soltar.classList.remove("dragging"));
  el.soltar.addEventListener("drop", (event) => {
    event.preventDefault();
    el.soltar.classList.remove("dragging");
    addFiles([...event.dataTransfer.files]);
  });
  for (const event of ["dragover", "drop"]) document.addEventListener(event, (e) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  });
  document.addEventListener("paste", (event) => {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      addFiles([...event.clipboardData.files]);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (operation?.cancelable) operation.controller.abort();
      else if (!operation) tellPanel("close");
    }
    if (event.ctrlKey && event.key === "Enter" && active?.inspected && !operation && !event.repeat) {
      event.preventDefault();
      perform((signal) => prepare(active, signal, true));
    }
  });
  el.cancelar.addEventListener("click", () => operation?.controller.abort());
  el["fechar-painel"].addEventListener("click", () => tellPanel("close"));
  window.addEventListener("message", (event) => {
    if (!embedded || event.source !== window.parent || event.origin !== WA_ORIGIN || event.data?.channel !== PANEL_CHANNEL || event.data.what !== "hidden") return;
    el.player.pause();
    if (media instanceof HTMLVideoElement) media.pause();
  });
  el.rever.addEventListener("click", checkCompatibility);
  if (el["conectar-wa"]) {
    el["conectar-wa"].addEventListener("click", () => {
      if (typeof window.__pulsoOpenWhatsAppLogin === "function") window.__pulsoOpenWhatsAppLogin(true);
    });
  }
  el.automatico.addEventListener("click", () => perform((signal) => prepare(active, signal, true)));
  el.preparar.addEventListener("click", () => perform((signal) => prepare(active, signal)));
  if (el["enviar-pacote"]) {
    el["enviar-pacote"].addEventListener("click", () => perform((signal) => sendJobsAsPack(active ? [active] : [], signal)));
  }
  if (el["enviar-fila-pacote"]) {
    el["enviar-fila-pacote"].addEventListener("click", () => perform((signal) => sendJobsAsPack(jobs, signal), true, true));
  }
  el.enviar.addEventListener("click", () => {
    const prepared = active?.result;
    const needsEncoding = !prepared || prepared.bytes.length > stickerUploadLimit(prepared.animated);
    perform((signal) => send(active, signal), needsEncoding);
  });
  el["enviar-fila"].addEventListener("click", () => perform(sendQueue, true, true));
  el["baixar-webp"].addEventListener("click", () => perform(async () => {
    await retag(active);
    if (active.result) {
      download(active.result.url, "webp");
      status("WebP salvo pelo navegador.");
    }
  }, false));
  el["baixar-ogg"].addEventListener("click", () => {
    if (active?.audio) download(active.audio.url, "ogg");
  });
  el["pre-ouvir"].addEventListener("click", () => perform(async (signal) => {
    await prepareAudio(active, signal, false);
    updatePreview();
    status("Áudio processado. Use o player na prévia para ouvir.");
    el.player.focus();
  }));
  el.modo.addEventListener("change", () => {
    save({ mode: el.modo.value });
    framingChange((options) => {
      options.mode = el.modo.value;
    });
  });
  el.bordas.addEventListener("change", () => {
    save({ remove: el.bordas.checked });
    framingChange((options) => {
      options.remove = el.bordas.checked;
    });
  });
  el.desfazer.addEventListener("click", () => {
    save({ remove: false });
    framingChange((options) => {
      options.remove = false;
    });
  });
  el.foco.addEventListener("click", () => framingChange((options) => {
    options.focus = active.framing.focus;
  }));
  el.zoom.addEventListener("input", () => framingChange((options) => {
    options.zoom = Number(el.zoom.value);
  }));
  el.inicio.addEventListener("input", () => rangeChange("inicio"));
  el.fim.addEventListener("input", () => rangeChange("fim"));
  el["tempo-alvo"].addEventListener("change", () => {
    audioTimeline = el["tempo-alvo"].checked;
    refreshTimeline();
  });
  el.som.addEventListener("change", () => {
    active.sound = el.som.value;
    active.audioWarning = false;
    audioTimeline = active.sound === "extra" && !active.duration && !!active.extraLength;
    clearAudio(active);
    setOptions(active);
    refreshTimeline();
    updatePreview();
  });
  el.faixa.addEventListener("change", () => {
    const file = el.faixa.files[0];
    el.faixa.value = "";
    if (!file || !active) return;
    if (queueBytes(active) + file.size > QUEUE_BYTES) {
      status("A fila já atingiu o limite total de arquivos. Remova um arquivo antes de adicionar este áudio.", true);
      return;
    }
    perform(async (signal) => {
      const buffer = await loadAudio(file, signal);
      if (active.extraUrl) URL.revokeObjectURL(active.extraUrl);
      active.extra = file;
      active.extraAudioInfo = { duration: buffer.duration, channels: buffer.numberOfChannels };
      active.extraUrl = URL.createObjectURL(file);
      active.extraLength = buffer.duration;
      active.extraRange = { start: 0, end: Math.min(CLIP_LIMIT, buffer.duration) };
      active.extraWave = waveform(buffer);
      cachedAudio = { file, buffer };
      audioTimeline = true;
      clearAudio(active);
      setOptions(active);
      refreshTimeline();
      updatePreview();
      status("Faixa separada carregada. Ajuste o trecho na prévia.");
    });
  });
  for (const [id, key] of [["normalizar", "normalize"], ["silencio", "trim"], ["voz", "voice"]]) {
    by(id).addEventListener("change", () => {
      const value = by(id).checked;
      save({ [key]: value });
      active.audioOptions[key] = value;
      clearAudio(active);
      updatePreview();
    });
  }
  for (const [id, key] of [["preset", "preset"], ["fps", "fps"], ["fixa", "still"]]) {
    by(id).addEventListener("change", () => {
      const input = by(id);
      const value = id === "fixa" ? input.checked : id === "fps" ? Number(input.value) : input.value;
      save({ [key]: value });
      framingChange((options) => {
        options[key] = value;
      });
    });
  }
  for (const [id, key] of [["pacote", "pack"], ["autor", "author"]]) {
    by(id).addEventListener("change", () => {
      const job = active;
      job[key] = by(id).value;
      save({ [key]: job[key] });
      job.metadataDirty = true;
    });
  }
  el.destino.addEventListener("change", () => save({ destination: el.destino.value }));
  el["tema-celular"].addEventListener("change", () => {
    save({ tone: el["tema-celular"].value });
    refreshTone();
  });
  dark.addEventListener("change", refreshTone);
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    operation?.controller.abort();
    for (const job of jobs) releaseJob(job);
  });
  renderControls();
  chrome.storage.local.get(storageKey).then((result) => {
    const value = result[storageKey] || {};
    preferences = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
      key,
      enums[key] ? enums[key].includes(value[key]) ? value[key] : fallback : typeof value[key] === typeof fallback ? typeof fallback === "string" ? value[key].slice(0, 128) : value[key] : fallback
    ]));
    el.destino.value = preferences.destination;
    el["tema-celular"].value = preferences.tone;
    refreshTone();
  }).catch(refreshTone);
  if (embedded) {
    tellPanel("ready");
    checkCompatibility();
  } else {
    const notice = document.createElement("p");
    notice.className = "open-in-whatsapp";
    notice.textContent = "Abra o WhatsApp Web e clique no Pulso no canto da página.";
    document.body.replaceChildren(notice);
  }
})();
