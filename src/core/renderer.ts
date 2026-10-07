/**
 * RenderSystem — WebGPURenderer (автофолбэк на WebGL2) + RenderPipeline.
 * Bloom только по emissive: сцена рендерится с MRT {output, emissive},
 * bloom применяется к emissive-каналу и складывается с кадром.
 */
import { ACESFilmicToneMapping, RenderPipeline, SRGBColorSpace, WebGPURenderer } from 'three/webgpu';
import type { Camera, Scene } from 'three/webgpu';
import { emissive, float, length, mrt, output, pass, screenUV, smoothstep, vec2 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Quality } from './types';
import { setGlowEnabled } from '../world/materials';
import { isTouchDevice } from './device';

export class RenderSystem {
  readonly renderer: WebGPURenderer;
  private pipeline: RenderPipeline | null = null;
  private quality: Quality = 'high';
  private scene: Scene | null = null;
  private camera: Camera | null = null;
  private bloomNode: { strength: { value: number } } | null = null;
  private neonBoost = 0;

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

  /** Ночью неон сильнее: усиление bloom 0..1 */
  setNeonBoost(k: number): void {
    this.neonBoost = k;
    if (this.bloomNode) this.bloomNode.strength.value = 0.85 * (1 + 0.45 * k);
    this.renderer.toneMappingExposure = 1 - 0.28 * k;
  }

  getQuality(): Quality {
    return this.quality;
  }

  private rebuild(): void {
    const dpr = window.devicePixelRatio || 1;
    // на телефонах экраны с dpr 3 — ограничиваем сильнее (fill-rate)
    const cap = isTouchDevice() ? (this.quality === 'high' ? 1.5 : 1) : this.quality === 'high' ? 2 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.pipeline?.dispose();
    this.pipeline = null;
    this.bloomNode = null;
    const bloomOn = this.quality !== 'low';
    setGlowEnabled(bloomOn);
    if (!this.scene || !this.camera || !bloomOn) return;

    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive }));
    const color = scenePass.getTextureNode('output');
    const glow = scenePass.getTextureNode('emissive');
    const bloomPass = bloom(glow, 0.85, 0.45, 0.0);
    this.bloomNode = bloomPass;
    this.setNeonBoost(this.neonBoost);
    const pipeline = new RenderPipeline(this.renderer);
    // лёгкая виньетка + хроматическая аберрация к краям кадра (только high)
    const off = screenUV.sub(vec2(0.5, 0.5));
    const edge = smoothstep(float(0.25), float(0.75), length(off));
    const shift = off.mul(edge).mul(0.006);
    const aberrated = color.sample(screenUV.add(shift)).r.toVar();
    const rgb = color.sample(screenUV).rgb;
    const ca = rgb.setX(aberrated).setZ(color.sample(screenUV.sub(shift)).b);
    const vignette = float(1.0).sub(edge.mul(0.38));
    pipeline.outputNode = ca.mul(vignette).add(bloomPass);
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
