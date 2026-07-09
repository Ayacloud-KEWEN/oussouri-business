/**
 * 最小 PNG 编码器 + 鱼子酱风格产品图生成（零依赖，node:zlib）。
 * 用途：演示数据脚本为每个产品生成一张 640×420 的"珠粒"风格图片。
 */
import { deflateSync } from "node:zlib";

// ---------- PNG 编码 ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // 每行前置 filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((v, i) => {
      raw[y * (width * 4 + 1) + 1 + i] = v;
    });
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 鱼子酱图片生成 ----------

export interface CaviarTint {
  /** 珠粒基色 */
  pearl: [number, number, number];
  /** 珠粒高光 */
  highlight: [number, number, number];
}

/** 各品种参考色 */
export const TINTS: Record<string, CaviarTint> = {
  DAU: { pearl: [92, 78, 40], highlight: [201, 165, 92] },      // 帝王金
  SCHDAU: { pearl: [52, 50, 46], highlight: [150, 140, 120] },  // 深褐
  BAE: { pearl: [40, 42, 46], highlight: [120, 130, 145] },     // 青灰
  GUE: { pearl: [80, 60, 35], highlight: [190, 150, 90] },      // 琥珀
  HUS: { pearl: [45, 45, 50], highlight: [170, 170, 185] },     // 铂灰
  DEFAULT: { pearl: [50, 48, 44], highlight: [160, 150, 130] },
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCaviarImage(species: string, seed = 42): Buffer {
  const W = 640;
  const H = 420;
  const tint = TINTS[species] ?? TINTS.DEFAULT!;
  const rand = mulberry32(seed + species.split("").reduce((s, c) => s + c.charCodeAt(0), 0));
  const px = new Uint8Array(W * H * 4);

  // 背景：深海军蓝渐变 + 轻微暗角
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const g = y / H;
      const vign = 1 - 0.5 * Math.hypot((x - W / 2) / W, (y - H / 2) / H);
      px[i] = Math.round((10 + 8 * g) * vign);
      px[i + 1] = Math.round((18 + 10 * g) * vign);
      px[i + 2] = Math.round((34 + 14 * g) * vign);
      px[i + 3] = 255;
    }
  }

  // 珠粒：中央椭圆区域内散布（似罐内俯拍）
  const pearls: { x: number; y: number; r: number }[] = [];
  for (let attempt = 0; attempt < 4000 && pearls.length < 520; attempt += 1) {
    const angle = rand() * Math.PI * 2;
    const rad = Math.sqrt(rand());
    const x = W / 2 + Math.cos(angle) * rad * 250;
    const y = H / 2 + Math.sin(angle) * rad * 160;
    const r = 5 + rand() * 4;
    if (pearls.every((p) => Math.hypot(p.x - x, p.y - y) > (p.r + r) * 0.82)) {
      pearls.push({ x, y, r });
    }
  }
  for (const p of pearls) {
    const shade = 0.82 + rand() * 0.36;
    for (let dy = -p.r; dy <= p.r; dy += 1) {
      for (let dx = -p.r; dx <= p.r; dx += 1) {
        const d = Math.hypot(dx, dy) / p.r;
        if (d > 1) continue;
        const xx = Math.round(p.x + dx);
        const yy = Math.round(p.y + dy);
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const i = (yy * W + xx) * 4;
        // 球面明暗：左上偏亮
        const lit = Math.max(0, 1 - Math.hypot(dx / p.r + 0.35, dy / p.r + 0.35) * 0.75);
        const edge = 1 - d * d * 0.55;
        for (let c = 0; c < 3; c += 1) {
          const base = tint.pearl[c]! * shade * edge;
          const hi = tint.highlight[c]! * lit * lit;
          px[i + c] = Math.min(255, Math.round(base + hi));
        }
        px[i + 3] = 255;
      }
    }
    // 高光点
    const hx = Math.round(p.x - p.r * 0.32);
    const hy = Math.round(p.y - p.r * 0.32);
    if (hx >= 0 && hx < W && hy >= 0 && hy < H) {
      const i = (hy * W + hx) * 4;
      px[i] = 235; px[i + 1] = 232; px[i + 2] = 224;
    }
  }

  return encodePng(W, H, px);
}
