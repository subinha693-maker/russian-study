// 필기 캔버스: 손가락/펜 입력, 되돌리기, 지우기, 지우개, 이미지 내보내기
// opts.guides: 캔버스에 점선 안내선 2줄 그리기 (연습장은 CSS 줄 배경을 써서 false)
export class Pad {
  constructor(canvas, opts = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = { guides: true, ...opts };
    this.strokes = [];
    this.cur = null;
    this.enabled = true;
    this.fit = false;     // true면 전체 필기가 보이도록 축소·가운데 정렬 (정답 비교용, 입력 불가 상태)
    this.size = 1;        // 펜 굵기 배율
    this.erasing = false; // 지우개 모드
    this.penSeen = false; // 펜이 한 번이라도 쓰이면 손바닥(터치) 입력 무시
    this.onChange = () => {};

    const o = { passive: false };
    canvas.addEventListener('pointerdown', e => this.down(e), o);
    canvas.addEventListener('pointermove', e => this.move(e), o);
    canvas.addEventListener('pointerup', e => this.up(e), o);
    canvas.addEventListener('pointercancel', e => this.up(e), o);
    // 캔버스 위에서 스크롤/확대/당겨서 새로고침 막기
    for (const t of ['touchstart', 'touchmove', 'touchend']) canvas.addEventListener(t, e => e.preventDefault(), o);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  pt(e) {
    const r = this.c.getBoundingClientRect();
    const p = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return [e.clientX - r.left, e.clientY - r.top, p];
  }

  down(e) {
    e.preventDefault();
    if (!this.enabled || this.fit) return;
    if (e.pointerType === 'pen') this.penSeen = true;
    else if (e.pointerType === 'touch' && this.penSeen) return;
    if (this.cur) return; // 멀티터치 무시
    this.c.setPointerCapture(e.pointerId);
    this.pid = e.pointerId;
    this.cur = { pts: [this.pt(e)], size: this.size, erase: this.erasing };
    this.drawDot(this.cur, this.cur.pts[0]);
  }

  move(e) {
    if (!this.cur || e.pointerId !== this.pid) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) {
      this.cur.pts.push(this.pt(ev));
      this.drawTail(this.cur, this.cur.pts.length);
    }
  }

  up(e) {
    if (!this.cur || e.pointerId !== this.pid) return;
    this.strokes.push(this.cur);
    this.cur = null;
    this.onChange();
  }

  width(s, p) { return s.erase ? 26 * s.size : (2 + p * 4) * s.size; }
  ink() { return getComputedStyle(this.c).getPropertyValue('--ink').trim() || '#111'; }
  style(s) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = this.inkColor || this.ink();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }

  drawDot(s, [x, y, p]) {
    const ctx = this.ctx;
    this.style(s);
    ctx.beginPath(); ctx.arc(x, y, this.width(s, p) / 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // n번째 점까지 중 마지막 구간만 부드럽게(중점 2차 곡선) 그리기
  drawTail(s, n) {
    if (n < 2) return;
    const pts = s.pts, ctx = this.ctx;
    const a = pts[Math.max(0, n - 3)], b = pts[n - 2], c = pts[n - 1];
    const m1 = n >= 3 ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : [b[0], b[1]];
    const m2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    this.style(s);
    ctx.lineWidth = this.width(s, (b[2] + c[2]) / 2);
    ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.quadraticCurveTo(b[0], b[1], m2[0], m2[1]); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  drawStroke(s) {
    const n = s.pts.length;
    if (n === 1) return this.drawDot(s, s.pts[0]);
    for (let i = 2; i <= n; i++) this.drawTail(s, i);
    const last = s.pts[n - 1], prev = s.pts[n - 2], ctx = this.ctx; // 끝점까지 마무리
    this.style(s);
    ctx.beginPath(); ctx.moveTo((prev[0] + last[0]) / 2, (prev[1] + last[1]) / 2); ctx.lineTo(last[0], last[1]); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  guides() {
    const ctx = this.ctx, h = this.h;
    ctx.save();
    ctx.strokeStyle = getComputedStyle(this.c).getPropertyValue('--guide').trim() || '#ddd';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    for (const f of [0.35, 0.65]) { ctx.beginPath(); ctx.moveTo(12, h * f); ctx.lineTo(this.w - 12, h * f); ctx.stroke(); }
    ctx.restore();
  }

  // 잉크가 있는 영역 (지우개 제외)
  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of this.strokes) {
      if (s.erase) continue;
      for (const [x, y, p] of s.pts) {
        const r = this.width(s, p) / 2;
        x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
      }
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  // 필기 전체가 보이도록 축소(확대는 안 함) + 가운데 정렬
  fitTransform(w, h, pad = 20) {
    const b = this.bounds();
    if (!b) return null;
    const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
    const s = Math.min(1, (w - pad * 2) / bw, (h - pad * 2) / bh);
    return { s, tx: (w - bw * s) / 2 - b.x0 * s, ty: (h - bh * s) / 2 - b.y0 * s };
  }

  redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w || 0, this.h || 0);
    if (this.opts.guides) this.guides();
    ctx.save();
    const t = this.fit ? this.fitTransform(this.w, this.h) : null;
    if (t) ctx.transform(t.s, 0, 0, t.s, t.tx, t.ty);
    this.strokes.forEach(s => this.drawStroke(s));
    ctx.restore();
  }

  undo() {
    if (!this.strokes.length && this.cleared) { this.strokes = this.cleared; this.cleared = null; } // 지우기 되돌리기
    else this.strokes.pop();
    this.redraw(); this.onChange();
  }
  clear() { if (this.strokes.length) this.cleared = this.strokes; this.strokes = []; this.cur = null; this.redraw(); this.onChange(); }
  isEmpty() { return !this.strokes.some(s => !s.erase); }
  setEnabled(v) { this.enabled = v; if (!v && this.cur) { this.strokes.push(this.cur); this.cur = null; } }
  setFit(v) { this.setEnabled(this.enabled); this.fit = v; this.redraw(); }

  // 흰 배경 + 검은 글씨 PNG, 필기 영역에 맞춰 자름 (비전 AI 채점용)
  toDataURL() {
    const b = this.bounds();
    const pad = 16, dpr = 2;
    const w = b ? b.x1 - b.x0 + pad * 2 : this.w, h = b ? b.y1 - b.y0 + pad * 2 : this.h;
    const out = document.createElement('canvas');
    out.width = Math.round(w * dpr); out.height = Math.round(h * dpr);
    const o = out.getContext('2d');
    o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
    // 지우개가 흰 배경까지 지우지 않도록 별도 레이어에 그린 뒤 합성
    const layer = document.createElement('canvas');
    layer.width = out.width; layer.height = out.height;
    const l = layer.getContext('2d');
    l.setTransform(dpr, 0, 0, dpr, b ? (pad - b.x0) * dpr : 0, b ? (pad - b.y0) * dpr : 0);
    const keep = this.ctx; this.ctx = l; this.inkColor = '#000';
    this.strokes.forEach(s => this.drawStroke(s));
    this.ctx = keep; this.inkColor = null;
    o.drawImage(layer, 0, 0);
    return out.toDataURL('image/png');
  }
}
