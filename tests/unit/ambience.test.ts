import { describe, expect, it } from 'vitest';
import { AudioManager } from '../../src/audio/audioManager';

describe('AudioManager: амбиенс, гром, интенсивность музыки', () => {
  it('безопасны до unlock()', () => {
    const a = new AudioManager();
    expect(() => {
      a.setAmbience('rain');
      a.setAmbience('sea');
      a.setAmbience(null);
      a.thunder(0.8);
      a.thunder(NaN);
      a.setMusicIntensity(1);
      a.playMusic('race');
      a.setMusicIntensity(0);
    }).not.toThrow();
  });
});
