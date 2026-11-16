// A small QR code generator, written for "Take it to another device": the setup link as
// something the other phone's camera can read. Byte mode only, error correction level M,
// versions 1 to 40, following ISO/IEC 18004. No dependencies.
//
//   qrMatrix(text)  -> {size, version, mask, modules[y][x] (true = dark)}
//   qrSvg(text)     -> an <svg> string with the 4-module quiet zone the standard asks for

// Per version (index 1..40), for level M: error correction codewords per block, and blocks.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const FORMAT_M = 0;   // the two format bits for level M

/** Modules left for data and error correction once the fixed patterns are placed. */
export function rawDataModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
/** Data codewords (bytes) a version holds at level M. */
export const dataCodewords = ver => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

/** Centres of the alignment patterns along one axis. */
export function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

// ---- Reed-Solomon over GF(2^8), polynomial 0x11D ----
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
function rsDivisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { out[j] = gfMul(out[j], root); if (j + 1 < degree) out[j] ^= out[j + 1]; }
    root = gfMul(root, 2);
  }
  return out;
}
export function rsRemainder(data, degree) {
  const div = rsDivisor(degree), out = new Array(degree).fill(0);
  for (const b of data) {
    const f = b ^ out.shift();
    out.push(0);
    for (let i = 0; i < degree; i++) out[i] ^= gfMul(div[i], f);
  }
  return out;
}

/** The 15 format bits for a mask at level M, and the 18 version bits for versions 7 and up. */
export function formatBits(mask) {
  const data = (FORMAT_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
export function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  return (ver << 12) | rem;
}

/** Text to the full sequence of codewords: data, padded, split into blocks, each with its error correction, interleaved. */
export function codewords(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  for (; ver <= 40; ver++) {
    const lenBits = ver < 10 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 40) throw new Error('too long for a QR code');
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);                                   // byte mode
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));      // terminator
  put(0, (8 - bits.length % 8) % 8);           // to a whole byte
  for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const nBlocks = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawDataModules(ver) / 8);
  const nShort = nBlocks - raw % nBlocks, shortLen = Math.floor(raw / nBlocks);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, eccLen);
    if (i < nShort) dat.push(0);               // placeholder so every block is the same length
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) out.push(b[i]); });
  }
  return {ver, data, blocks, all: out};
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

/** How awkward a finished symbol is for a scanner, by the standard's four rules. Lower is better. */
function penalty(m, size) {
  let score = 0;
  const line = get => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      // A finder-like 1011101 with four light modules on either side.
      for (let b = 0; b + 10 < size; b++) {
        const s = k => get(a, b + k);
        if ((s(0) && !s(1) && s(2) && s(3) && s(4) && !s(5) && s(6) && !s(7) && !s(8) && !s(9) && !s(10)) ||
            (!s(0) && !s(1) && !s(2) && !s(3) && s(4) && !s(5) && s(6) && s(7) && s(8) && !s(9) && s(10))) score += 40;
      }
    }
  };
  line((y, x) => m[y][x]);
  line((x, y) => m[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (m[y][x]) dark++;
    if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
}

export function qrMatrix(text, forceMask = -1) {
  const {ver, all} = codewords(text);
  const size = ver * 4 + 17;
  const m = Array.from({length: size}, () => new Array(size).fill(false));
  const fn = Array.from({length: size}, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = !!dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }            // timing
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {                              // finders, with separators
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  const al = alignmentPositions(ver);
  al.forEach((cx, i) => al.forEach((cy, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = mask => {
    const bits = formatBits(mask), bit = i => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);                                                                     // the always-dark module
  };
  drawFormat(0);                                                                                // reserves the format area
  if (ver >= 7) {
    const bits = versionBits(ver);
    for (let i = 0; i < 18; i++) { const dark = ((bits >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
  }
  // The codewords, in the zigzag from the bottom right, two columns at a time.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && i < all.length * 8) { m[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const flip = mask => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x]; };
  let best = forceMask, bestScore = Infinity;
  if (best < 0) for (let mask = 0; mask < 8; mask++) {
    flip(mask); drawFormat(mask);
    const s = penalty(m, size);
    if (s < bestScore) { bestScore = s; best = mask; }
    flip(mask);                                                                                 // undo
  }
  flip(best); drawFormat(best);
  return {size, version: ver, mask: best, modules: m, isFunction: fn};
}

/** The symbol as an SVG string: one path, dark on light, with the quiet zone. */
export function qrSvg(text, {dark = '#1b1d22', light = '#ffffff', quiet = 4} = {}) {
  const {size, modules} = qrMatrix(text);
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + quiet},${y + quiet}h1v1h-1z`;
  const n = size + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
