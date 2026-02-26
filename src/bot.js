import { Bot, InputFile, session } from "grammy";
import {
  LUX,
  kbHome,
  kbStudio,
  kbBackHome,
  formatStats,
  studioCard
} from "./ui.js";

import {
  proCompress,
  quickOptimize,
  compareModes,
  resizeImage,
  cropImage,
  rotateImage,
  convertImage,
  watermarkText,
  blurImage,
  readMeta,
  applyFeatureMode
} from "./imageOps.js";

function makeInitialSession() {
  const def = (process.env.DEFAULT_FORMAT || "webp").toLowerCase();
  const outFormat = def === "jpg" ? "jpeg" : def === "jpeg" ? "jpeg" : def === "png" ? "png" : "webp";

  return {
    fileId: null,
    fileName: "image.jpg",
    awaiting: null,
    busy: false,
    pro: {
      outFormat,
      quality: 78,
      keepMeta: false,
      progressive: true,
      mozjpeg: true,
      chroma: "4:2:0",
      maxW: 0,
      targetKB: 0
    }
  };
}

export function buildBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN missing");

  const MAX_INPUT_MB = Number(process.env.MAX_INPUT_MB || 20);
  const MAX_OUTPUT_MB = Number(process.env.MAX_OUTPUT_MB || 45);
  const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
  const MAX_OUTPUT_BYTES = MAX_OUTPUT_MB * 1024 * 1024;

  const bot = new Bot(token);
  bot.use(session({ initial: makeInitialSession }));

  bot.command("start", async (ctx) => {
    ctx.session = makeInitialSession();
    await ctx.reply(
      `${LUX.brand}\n\n1) Send an image (Photo or File).\n2) Wait for \"Image detected successfully\" confirmation.\n3) Tap an action button from the panel.\n\n• Input limit: ${MAX_INPUT_MB} MB\n• Output limit: ${MAX_OUTPUT_MB} MB\n\n${LUX.tips}`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("menu", async (ctx) => {
    return ctx.reply(
      `${LUX.brand}\n${ctx.session.fileId ? "✅ Image loaded. Choose an action below:" : "📥 Send an image first to unlock actions."}`,
      { parse_mode: "Markdown", reply_markup: kbHome(Boolean(ctx.session.fileId)) }
    );
  });

  bot.on("message:photo", async (ctx) => {
    const best = ctx.message.photo.at(-1);
    ctx.session.fileId = best.file_id;
    ctx.session.fileName = "photo.jpg";
    ctx.session.awaiting = null;
    await ctx.reply(LUX.received, { parse_mode: "Markdown", reply_markup: kbHome(true) });
  });

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("image/")) {
      return ctx.reply("Please send an image file (JPG/PNG/WEBP).");
    }
    if (doc.file_size && doc.file_size > MAX_INPUT_BYTES) {
      return ctx.reply(`That file is too large. Max input is ${MAX_INPUT_MB} MB.`);
    }
    ctx.session.fileId = doc.file_id;
    ctx.session.fileName = doc.file_name || "image";
    ctx.session.awaiting = null;
    await ctx.reply(LUX.received, { parse_mode: "Markdown", reply_markup: kbHome(true) });
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    if (data === "nav:home") return showHome(ctx, true);
    if (data === "nav:new") return clearSession(ctx, true);
    if (data === "nav:cancel") return cancel(ctx, true);

    if (!ctx.session.fileId) {
      return showHome(ctx, true, LUX.noImage);
    }
    if (ctx.session.busy) {
      return updatePanel(ctx, "⏳ Studio is working… please wait.", kbHome(true));
    }

    if (data === "q:quick") return doQuick(ctx, MAX_OUTPUT_BYTES);
    if (data === "q:compare") return doCompare(ctx, MAX_OUTPUT_BYTES);

    if (data === "c:ask_target") {
      ctx.session.awaiting = "compress_target";
      return updatePanel(
        ctx,
        "🎯 **Compress to Size**\nSend target size like:\n• `300KB`\n• `1MB`\n• `750 kb`\n\nI will auto-adjust quality to reach it.",
        kbBackHome()
      );
    }

    if (data === "p:studio") {
      return updatePanel(ctx, studioCard(ctx.session), kbStudio(ctx.session));
    }

    if (data === "p:resize") {
      ctx.session.awaiting = "resize_wh";
      return updatePanel(ctx, "🖼 **Resize**\nSend: `width height [mode]`\nExample: `1080 0 balanced`\nModes: `ultra` / `balanced` / `crystal`", kbBackHome());
    }
    if (data === "p:crop") {
      ctx.session.awaiting = "crop_xywh";
      return updatePanel(ctx, "✂️ **Crop**\nSend: `left top width height [mode]`\nExample: `50 50 400 400 ultra`\nModes: `ultra` / `balanced` / `crystal`", kbBackHome());
    }
    if (data === "p:convert") {
      ctx.session.awaiting = "convert_fmt";
      return updatePanel(ctx, "🔁 **Convert**\nSend: `jpg|png|webp [mode]`\nExample: `png crystal`\nModes: `ultra` / `balanced` / `crystal`", kbBackHome());
    }
    if (data === "p:rotate") {
      ctx.session.awaiting = "rotate_angle";
      return updatePanel(ctx, "🔃 **Rotate**\nSend: `90|180|270 [mode]`\nExample: `90 balanced`\nModes: `ultra` / `balanced` / `crystal`", kbBackHome());
    }
    if (data === "p:watermark") {
      ctx.session.awaiting = "watermark_text";
      return updatePanel(ctx, "🖋 **Watermark**\nSend: `text | mode`\nExample: `Sai Shaik | crystal`\nModes: `ultra` / `balanced` / `crystal`", kbBackHome());
    }
    if (data === "p:blur") {
      ctx.session.awaiting = "blur_sigma";
      return updatePanel(ctx, "🫧 **Blur**\nSend: `sigma [mode]`\nExample: `6 ultra`\nModes: `ultra` / `balanced` / `crystal`", kbBackHome());
    }

    if (data === "set:fmt") {
      ctx.session.awaiting = "studio_fmt";
      return updatePanel(ctx, "Send format: `jpeg` / `webp` / `png`", kbStudio(ctx.session));
    }
    if (data === "set:quality") {
      ctx.session.awaiting = "studio_quality";
      return updatePanel(ctx, "Send quality `10-95` (example: `78`)", kbStudio(ctx.session));
    }
    if (data === "set:target") {
      ctx.session.awaiting = "studio_target";
      return updatePanel(ctx, "Send target size: `300KB` / `1MB` or `OFF`", kbStudio(ctx.session));
    }
    if (data === "set:maxw") {
      ctx.session.awaiting = "studio_maxw";
      return updatePanel(ctx, "Send max width in px (example: `1280`) or `0`", kbStudio(ctx.session));
    }
    if (data === "set:chroma") {
      ctx.session.awaiting = "studio_chroma";
      return updatePanel(ctx, "Send chroma: `4:2:0` or `4:4:4`", kbStudio(ctx.session));
    }

    if (data === "tog:meta") {
      ctx.session.pro.keepMeta = !ctx.session.pro.keepMeta;
      return updatePanel(ctx, studioCard(ctx.session), kbStudio(ctx.session));
    }
    if (data === "tog:prog") {
      ctx.session.pro.progressive = !ctx.session.pro.progressive;
      return updatePanel(ctx, studioCard(ctx.session), kbStudio(ctx.session));
    }
    if (data === "tog:moz") {
      ctx.session.pro.mozjpeg = !ctx.session.pro.mozjpeg;
      return updatePanel(ctx, studioCard(ctx.session), kbStudio(ctx.session));
    }

    if (data === "do:apply") {
      return doApplyPro(ctx, MAX_OUTPUT_BYTES);
    }

    return updatePanel(ctx, "Unknown action.", kbHome(Boolean(ctx.session.fileId)));
  });

  bot.on("message:text", async (ctx) => {
    const step = ctx.session.awaiting;
    if (!step) return;

    if (!ctx.session.fileId) {
      ctx.session.awaiting = null;
      return ctx.reply(LUX.noImage, { parse_mode: "Markdown", reply_markup: kbHome(false) });
    }
    if (ctx.session.busy) return ctx.reply("⏳ Studio is working… please wait.");

    const text = ctx.message.text.trim();

    try {
      if (step === "compress_target") {
        const targetKB = parseSizeToKB(text);
        if (!targetKB || targetKB < 30) return ctx.reply("Send valid target like `300KB` or `1MB`.", { parse_mode: "Markdown" });

        ctx.session.pro.targetKB = targetKB;
        ctx.session.pro.outFormat = "webp";
        ctx.session.awaiting = null;
        return doApplyPro(ctx, MAX_OUTPUT_BYTES, `🎯 Target: **${targetKB}KB**`);
      }

      if (step === "resize_wh") {
        const [wRaw, hRaw, modeRaw] = text.split(/\s+/);
        const w = parseInt(wRaw, 10);
        const h = parseInt(hRaw, 10);
        const width = Number.isFinite(w) ? (w === 0 ? null : w) : null;
        const height = Number.isFinite(h) ? (h === 0 ? null : h) : null;
        const mode = parseFeatureMode(modeRaw);

        ctx.session.awaiting = null;
        const input = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });
        const resized = await resizeImage(input, { width, height, fit: "inside" });
        const styled = await applyFeatureMode(resized, mode);
        return sendOutputWithStats(ctx, styled, styled.outName, styled.outMime, MAX_OUTPUT_BYTES, `🎚 Mode: **${styled.mode}**`);
      }

      if (step === "crop_xywh") {
        const [lRaw, tRaw, wRaw, hRaw, modeRaw] = text.split(/\s+/);
        const [l, t, w, h] = [lRaw, tRaw, wRaw, hRaw].map((n) => parseInt(n, 10));
        if (![l, t, w, h].every(Number.isFinite)) return ctx.reply("Send: `left top width height`", { parse_mode: "Markdown" });
        const mode = parseFeatureMode(modeRaw);

        ctx.session.awaiting = null;
        const input = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });
        const cropped = await cropImage(input, { left: l, top: t, width: w, height: h });
        const styled = await applyFeatureMode(cropped, mode);
        return sendOutputWithStats(ctx, styled, styled.outName, styled.outMime, MAX_OUTPUT_BYTES, `🎚 Mode: **${styled.mode}**`);
      }

      if (step === "convert_fmt") {
        const [fmtRaw, modeRaw] = text.split(/\s+/);
        const fmt = (fmtRaw || "").toLowerCase();
        const norm = fmt === "jpg" ? "jpeg" : fmt;
        if (!["jpeg", "png", "webp"].includes(norm)) return ctx.reply("Use: `jpg` / `png` / `webp`", { parse_mode: "Markdown" });
        const mode = parseFeatureMode(modeRaw);

        ctx.session.awaiting = null;
        const input = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });
        const out = await convertImage(input, { format: norm, quality: 88 });
        const styled = await applyFeatureMode(out, mode);
        return sendOutputWithStats(ctx, styled, styled.outName, styled.outMime, MAX_OUTPUT_BYTES, `🎚 Mode: **${styled.mode}**`);
      }

      if (step === "rotate_angle") {
        const [angleRaw, modeRaw] = text.split(/\s+/);
        const angle = parseInt(angleRaw, 10);
        if (![90, 180, 270].includes(angle)) return ctx.reply("Send: `90` / `180` / `270`", { parse_mode: "Markdown" });
        const mode = parseFeatureMode(modeRaw);

        ctx.session.awaiting = null;
        const input = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });
        const rotated = await rotateImage(input, { angle });
        const styled = await applyFeatureMode(rotated, mode);
        return sendOutputWithStats(ctx, styled, styled.outName, styled.outMime, MAX_OUTPUT_BYTES, `🎚 Mode: **${styled.mode}**`);
      }

      if (step === "watermark_text") {
        const [wmRaw, modeRaw] = text.split("|").map((part) => part.trim());
        const wm = (wmRaw || "").slice(0, 50);
        if (!wm) return ctx.reply("Send watermark text.", { parse_mode: "Markdown" });
        const mode = parseFeatureMode(modeRaw);

        ctx.session.awaiting = null;
        const input = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });
        const watermarked = await watermarkText(input, { text: wm, opacity: 0.35, size: 48 });
        const styled = await applyFeatureMode(watermarked, mode);
        return sendOutputWithStats(ctx, styled, styled.outName, styled.outMime, MAX_OUTPUT_BYTES, `🎚 Mode: **${styled.mode}**`);
      }

      if (step === "blur_sigma") {
        const [sigmaRaw, modeRaw] = text.split(/\s+/);
        const sigma = clampInt(parseInt(sigmaRaw, 10), 1, 20, 6);
        const mode = parseFeatureMode(modeRaw);

        ctx.session.awaiting = null;
        const input = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });
        const blurred = await blurImage(input, { sigma });
        const styled = await applyFeatureMode(blurred, mode);
        return sendOutputWithStats(ctx, styled, styled.outName, styled.outMime, MAX_OUTPUT_BYTES, `🎚 Mode: **${styled.mode}**`);
      }

      if (step === "studio_fmt") {
        const f = text.toLowerCase();
        if (!["jpeg", "webp", "png"].includes(f)) return ctx.reply("Send: `jpeg` / `webp` / `png`", { parse_mode: "Markdown" });
        ctx.session.pro.outFormat = f;
        ctx.session.awaiting = null;
        return ctx.reply(studioCard(ctx.session), { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
      }

      if (step === "studio_quality") {
        const q = clampInt(parseInt(text, 10), 10, 95, 78);
        ctx.session.pro.quality = q;
        ctx.session.awaiting = null;
        return ctx.reply(studioCard(ctx.session), { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
      }

      if (step === "studio_target") {
        if (text.toLowerCase() === "off") {
          ctx.session.pro.targetKB = 0;
        } else {
          const targetKB = parseSizeToKB(text);
          if (!targetKB || targetKB < 30) return ctx.reply("Send `300KB` / `1MB` or `OFF`", { parse_mode: "Markdown" });
          ctx.session.pro.targetKB = targetKB;
        }
        ctx.session.awaiting = null;
        return ctx.reply(studioCard(ctx.session), { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
      }

      if (step === "studio_maxw") {
        const mw = parseInt(text, 10);
        if (!Number.isFinite(mw) || mw < 0 || mw > 12000) return ctx.reply("Send a number like `1280` or `0`.", { parse_mode: "Markdown" });
        ctx.session.pro.maxW = mw;
        ctx.session.awaiting = null;
        return ctx.reply(studioCard(ctx.session), { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
      }

      if (step === "studio_chroma") {
        const c = text.trim();
        if (!["4:2:0", "4:4:4"].includes(c)) return ctx.reply("Send `4:2:0` or `4:4:4`", { parse_mode: "Markdown" });
        ctx.session.pro.chroma = c;
        ctx.session.awaiting = null;
        return ctx.reply(studioCard(ctx.session), { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
      }

      ctx.session.awaiting = null;
      return ctx.reply("✅ Done. Use /menu", { reply_markup: kbHome(Boolean(ctx.session.fileId)) });
    } catch (err) {
      ctx.session.awaiting = null;
      return ctx.reply(`❌ Failed: ${err?.message || "Unknown error"}`, { reply_markup: kbHome(Boolean(ctx.session.fileId)) });
    }
  });

  async function updatePanel(ctx, text, replyMarkup) {
    try {
      return await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: replyMarkup
      });
    } catch {
      return ctx.reply(text, { parse_mode: "Markdown", reply_markup: replyMarkup });
    }
  }

  async function showHome(ctx, asEdit = false, header) {
    const text = `${LUX.brand}\n${header || "Choose an action:"}`;
    const markup = kbHome(Boolean(ctx.session.fileId));
    if (asEdit) return updatePanel(ctx, text, markup);
    return ctx.reply(text, { parse_mode: "Markdown", reply_markup: markup });
  }

  async function cancel(ctx, asEdit = false) {
    ctx.session.awaiting = null;
    ctx.session.busy = false;
    const markup = kbHome(Boolean(ctx.session.fileId));
    if (asEdit) return updatePanel(ctx, LUX.canceled, markup);
    return ctx.reply(LUX.canceled, { parse_mode: "Markdown", reply_markup: markup });
  }

  async function clearSession(ctx, asEdit = false) {
    ctx.session = makeInitialSession();
    const msg = `${LUX.cleared}\n\n${LUX.brand}`;
    if (asEdit) return updatePanel(ctx, msg, kbHome(false));
    return ctx.reply(msg, { parse_mode: "Markdown", reply_markup: kbHome(false) });
  }

  async function doQuick(ctx, maxOutBytes) {
    ctx.session.busy = true;
    try {
      const input = await downloadTelegramFile(ctx);
      await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

      const defFmt = (process.env.DEFAULT_FORMAT || "webp").toLowerCase();
      const r = await quickOptimize(input, defFmt);

      const outName = r.fmt === "png" ? "optimized.png" : r.fmt === "webp" ? "optimized.webp" : "optimized.jpg";
      const outMime = r.fmt === "png" ? "image/png" : r.fmt === "webp" ? "image/webp" : "image/jpeg";

      return sendOutputWithStats(ctx, r, outName, outMime, maxOutBytes);
    } finally {
      ctx.session.busy = false;
    }
  }

  async function doCompare(ctx, maxOutBytes) {
    ctx.session.busy = true;
    try {
      const input = await downloadTelegramFile(ctx);
      await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

      const results = await compareModes(input);
      for (const r of results) {
        const outName = r.fmt === "webp" ? `${r.label}.webp` : `${r.label}.jpg`;
        const outMime = r.fmt === "webp" ? "image/webp" : "image/jpeg";
        await sendOutputWithStats(ctx, r, outName, outMime, maxOutBytes, `🧪 Mode: **${r.label}**`);
      }
      await ctx.reply("🆕 Send another image or use the panel.", { reply_markup: kbHome(true) });
    } finally {
      ctx.session.busy = false;
    }
  }

  async function doApplyPro(ctx, maxOutBytes, extraCaption) {
    ctx.session.busy = true;
    try {
      const input = await downloadTelegramFile(ctx);
      await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

      const r = await proCompress(input, ctx.session.pro);
      const outName = r.fmt === "png" ? "studio.png" : r.fmt === "webp" ? "studio.webp" : "studio.jpg";
      const outMime = r.fmt === "png" ? "image/png" : r.fmt === "webp" ? "image/webp" : "image/jpeg";

      return sendOutputWithStats(ctx, r, outName, outMime, maxOutBytes, extraCaption);
    } finally {
      ctx.session.busy = false;
    }
  }

  async function sendOutputWithStats(ctx, r, outName, outMime, maxOutBytes, extraCaption) {
    if (r.outBuffer.length > maxOutBytes) {
      return ctx.reply(
        `⚠️ Output too large (${MAX_OUTPUT_MB}MB limit). Try:\n• Lower quality\n• Set Target size\n• Set Max width`,
        { reply_markup: kbHome(true) }
      );
    }

    const capA = extraCaption ? `${extraCaption}\n` : "";
    const capB = formatStats({
      beforeKB: r.beforeKB,
      afterKB: r.afterKB,
      savedPct: r.savedPct,
      dimsBefore: r.dimsBefore,
      dimsAfter: r.dimsAfter,
      fmt: r.fmt
    });

    await ctx.replyWithDocument(new InputFile(r.outBuffer, outName), {
      caption: capA + capB,
      parse_mode: "Markdown",
      reply_markup: kbHome(true)
    });
  }

  async function sendOutput(ctx, input, out, outName, outMime, maxOutBytes) {
    if (out.length > maxOutBytes) {
      return ctx.reply(`⚠️ Output too large (${MAX_OUTPUT_MB}MB). Try smaller settings.`, { reply_markup: kbHome(true) });
    }

    const beforeKB = Math.round(input.length / 1024);
    const afterKB = Math.round(out.length / 1024);
    const dimsBefore = await readMeta(input);
    const dimsAfter = await readMeta(out);
    const savedPct = Math.max(0, Math.round(((beforeKB - afterKB) / beforeKB) * 100));

    await ctx.replyWithDocument(new InputFile(out, outName), {
      caption: formatStats({
        beforeKB,
        afterKB,
        savedPct,
        dimsBefore,
        dimsAfter,
        fmt: outMime.split("/")[1]
      }),
      parse_mode: "Markdown",
      reply_markup: kbHome(true)
    });
  }

  async function downloadTelegramFile(ctx) {
    const file = await ctx.api.getFile(ctx.session.fileId);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to download file from Telegram.");
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }

  function clampInt(n, min, max, fallback) {
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function parseSizeToKB(input) {
    const s = input.trim().toLowerCase().replace(/\s+/g, "");
    const m = s.match(/^(\d+(?:\.\d+)?)(kb|mb)$/);
    if (!m) return null;
    const value = Number(m[1]);
    const unit = m[2];
    if (!Number.isFinite(value) || value <= 0) return null;
    if (unit === "kb") return Math.round(value);
    if (unit === "mb") return Math.round(value * 1024);
    return null;
  }

  function parseFeatureMode(input) {
    const mode = (input || "balanced").trim().toLowerCase();
    if (["ultra", "balanced", "crystal"].includes(mode)) return mode;
    return "balanced";
  }

  bot.catch((err) => console.error("Bot error:", err));
  return bot;
}
