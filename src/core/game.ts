/**
 * Game — стейт-машина и интеграция модулей (GAME_DESIGN.md §6.9).
 * Каркас: сцена, камера, цикл. Модули подключаются на этапе интеграции.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Line, LineBasicMaterial, PerspectiveCamera, Scene } from 'three/webgpu';
import { GameLoop } from './loop';
import type { RenderSystem } from './renderer';
import { Track } from '../world/track';
import { SUNSET_LOOP } from '../world/trackData';
import { PALETTE } from '../world/palette';

export class Game {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 4000);
  readonly track = new Track(SUNSET_LOOP);
  readonly loop: GameLoop;
  private time = 0;

  constructor(readonly render: RenderSystem) {
    this.scene.background = new Color(PALETTE.void);
    const pos: number[] = [];
    for (let i = 0; i <= this.track.count; i++) {
      const k = (i % this.track.count) * 3;
      pos.push(this.track.positions[k], this.track.positions[k + 1], this.track.positions[k + 2]);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.scene.add(new Line(geo, new LineBasicMaterial({ color: PALETTE.magenta })));
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
    render.setView(this.scene, this.camera);
    this.loop = new GameLoop(
      {
        step: (dt) => {
          this.time += dt;
        },
        frame: () => {
          const a = this.time * 0.1;
          this.camera.position.set(Math.sin(a) * 600, 350, Math.cos(a) * 600);
          this.camera.lookAt(0, 0, 0);
          this.render.render();
        },
      },
      (cb) => this.render.renderer.setAnimationLoop(cb),
    );
  }

  start(): void {
    this.loop.start();
  }
}
