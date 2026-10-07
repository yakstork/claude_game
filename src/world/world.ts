/**
 * World — сборка мира: небо, земля, трасса, окружение, свет, туман.
 */
import { Color, DirectionalLight, Fog, HemisphereLight, Mesh, type Scene, type Vector3 } from 'three/webgpu';
import type { Quality, TimeOfDay, Weather as WeatherKind } from '../core/types';
import type { Track } from './track';
import { Sky, SUN_DIR } from './sky';
import { Ground } from './ground';
import { TrackMesh } from './trackMesh';
import { Environment } from './environment';
import { PALETTE } from './palette';
import { Weather } from './weather';
import { nightBoost, skyUniforms, TOD_PRESETS } from './timeOfDay';

const _fogTint = new Color();
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
  /** Storm Boulevard: ночная гроза с молниями */
  private stormy = false;
  /** Дождь: Storm Boulevard или погода «дождь» на любой трассе */
  private rainy = false;
  private foggy = false;
  private weatherKind: WeatherKind = 'clear';
  private quality: Quality = 'high';
  private tod: TimeOfDay = 'sunset';

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

  /** Погода: Storm Boulevard — всегда ночной ливень с молниями; на остальных — по настройке (ясно / дождь / туман) */
  private applyWeather(): void {
    const storm = this.track.id === 'storm';
    this.stormy = storm;
    this.rainy = storm || this.weatherKind === 'rain';
    this.foggy = !storm && this.weatherKind === 'fog';
    this.sky.storm.value = storm ? 1 : this.rainy ? 0.7 : 0;
    this.sky.flash.value = 0;
    // мокрая дорога: шейдер асфальта собирается заново при смене
    if (this.trackMesh.wet !== this.rainy && !storm) this.rebuildTrackMesh();
    this.applyTimeOfDay();
    if (this.rainy && !this.weather) {
      this.weather = new Weather();
      this.weather.rain.setDensity(this.quality === 'high' ? 1 : 0.4);
      this.scene.add(this.weather.rain.mesh);
    }
    if (this.weather) this.weather.rain.mesh.visible = this.rainy;
  }

  /** Погода из настроек: ясно / дождь / туман */
  setWeather(w: WeatherKind): void {
    if (w === this.weatherKind) return;
    this.weatherKind = w;
    this.applyWeather();
  }

  private rebuildTrackMesh(): void {
    this.scene.remove(this.trackMesh.group);
    this.trackMesh.group.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.trackMesh = new TrackMesh(this.track, this.rainy);
    this.scene.add(this.trackMesh.group);
  }

  /** Молнии: на Storm Boulevard всегда, под дождём на других трассах — только ночью */
  private get lightningOn(): boolean {
    return this.stormy || (this.rainy && this.tod === 'night');
  }

  private setLights(flash: number): void {
    const p = TOD_PRESETS[this.tod];
    const k = this.stormy ? 0.55 : this.rainy ? 0.75 : 1;
    const dim = this.rainy && !this.stormy ? 0.6 : 1;
    this.hemi.intensity = (this.stormy ? 1.6 : p.hemiIntensity) * k + flash * 3.2;
    this.sun.intensity = (this.stormy ? 0.5 : p.sunLightIntensity * dim) + flash * 2.0;
    this.rim.intensity = (this.stormy ? 0.6 : p.rimIntensity * dim) + flash * 1.0;
  }

  /** Время суток: на Storm Boulevard всегда ночная гроза (погода приоритетнее) */
  setTimeOfDay(t: TimeOfDay): void {
    this.tod = t;
    this.applyTimeOfDay();
  }

  /** Фары включены: ночь или гроза (0..1) */
  get headlights(): number {
    return this.stormy || this.foggy || this.tod === 'night' ? 1 : 0;
  }

  /** Ночной вид (для усиления неона): ночь или гроза */
  get isNight(): boolean {
    return this.headlights > 0;
  }

  private applyTimeOfDay(): void {
    const p = TOD_PRESETS[this.stormy ? 'sunset' : this.tod];
    this.sky.setPreset(p);
    nightBoost.value = this.headlights;
    this.fog.color.set(this.stormy ? 0x1c0838 : p.fog);
    if (this.foggy) {
      // плотный неоновый туман: цвет тумана и дальнего неба смещается к розово-сиреневому свечению
      this.fog.color.lerp(_fogTint.set(PALETTE.lilac), 0.35).lerp(_fogTint.set(PALETTE.magenta), 0.18);
      for (const u of [skyUniforms.horizon, skyUniforms.mid, skyUniforms.high]) u.value.lerp(this.fog.color, 0.8);
      skyUniforms.zenith.value.lerp(this.fog.color, 0.45);
    }
    this.updateFog();
    this.hemi.color.set(p.hemiColor);
    this.sun.color.set(p.sunLight);
    this.sun.position.copy(p.sunDir).multiplyScalar(100);
    this.rim.position.set(-p.sunDir.x * 100, 60, -p.sunDir.z * 100);
    this.setLights(0);
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
    this.trackMesh = new TrackMesh(track, this.weatherKind === 'rain');
    this.environment = new Environment(track);
    this.scene.add(this.trackMesh.group, this.environment.group);
    this.applyWeather();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.weather?.rain.setDensity(q === 'high' ? 1 : 0.4);
    this.updateFog();
  }

  /** Дальность тумана: туман — плотная стена, дождь — заметно ближе, ясно — по качеству */
  private updateFog(): void {
    const high = this.quality === 'high';
    if (this.foggy) {
      this.fog.near = 6;
      this.fog.far = high ? 260 : 220;
    } else if (this.rainy) {
      this.fog.near = high ? 60 : 40;
      this.fog.far = high ? 750 : 600;
    } else {
      this.fog.near = high ? 120 : 80;
      this.fog.far = high ? 1350 : 950;
    }
    this.ground.fadeDistance.value = this.foggy ? 320 : this.rainy ? (high ? 800 : 600) : high ? 1300 : 800;
  }

  /** Счётчик молний (0 — погоды нет) */
  get lightningStrikes(): number {
    return this.lightningOn && this.weather ? this.weather.lightning.strikes : 0;
  }

  /** Тип звукового фона трассы */
  get ambience(): 'rain' | 'sea' | null {
    return this.rainy ? 'rain' : this.track.id === 'coast' ? 'sea' : null;
  }

  update(cameraPos: Vector3): void {
    this.sky.update(cameraPos);
    if (this.rainy && this.weather) {
      const f = this.weather.update(cameraPos);
      if (this.lightningOn) {
        this.sky.flash.value = f;
        this.setLights(f);
      }
    }
  }
}
