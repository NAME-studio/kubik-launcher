'use strict';

(() => {
  const TEMPLATE = {
    skin: '#b98a63',
    skinShade: '#9c6f4d',
    hair: '#4a2f1b',
    hairShade: '#36210f',
    shirt: '#00a8a8',
    shirtShade: '#008f8f',
    pants: '#34479c',
    pantsShade: '#2a3a82',
    shoes: '#4a3b2e',
    white: '#f2f2f2',
    eye: '#3a6ea5',
    mouth: '#7a4a32',
  };

  function hexToRgba(hex) {
    const value = String(hex || '#000000').replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    return [
      parseInt(full.slice(0, 2), 16) || 0,
      parseInt(full.slice(2, 4), 16) || 0,
      parseInt(full.slice(4, 6), 16) || 0,
      full.length >= 8 ? parseInt(full.slice(6, 8), 16) : 255,
    ];
  }

  function toHex(r, g, b) {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  class SkinEditor {
    constructor(options) {
      this.canvas = options.canvas;
      this.onChange = options.onChange || (() => {});
      this.ctx = this.canvas.getContext('2d');
      this.tex = document.createElement('canvas');
      this.tex.width = 64;
      this.tex.height = 64;
      this.tctx = this.tex.getContext('2d', { willReadFrequently: true });
      this.tctx.imageSmoothingEnabled = false;
      this.zoom = 6;
      this.tool = 'pencil';
      this.color = window.accentColor ? window.accentColor() : '#8ce86a';
      this.model = 'classic';
      this.mirror = false;
      this.grid = true;
      this.outlines = false;
      this.undoStack = [];
      this.redoStack = [];
      this.drawing = false;
      this.lastPoint = null;
      this.hover = null;
      this.bindEvents();
      this.resize();
      this.buildTemplate('classic');
    }

    bindEvents() {
      const canvas = this.canvas;
      const position = (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(((event.clientX - rect.left) / rect.width) * 64);
        const y = Math.floor(((event.clientY - rect.top) / rect.height) * 64);
        if (x < 0 || y < 0 || x > 63 || y > 63) return null;
        return { x, y };
      };

      canvas.addEventListener('contextmenu', (event) => event.preventDefault());

      canvas.addEventListener('pointerdown', (event) => {
        const point = position(event);
        if (!point) return;
        canvas.setPointerCapture(event.pointerId);
        this.drawing = true;
        this.lastPoint = point;
        this.pushUndo();
        if (event.button === 2) {
          this.pick(point);
        } else {
          this.apply(point);
        }
        this.redraw();
      });

      canvas.addEventListener('pointermove', (event) => {
        const point = position(event);
        this.hover = point;
        if (this.drawing && point) {
          if (this.tool === 'pencil' || this.tool === 'eraser') {
            this.lineTo(this.lastPoint, point);
            this.lastPoint = point;
          } else {
            this.apply(point);
          }
        }
        this.redraw();
        if (!this.drawing) this.notify();
      });

      const end = () => {
        if (!this.drawing) return;
        this.drawing = false;
        this.lastPoint = null;
        this.notify();
      };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      canvas.addEventListener('pointerleave', () => {
        this.hover = null;
        this.redraw();
      });
    }

    notify() {
      this.onChange(this);
    }

    resize() {
      const size = 64 * this.zoom;
      this.canvas.width = size;
      this.canvas.height = size;
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
      this.redraw();
    }

    setZoom(zoom) {
      this.zoom = Math.max(2, Math.min(12, Math.round(zoom)));
      this.resize();
    }

    setModel(model) {
      this.model = model === 'slim' ? 'slim' : 'classic';
    }

    setColor(color) {
      this.color = color;
    }

    setTool(tool) {
      this.tool = tool;
    }

    setMirror(value) {
      this.mirror = Boolean(value);
    }

    setGrid(value) {
      this.grid = Boolean(value);
      this.redraw();
    }

    setOutlines(value) {
      this.outlines = Boolean(value);
      this.redraw();
    }

    pushUndo() {
      try {
        this.undoStack.push(this.tctx.getImageData(0, 0, 64, 64));
        if (this.undoStack.length > 40) this.undoStack.shift();
        this.redoStack = [];
      } catch {
        /* ignore */
      }
    }

    undo() {
      const previous = this.undoStack.pop();
      if (!previous) return;
      this.redoStack.push(this.tctx.getImageData(0, 0, 64, 64));
      this.tctx.putImageData(previous, 0, 0);
      this.redraw();
      this.notify();
    }

    redo() {
      const next = this.redoStack.pop();
      if (!next) return;
      this.undoStack.push(this.tctx.getImageData(0, 0, 64, 64));
      this.tctx.putImageData(next, 0, 0);
      this.redraw();
      this.notify();
    }

    paintPixel(x, y) {
      if (x < 0 || y < 0 || x > 63 || y > 63) return;
      if (this.tool === 'eraser') {
        this.tctx.clearRect(x, y, 1, 1);
      } else {
        this.tctx.fillStyle = this.color;
        this.tctx.fillRect(x, y, 1, 1);
      }
      if (this.mirror) {
        const mx = 63 - x;
        if (this.tool === 'eraser') this.tctx.clearRect(mx, y, 1, 1);
        else {
          this.tctx.fillStyle = this.color;
          this.tctx.fillRect(mx, y, 1, 1);
        }
      }
    }

    floodFill(x, y) {
      const data = this.tctx.getImageData(0, 0, 64, 64);
      const pixels = data.data;
      const index = (px, py) => (py * 64 + px) * 4;
      const start = index(x, y);
      const target = [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]];
      const fill = hexToRgba(this.color);
      if (target.every((value, i) => value === fill[i])) return;
      const stack = [[x, y]];
      const visited = new Uint8Array(64 * 64);
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < 0 || cy < 0 || cx > 63 || cy > 63) continue;
        const flat = cy * 64 + cx;
        if (visited[flat]) continue;
        visited[flat] = 1;
        const pos = flat * 4;
        if (
          pixels[pos] !== target[0] ||
          pixels[pos + 1] !== target[1] ||
          pixels[pos + 2] !== target[2] ||
          pixels[pos + 3] !== target[3]
        ) {
          continue;
        }
        pixels[pos] = fill[0];
        pixels[pos + 1] = fill[1];
        pixels[pos + 2] = fill[2];
        pixels[pos + 3] = fill[3];
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      this.tctx.putImageData(data, 0, 0);
      if (this.mirror) {
        const mirrored = this.tctx.getImageData(0, 0, 64, 64);
        const src = new Uint8ClampedArray(mirrored.data);
        for (let py = 0; py < 64; py += 1) {
          for (let px = 0; px < 32; px += 1) {
            const from = (py * 64 + px) * 4;
            const to = (py * 64 + (63 - px)) * 4;
            mirrored.data[to] = src[from];
            mirrored.data[to + 1] = src[from + 1];
            mirrored.data[to + 2] = src[from + 2];
            mirrored.data[to + 3] = src[from + 3];
          }
        }
        this.tctx.putImageData(mirrored, 0, 0);
      }
    }

    pick(point) {
      const data = this.tctx.getImageData(point.x, point.y, 1, 1).data;
      if (data[3] === 0) return;
      this.color = toHex(data[0], data[1], data[2]);
      if (this.onPick) this.onPick(this.color);
    }

    apply(point) {
      if (this.tool === 'fill') this.floodFill(point.x, point.y);
      else if (this.tool === 'picker') this.pick(point);
      else this.paintPixel(point.x, point.y);
    }

    lineTo(from, to) {
      if (!from) {
        this.apply(to);
        return;
      }
      let x0 = from.x;
      let y0 = from.y;
      const x1 = to.x;
      const y1 = to.y;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (let guard = 0; guard < 512; guard += 1) {
        this.paintPixel(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const err2 = err * 2;
        if (err2 > -dy) {
          err -= dy;
          x0 += sx;
        }
        if (err2 < dx) {
          err += dx;
          y0 += sy;
        }
      }
    }

    redraw() {
      const ctx = this.ctx;
      const size = this.canvas.width;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(this.tex, 0, 0, 64, 64, 0, 0, size, size);

      if (this.outlines) {
        const areas = [
          [0, 0, 32, 16, window.accentRgba ? window.accentRgba(0.75) : 'rgba(140,232,106,.75)'],
          [16, 16, 24, 16, 'rgba(92,200,255,.7)'],
          [40, 16, 16, 16, 'rgba(167,139,250,.7)'],
          [0, 16, 16, 16, 'rgba(248,169,76,.7)'],
          [16, 48, 16, 16, 'rgba(248,169,76,.55)'],
          [32, 48, 16, 16, 'rgba(167,139,250,.55)'],
          [32, 0, 32, 16, window.accentRgba ? window.accentRgba(0.35) : 'rgba(140,232,106,.35)'],
          [0, 32, 56, 16, 'rgba(92,200,255,.3)'],
        ];
        ctx.lineWidth = 1;
        for (const [x, y, w, h, color] of areas) {
          ctx.strokeStyle = color;
          ctx.strokeRect(x * this.zoom + 0.5, y * this.zoom + 0.5, w * this.zoom - 1, h * this.zoom - 1);
        }
      }

      if (this.grid && this.zoom >= 4) {
        ctx.strokeStyle = 'rgba(255,255,255,.055)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 64; i += 1) {
          const p = i * this.zoom + 0.5;
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, size);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, p);
          ctx.lineTo(size, p);
          ctx.stroke();
        }
      }

      if (this.hover) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.hover.x * this.zoom + 1, this.hover.y * this.zoom + 1, this.zoom - 2, this.zoom - 2);
      }
    }

    fillRect(x, y, w, h, color) {
      this.tctx.fillStyle = color;
      this.tctx.fillRect(x, y, w, h);
    }

    buildTemplate(model) {
      const t = this.tctx;
      t.clearRect(0, 0, 64, 64);
      this.model = model === 'slim' ? 'slim' : 'classic';
      const c = TEMPLATE;

      this.fillRect(0, 0, 32, 16, c.skin);
      this.fillRect(0, 0, 32, 8, c.hair);
      this.fillRect(24, 8, 8, 8, c.hair);
      this.fillRect(0, 8, 8, 4, c.hair);
      this.fillRect(16, 8, 8, 4, c.hair);
      this.fillRect(8, 8, 8, 8, c.skin);
      this.fillRect(8, 8, 8, 2, c.hair);
      this.fillRect(9, 12, 1, 1, c.white);
      this.fillRect(10, 12, 1, 1, c.eye);
      this.fillRect(13, 12, 1, 1, c.white);
      this.fillRect(14, 12, 1, 1, c.eye);
      this.fillRect(11, 13, 2, 1, c.skinShade);
      this.fillRect(10, 14, 4, 1, c.mouth);

      this.fillRect(16, 16, 24, 16, c.shirt);
      this.fillRect(16, 20, 4, 12, c.shirtShade);
      this.fillRect(28, 20, 4, 12, c.shirtShade);

      this.fillRect(40, 16, 16, 16, c.skin);
      this.fillRect(40, 16, 16, 4, c.shirt);
      this.fillRect(40, 20, 4, 4, c.shirt);
      this.fillRect(44, 20, 4, 4, c.shirt);
      this.fillRect(48, 20, 4, 4, c.shirt);
      this.fillRect(52, 20, 4, 4, c.shirt);

      this.fillRect(32, 48, 16, 16, c.skin);
      this.fillRect(32, 48, 16, 4, c.shirt);
      this.fillRect(32, 52, 4, 4, c.shirt);
      this.fillRect(36, 52, 4, 4, c.shirt);
      this.fillRect(40, 52, 4, 4, c.shirt);
      this.fillRect(44, 52, 4, 4, c.shirt);

      this.fillRect(0, 16, 16, 16, c.pants);
      this.fillRect(0, 30, 16, 2, c.shoes);
      this.fillRect(4, 20, 4, 12, c.pants);
      this.fillRect(4, 30, 4, 2, c.shoes);
      this.fillRect(12, 20, 4, 12, c.pants);
      this.fillRect(12, 30, 4, 2, c.shoes);

      this.fillRect(16, 48, 16, 16, c.pants);
      this.fillRect(16, 62, 16, 2, c.shoes);
      this.fillRect(20, 52, 4, 12, c.pants);
      this.fillRect(20, 62, 4, 2, c.shoes);
      this.fillRect(28, 52, 4, 12, c.pants);
      this.fillRect(28, 62, 4, 2, c.shoes);

      this.redraw();
      this.notify();
    }

    clearAll() {
      this.pushUndo();
      this.tctx.clearRect(0, 0, 64, 64);
      this.redraw();
      this.notify();
    }

    loadImageElement(image, silent = false) {
      const texture = window.SkinRender.textureOf(image);
      this.pushUndo();
      this.tctx.clearRect(0, 0, 64, 64);
      this.tctx.drawImage(texture, 0, 0);
      this.redraw();
      if (!silent) this.notify();
    }

    importFile(file) {
      return new Promise((resolve, reject) => {
        if (!file) return reject(new Error('Файл не выбран'));
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const image = await window.SkinRender.loadImage(String(reader.result));
            this.loadImageElement(image);
            resolve(true);
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.readAsDataURL(file);
      });
    }

    exportDataUrl() {
      return this.tex.toDataURL('image/png');
    }

    snapshotDataUrl() {
      return this.exportDataUrl();
    }
  }

  window.SkinEditor = SkinEditor;
})();
