import sharp from "sharp";

export async function readMeta(inputBuffer) {
  const meta = await sharp(inputBuffer).rotate().metadata();
  return { w: meta.width ?? null, h: meta.height ?? null };
}

export async function proCompress(inputBuffer, pro) {
  const beforeKB = Math.round(inputBuffer.length / 1024);
  const dimsBefore = await readMeta(inputBuffer);

  let img = sharp(inputBuffer).rotate();

  // resize if needed
  if (pro.maxW && pro.maxW > 0) {
    img = img.resize({ width: pro.maxW, withoutEnlargement: true });
  }

  // metadata
  if (pro.keepMeta) img = img.withMetadata();

  let outBuffer;

  // Target size mode (best for jpeg/webp)
  if (pro.targetKB && pro.targetKB > 0 && (pro.outFormat === "jpeg" || pro.outFormat === "webp")) {
    outBuffer = await encodeToTarget(img, pro);
  } else {
    outBuffer = await encode(img, pro, pro.quality);
  }

  const afterKB = Math.round(outBuffer.length / 1024);
  const dimsAfter = await readMeta(outBuffer);
  const savedPct = Math.max(0, Math.round(((beforeKB - afterKB) / beforeKB) * 100));

  return { outBuffer, beforeKB, afterKB, savedPct, dimsBefore, dimsAfter, fmt: pro.outFormat };
}

async function encode(img, pro, quality) {
  if (pro.outFormat === "jpeg") {
    return await img
      .jpeg({
        quality,
        progressive: pro.progressive,
        mozjpeg: pro.mozjpeg,
        chromaSubsampling: pro.chroma
      })
      .toBuffer();
  }
  if (pro.outFormat === "webp") {
    return await img.webp({ quality }).toBuffer();
  }
  if (pro.outFormat === "png") {
    return await img.png({ compressionLevel: 9, palette: true }).toBuffer();
  }
  throw new Error("Unsupported format");
}

async function encodeToTarget(img, pro) {
  const targetBytes = pro.targetKB * 1024;

  let lo = 25;
  let hi = 95;
  let best = null;

  for (let i = 0; i < 7; i++) {
    const mid = Math.round((lo + hi) / 2);
    const out = await encode(img.clone(), pro, mid);

    if (out.length <= targetBytes) {
      best = out; // under target: raise quality
      lo = mid + 1;
    } else {
      hi = mid - 1; // over target: lower quality
    }
  }

  if (!best) return await encode(img, pro, 25);
  return best;
}

export async function quickOptimize(inputBuffer, defaultFormat = "webp") {
  // Premium safe defaults: strip meta, keep original size unless huge
  const pro = {
    outFormat: defaultFormat === "jpeg" ? "jpeg" : defaultFormat,
    quality: 78,
    keepMeta: false,
    progressive: true,
    mozjpeg: true,
    chroma: "4:2:0",
    maxW: 0,
    targetKB: 0
  };
  return await proCompress(inputBuffer, pro);
}

export async function compareModes(inputBuffer) {
  const modes = [
    { label: "Ultra", pro: { outFormat: "webp", quality: 45, keepMeta: false, progressive: true, mozjpeg: true, chroma: "4:2:0", maxW: 1280, targetKB: 0 } },
    { label: "Balanced", pro: { outFormat: "webp", quality: 78, keepMeta: false, progressive: true, mozjpeg: true, chroma: "4:2:0", maxW: 0, targetKB: 0 } },
    { label: "Crystal", pro: { outFormat: "jpeg", quality: 90, keepMeta: false, progressive: true, mozjpeg: true, chroma: "4:4:4", maxW: 0, targetKB: 0 } }
  ];

  const results = [];
  for (const m of modes) {
    const r = await proCompress(inputBuffer, m.pro);
    results.push({ ...r, label: m.label });
  }
  return results;
}

export async function resizeImage(inputBuffer, { width, height, fit = "inside" }) {
  return await sharp(inputBuffer).rotate().resize({ width, height, fit }).toBuffer();
}

export async function cropImage(inputBuffer, { left, top, width, height }) {
  return await sharp(inputBuffer).rotate().extract({ left, top, width, height }).toBuffer();
}

export async function rotateImage(inputBuffer, { angle }) {
  return await sharp(inputBuffer).rotate(angle).toBuffer();
}

export async function convertImage(inputBuffer, { format = "jpeg", quality = 85 }) {
  const img = sharp(inputBuffer).rotate();
  if (format === "jpeg" || format === "jpg") return await img.jpeg({ quality, mozjpeg: true }).toBuffer();
  if (format === "png") return await img.png({ compressionLevel: 9 }).toBuffer();
  if (format === "webp") return await img.webp({ quality }).toBuffer();
  throw new Error("Unsupported convert format");
}

export async function watermarkText(inputBuffer, { text = "Watermark", opacity = 0.35, size = 48 }) {
  const base = sharp(inputBuffer).rotate();
  const meta = await base.metadata();
  const w = meta.width ?? 800;
  const h = meta.height ?? 600;

  const svg = `
  <svg width="${w}" height="${h}">
    <style>
      .t { fill: rgba(255,255,255,${opacity}); font-size: ${size}px; font-family: Arial, sans-serif; }
    </style>
    <text x="${Math.floor(w * 0.06)}" y="${Math.floor(h * 0.92)}" class="t">${escapeXml(text)}</text>
  </svg>`;

  return await base.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toBuffer();
}

export async function blurImage(inputBuffer, { sigma = 6 }) {
  return await sharp(inputBuffer).rotate().blur(sigma).toBuffer();
}

function escapeXml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
