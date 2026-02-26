import { InlineKeyboard } from "grammy";

export const LUX = {
  brand: "𝐈𝐌𝐀𝐆𝐄 𝐒𝐓𝐔𝐃𝐈𝐎 ✨",
  received: "✅ **Received.** Your image is locked in the Studio vault.",
  processing: "🔄 **Processing…**\n`Optimizing pixels • balancing quality • preparing delivery`",
  noImage: "Send an image first (Photo or File) — then I’ll unlock the Studio.",
  canceled: "❌ **Canceled.** Studio reset. Send a new image.",
  cleared: "🧹 **Cleared.** Send a new image to begin.",
  tips:
    "Tip: Send as **File** for best quality (Document). Photos may be pre-compressed by Telegram."
};

export function kbHome() {
  return new InlineKeyboard()
    .text("✨ Quick Optimize", "q:quick").row()
    .text("🎯 Compress to Size", "c:ask_target").text("🧪 Compare Modes", "q:compare").row()
    .text("🎛 Pro Studio", "p:studio").row()
    .text("🖼 Resize", "p:resize").text("✂️ Crop", "p:crop").row()
    .text("🔁 Convert", "p:convert").text("🔃 Rotate", "p:rotate").row()
    .text("🖋 Watermark", "p:watermark").text("🫧 Blur", "p:blur").row()
    .text("🆕 New Task", "nav:new").text("❌ Cancel", "nav:cancel");
}

export function kbStudio(s) {
  const p = s.pro;
  const meta = p.keepMeta ? "ON" : "OFF";
  const prog = p.progressive ? "ON" : "OFF";
  const mj = p.mozjpeg ? "ON" : "OFF";
  const fmt = p.outFormat.toUpperCase();
  const target = p.targetKB ? `${p.targetKB}KB` : "OFF";
  const resize = p.maxW ? `${p.maxW}px` : "OFF";

  return new InlineKeyboard()
    .text(`Format: ${fmt}`, "set:fmt").row()
    .text(`Quality: ${p.quality}`, "set:quality").row()
    .text(`Target: ${target}`, "set:target").text(`MaxW: ${resize}`, "set:maxw").row()
    .text(`Metadata: ${meta}`, "tog:meta").text(`Progressive: ${prog}`, "tog:prog").row()
    .text(`MozJPEG: ${mj}`, "tog:moz").text(`Chroma: ${p.chroma}`, "set:chroma").row()
    .text("✅ Apply", "do:apply").row()
    .text("⬅️ Back", "nav:home").text("🆕 New Task", "nav:new").row()
    .text("❌ Cancel", "nav:cancel");
}

export function kbBackHome() {
  return new InlineKeyboard().text("⬅️ Back to Panel", "nav:home").text("❌ Cancel", "nav:cancel");
}

export function formatStats({ beforeKB, afterKB, savedPct, dimsBefore, dimsAfter, fmt }) {
  const b = beforeKB.toLocaleString();
  const a = afterKB.toLocaleString();
  const d1 = dimsBefore ? `${dimsBefore.w}×${dimsBefore.h}` : "—";
  const d2 = dimsAfter ? `${dimsAfter.w}×${dimsAfter.h}` : "—";
  return (
    `✨ **Delivered.**\n` +
    `**Format:** ${fmt.toUpperCase()}\n` +
    `**Size:** ${b} KB → ${a} KB (**${savedPct}% saved**)\n` +
    `**Resolution:** ${d1} → ${d2}`
  );
}

export function studioCard(s) {
  const p = s.pro;
  return (
    `🎛 **Pro Studio Settings**\n` +
    `• Format: **${p.outFormat.toUpperCase()}**\n` +
    `• Quality: **${p.quality}**\n` +
    `• Target: **${p.targetKB ? `${p.targetKB} KB` : "OFF"}**\n` +
    `• Max Width: **${p.maxW ? `${p.maxW}px` : "OFF"}**\n` +
    `• Metadata: **${p.keepMeta ? "KEEP" : "STRIP"}**\n` +
    `• Progressive: **${p.progressive ? "ON" : "OFF"}**\n` +
    `• MozJPEG: **${p.mozjpeg ? "ON" : "OFF"}**\n` +
    `• Chroma: **${p.chroma}**`
  );
    }
