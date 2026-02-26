import { Bot, session } from "grammy";
import { LUX, kbHome, kbStudio, kbBackHome, formatStats, studioCard } from "./ui.js";
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
  readMeta
} from "./imageOps.js";

function initialSessionFactory() {
  const def = (process.env.DEFAULT_FORMAT || "webp").toLowerCase();
  const outFormat = def === "jpg" ? "jpeg" : def === "jpeg" ? "jpeg" : def === "png" ? "png" : "webp";
  return {
    fileId: null,
    fileName: "image.jpg",
    mime: "image/jpeg",
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

  bot.use(session({ initial: initialSessionFactory }));

  bot.command("start", async (ctx) => {
    ctx.session = initialSessionFactory();
    await ctx.reply(
      `${LUX.brand}\n\nSend an image (Photo or File).\nThen use the luxury panel below.\n\n• Input limit: ${MAX_INPUT_MB} MB\n• Output limit: ${MAX_OUTPUT_MB} MB\n\n${LUX.tips}`,
      { parse_mode: "Markdown", reply_markup: kbHome() }
    );
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply(`${LUX.brand}\nChoose an action:`, { parse_mode: "Markdown", reply_markup: kbHome() });
  });

  // --- Receive Photo ---
  bot.on("message:photo", async (ctx) => {
    const best = ctx.message.photo.at(-1);
    ctx.session.fileId = best.file_id;
    ctx.session.fileName = "photo.jpg";
    ctx.session.awaiting = null;
    await ctx.reply(LUX.received, { parse_mode: "Markdown", reply_markup: kbHome() });
  });

  // --- Receive Document (best quality) ---
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("image/")) return ctx.reply("Please send an image file (JPG/PNG/WEBP).");
    if (doc.file_size && doc.file_size > MAX_INPUT_BYTES) {
      return ctx.reply(`That file is too large. Max input is ${MAX_INPUT_MB} MB.`);
    }
    ctx.session.fileId = doc.file_id;
    ctx.session.fileName = doc.file_name || "image";
    ctx.session.awaiting = null;
    await ctx.reply(LUX.received, { parse_mode: "Markdown", reply_markup: kbHome() });
  });

  // --- Callback router ---
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    // NAV
    if (data === "nav:home") return showHome(ctx);
    if (data === "nav:new") return doClear(ctx, true);
    if (data === "nav:cancel") return doCancel(ctx);

    // Requires image
    if (!ctx.session.fileId) {
      return ctx.reply(LUX.noImage, { parse_mode: "Markdown", reply_markup: kbHome() });
    }
    if (ctx.session.busy) {
      return ctx.reply("⏳ Studio is working… please wait a moment.", { reply_markup: kbHome() });
    }

    // QUICK
    if (data === "q:quick") return doQuick(ctx, MAX_OUTPUT_BYTES);
    if (data === "q:compare") return doCompare(ctx, MAX_OUTPUT_BYTES);

    // COMPRESS ASK TARGET (your requirement)
    if (data === "c:ask_target") {
      ctx.session.awaiting = "compress_target";
      return ctx.reply(
        "🎯 **Compress to Size**\nSend target size like:\n• `300KB`\n• `1MB`\n• `750 kb`\n\nI will auto-adjust quality to reach it (best possible).",
        { parse_mode: "Markdown", reply_markup: kbBackHome() }
      );
    }

    // PRO STUDIO
    if (data === "p:studio") {
      return ctx.reply(`${studioCard(ctx.session)}`, { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }

    // Tools that need text input
    if (data === "p:resize") {
      ctx.session.awaiting = "resize_wh";
      return ctx.reply("🖼 **Resize**\nSend: `width height`\nExample: `1080 0` (auto height)\nExample: `1080 1080`", {
        parse_mode: "Markdown",
        reply_markup: kbBackHome()
      });
    }
    if (data === "p:crop") {
      ctx.session.awaiting = "crop_xywh";
      return ctx.reply("✂️ **Crop**\nSend: `left top width height`\nExample: `50 50 400 400`", {
        parse_mode: "Markdown",
        reply_markup: kbBackHome()
      });
    }
    if (data === "p:convert") {
      ctx.session.awaiting = "convert_fmt";
      return ctx.reply("🔁 **Convert**\nSend format: `jpg` / `png` / `webp`", {
        parse_mode: "Markdown",
        reply_markup: kbBackHome()
      });
    }
    if (data === "p:rotate") {
      ctx.session.awaiting = "rotate_angle";
      return ctx.reply("🔃 **Rotate**\nSend angle: `90` / `180` / `270`", {
        parse_mode: "Markdown",
        reply_markup: kbBackHome()
      });
    }
    if (data === "p:watermark") {
      ctx.session.awaiting = "watermark_text";
      return ctx.reply("🖋 **Watermark**\nSend watermark text (example: `Sai Shaik`)", {
        parse_mode: "Markdown",
        reply_markup: kbBackHome()
      });
    }
    if (data === "p:blur") {
      ctx.session.awaiting = "blur_sigma";
      return ctx.reply("🫧 **Blur**\nSend blur strength `1-20` (example: `6`)", {
        parse_mode: "Markdown",
        reply_markup: kbBackHome()
      });
    }

    // Pro studio setters
    if (data === "set:fmt") {
      ctx.session.awaiting = "studio_fmt";
      return ctx.reply("Send format: `jpeg` / `webp` / `png`", { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }
    if (data === "set:quality") {
      ctx.session.awaiting = "studio_quality";
      return ctx.reply("Send quality `10-95` (example: `78`)", { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }
    if (data === "set:target") {
      ctx.session.awaiting = "studio_target";
      return ctx.reply("Send target size like `300KB` or `1MB` or `OFF`", { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }
    if (data === "set:maxw") {
      ctx.session.awaiting = "studio_maxw";
      return ctx.reply("Send max width in pixels like `1280` or `0` to disable", { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }
    if (data === "set:chroma") {
      ctx.session.awaiting = "studio_chroma";
      return ctx.reply("Send chroma: `4:2:0` or `4:4:4`", { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }
    if (data === "tog:meta") {
      ctx.session.pro.keepMeta = !ctx.session.pro.keepMeta;
      return ctx.reply(studioCard(ctx.session), { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }
    if (data === "tog:prog") {
      ctx.session.pro.progressive = !ctx.session.pro.progressive;
      return ctx.reply(studioCard(ctx.session), { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }
    if (data === "tog:moz") {
      ctx.session.pro.mozjpeg = !ctx.session.pro.mozjpeg;
      return ctx.reply(studioCard(ctx.session), { parse_mode: "Markdown", reply_markup: kbStudio(ctx.session) });
    }

    if (data === "do:apply") {
      return doApplyPro(ctx, MAX_OUTPUT_BYTES);
    }

    return ctx.reply("Unknown action.", { reply_markup: kbHome() });
  });

  // --- Text input handler for all wizards ---
  bot.on("message:text", async (ctx) => {
    if (!ctx.session.awaiting) return;

    if (!ctx.session.fileId) {
      ctx.session.awaiting = null;
      return ctx.reply(LUX.noImage, { parse_mode: "Markdown", reply_markup: kbHome() });
    }
    if (ctx.session.busy) return ctx.reply("⏳ Studio is working… please wait.");

    const step = ctx.session.awaiting;
    const text = ctx.message.text.trim();

    try {
      // COMPRESS TO TARGET (main requirement)
      if (step === "compress_target") {
        const targetKB = parseSizeToKB(text);
        if (!targetKB || targetKB < 30) return ctx.reply("Send valid target like `300KB` or `1MB`.", { parse_mode: "Markdown" });

        ctx.session.pro.targetKB = targetKB;
        // choose best default format for target-size: WEBP is best
        ctx.session.pro.outFormat = "webp";
        ctx.session.awaiting = null;
        return doApplyPro(ctx, MAX_OUTPUT_BYTES, { forceCaption: `🎯 Target: ${targetKB}KB` });
      }

      // Resize
      if (step === "resize_wh") {
        const [wRaw, hRaw] = text.split(/\s+/);
        const w = parseInt(wRaw, 10);
        const h = parseInt(hRaw, 10);
        const width = Number.isFinite(w) ? (w === 0 ? null : w) : null;
        const height = Number.isFinite(h) ? (h === 0 ? null : h) : null;
        ctx.session.awaiting = null;

        const inputBuffer = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

        const out = await resizeImage(inputBuffer, { width, height, fit: "inside" });
        return sendOutput(ctx, inputBuffer, out, "resized.jpg", "image/jpeg", MAX_OUTPUT_BYTES);
      }

      // Crop
      if (step === "crop_xywh") {
        const [l, t, w, h] = text.split(/\s+/).map((n) => parseInt(n, 10));
        if (![l, t, w, h].every(Number.isFinite)) return ctx.reply("Send: `left top width height`", { parse_mode: "Markdown" });
        ctx.session.awaiting = null;

        const inputBuffer = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

        const out = await cropImage(inputBuffer, { left: l, top: t, width: w, height: h });
        return sendOutput(ctx, inputBuffer, out, "cropped.jpg", "image/jpeg", MAX_OUTPUT_BYTES);
      }

      // Convert
      if (step === "convert_fmt") {
        const fmt = text.toLowerCase();
        const norm = fmt === "jpg" ? "jpeg" : fmt;
        if (!["jpeg", "png", "webp"].includes(norm)) return ctx.reply("Use: `jpg` / `png` / `webp`", { parse_mode: "Markdown" });
        ctx.session.awaiting = null;

        const inputBuffer = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

        const out = await convertImage(inputBuffer, { format: norm, quality: 88 });
        const name = norm === "png" ? "converted.png" : norm === "webp" ? "converted.webp" : "converted.jpg";
        const mime = norm === "png" ? "image/png" : norm === "webp" ? "image/webp" : "image/jpeg";
        return sendOutput(ctx, inputBuffer, out, name, mime, MAX_OUTPUT_BYTES);
      }

      // Rotate
      if (step === "rotate_angle") {
        const angle = parseInt(text, 10);
        if (![90, 180, 270].includes(angle)) return ctx.reply("Send: `90` / `180` / `270`", { parse_mode: "Markdown" });
        ctx.session.awaiting = null;

        const inputBuffer = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

        const out = await rotateImage(inputBuffer, { angle });
        return sendOutput(ctx, inputBuffer, out, `rotated_${angle}.jpg`, "image/jpeg", MAX_OUTPUT_BYTES);
      }

      // Watermark
      if (step === "watermark_text") {
        const wm = text.slice(0, 50);
        if (!wm) return ctx.reply("Send watermark text.", { parse_mode: "Markdown" });
        ctx.session.awaiting = null;

        const inputBuffer = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

        const out = await watermarkText(inputBuffer, { text: wm, opacity: 0.35, size: 48 });
        return sendOutput(ctx, inputBuffer, out, "watermarked.jpg", "image/jpeg", MAX_OUTPUT_BYTES);
      }

      // Blur
      if (step === "blur_sigma") {
        const sigma = clampInt(parseInt(text, 10), 1, 20, 6);
        ctx.session.awaiting = null;

        const inputBuffer = await downloadTelegramFile(ctx);
        await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

        const out = await blurImage(inputBuffer, { sigma });
        return sendOutput(ctx, inputBuffer, out, `blur_${sigma}.jpg`, "image/jpeg", MAX_OUTPUT_BYTES);
      }

      // Studio setters
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

      // unknown step fallback
      ctx.session.awaiting = null;
      return ctx.reply("✅ Done. Use /menu", { reply_markup: kbHome() });
    } catch (err) {
      ctx.session.awaiting = null;
      return ctx.reply(`❌ Failed: ${err?.message || "Unknown error"}`, { reply_markup: kbHome() });
    }
  });

  // Helpers
  async function showHome(ctx) {
    return ctx.reply(`${LUX.brand}\nChoose an action:`, { parse_mode: "Markdown", reply_markup: kbHome() });
  }

  async function doCancel(ctx) {
    ctx.session.awaiting = null;
    ctx.session.busy = false;
    return ctx.reply(LUX.canceled, { parse_mode: "Markdown", reply_markup: kbHome() });
  }

  async function doClear(ctx, keepPanel = false) {
    ctx.session = initialSessionFactory();
    return ctx.reply(keepPanel ? `${LUX.cleared}\n\n${LUX.brand}` : LUX.cleared, {
      parse_mode: "Markdown",
      reply_markup: kbHome()
    });
  }

  async function doQuick(ctx, maxOutBytes) {
    ctx.session.busy = true;
    try {
      const inputBuffer = await downloadTelegramFile(ctx);
      await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

      const defFmt = (process.env.DEFAULT_FORMAT || "webp").toLowerCase();
      const r = await quickOptimize(inputBuffer, defFmt);
      const outName = r.fmt === "png" ? "optimized.png" : r.fmt === "webp" ? "optimized.webp" : "optimized.jpg";
      const outMime = r.fmt === "png" ? "image/png" : r.fmt === "webp" ? "image/webp" : "image/jpeg";

      await sendOutputWithStats(ctx, inputBuffer, r, outName, outMime, maxOutBytes);
    } finally {
      ctx.session.busy = false;
    }
  }

  async function doCompare(ctx, maxOutBytes) {
    ctx.session.busy = true;
    try {
      const inputBuffer = await downloadTelegramFile(ctx);
      await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

      const results = await compareModes(inputBuffer);

      for (const r of results) {
        const outName = r.fmt === "webp" ? `${r.label}.webp` : `${r.label}.jpg`;
        const outMime = r.fmt === "webp" ? "image/webp" : "image/jpeg";
        await sendOutputWithStats(ctx, inputBuffer, r, outName, outMime, maxOutBytes, `🧪 Mode: **${r.label}**`);
      }
      await ctx.reply("🆕 Want another? Send a new image or use the panel.", { reply_markup: kbHome() });
    } finally {
      ctx.session.busy = false;
    }
  }

  async function doApplyPro(ctx, maxOutBytes, { forceCaption } = {}) {
    ctx.session.busy = true;
    try {
      const inputBuffer = await downloadTelegramFile(ctx);
      await ctx.reply(LUX.processing, { parse_mode: "Markdown" });

      const r = await proCompress(inputBuffer, ctx.session.pro);

      // name & mime
      const outName =
        r.fmt === "png" ? "studio.png" : r.fmt === "webp" ? "studio.webp" : "studio.jpg";
      const outMime =
        r.fmt === "png" ? "image/png" : r.fmt === "webp" ? "image/webp" : "image/jpeg";

      await sendOutputWithStats(ctx, inputBuffer, r, outName, outMime, maxOutBytes, forceCaption);
      await ctx.reply("🎛 Studio ready. You can change settings again or start new task.", { reply_markup: kbHome() });
    } finally {
      ctx.session.busy = false;
    }
  }

  async function sendOutputWithStats(ctx, inputBuffer, r, outName, outMime, maxOutBytes, extraCaption) {
    if (r.outBuffer.length > maxOutBytes) {
      return ctx.reply(
        `⚠️ Output is too large for bot limit (${MAX_OUTPUT_MB}MB). Try:\n• Lower quality\n• Set Target size\n• Set Max width`,
        { reply_markup: kbHome() }
      );
    }

    const cap1 = extraCaption ? `${extraCaption}\n` : "";
    const cap2 = formatStats({
      beforeKB: r.beforeKB,
      afterKB: r.afterKB,
      savedPct: r.savedPct,
      dimsBefore: r.dimsBefore,
      dimsAfter: r.dimsAfter,
      fmt: r.fmt
    });

    await ctx.replyWithDocument(new File([r.outBuffer], outName, { type: outMime }), {
      caption: cap1 + cap2,
      parse_mode: "Markdown",
      reply_markup: kbHome()
    });
  }

  async function sendOutput(ctx, inputBuffer, outBuffer, outName, outMime, maxOutBytes) {
    if (outBuffer.length > maxOutBytes) {
      return ctx.reply(
        `⚠️ Output is too large for bot limit (${MAX_OUTPUT_MB}MB). Try smaller size.`,
        { reply_markup: kbHome() }
      );
    }
    const beforeKB = Math.round(inputBuffer.length / 1024);
    const afterKB = Math.round(outBuffer.length / 1024);
    const dimsBefore = await readMeta(inputBuffer);
    const dimsAfter = await readMeta(outBuffer);
    const savedPct = Math.max(0, Math.round(((beforeKB - afterKB) / beforeKB) * 100));

    await ctx.replyWithDocument(new File([outBuffer], outName, { type: outMime }), {
      caption: formatStats({ beforeKB, afterKB, savedPct, dimsBefore, dimsAfter, fmt: outMime.split("/")[1] }),
      parse_mode: "Markdown",
      reply_markup: kbHome()
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
    // accepts: "300KB", "1MB", "750 kb", "2 mb"
    const s = input.trim().toLowerCase().replace(/\s+/g, "");
    const m = s.match(/^(\d+(?:\.\d+)?)(kb|mb)$/);
    if (!m) return null;
    const value = Number(m[1]);
    const unit = m[2];
    if (!Number.isFinite(value) || value <= 0) return null;
    if (unit === "kb") return Math.round(value);
    if (unit === "mb") ret
