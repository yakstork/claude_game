/**
 * VehiclePhysics — аркадная физика машины (GAME_DESIGN.md §3.1, §6.3).
 * ЗАГЛУШКА каркаса: реализует gameplay-engineer.
 */
import { Quaternion, Vector3 } from 'three';
import type { CarSpec, VehicleControls, VehicleEvent, VehicleState, WheelState } from '../core/types';
import type { Track } from '../world/track';

export function createWheel(): WheelState {
  return { compression: 0, onGround: true, spin: 0, steerAngle: 0, skid: 0, contact: new Vector3() };
}

export function createVehicleState(): VehicleState {
  return {
    position: new Vector3(),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
    heading: 0,
    yawRate: 0,
    speed: 0,
    rpm: 0,
    gear: 1,
    throttle: 0,
    onGround: true,
    airTime: 0,
    driftAngle: 0,
    drifting: false,
    driftIntensity: 0,
    nitro: 0.25,
    nitroActive: false,
    wheels: [createWheel(), createWheel(), createWheel(), createWheel()],
    trackS: 0,
    lateral: 0,
  };
}

export class VehiclePhysics {
  readonly state: VehicleState = createVehicleState();
  readonly events: VehicleEvent[] = [];
  /** Множитель мощности (rubber banding) */
  powerScale = 1;
  /** До старта: мотор крутится, машина стоит */
  frozen = false;

  constructor(
    readonly spec: CarSpec,
    readonly track: Track,
  ) {}

  reset(position: Vector3, heading: number, s: number): void {
    const st = this.state;
    st.position.copy(position);
    st.heading = heading;
    st.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), heading);
    st.velocity.set(0, 0, 0);
    st.speed = 0;
    st.trackS = s;
    st.nitro = 0.25;
  }

  step(_dt: number, _controls: VehicleControls): void {
    this.events.length = 0;
  }
}
