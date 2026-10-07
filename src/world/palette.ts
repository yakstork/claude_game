/** Палитра Neon Rush (GAME_DESIGN.md §4.1). Все цвета 3D-сцены берутся отсюда. */
export const PALETTE = {
  void: 0x0d0221,
  deepViolet: 0x1a0b3b,
  purple: 0x2b0f54,
  violet: 0x7a04eb,
  lilac: 0xb967ff,
  magenta: 0xff2a6d,
  pink: 0xff6ec7,
  cyan: 0x05d9e8,
  orange: 0xff9e3d,
  yellow: 0xffd319,
  white: 0xf5e9ff,
  // небо
  skyZenith: 0x12022e,
  skyHigh: 0x3b0a5e,
  skyMid: 0xb3206e,
  skyHorizon: 0xff7b54,
  asphalt: 0x160a2e,
  // ночь (синтвейв: глубокий фиолет с магентовой кромкой города)
  nightZenith: 0x05010f,
  nightHigh: 0x180536,
  nightMid: 0x3b0c63,
  nightHorizon: 0x7a1f8c,
  nightFog: 0x120330,
  // рассвет (холодный розово-голубой)
  dawnZenith: 0x1b2570,
  dawnHigh: 0x4a5fc8,
  dawnMid: 0xd48ae6,
  dawnHorizon: 0xffb4d2,
  dawnFog: 0x7060b0,
} as const;

export function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
