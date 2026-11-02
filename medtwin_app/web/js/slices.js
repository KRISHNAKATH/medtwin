// Linked axial / coronal / sagittal slices rendered by the server as PNG, with an optional
// correction brush. Volume axes are RAS voxels (x: right, y: anterior, z: superior). Images are
// radiological: columns run from patient right to left, rows from anterior/superior downwards.
// Strokes are sent in image pixel coordinates (1 pixel = 1 voxel); the server maps them back.

const PLANE_AXIS = { axial: 2, coronal: 1, sagittal: 0 };
// For each plane: which voxel axes map to image columns and rows.
const PLANE_DIMS = { axial: [0, 1], coronal: [0, 2], sagittal: [1, 2] };

export class SliceViewer {
  constructor(root, { onStrokesChanged } = {}) {
    this.root = root;
    this.base = null;
    this.rev = '';
    this.shape = [1, 1, 1];
    this.voxelMm = 1;
    this.cursor = [0, 0, 0];
    this.channel = 'flair';
    this.overlay = 'prediction';
    this.timers = {};
    this.planes = {};
    this.editing = false;
    this.paintLabel = 3;
    this.paintColor = '#e0234e';
    this.brushMm = 4;
    this.strokes = [];
    this.current = null;
    this.onStrokesChanged = onStrokesChanged || (() => {});
    for (const el of root.querySelectorAll('.slice')) {
      const plane = el.dataset.plane;
      const p = {
        el, slider: el.querySelector('input[type=range]'), frame: el.querySelector('.frame'),
        img: el.querySelector('img'), canvas: el.querySelector('canvas.paint-layer'),
        vline: el.querySelector('.xh-v'), hline: el.querySelector('.xh-h'),
      };
      this.planes[plane] = p;
      p.slider.addEventListener('input', () => {
        this.cursor[PLANE_AXIS[plane]] = Number(p.slider.value);
        this._refresh(plane, true);
        this._crosshairs();
      });
      p.img.addEventListener('load', () => { this._fitCanvas(plane); this._crosshairs(); this._drawStrokes(plane); });
      p.frame.addEventListener('click', (e) => { if (!this.editing) this._click(plane, e); });
      p.canvas.addEventListener('pointerdown', (e) => this._strokeStart(plane, e));
      p.canvas.addEventListener('pointermove', (e) => this._strokeMove(plane, e));
      p.canvas.addEventListener('pointerup', () => this._strokeEnd());
      p.canvas.addEventListener('pointerleave', () => this._strokeEnd());
    }
    window.addEventListener('resize', () => { for (const pl of Object.keys(this.planes)) this._fitCanvas(pl); this._crosshairs(); });
  }

  open(base, shape, cursor, voxelMm = 1, rev = '') {
    this.base = base;
    this.shape = shape;
    this.voxelMm = voxelMm;
    this.rev = rev;
    this.strokes = [];
    for (const [plane, p] of Object.entries(this.planes)) p.slider.max = String(shape[PLANE_AXIS[plane]] - 1);
    this.goTo(cursor || shape.map((n) => Math.floor(n / 2)));
    this.onStrokesChanged(this.strokes.length);
  }

  setRevision(rev) { this.rev = rev; this._refreshAll(); }

  goTo(voxel) {
    this.cursor = voxel.map((v, i) => Math.max(0, Math.min(this.shape[i] - 1, Math.round(v))));
    this._refreshAll();
  }

  setChannel(channel) { this.channel = channel; this._refreshAll(); }
  setOverlay(overlay) { this.overlay = overlay; this._refreshAll(); }

  // ------------------------------------------------------------ editing
  setEditing(on) {
    this.editing = on;
    this.root.classList.toggle('editing', on);
    for (const plane of Object.keys(this.planes)) { this._fitCanvas(plane); this._drawStrokes(plane); }
  }

  setPaint(label, color) { this.paintLabel = label; this.paintColor = color; }
  setBrush(mm) { this.brushMm = mm; }

  undo() {
    this.strokes.pop();
    this._redrawAll();
    this.onStrokesChanged(this.strokes.length);
  }

  clearStrokes() {
    this.strokes = [];
    this._redrawAll();
    this.onStrokesChanged(0);
  }

  _toVoxelPixel(plane, event) {
    const p = this.planes[plane];
    const rect = p.img.getBoundingClientRect();
    const [colAxis, rowAxis] = PLANE_DIMS[plane];
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    return [fx * this.shape[colAxis] - 0.5, fy * this.shape[rowAxis] - 0.5];
  }

  _strokeStart(plane, event) {
    if (!this.editing) return;
    const pt = this._toVoxelPixel(plane, event);
    if (!pt) return;
    event.preventDefault();
    this.planes[plane].canvas.setPointerCapture(event.pointerId);
    this.current = {
      plane, index: this.cursor[PLANE_AXIS[plane]], label: this.paintLabel, color: this.paintColor,
      radius: Math.max(0.5, this.brushMm / this.voxelMm / 2), points: [pt],
    };
    this.strokes.push(this.current);
    this._drawStrokes(plane);
  }

  _strokeMove(plane, event) {
    if (!this.current || this.current.plane !== plane) return;
    const pt = this._toVoxelPixel(plane, event);
    if (!pt) return;
    this.current.points.push(pt);
    this._drawStrokes(plane);
  }

  _strokeEnd() {
    if (!this.current) return;
    this.current = null;
    this.onStrokesChanged(this.strokes.length);
  }

  exportStrokes() {
    return this.strokes.map(({ plane, index, label, radius, points }) => ({
      plane, index, label, radius, points: points.map(([c, r]) => [Math.round(c * 10) / 10, Math.round(r * 10) / 10]),
    }));
  }

  _fitCanvas(plane) {
    const p = this.planes[plane];
    const img = p.img.getBoundingClientRect();
    const frame = p.frame.getBoundingClientRect();
    if (!img.width) return;
    Object.assign(p.canvas.style, {
      left: `${img.left - frame.left}px`, top: `${img.top - frame.top}px`, width: `${img.width}px`, height: `${img.height}px`,
    });
    p.canvas.width = Math.round(img.width);
    p.canvas.height = Math.round(img.height);
  }

  _drawStrokes(plane) {
    const p = this.planes[plane];
    const ctx = p.canvas.getContext('2d');
    ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
    if (!p.canvas.width) return;
    const [colAxis, rowAxis] = PLANE_DIMS[plane];
    const sx = p.canvas.width / this.shape[colAxis];
    const sy = p.canvas.height / this.shape[rowAxis];
    const index = this.cursor[PLANE_AXIS[plane]];
    for (const s of this.strokes) {
      if (s.plane !== plane || s.index !== index) continue;
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = s.label === 0 ? '#ffffff' : s.color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = s.radius * 2 * sx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (s.label === 0) ctx.setLineDash([4, 3]); else ctx.setLineDash([]);
      ctx.beginPath();
      s.points.forEach(([c, r], i) => {
        const x = (c + 0.5) * sx;
        const y = (r + 0.5) * sy;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (s.points.length === 1) {
        const [c, r] = s.points[0];
        ctx.arc((c + 0.5) * sx, (r + 0.5) * sy, s.radius * sx, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  _redrawAll() { for (const plane of Object.keys(this.planes)) this._drawStrokes(plane); }

  // ------------------------------------------------------------ navigation
  _refreshAll() { for (const plane of Object.keys(this.planes)) this._refresh(plane, false); }

  _refresh(plane, debounce) {
    if (!this.base) return;
    const p = this.planes[plane];
    const index = this.cursor[PLANE_AXIS[plane]];
    p.slider.value = String(index);
    const url = `${this.base}/slice?plane=${plane}&index=${index}&channel=${this.channel}&overlay=${this.overlay}&rev=${encodeURIComponent(this.rev)}`;
    clearTimeout(this.timers[plane]);
    if (debounce) this.timers[plane] = setTimeout(() => { p.img.src = url; }, 40);
    else p.img.src = url;
    this._drawStrokes(plane);
  }

  _click(plane, event) {
    const pt = this._toVoxelPixel(plane, event);
    if (!pt) return;
    const [colAxis, rowAxis] = PLANE_DIMS[plane];
    const next = [...this.cursor];
    next[colAxis] = this.shape[colAxis] - 1 - pt[0];
    next[rowAxis] = this.shape[rowAxis] - 1 - pt[1];
    this.goTo(next);
  }

  _crosshairs() {
    for (const [plane, p] of Object.entries(this.planes)) {
      const imgRect = p.img.getBoundingClientRect();
      const frameRect = p.frame.getBoundingClientRect();
      if (!imgRect.width) continue;
      const [colAxis, rowAxis] = PLANE_DIMS[plane];
      const fx = 1 - (this.cursor[colAxis] + 0.5) / this.shape[colAxis];
      const fy = 1 - (this.cursor[rowAxis] + 0.5) / this.shape[rowAxis];
      p.vline.style.left = `${imgRect.left - frameRect.left + fx * imgRect.width}px`;
      p.hline.style.top = `${imgRect.top - frameRect.top + fy * imgRect.height}px`;
    }
  }
}
