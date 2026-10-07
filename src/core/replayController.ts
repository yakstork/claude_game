/**
 * Контроллер повтора и фоторежима. Владеет записью (ReplayRecorder), воспроизведением
 * (позы машин, «телевизионные» камеры, перемотка), оверлеем и фотокамерой.
 * Game даёт только хуки: запись в step, frame() в кадре, enter/leave для UI.
 */
import { MathUtils, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Track } from '../world/track';
import type { EffectsManager } from '../vehicle/effects';
import type { CarModel } from '../vehicle/carModel';
import { CAR_GEOMETRY } from '../vehicle/specs';
import { createVehicleState } from '../vehicle/physics';
import { FLAG_AIR, FLAG_DRIFT, FLAG_NITRO, ReplayRecorder, type PoseSource, type ReplayPlayer } from '../race/replay';
import { createProjection } from '../world/track';
import { ReplayOverlay } from '../ui/replayOverlay';
import type { VehicleState } from './types';

export interface ReplayHost {
  readonly camera: PerspectiveCamera;
  readonly track: Track;
  readonly effects: EffectsManager;
  readonly world: { update(p: Vector3): void };
  readonly cars: readonly { model: CarModel }[];
  readonly playerSlot: number;
  readonly render: { renderer: { domElement: HTMLCanvasElement } };
}

export interface ReplayHooks {
  /** Режим включён: скрыть UI/HUD, заглушить мотор */
  enter(kind: 'replay' | 'photo'): void;
  /** Выход: куда вернуть UI */
  leave(to: 'results' | 'pause'): void;
}

type Mode = 'none' | 'replay' | 'photo';
const CAM_NAMES = ['ПОГОНЯ', 'БАМПЕР', 'У ТРАССЫ', 'СБОКУ', 'ВЕРТОЛЁТ'] as const;
const CAM_CHASE = 0;
const CAM_BUMPER = 1;
const CAM_TRACKSIDE = 2;
const CAM_SIDE = 3;
const CAM_HELI = 4;
/** Ракурсы автопереключения (бампер реже) */
const AUTO_POOL = [CAM_TRACKSIDE, CAM_SIDE, CAM_HELI, CAM_CHASE, CAM_TRACKSIDE, CAM_BUMPER, CAM_SIDE];
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

const _p = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const _proj = createProjection();
const _desPos = new Vector3();
const _desLook = new Vector3();
const Z = new Vector3(0, 0, 1);

export class ReplayController {
  private readonly rec = new ReplayRecorder();
  private recording = false;
  private recT = 0;
  private player: ReplayPlayer | null = null;
  private readonly overlay: ReplayOverlay;
  private mode: Mode = 'none';
  /** Фото-режим поверх (из повтора или паузы) */
  private photoOn = false;
  private photoFrom: 'replay' | 'pause' = 'pause';
  private states: VehicleState[] = [];

  // воспроизведение
  private t = 0;
  private speedIdx = 2;
  private playing = true;
  private cam = CAM_TRACKSIDE;
  private auto = true;
  private nextSwitch = 0;
  private snapCam = true;
  private readonly camPos = new Vector3();
  private readonly camLook = new Vector3();
  private heliAngle = 0;
  private sideSign = 1;

  // фото
  private yaw = 0;
  private pitch = 0.2;
  private dist = 8;
  private readonly keys = new Set<string>();
  private shotPending = false;

  constructor(
    private readonly host: ReplayHost,
    private readonly hooks: ReplayHooks,
    uiLayer: HTMLElement,
  ) {
    this.overlay = new ReplayOverlay(uiLayer, {
      onTogglePause: () => this.togglePlay(),
      onSeek: (d) => this.seek(d),
      onPhoto: () => this.startPhoto('replay'),
      onExit: () => this.exit(),
      onShoot: () => this.shoot(),
      onDrag: (dx, dy) => {
        this.yaw -= dx * 0.006;
        this.pitch = MathUtils.clamp(this.pitch + dy * 0.006, 0.02, 1.45);
      },
      onWheel: (dy) => this.zoom(1 + MathUtils.clamp(dy, -200, 200) * 0.0012),
    });
    window.addEventListener('keydown', (e) => this.onKey(e, true), true);
    window.addEventListener('keyup', (e) => this.onKey(e, false), true);
  }

  // ─── Запись ──────────────────────────────────────────────────────────────

  begin(states: VehicleState[]): void {
    this.leaveSilently();
    this.states = states;
    this.rec.begin(states.length);
    this.recT = 0;
    this.recording = true;
    this.player = null;
    // позы на момент 0: первый кадр пишется сразу
    this.rec.record(0, states);
  }

  /** Вызывать из step(dt) после физики */
  record(dt: number): void {
    if (!this.recording) return;
    this.recT += dt;
    this.rec.record(this.recT, this.states as PoseSource[]);
  }

  stopRecording(): void {
    if (!this.recording) return;
    this.recording = false;
    // последний кадр на финише
    this.rec.record(this.recT + 0.05, this.states as PoseSource[]);
  }

  get canReplay(): boolean {
    return !this.recording && this.rec.frameCount >= 2;
  }

  get active(): boolean {
    return this.mode !== 'none';
  }

  /** Повтор полностью управляет кадром (без физики) */
  get takesOver(): boolean {
    return this.mode === 'replay';
  }

  get photo(): boolean {
    return this.photoOn;
  }

  /** Сбросить режим без хуков (новая гонка / выход в меню) */
  leaveSilently(): void {
    this.mode = 'none';
    this.photoOn = false;
    this.overlay.show(null);
    this.keys.clear();
  }

  // ─── Повтор ──────────────────────────────────────────────────────────────

  startReplay(): void {
    if (this.mode !== 'none') return;
    if (this.recording) this.stopRecording();
    this.player ??= this.rec.finish();
    const pl = this.player;
    if (!pl || pl.carCount !== this.host.cars.length) return;
    this.mode = 'replay';
    this.t = 0;
    this.speedIdx = 2;
    this.playing = true;
    this.auto = true;
    this.cam = CAM_TRACKSIDE;
    this.nextSwitch = 5;
    this.snapCam = true;
    this.initFakeStates();
    this.host.effects.clear();
    this.hooks.enter('replay');
    this.overlay.show('replay');
  }

  private fakes: VehicleState[] = [];

  private initFakeStates(): void {
    this.fakes = this.host.cars.map(() => createVehicleState());
    this.applyPoses(0, true);
  }

  private togglePlay(): void {
    if (this.mode !== 'replay' || this.photoOn) return;
    const pl = this.player!;
    if (!this.playing && this.t >= pl.duration - 1e-3) this.t = 0;
    this.playing = !this.playing;
  }

  private seek(d: number): void {
    const pl = this.player;
    if (this.mode !== 'replay' || !pl || this.photoOn) return;
    this.t = MathUtils.clamp(this.t + d, 0, pl.duration);
    this.host.effects.clear();
    this.snapCam = true;
  }

  private setCam(i: number): void {
    this.cam = i;
    this.snapCam = true;
    this.nextSwitch = this.t + 4 + Math.random() * 3;
  }

  private autoSwitch(): void {
    let n = this.cam;
    for (let k = 0; k < 8 && n === this.cam; k++) n = AUTO_POOL[Math.floor(Math.random() * AUTO_POOL.length)];
    this.setCam(n);
  }

  exit(): void {
    if (this.photoOn) {
      this.photoOn = false;
      if (this.photoFrom === 'replay' && this.mode === 'replay') {
        this.overlay.show('replay');
        return;
      }
      this.mode = 'none';
      this.overlay.show(null);
      this.hooks.leave('pause');
      return;
    }
    if (this.mode === 'replay') {
      this.mode = 'none';
      this.overlay.show(null);
      this.host.effects.clear();
      this.hooks.leave('results');
    }
  }

  // ─── Фоторежим ───────────────────────────────────────────────────────────

  /** Из паузы (from 'pause') или из повтора ('replay') */
  startPhoto(from: 'replay' | 'pause'): void {
    if (this.photoOn) return;
    if (from === 'replay' && this.mode !== 'replay') return;
    if (from === 'pause' && this.mode !== 'none') return;
    this.photoFrom = from;
    this.photoOn = true;
    if (from === 'pause') {
      this.mode = 'photo';
      this.hooks.enter('photo');
    }
    this.targetPos(_p);
    this.dist = 8;
    this.pitch = 0.2;
    // старт: сзади-сбоку от машины игрока
    const st = from === 'replay' ? this.fakes[this.host.playerSlot] : this.states[this.host.playerSlot];
    this.yaw = (st ? st.heading : 0) + Math.PI + 0.6;
    this.keys.clear();
    this.overlay.show('photo');
  }

  private zoom(k: number): void {
    this.dist = MathUtils.clamp(this.dist * k, 3.5, 45);
  }

  private shoot(): void {
    if (!this.photoOn) return;
    this.shotPending = true;
  }

  private targetPos(out: Vector3): void {
    const slot = this.host.playerSlot;
    if (this.mode === 'replay') out.copy(this.fakes[slot].position);
    else out.copy(this.host.cars[slot].model.group.position);
    out.y += 0.7;
  }

  /** Камера фоторежима; вызывать после того, как позы машин в кадре выставлены */
  updatePhoto(dt: number): void {
    const k = this.keys;
    const rot = dt * 1.6;
    if (k.has('ArrowLeft')) this.yaw += rot;
    if (k.has('ArrowRight')) this.yaw -= rot;
    if (k.has('ArrowUp')) this.pitch = Math.min(1.45, this.pitch + rot * 0.7);
    if (k.has('ArrowDown')) this.pitch = Math.max(0.02, this.pitch - rot * 0.7);
    if (k.has('Equal') || k.has('NumpadAdd')) this.zoom(1 - dt * 1.2);
    if (k.has('Minus') || k.has('NumpadSubtract')) this.zoom(1 + dt * 1.2);
    this.targetPos(_p);
    const cp = Math.cos(this.pitch);
    const c = this.host.camera;
    c.position.set(_p.x + Math.sin(this.yaw) * cp * this.dist, _p.y + Math.sin(this.pitch) * this.dist, _p.z + Math.cos(this.yaw) * cp * this.dist);
    c.lookAt(_p);
    this.setFov(c, 50);
  }

  private setFov(c: PerspectiveCamera, fov: number): void {
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }

  /** После render.render(): забрать кадр, если просили снимок */
  afterRender(): void {
    if (!this.shotPending) return;
    this.shotPending = false;
    const canvas = this.host.render.renderer.domElement;
    this.overlay.flash();
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          this.overlay.say('Не удалось сохранить снимок');
          return;
        }
        const d = new Date();
        const pad = (n: number): string => String(n).padStart(2, '0');
        const name = `neon-rush-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        this.overlay.say('Снимок сохранён');
      }, 'image/png');
    } catch {
      this.overlay.say('Не удалось сохранить снимок');
    }
  }

  // ─── Кадр повтора ────────────────────────────────────────────────────────

  /** Полный кадр повтора (кроме render.render()) */
  frame(dt: number): void {
    const pl = this.player;
    if (this.mode !== 'replay' || !pl) return;
    const playing = this.playing && !this.photoOn;
    const rdt = playing ? dt * SPEEDS[this.speedIdx] : 0;
    if (playing) {
      this.t += rdt;
      if (this.t >= pl.duration) {
        this.t = pl.duration;
        this.playing = false;
      }
      if (this.auto && this.t >= this.nextSwitch) this.autoSwitch();
    }
    this.applyPoses(rdt, false);
    if (this.photoOn) this.updatePhoto(dt);
    else this.updateCamera(dt);
    this.host.effects.update(rdt, this.host.camera, 0, 0);
    this.host.world.update(this.host.camera.position);
    this.overlay.setStatus({ time: this.t, duration: pl.duration, speed: SPEEDS[this.speedIdx], paused: !this.playing, camera: CAM_NAMES[this.cam], auto: this.auto });
  }

  /** Позы машин из записи в модели (и фиктивные VehicleState для эффектов) */
  private applyPoses(dt: number, silent: boolean): void {
    const pl = this.player!;
    const r = CAR_GEOMETRY.wheelRadius;
    for (let i = 0; i < this.fakes.length; i++) {
      const st = this.fakes[i];
      pl.sample(this.t, i, st.position, st.quaternion);
      pl.velocity(this.t, i, st.velocity);
      const fl = pl.flags(this.t, i);
      st.nitroActive = (fl & FLAG_NITRO) !== 0;
      st.drifting = (fl & FLAG_DRIFT) !== 0;
      st.onGround = (fl & FLAG_AIR) === 0;
      _f.copy(Z).applyQuaternion(st.quaternion);
      st.heading = Math.atan2(_f.x, _f.z);
      st.speed = st.velocity.x * Math.sin(st.heading) + st.velocity.z * Math.cos(st.heading);
      CAR_GEOMETRY.wheelOffsets.forEach(([x, , z], w) => {
        const ws = st.wheels[w];
        ws.contact.set(x, -r, z).applyQuaternion(st.quaternion).add(st.position);
        ws.onGround = st.onGround;
        ws.skid = st.drifting && w >= 2 && st.onGround ? 0.9 : 0;
        ws.spin += (st.speed * dt) / r;
      });
      this.host.track.project(st.position, st.trackS, _proj);
      st.trackS = _proj.s;
      this.host.cars[i].model.update(st, _proj.height, dt);
      if (!silent && dt > 0) this.host.effects.updateCar(i, st, dt);
    }
  }

  private updateCamera(dt: number): void {
    const st = this.fakes[this.host.playerSlot];
    const c = this.host.camera;
    const p = st.position;
    _f.set(Math.sin(st.heading), 0, Math.cos(st.heading));
    _r.set(_f.z, 0, -_f.x);
    const speed = Math.abs(st.speed);
    let fov = 60;
    let smooth = 0; // 0 — жёстко, иначе коэффициент пружины
    let lookSmooth = 0;
    switch (this.cam) {
      case CAM_CHASE:
        _desPos.copy(p).addScaledVector(_f, -(7.6 + speed * 0.03));
        _desPos.y += 2.9;
        _desLook.copy(p).addScaledVector(_f, 6);
        _desLook.y += 1.2;
        fov = 66 + Math.min(14, speed * 0.1);
        smooth = 9;
        lookSmooth = 14;
        break;
      case CAM_BUMPER:
        _desPos.copy(p).addScaledVector(_f, 2.45);
        _desPos.y += 0.72;
        _desLook.copy(_desPos).addScaledVector(_f, 20);
        _desLook.y -= 0.6;
        fov = 76 + Math.min(10, speed * 0.1);
        break;
      case CAM_TRACKSIDE: {
        // фиксированная камера у трассы впереди машины; перевыбирается при смене и если машина уехала далеко
        const tooFar = this.camPos.distanceToSquared(p) > 170 * 170 || (this.camPos.x - p.x) * _f.x + (this.camPos.z - p.z) * _f.z < -45;
        if (this.snapCam || tooFar) {
          this.host.track.project(p, st.trackS, _proj);
          const ahead = MathUtils.clamp(speed * 1.5, 40, 110);
          const s = this.host.track.sampleAt(_proj.s + ahead);
          this.sideSign = -this.sideSign;
          const off = s.halfWidth + 6.5;
          this.camPos.copy(s.position).addScaledVector(s.right, this.sideSign * off);
          this.camPos.y += 1.4 + Math.random() * 1.6;
          this.camLook.copy(p);
          this.snapCam = true;
        }
        _desPos.copy(this.camPos);
        _desLook.copy(p);
        _desLook.y += 0.7;
        fov = 38;
        lookSmooth = 7;
        break;
      }
      case CAM_SIDE:
        _desPos.copy(p).addScaledVector(_r, 6.8).addScaledVector(_f, speed * 0.12);
        _desPos.y = p.y + 0.75;
        _desLook.copy(p);
        _desLook.y += 0.5;
        fov = 58;
        smooth = 10;
        lookSmooth = 20;
        break;
      default: // вертолёт
        this.heliAngle += dt * 0.22;
        _desPos.set(p.x + Math.sin(this.heliAngle) * 16 + _f.x * speed * 0.35, p.y + 34, p.z + Math.cos(this.heliAngle) * 16 + _f.z * speed * 0.35);
        _desLook.copy(p);
        fov = 55;
        smooth = 5;
        lookSmooth = 12;
        break;
    }
    if (this.snapCam) {
      this.camPos.copy(_desPos);
      this.camLook.copy(_desLook);
      this.snapCam = false;
    } else {
      if (smooth > 0) this.camPos.lerp(_desPos, 1 - Math.exp(-dt * smooth));
      else this.camPos.copy(_desPos);
      if (lookSmooth > 0) this.camLook.lerp(_desLook, 1 - Math.exp(-dt * lookSmooth));
      else this.camLook.copy(_desLook);
    }
    c.position.copy(this.camPos);
    c.lookAt(this.camLook);
    const f = Math.abs(c.fov - fov) > 8 ? fov : c.fov + (fov - c.fov) * Math.min(1, dt * 4);
    this.setFov(c, f);
  }

  // ─── Клавиатура ──────────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (this.mode === 'none') return;
    const code = e.code;
    if (!down) {
      this.keys.delete(code);
      return;
    }
    if (code === 'Escape' || code === 'Backspace') this.exit();
    else if (this.photoOn) {
      if (code === 'Enter' || code === 'KeyP' || code === 'Space') this.shoot();
      else if (code.startsWith('Arrow') || code === 'Equal' || code === 'Minus' || code === 'NumpadAdd' || code === 'NumpadSubtract') this.keys.add(code);
    } else if (this.mode === 'replay') {
      if (code === 'ArrowLeft') this.seek(-5);
      else if (code === 'ArrowRight') this.seek(5);
      else if (code === 'Space') this.togglePlay();
      else if (code === 'ArrowUp') this.speedIdx = Math.min(SPEEDS.length - 1, this.speedIdx + 1);
      else if (code === 'ArrowDown') this.speedIdx = Math.max(0, this.speedIdx - 1);
      else if (code === 'KeyF') this.startPhoto('replay');
      else if (code === 'Digit0' || code === 'Numpad0' || code === 'KeyA') {
        this.auto = true;
        this.nextSwitch = this.t + 4 + Math.random() * 3;
      } else if (/^(Digit|Numpad)[1-5]$/.test(code)) {
        this.auto = false;
        this.setCam(Number(code.slice(-1)) - 1);
      }
    }
    // игровой ввод и меню не должны видеть эти клавиши
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
