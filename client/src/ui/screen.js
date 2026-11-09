// A small terminal canvas with true-color cells and diff-based flushing:
// only cells that changed since the last frame are written to the terminal.

const DEFAULT = -1;
const pack = (c) => (c ? ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255) : DEFAULT);
const unpack = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

class Screen {
  constructor() {
    this.w = 0;
    this.h = 0;
    this.prev = null;
  }

  begin(w, h) {
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.prev = null; // full redraw after resize
    }
    const n = w * h;
    this.ch = new Array(n).fill(" ");
    this.fg = new Int32Array(n).fill(DEFAULT);
    this.bg = new Int32Array(n).fill(DEFAULT);
    this.bold = new Uint8Array(n);
  }

  invalidate() {
    this.prev = null;
  }

  // bg === undefined keeps the existing background (draw text "over" tiles)
  put(x, y, ch, fg, bg, bold = false) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.ch[i] = ch;
    this.fg[i] = pack(fg);
    if (bg !== undefined) this.bg[i] = pack(bg);
    this.bold[i] = bold ? 1 : 0;
  }

  getBg(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const v = this.bg[y * this.w + x];
    return v === DEFAULT ? null : unpack(v);
  }

  text(x, y, str, fg, bg, bold = false, maxLen = Infinity) {
    str = String(str);
    const n = Math.min(str.length, maxLen);
    for (let i = 0; i < n; i++) this.put(x + i, y, str[i], fg, bg, bold);
    return n;
  }

  fill(x, y, w, h, bg, ch = " ") {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.put(xx, yy, ch, null, bg);
  }

  // Rounded box with an optional title. Fills the inside with bg.
  box(x, y, w, h, { color, bg, title, titleColor, rightTitle, rightColor } = {}) {
    if (w < 2 || h < 2) return;
    this.fill(x, y, w, h, bg);
    for (let i = 1; i < w - 1; i++) {
      this.put(x + i, y, "─", color, bg);
      this.put(x + i, y + h - 1, "─", color, bg);
    }
    for (let j = 1; j < h - 1; j++) {
      this.put(x, y + j, "│", color, bg);
      this.put(x + w - 1, y + j, "│", color, bg);
    }
    this.put(x, y, "╭", color, bg);
    this.put(x + w - 1, y, "╮", color, bg);
    this.put(x, y + h - 1, "╰", color, bg);
    this.put(x + w - 1, y + h - 1, "╯", color, bg);
    if (title) this.text(x + 2, y, ` ${title} `, titleColor || color, bg, true, w - 4);
    if (rightTitle) {
      const t = ` ${rightTitle} `;
      this.text(x + w - 2 - t.length, y, t, rightColor || color, bg, false, w - 4);
    }
  }

  sgr(fg, bg, bold) {
    const f = fg === DEFAULT ? "39" : `38;2;${(fg >> 16) & 255};${(fg >> 8) & 255};${fg & 255}`;
    const b = bg === DEFAULT ? "49" : `48;2;${(bg >> 16) & 255};${(bg >> 8) & 255};${bg & 255}`;
    return `\x1b[0;${bold ? "1;" : ""}${f};${b}m`;
  }

  flush(out = process.stdout) {
    const { w, h } = this;
    const prev = this.prev;
    let s = prev ? "" : "\x1b[0m\x1b[2J";
    let curStyle = null;
    let cursor = -1; // index the terminal cursor is at
    for (let i = 0; i < w * h; i++) {
      const ch = this.ch[i];
      const fg = this.fg[i];
      const bg = this.bg[i];
      const bold = this.bold[i];
      if (prev && prev.ch[i] === ch && prev.fg[i] === fg && prev.bg[i] === bg && prev.bold[i] === bold) continue;
      if (cursor !== i) {
        s += `\x1b[${Math.floor(i / w) + 1};${(i % w) + 1}H`;
      }
      const style = this.sgr(fg, bg, bold);
      if (style !== curStyle) {
        s += style;
        curStyle = style;
      }
      s += ch;
      cursor = (i + 1) % w === 0 ? -1 : i + 1; // avoid relying on auto-wrap
    }
    if (s) out.write(s + "\x1b[0m");
    this.prev = { ch: this.ch, fg: this.fg, bg: this.bg, bold: this.bold };
  }
}

module.exports = { Screen };
