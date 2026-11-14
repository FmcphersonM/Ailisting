// Draws the app icon in the sizes phones ask for. Run: node scripts/make-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../web/public/icons");
fs.mkdirSync(out, { recursive: true });

// A price tag on a green background. "inset" leaves room for round icon masks.
function svg(size, { rounded, inset }) {
  const r = rounded ? size * 0.22 : 0;
  const s = size * inset;
  const o = (size - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="#0d6b4d"/>
    <g transform="translate(${o} ${o}) scale(${s / 100})">
      <path d="M52 16 H80 a4 4 0 0 1 4 4 V48 a6 6 0 0 1 -1.8 4.2 L50.2 84.2 a6 6 0 0 1 -8.4 0 L15.8 58.2 a6 6 0 0 1 0 -8.4 L47.8 17.8 A6 6 0 0 1 52 16 Z" fill="#ffffff"/>
      <circle cx="68" cy="32" r="6.5" fill="#0d6b4d"/>
    </g>
  </svg>`;
}

const jobs = [
  ["icon-192.png", 192, { rounded: true, inset: 0.78 }],
  ["icon-512.png", 512, { rounded: true, inset: 0.78 }],
  ["icon-maskable-512.png", 512, { rounded: false, inset: 0.62 }],
  ["apple-touch-icon.png", 180, { rounded: false, inset: 0.74 }],
];
for (const [name, size, opts] of jobs) {
  await sharp(Buffer.from(svg(size, opts))).png().toFile(path.join(out, name));
  console.log("wrote", name);
}
