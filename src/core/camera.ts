/**
 * Камеры: chase-камера на пружине (FOV от скорости, тряска, отставание по
 * рысканию — занос хорошо виден) и облёт машины в меню.
 */
import { MathUtils, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { CameraView } from './types';

const BASE_FOV = 62;
const MAX_FOV = 84;

const _fwd = new Vector3();
const _desired = new Vector3();
const _look = new Vector3();

export interface ChaseInput {
  position: Vector3;
  heading: number;
  velocity: Vector3;
  speed: number;
  maxSpeed: number;
  nitro: boolean;
  onGround: boolean;
  drifting: boolean;
}

export class ChaseCamera {
  private yaw = 0;
  private readonly pos = new Vector3();
  private readonly lookAt = new Vector3();
  private shake = 0;
  private t = 0;
  private fov = BASE_FOV;
  private previewAngle = 0.6;
  /** Вид: дальняя / ближняя chase-камера или камера на бампере */
  view: CameraView = 'far';
  /** Множитель вертикального FOV (split-screen: полуэкран очень широкий) */
  fovScale = 1;

  constructor(readonly camera: PerspectiveCamera) {}

  /** Импульс тряски (удар, приземление), 0..1 */
  kick(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Мгновенно поставить камеру за машиной */
  snap(inp: ChaseInput): void {
    this.yaw = inp.heading;
    this.computeDesired(inp, _desired, _look);
    this.pos.copy(_desired);
    this.lookAt.copy(_look);
    this.fov = BASE_FOV;
    this.apply(0);
  }

  private computeDesired(inp: ChaseInput, outPos: Vector3, outLook: Vector3): void {
    const speedK = MathUtils.clamp(Math.abs(inp.speed) / Math.max(1, inp.maxSpeed), 0, 1.3);
    if (this.view === 'bumper') {
      // перед капотом, низко: максимальное ощущение скорости
      _fwd.set(Math.sin(inp.heading), 0, Math.cos(inp.heading));
      outPos.copy(inp.position).addScaledVector(_fwd, 2.45);
      outPos.y += 0.72;
      outLook.copy(outPos).addScaledVector(_fwd, 20);
      outLook.y -= 0.6;
      return;
    }
    const near = this.view === 'near';
    const dist = (near ? 5.4 : 7.6) + speedK * (near ? 1.2 : 1.8) + (inp.nitro ? 0.9 : 0);
    const height = (near ? 2.1 : 2.9) + speedK * 0.3;
    _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    outPos.copy(inp.position).addScaledVector(_fwd, -dist);
    outPos.y += height;
    outLook.copy(inp.position).addScaledVector(_fwd, 5 + speedK * 4);
    outLook.y += 1.25;
  }

  update(dt: number, inp: ChaseInput): void {
    this.t += dt;
    // рыскание камеры догоняет курс — в заносе камера видит машину боком
    const yawRate = inp.drifting ? 3.2 : 5.5;
    let d = inp.heading - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * yawRate);

    this.computeDesired(inp, _desired, _look);
    if (this.view === 'bumper') {
      // жёстко на машине: пружина дала бы «плавающий» вид изнутри кузова
      this.pos.copy(_desired);
      this.lookAt.copy(_look);
      const sk = MathUtils.clamp(Math.abs(inp.speed) / Math.max(1, inp.maxSpeed), 0, 1.3);
      const tf = BASE_FOV + 8 + (MAX_FOV - BASE_FOV - 6) * sk * sk + (inp.nitro ? 6 : 0);
      this.fov += (tf - this.fov) * Math.min(1, dt * 3);
      this.shake = Math.max(0, this.shake - dt * 2.2);
      this.apply(this.shake * 0.2);
      return;
    }
    const k = 1 - Math.exp(-dt * 10);
    this.pos.x += (_desired.x - this.pos.x) * k;
    this.pos.z += (_desired.z - this.pos.z) * k;
    // по вертикали мягче (прыжки), но не отставать сильно
    const ky = 1 - Math.exp(-dt * (inp.onGround ? 8 : 4));
    this.pos.y += (_desired.y - this.pos.y) * ky;
    if (this.pos.y < inp.position.y + 0.8) this.pos.y = inp.position.y + 0.8;
    const kl = 1 - Math.exp(-dt * 14);
    this.lookAt.lerp(_look, kl);

    const speedK = MathUtils.clamp(Math.abs(inp.speed) / Math.max(1, inp.maxSpeed), 0, 1.3);
    const targetFov = BASE_FOV + (MAX_FOV - BASE_FOV - 6) * speedK * speedK + (inp.nitro ? 6 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 3);

    // тряска: лёгкая от скорости + импульсы
    const speedShake = Math.max(0, speedK - 0.55) * 0.06 + (inp.nitro ? 0.05 : 0);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.apply(speedShake + this.shake * 0.35);
  }

  private apply(shake: number): void {
    const c = this.camera;
    c.position.copy(this.pos);
    if (shake > 0) {
      const t = this.t;
      c.position.x += (Math.sin(t * 47.3) + Math.sin(t * 91.1) * 0.5) * shake * 0.12;
      c.position.y += (Math.sin(t * 53.7) + Math.sin(t * 77.9) * 0.5) * shake * 0.1;
    }
    c.lookAt(this.lookAt);
    const fov = this.fov * this.fovScale;
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }

  /** Облёт машины в меню */
  preview(dt: number, target: Vector3, heading: number): void {
    this.t += dt;
    this.previewAngle += dt * 0.35;
    const a = heading + this.previewAngle;
    const r = 10.5 + Math.sin(this.t * 0.4) * 0.6;
    this.pos.set(target.x + Math.sin(a) * r, target.y + 2.4 + Math.sin(this.t * 0.3) * 0.3, target.z + Math.cos(a) * r);
    this.lookAt.set(target.x, target.y - 0.35, target.z);
    this.fov = 42;
    this.apply(0);
  }
}
