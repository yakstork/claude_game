/**
 * Мини-карта: контур трассы рисуется один раз в offscreen-canvas со свечением,
 * каждый кадр — копия фона + точки машин. Мировой +X — вправо, +Z — вверх.
 */
import type { MinimapDot } from '../core/types';

const VIOLET = '#7a04eb';
const MAGENTA = '#ff2a6d';
const PINK = '#ff6ec7';
const YELLOW = '#ffd319';
const WHITE = '#f5e9ff';

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly bg: HTMLCanvasElement = document.createElement('canvas');
  private outline: { x: number; z: number }[] = [];
  /** Размер backing-store, px. */
  private size = 0;
  private cx = 0;
  private cz = 0;
  private scale = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  setOutline(outline: { x: number; z: number }[]): void {
    this.outline = outline;
    this.resize();
  }

  /** Подгоняет разрешение под CSS-размер и devicePixelRatio, перерисовывает фон. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(64, Math.round(Math.max(rect.width, 1) * dpr));
    this.size = px;
    this.canvas.width = px;
    this.canvas.height = px;
    this.bg.width = px;
    this.bg.height = px;
    this.buildBackground();
  }

  private buildBackground(): void {
    const g = this.bg.getContext('2d');
    const pts = this.outline;
    if (!g) return;
    const S = this.size;
    g.clearRect(0, 0, S, S);
    if (pts.length < 2) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const u = S / 200;
    const pad = 16 * u;
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    this.scale = (S - pad * 2) / span;
    this.cx = (minX + maxX) / 2;
    this.cz = (minZ + maxZ) / 2;

    const path = new Path2D();
    for (let i = 0; i < pts.length; i++) {
      const x = this.mx(pts[i].x);
      const y = this.my(pts[i].z);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();

    g.lineJoin = 'round';
    g.lineCap = 'round';
    // широкое полупрозрачное свечение
    g.strokeStyle = 'rgba(122,4,235,0.28)';
    g.lineWidth = 12 * u;
    g.stroke(path);
    g.shadowColor = VIOLET;
    g.shadowBlur = 8 * u;
    g.strokeStyle = 'rgba(122,4,235,0.6)';
    g.lineWidth = 6 * u;
    g.stroke(path);
    // тонкая яркая линия
    g.shadowColor = MAGENTA;
    g.shadowBlur = 6 * u;
    g.strokeStyle = MAGENTA;
    g.lineWidth = 2.6 * u;
    g.stroke(path);
    g.shadowBlur = 0;
    g.strokeStyle = PINK;
    g.lineWidth = 1 * u;
    g.stroke(path);

    // отметка старта — перпендикулярная черта в первой точке контура
    const a = pts[0];
    const b = pts[1];
    const dx = this.mx(b.x) - this.mx(a.x);
    const dy = this.my(b.z) - this.my(a.z);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const sx = this.mx(a.x);
    const sy = this.my(a.z);
    g.strokeStyle = YELLOW;
    g.shadowColor = YELLOW;
    g.shadowBlur = 5 * u;
    g.lineWidth = 3 * u;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(sx + nx * 7 * u, sy + ny * 7 * u);
    g.lineTo(sx - nx * 7 * u, sy - ny * 7 * u);
    g.stroke();
    g.shadowBlur = 0;
  }

  private mx(x: number): number {
    return (x - this.cx) * this.scale + this.size / 2;
  }

  private my(z: number): number {
    return this.size / 2 - (z - this.cz) * this.scale;
  }

  /** Каждый кадр: фон + точки. Без аллокаций. */
  draw(dots: MinimapDot[]): void {
    const c = this.ctx;
    if (!c || this.size === 0) return;
    const S = this.size;
    const u = S / 200;
    c.clearRect(0, 0, S, S);
    c.drawImage(this.bg, 0, 0);
    let player: MinimapDot | null = null;
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (d.isPlayer) {
        player = d;
        continue;
      }
      c.fillStyle = d.color;
      c.beginPath();
      c.arc(this.mx(d.x), this.my(d.z), 4 * u, 0, Math.PI * 2);
      c.fill();
    }
    if (player) {
      c.beginPath();
      c.arc(this.mx(player.x), this.my(player.z), 6 * u, 0, Math.PI * 2);
      c.fillStyle = player.color;
      c.fill();
      c.lineWidth = 2 * u;
      c.strokeStyle = WHITE;
      c.stroke();
    }
  }
}
