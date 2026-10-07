/**
 * Attract mode: после паузы в главном меню фоном идёт демо-гонка ботов, камера
 * переключается как на ТВ-трансляции. Любое нажатие/тап/геймпад — возврат в меню.
 * Модуль не знает про Game: всё общение через AttractHost. Настройки и рекорды
 * не затрагиваются; трасса/время суток меняются только в мире и откатываются.
 */
import { Group, Quaternion, Vector3, type PerspectiveCamera, type Scene } from 'three/webgpu';
import type { Settings, TimeOfDay, VehicleControls, VehicleState } from './types';
import { BotDriver } from '../ai/botDriver';
import { applyDifficulty } from '../ai/difficulty';
import { BOT_PROFILES, CAR_GEOMETRY, specById } from '../vehicle/specs';
import { VehiclePhysics } from '../vehicle/physics';
import { resolveCarCollisions } from '../vehicle/collisions';
import { CarModel } from '../vehicle/carModel';
import { Track, createProjection } from '../world/track';
import { TRACKS } from '../world/trackData';
import type { World } from '../world/world';

export const ATTRACT_IDLE_SECONDS = 15;
const SHOT_MIN = 5;
const SHOT_MAX = 6;
const AUDIO_DUCK = 0.35;
const CARS = 6;

export interface AttractHost {
  scene: Scene;
  camera: PerspectiveCamera;
  world: World;
  /** Главное меню на экране и ничего не мешает (не гонка, не настройки, не подсказки) */
  canStart(): boolean;
  settings(): Settings;
  /** Трасса, на которую вернуть мир при выходе */
  track(): Track;
  setPreviewVisible(v: boolean): void;
  setMenuTranslucent(on: boolean): void;
  /** Множитель громкости (1 — обычная) */
  setVolumes(scale: number): void;
}

type Shot = 'roadside' | 'top' | 'side' | 'chase';
const SHOTS: Shot[] = ['roadside', 'top', 'side', 'chase'];

interface DemoCar {
  physics: VehiclePhysics;
  model: CarModel;
  bot: BotDriver;
  prevPos: Vector3;
  prevQuat: Quaternion;
  pos: Vector3;
  quat: Quaternion;
}

const _proj = createProjection();
const _fwd = new Vector3();
const _right = new Vector3();
const _want = new Vector3();
const _look = new Vector3();

export class Attract {
  active = false;
  /** false — демо выключено (?attract=0, автостарт, e2e) */
  enabled = true;
  /** Время последней активности (реальные часы: dt кадра на слабых машинах занижен) */
  private lastActivity = performance.now();
  private cars: DemoCar[] = [];
  private states: VehicleState[] = [];
  private readonly group = new Group();
  private track: Track | null = null;
  private ticker: HTMLElement | null = null;
  private target = 0;
  private shot: Shot = 'chase';
  private shotT = 0;
  private shotLen = 5;
  private cut = true;
  private readonly camPos = new Vector3();
  private readonly fixedPos = new Vector3();
  private savedFov = 62;
  private swallowClick = false;

  constructor(private readonly host: AttractHost) {
    const press = (e: Event): void => {
      if (this.active) {
        // любое нажатие в демо: выход и гашение события (чтобы не нажать кнопку меню под ним)
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stop();
        if (e.type === 'pointerdown' || e.type === 'touchstart' || e.type === 'mousedown') this.swallowNextClick();
      } else {
        this.lastActivity = performance.now();
      }
    };
    for (const t of ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'wheel']) {
      window.addEventListener(t, press, { capture: true, passive: false });
    }
    window.addEventListener(
      'mousemove',
      () => {
        if (!this.active) this.lastActivity = performance.now();
      },
      { passive: true },
    );
  }

  private swallowNextClick(): void {
    if (this.swallowClick) return;
    this.swallowClick = true;
    const h = (e: Event): void => {
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener('click', h, { capture: true, once: true });
    window.setTimeout(() => {
      window.removeEventListener('click', h, { capture: true });
      this.swallowClick = false;
    }, 500);
  }

  private gamepadActive(): boolean {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.6)) return true;
    }
    return false;
  }

  /** Каждый кадр: считает бездействие в меню / следит за выходом по геймпаду */
  tick(): void {
    if (!this.enabled) return;
    if (this.active) {
      if (this.gamepadActive()) this.stop();
      return;
    }
    if (!this.host.canStart()) {
      this.lastActivity = performance.now();
      return;
    }
    if (this.gamepadActive()) this.lastActivity = performance.now();
    if (performance.now() - this.lastActivity >= ATTRACT_IDLE_SECONDS * 1000) this.start();
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lastActivity = performance.now();
    const host = this.host;
    const trackDef = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    const tods: TimeOfDay[] = ['sunset', 'night', 'dawn'];
    const track = new Track(trackDef);
    this.track = track;
    host.world.setTrack(track);
    host.world.setQuality(host.settings().quality);
    host.world.setTimeOfDay(tods[Math.floor(Math.random() * tods.length)]);
    host.setPreviewVisible(false);

    host.scene.add(this.group);
    this.cars = [];
    this.states = [];
    const profiles = BOT_PROFILES.slice(0, CARS).map((p) => applyDifficulty(p, 'normal'));
    profiles.forEach((profile, slot) => {
      const spec = { ...specById(profile.carId), bodyColor: profile.bodyColor, neonColor: profile.neonColor };
      const physics = new VehiclePhysics(spec, track);
      const pose = track.gridPose(slot);
      physics.reset(pose.position, pose.heading, pose.s);
      const model = new CarModel(spec);
      this.group.add(model.group);
      const st = physics.state;
      this.cars.push({
        physics,
        model,
        bot: new BotDriver(track, profile, Math.floor(Math.random() * 100000) + slot * 77),
        prevPos: st.position.clone(),
        prevQuat: st.quaternion.clone(),
        pos: st.position.clone(),
        quat: st.quaternion.clone(),
      });
      this.states.push(st);
    });
    this.target = Math.floor(Math.random() * this.cars.length);
    this.savedFov = host.camera.fov;
    this.shot = 'chase';
    this.nextShot(true);
    host.setMenuTranslucent(true);
    host.setVolumes(AUDIO_DUCK);
    this.showTicker();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lastActivity = performance.now();
    const host = this.host;
    for (const c of this.cars) c.model.dispose();
    this.group.clear();
    host.scene.remove(this.group);
    this.cars = [];
    this.states = [];
    this.ticker?.remove();
    this.ticker = null;
    host.camera.fov = this.savedFov;
    host.camera.updateProjectionMatrix();
    host.world.setTrack(host.track());
    host.world.setQuality(host.settings().quality);
    host.world.setTimeOfDay(host.settings().timeOfDay);
    host.setPreviewVisible(true);
    host.setMenuTranslucent(false);
    host.setVolumes(1);
    this.track = null;
  }

  /** Фиксированный шаг физики демо */
  step(dt: number): void {
    const track = this.track;
    if (!this.active || !track) return;
    for (const c of this.cars) {
      c.prevPos.copy(c.physics.state.position);
      c.prevQuat.copy(c.physics.state.quaternion);
      const controls: VehicleControls = c.bot.update(dt, c.physics.state, c.physics.spec, this.states);
      c.physics.step(dt, controls);
    }
    resolveCarCollisions(this.cars.map((c) => c.physics));
    for (const c of this.cars) {
      if (c.physics.needsRespawn || c.bot.stuckTime > 4) {
        const st = c.physics.state;
        const sample = track.sampleAt(st.trackS);
        const pos = sample.position.clone();
        pos.y += CAR_GEOMETRY.wheelRadius + 0.3;
        c.physics.reset(pos, Math.atan2(sample.tangent.x, sample.tangent.z), sample.s);
        c.bot.stuckTime = 0;
        c.prevPos.copy(st.position);
        c.prevQuat.copy(st.quaternion);
      }
    }
  }

  /** Кадр: интерполяция машин и «телеоператор» */
  frame(dt: number, alpha: number): void {
    const track = this.track;
    if (!this.active || !track) return;
    const lamp = this.host.world.headlights;
    const hi = this.host.settings().quality === 'high';
    for (const c of this.cars) {
      const st = c.physics.state;
      c.pos.lerpVectors(c.prevPos, st.position, alpha);
      c.quat.slerpQuaternions(c.prevQuat, st.quaternion, alpha);
      track.project(c.pos, st.trackS, _proj);
      c.model.update(st, _proj.height, dt, c.pos, c.quat);
      c.model.group.position.copy(c.pos);
      c.model.group.quaternion.copy(c.quat);
      c.model.setHeadlights(lamp, hi);
    }
    this.shotT += dt;
    if (this.shotT >= this.shotLen) this.nextShot(false);
    this.updateCamera(dt);
  }

  private nextShot(first: boolean): void {
    this.shotT = 0;
    this.shotLen = SHOT_MIN + Math.random() * (SHOT_MAX - SHOT_MIN);
    if (!first) this.target = (this.target + 1 + Math.floor(Math.random() * (this.cars.length - 1))) % this.cars.length;
    let s = this.shot;
    while (s === this.shot) s = SHOTS[Math.floor(Math.random() * SHOTS.length)];
    this.shot = s;
    const st = this.cars[this.target].physics.state;
    if (s === 'roadside' && this.track) {
      // камера у обочины чуть впереди машины; машина проносится мимо
      const sample = this.track.sampleAt(st.trackS + 14 + st.speed * 0.9);
      const side = Math.random() < 0.5 ? 1 : -1;
      this.fixedPos.copy(sample.position).addScaledVector(sample.right, side * (sample.halfWidth - 1.2));
      this.fixedPos.y = sample.position.y + 1.1;
    }
    this.host.camera.fov = s === 'roadside' ? 42 : s === 'top' ? 55 : 62;
    this.host.camera.updateProjectionMatrix();
    this.cut = true;
  }

  private updateCamera(dt: number): void {
    const c = this.cars[this.target];
    const cam = this.host.camera;
    const h = c.physics.state.heading;
    _fwd.set(Math.sin(h), 0, Math.cos(h));
    _right.set(Math.cos(h), 0, -Math.sin(h));
    _look.copy(c.pos).addScaledVector(_fwd, 3);
    switch (this.shot) {
      case 'roadside':
        _want.copy(this.fixedPos);
        break;
      case 'top':
        _want.copy(c.pos).addScaledVector(_fwd, -7).addScaledVector(_right, 3);
        _want.y += 24;
        break;
      case 'side':
        _want.copy(c.pos).addScaledVector(_right, 11).addScaledVector(_fwd, 4);
        _want.y += 1.8;
        break;
      default:
        _want.copy(c.pos).addScaledVector(_fwd, -11);
        _want.y += 4.2;
    }
    if (this.cut || this.shot === 'roadside') {
      this.camPos.copy(_want);
      this.cut = false;
    } else {
      this.camPos.lerp(_want, 1 - Math.exp(-7 * dt));
    }
    cam.position.copy(this.camPos);
    cam.lookAt(_look);
  }

  private showTicker(): void {
    if (!document.getElementById('attract-style')) {
      const style = document.createElement('style');
      style.id = 'attract-style';
      style.textContent = `
.attract-ticker{position:fixed;left:0;right:0;bottom:0;height:2.4em;overflow:hidden;z-index:50;pointer-events:none;
  font:italic 900 clamp(14px,2.6vh,28px) "Arial Black","Trebuchet MS",system-ui,sans-serif;letter-spacing:.12em;
  background:linear-gradient(to top,rgba(13,2,33,.85),rgba(13,2,33,0));color:var(--white,#f5e9ff);
  display:flex;align-items:center;text-shadow:0 0 10px var(--magenta,#ff2a6d),0 0 22px var(--magenta,#ff2a6d)}
.attract-ticker span{display:inline-block;white-space:nowrap;padding-left:100%;animation:attract-scroll 14s linear infinite}
@keyframes attract-scroll{to{transform:translateX(-100%)}}
.nr-ui{transition:opacity .5s}
.nr-ui.attract{opacity:.45}`;
      document.head.appendChild(style);
    }
    const t = document.createElement('div');
    t.className = 'attract-ticker';
    const phrase = 'НАЖМИ ЛЮБУЮ КЛАВИШУ';
    const span = document.createElement('span');
    span.textContent = `${phrase}   ★   ${phrase}   ★   ${phrase}   ★   ${phrase}`;
    t.appendChild(span);
    document.body.appendChild(t);
    this.ticker = t;
  }
}
