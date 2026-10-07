/**
 * Неоновый маркер «СОПЕРНИК» над машиной соперника: спрайт с текстом из canvas
 * (рисуется кодом, без внешних ассетов). Цвета — из палитры.
 */
import { CanvasTexture, Sprite, SpriteNodeMaterial, type Group } from 'three/webgpu';
import { PALETTE, cssColor } from './palette';

const W = 512;
const H = 160;
/** Высота над точкой машины, м */
const HEIGHT = 2.6;

export class RivalMarker {
  readonly sprite: Sprite;
  private readonly tex: CanvasTexture;
  private readonly mat: SpriteNodeMaterial;
  private t = 0;

  constructor(name: string) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    if (g) {
      g.clearRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = cssColor(PALETTE.magenta);
      g.shadowBlur = 22;
      g.fillStyle = cssColor(PALETTE.pink);
      g.font = 'italic 700 74px "Trebuchet MS", system-ui, sans-serif';
      g.fillText('СОПЕРНИК', W / 2, 48);
      g.shadowColor = cssColor(PALETTE.cyan);
      g.fillStyle = cssColor(PALETTE.cyan);
      g.font = '700 44px "Trebuchet MS", system-ui, sans-serif';
      g.fillText(name, W / 2, 106);
      // стрелка вниз
      g.fillStyle = cssColor(PALETTE.pink);
      g.shadowColor = cssColor(PALETTE.magenta);
      g.beginPath();
      g.moveTo(W / 2 - 16, 130);
      g.lineTo(W / 2 + 16, 130);
      g.lineTo(W / 2, 156);
      g.closePath();
      g.fill();
    }
    this.tex = new CanvasTexture(canvas);
    this.mat = new SpriteNodeMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false });
    this.sprite = new Sprite(this.mat);
    this.sprite.scale.set(5.2, 5.2 * (H / W), 1);
    this.sprite.position.set(0, HEIGHT, 0);
    this.sprite.frustumCulled = false;
  }

  attach(group: Group): void {
    group.add(this.sprite);
  }

  /** Лёгкое покачивание */
  update(dt: number): void {
    this.t += dt;
    this.sprite.position.y = HEIGHT + Math.sin(this.t * 3) * 0.12;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.tex.dispose();
    this.mat.dispose();
  }
}
