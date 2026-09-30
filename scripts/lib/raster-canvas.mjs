// Minimal raster canvas for offline frame rendering: fillRect, bitmap fillText,
// clipping and drawImage over a 640x432 RGB buffer. No browser or packages.
const rgb = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16));

// Nonzero winding at pixel centers, including diagonal closing edges.
export function inside(polys, x, y) {
  let winding = 0;
  for (const p of polys) for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
    if (Math.min(ay, by) <= y && y < Math.max(ay, by) &&
        ax + (y - ay) * (bx - ax) / (by - ay) > x) winding += by > ay ? 1 : -1;
  }
  return winding !== 0;
}

export function rasterAvatar(svg) {
  const pixels = Buffer.alloc(64 * 64 * 3);
  for (const [, fill, d] of svg.matchAll(/<path fill="(#[\da-f]{6})" d="([^"]+)"/gi)) {
    const tokens = d.match(/[MhvHVz]|-?\d+/g), polys = [];
    let x = 0, y = 0, p;
    for (let i = 0; i < tokens.length;) {
      const c = tokens[i++];
      if (c === 'M') { x = +tokens[i++]; y = +tokens[i++]; p = []; polys.push(p); }
      else if (c === 'h') x += +tokens[i++];
      else if (c === 'v') y += +tokens[i++];
      else if (c === 'H') x = +tokens[i++];
      else if (c === 'V') y = +tokens[i++];
      else if (c === 'z') { [x, y] = p[0]; continue; }
      else throw new Error(`Unsupported SVG token: ${c}`);
      p.push([x, y]);
    }
    const color = rgb(fill);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
      if (inside(polys, x + .5, y + .5)) pixels.set(color, (y * 64 + x) * 3);
  }
  return pixels;
}

// Five-column bitmap letters. Canvas labels are uppercase; no system fonts.
const glyphs = {
  A:['01110','10001','10001','11111','10001','10001','10001'],
  B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'],
  D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  G:['01111','10000','10000','10111','10001','10001','01111'],
  H:['10001','10001','10001','11111','10001','10001','10001'],
  I:['11111','00100','00100','00100','00100','00100','11111'],
  K:['10001','10010','10100','11000','10100','10010','10001'],
  M:['10001','11011','10101','10101','10001','10001','10001'],
  N:['10001','11001','11001','10101','10011','10011','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'],
  P:['11110','10001','10001','11110','10000','10000','10000'],
  R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['01111','10000','10000','01110','00001','00001','11110'],
  T:['11111','00100','00100','00100','00100','00100','00100'],
  W:['10001','10001','10001','10101','10101','11011','10001'],
  F:['11111','10000','10000','11110','10000','10000','10000'],
  L:['10000','10000','10000','10000','10000','10000','11111'],
  U:['10001','10001','10001','10001','10001','10001','01110'],
  V:['10001','10001','10001','10001','10001','01010','00100'],
  Y:['10001','10001','01010','00100','00100','00100','00100'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '.':['00000','00000','00000','00000','00000','00110','00110'],
  '?':['01110','10001','00001','00010','00100','00000','00100'],
  '✓':['00000','00001','00001','00010','10010','01100','00100'],
};

export function context(pixels, avatar) {
  let clips = [], path = [], stack = [];
  const put = (x, y, color) => {
    if (x >= 0 && y >= 0 && x < 640 && y < 432 && clips.every(p => inside([p], x + .5, y + .5)))
      pixels.set(color, (y * 640 + x) * 3);
  };
  return {
    fillStyle: '#000000', font: '',
    fillRect(x, y, w, h) {
      const color = rgb(this.fillStyle);
      for (let py = Math.max(0, Math.ceil(y)); py < Math.min(432, y + h); py++)
        for (let px = Math.max(0, Math.ceil(x)); px < Math.min(640, x + w); px++) put(px, py, color);
    },
    fillText(text, x, y) {
      const tall = this.font.includes('14px'), sy = tall ? 2 : 1;
      for (const ch of text) {
        if (ch !== ' ' && !glyphs[ch]) throw new Error(`Missing glyph ${ch}`);
        (glyphs[ch] ?? []).forEach((row, dy) => [...row].forEach((bit, dx) => {
          if (bit === '1') this.fillRect(x + dx, y - 7 * sy + dy * sy, 1, sy);
        }));
        x += tall ? 8 : 7;
      }
    },
    save() { stack.push({clips: [...clips], fillStyle: this.fillStyle, font: this.font}); },
    restore() { const s = stack.pop(); clips = s.clips; this.fillStyle = s.fillStyle; this.font = s.font; },
    beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); }, closePath() {}, clip() { clips.push([...path]); },
    drawImage(_image, sx, sy, sw, sh, dx, dy, dw, dh) {
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const i = ((sy + Math.floor(y * sh / dh)) * 64 + sx + Math.floor(x * sw / dw)) * 3;
        put(dx + x, dy + y, avatar.subarray(i, i + 3));
      }
    },
  };
}
