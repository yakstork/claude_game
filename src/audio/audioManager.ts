/** AudioManager — синтезированный звук (GAME_DESIGN.md §4.6, §6.7). ЗАГЛУШКА: реализует ui-audio-engineer. */
import type { EngineAudioParams, MusicTrack, SfxName } from '../core/types';

export class AudioManager {
  async unlock(): Promise<void> {}
  setVolumes(_master: number, _music: number, _sfx: number): void {}
  playMusic(_track: MusicTrack | null): void {}
  updateEngine(_p: EngineAudioParams | null): void {}
  play(_sfx: SfxName): void {}
  setPaused(_p: boolean): void {}
}
