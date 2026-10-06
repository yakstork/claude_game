/**
 * World — сборка мира: небо, земля, трасса, окружение, свет, туман.
 */
import { Color, DirectionalLight, Fog, HemisphereLight, Mesh, type Scene, type Vector3 } from 'three/webgpu';
import type { Quality } from '../core/types';
import type { Track } from './track';
import { Sky, SUN_DIR } from './sky';
import { Ground } from './ground';
import { TrackMesh } from './trackMesh';
import { Environment } from './environment';
import { PALETTE } from './palette';
import { Weather } from './weather';

export const FOG_COLOR = 0x4a1268;

export class World {
  readonly sky = new Sky();
  readonly ground = new Ground();
  trackMesh: TrackMesh;
  environment: Environment;
  readonly fog = new Fog(FOG_COLOR, 120, 1350);
  readonly sun: DirectionalLight;
  private readonly hemi: HemisphereLight;
  private readonly rim: DirectionalLight;
  private weather: Weather | null = null;
  private stormy = false;
  private quality: Quality = 'high';

  constructor(
    readonly scene: Scene,
    public track: Track,
  ) {
    this.trackMesh = new TrackMesh(track);
    this.environment = new Environment(track);
    scene.background = new Color(PALETTE.void);
    scene.fog = this.fog;

    const hemi = new HemisphereLight(0xc38bff, 0x2a0a3d, 1.6);
    this.hemi = hemi;
    scene.add(hemi);
    this.sun = new DirectionalLight(PALETTE.orange, 2.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(100);
    scene.add(this.sun);
    // холодный контровой свет с противоположной стороны
    const rim = new DirectionalLight(PALETTE.cyan, 0.9);
    rim.position.set(-SUN_DIR.x * 100, 60, -SUN_DIR.z * 100);
    this.rim = rim;
    scene.add(rim);

    scene.add(this.sky.group, this.ground.mesh, this.trackMesh.group, this.environment.group);
    this.applyWeather();
  }

  /** Погода по id трассы: 'storm' — ночной ливень с молниями, остальные не меняются */
  private applyWeather(): void {
    const storm = this.track.id === 'storm';
    this.stormy = storm;
    this.sky.storm.value = storm ? 1 : 0;
    this.sky.flash.value = 0;
    this.fog.color.set(storm ? 0x1c0838 : FOG_COLOR);
    this.setLights(0);
    if (storm && !this.weather) {
      this.weather = new Weather();
      this.weather.rain.setDensity(this.quality === 'high' ? 1 : 0.4);
      this.scene.add(this.weather.rain.mesh);
    }
    if (this.weather) this.weather.rain.mesh.visible = storm;
  }

  private setLights(flash: number): void {
    const k = this.stormy ? 0.55 : 1;
    this.hemi.intensity = 1.6 * k + flash * 3.2;
    this.sun.intensity = (this.stormy ? 0.5 : 2.4) + flash * 2.0;
    this.rim.intensity = (this.stormy ? 0.6 : 0.9) + flash * 1.0;
  }

  /** Сменить трассу: старые дорога и окружение удаляются и освобождаются */
  setTrack(track: Track): void {
    if (track === this.track) return;
    for (const g of [this.trackMesh.group, this.environment.group]) {
      this.scene.remove(g);
      g.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
    }
    this.track = track;
    this.trackMesh = new TrackMesh(track);
    this.environment = new Environment(track);
    this.scene.add(this.trackMesh.group, this.environment.group);
    this.applyWeather();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.weather?.rain.setDensity(q === 'high' ? 1 : 0.4);
    this.fog.near = q === 'high' ? 120 : 80;
    this.fog.far = q === 'high' ? 1350 : 950;
    this.ground.fadeDistance.value = q === 'high' ? 1300 : 800;
  }

  update(cameraPos: Vector3): void {
    this.sky.update(cameraPos);
    if (this.stormy && this.weather) {
      const f = this.weather.update(cameraPos);
      this.sky.flash.value = f;
      this.setLights(f);
    }
  }
}
