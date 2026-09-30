/**
 * RenderSystem — WebGPURenderer (автофолбэк на WebGL2) + RenderPipeline.
 * Bloom только по emissive: сцена рендерится с MRT {output, emissive},
 * bloom применяется к emissive-каналу и складывается с кадром.
 */
import { ACESFilmicToneMapping, RenderPipeline, SRGBColorSpace, WebGPURenderer } from 'three/webgpu';
import type { Camera, Scene } from 'three/webgpu';
import { emissive, mrt, output, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Quality } from './types';

export class RenderSystem {
  readonly renderer: WebGPURenderer;
  private pipeline: RenderPipeline | null = null;
  private quality: Quality = 'high';
  private scene: Scene | null = null;
  private camera: Camera | null = null;

  private constructor(renderer: WebGPURenderer) {
    this.renderer = renderer;
  }

  static async create(container: HTMLElement, forceWebGL = false): Promise<RenderSystem> {
    const renderer = new WebGPURenderer({ antialias: true, forceWebGL, powerPreference: 'high-performance' });
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setSize(window.innerWidth, window.innerHeight);
    await renderer.init();
    container.appendChild(renderer.domElement);
    const sys = new RenderSystem(renderer);
    window.addEventListener('resize', () => sys.resize());
    return sys;
  }

  get backendName(): 'WebGPU' | 'WebGL2' {
    const b = this.renderer.backend as { isWebGPUBackend?: boolean };
    return b.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  }

  /** Сцена и камера для пайплайна (пересоздаётся при смене качества) */
  setView(scene: Scene, camera: Camera): void {
    this.scene = scene;
    this.camera = camera;
    this.rebuild();
  }

  setQuality(q: Quality): void {
    if (q === this.quality && this.pipeline) return;
    this.quality = q;
    this.rebuild();
  }

  getQuality(): Quality {
    return this.quality;
  }

  private rebuild(): void {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1));
    this.pipeline?.dispose();
    this.pipeline = null;
    if (!this.scene || !this.camera || this.quality === 'low') return;

    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive }));
    const color = scenePass.getTextureNode('output');
    const glow = scenePass.getTextureNode('emissive');
    const bloomPass = bloom(glow, 1.15, 0.55, 0.0);
    const pipeline = new RenderPipeline(this.renderer);
    pipeline.outputNode = color.add(bloomPass);
    this.pipeline = pipeline;
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    if (!this.scene || !this.camera) return;
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Число draw calls последнего кадра (для отладки/QA) */
  drawCalls(): number {
    const info = this.renderer.info as unknown as { render: { drawCalls?: number; calls?: number } };
    return info.render.drawCalls ?? info.render.calls ?? 0;
  }
}
