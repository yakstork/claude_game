/** BotDriver — ИИ бота (GAME_DESIGN.md §3.4, §6.4). ЗАГЛУШКА: реализует gameplay-engineer. */
import type { BotProfile, CarSpec, VehicleControls, VehicleState } from '../core/types';
import type { Track } from '../world/track';

export class BotDriver {
  private readonly out: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

  constructor(
    readonly track: Track,
    readonly profile: BotProfile,
    readonly seed: number,
  ) {}

  update(_dt: number, _self: VehicleState, _spec: CarSpec, _others: readonly VehicleState[]): VehicleControls {
    return this.out;
  }
}
