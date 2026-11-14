// Draws the app icon procedurally and writes every size the PWA needs.
// Run with `npm run icons`. No dependencies: shapes are rasterized with
// supersampling and the PNG files are encoded with Node's zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BACKGROUND = [0x15, 0x19, 0x22];
const ACCENT = [0x7a, 0xa7, 0xff];
const GOOD = [0x3d, 0xdc, 0x84];

// Geometry in a unit square (y grows downwards).
const ARC = { cx: 0.5, cy: 0.66, radius: 0.3, halfAngle: (62 * Math.PI) / 180, width: 0.078 };
const NEEDLE = { x: 0.5, top: 0.33, bottom: 0.66, width: 0.07, pivot: 0.075 };
const SUPERSAMPLING = 4;

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideArc(x, y) {
  const dx = x - ARC.cx;
  const dy = ARC.cy - y;
  const angle = Math.atan2(dx, dy); // 0 points up
  if (Math.abs(angle) <= ARC.halfAngle) {
    return Math.abs(Math.hypot(dx, dy) - ARC.radius) <= ARC.width / 2;
  }
  // Round caps at both ends.
  const end = Math.sign(angle) * ARC.halfAngle;
  const ex = ARC.cx + ARC.radius * Math.sin(end);
  const ey = ARC.cy - ARC.radius * Math.cos(end);
  return Math.hypot(x - ex, y - ey) <= ARC.width / 2;
}

function insideNeedle(x, y) {
  return (
    distanceToSegment(x, y, NEEDLE.x, NEEDLE.top, NEEDLE.x, NEEDLE.bottom) <= NEEDLE.width / 2 ||
    Math.hypot(x - NEEDLE.x, y - NEEDLE.bottom) <= NEEDLE.pivot
  );
}

function insideRoundedSquare(x, y, radius) {
  const qx = Math.abs(x - 0.5) - (0.5 - radius);
  const qy = Math.abs(y - 0.5) - (0.5 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= radius;
}

/**
 * @param size Width and height in pixels.
 * @param cornerRadius Corner radius as a fraction of the size; 0 fills the square.
 * @param scale Size of the artwork relative to the canvas (maskable icons keep
 *              it inside the central safe zone).
 */
function render(size, cornerRadius, scale) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = SUPERSAMPLING * SUPERSAMPLING;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPERSAMPLING; sy++) {
        for (let sx = 0; sx < SUPERSAMPLING; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLING) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLING) / size;
          if (cornerRadius > 0 && !insideRoundedSquare(x, y, cornerRadius)) continue;
          // Artwork coordinates, scaled around the centre.
          const ax = (x - 0.5) / scale + 0.5;
          const ay = (y - 0.5) / scale + 0.5;
          const color = insideNeedle(ax, ay) ? GOOD : insideArc(ax, ay) ? ACCENT : BACKGROUND;
          red += color[0];
          green += color[1];
          blue += color[2];
          alpha += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (alpha > 0) {
        pixels[offset] = Math.round(red / alpha);
        pixels[offset + 1] = Math.round(green / alpha);
        pixels[offset + 2] = Math.round(blue / alpha);
      }
      pixels[offset + 3] = Math.round((255 * alpha) / samples);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (color) => `#${color.map((value) => value.toString(16).padStart(2, '0')).join('')}`;

function faviconSvg() {
  const size = 64;
  const startX = (ARC.cx - ARC.radius * Math.sin(ARC.halfAngle)) * size;
  const endX = (ARC.cx + ARC.radius * Math.sin(ARC.halfAngle)) * size;
  const endsY = (ARC.cy - ARC.radius * Math.cos(ARC.halfAngle)) * size;
  const radius = ARC.radius * size;
  const n = (value) => Number(value.toFixed(2));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${n(size * 0.22)}" fill="${hex(BACKGROUND)}"/>`,
    `<path d="M${n(startX)} ${n(endsY)}A${n(radius)} ${n(radius)} 0 0 1 ${n(endX)} ${n(endsY)}" fill="none" stroke="${hex(ACCENT)}" stroke-width="${n(ARC.width * size)}" stroke-linecap="round"/>`,
    `<path d="M${n(NEEDLE.x * size)} ${n(NEEDLE.bottom * size)}V${n(NEEDLE.top * size)}" fill="none" stroke="${hex(GOOD)}" stroke-width="${n(NEEDLE.width * size)}" stroke-linecap="round"/>`,
    `<circle cx="${n(NEEDLE.x * size)}" cy="${n(NEEDLE.bottom * size)}" r="${n(NEEDLE.pivot * size)}" fill="${hex(GOOD)}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

const publicDir = new URL('../public/', import.meta.url);
mkdirSync(new URL('icons/', publicDir), { recursive: true });

const ICONS = [
  // Regular icons: rounded corners on a transparent canvas.
  { file: 'icons/icon-192.png', size: 192, cornerRadius: 0.22, scale: 1 },
  { file: 'icons/icon-512.png', size: 512, cornerRadius: 0.22, scale: 1 },
  // Maskable icons: full bleed, artwork inside the safe zone.
  { file: 'icons/icon-maskable-192.png', size: 192, cornerRadius: 0, scale: 0.72 },
  { file: 'icons/icon-maskable-512.png', size: 512, cornerRadius: 0, scale: 0.72 },
  // iOS rounds the corners itself and does not support transparency.
  { file: 'apple-touch-icon-180.png', size: 180, cornerRadius: 0, scale: 0.88 },
];

for (const { file, size, cornerRadius, scale } of ICONS) {
  writeFileSync(new URL(file, publicDir), encodePng(size, render(size, cornerRadius, scale)));
  console.log(`wrote public/${file}`);
}
writeFileSync(new URL('favicon.svg', publicDir), faviconSvg());
console.log('wrote public/favicon.svg');
