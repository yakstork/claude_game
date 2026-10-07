/**
 * Время суток: пресеты неба/тумана/света и общие uniform-ы, которые читают
 * небо, земля и здания. Цвета — только из палитры.
 */
import { Color, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { TimeOfDay } from '../core/types';
import { PALETTE } from './palette';

export interface TodPreset {
  zenith: number;
  high: number;
  mid: number;
  horizon: number;
  fog: number;
  /** Направление на солнце (нормализуется) */
  sunDir: Vector3;
  sunTop: number;
  sunBottom: number;
  /** Цвет свечения у солнца и горизонта */
  glow: number;
  /** 0 — солнца нет */
  sunVis: number;
  /** 0 — обычное небо, 1 — ночь: луна, много звёзд */
  night: number;
  hemiColor: number;
  hemiIntensity: number;
  sunLight: number;
  sunLightIntensity: number;
  rimIntensity: number;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

export const TOD_PRESETS: Record<TimeOfDay, TodPreset> = {
  sunset: {
    zenith: PALETTE.skyZenith,
    high: PALETTE.skyHigh,
    mid: PALETTE.skyMid,
    horizon: PALETTE.skyHorizon,
    fog: 0x4a1268,
    sunDir: V(1, 0.075, 0.12),
    sunTop: PALETTE.yellow,
    sunBottom: PALETTE.magenta,
    glow: PALETTE.orange,
    sunVis: 1,
    night: 0,
    hemiColor: 0xc38bff,
    hemiIntensity: 1.6,
    sunLight: PALETTE.orange,
    sunLightIntensity: 2.4,
    rimIntensity: 0.9,
  },
  night: {
    zenith: PALETTE.nightZenith,
    high: PALETTE.nightHigh,
    mid: PALETTE.nightMid,
    horizon: PALETTE.nightHorizon,
    fog: PALETTE.nightFog,
    sunDir: V(0.85, 0.38, -0.25), // положение луны
    sunTop: PALETTE.white,
    sunBottom: PALETTE.lilac,
    glow: PALETTE.magenta,
    sunVis: 0,
    night: 1,
    hemiColor: PALETTE.lilac,
    hemiIntensity: 0.5,
    sunLight: PALETTE.lilac,
    sunLightIntensity: 0.6,
    rimIntensity: 0.8,
  },
  dawn: {
    zenith: PALETTE.dawnZenith,
    high: PALETTE.dawnHigh,
    mid: PALETTE.dawnMid,
    horizon: PALETTE.dawnHorizon,
    fog: PALETTE.dawnFog,
    sunDir: V(0.55, 0.07, -0.83),
    sunTop: PALETTE.white,
    sunBottom: PALETTE.pink,
    glow: PALETTE.pink,
    sunVis: 1,
    night: 0,
    hemiColor: 0xb9b0ff,
    hemiIntensity: 1.7,
    sunLight: PALETTE.pink,
    sunLightIntensity: 1.9,
    rimIntensity: 1.0,
  },
};

/** Цвета неба как uniform-ы (ground берёт отсюда цвет дымки) */
export const skyUniforms = {
  zenith: uniform(new Color(PALETTE.skyZenith)),
  high: uniform(new Color(PALETTE.skyHigh)),
  mid: uniform(new Color(PALETTE.skyMid)),
  horizon: uniform(new Color(PALETTE.skyHorizon)),
};

/** Направление на солнце (ночью — на луну) и цвета блика: общие uniform-ы неба и моря */
export const sunDirUniform = uniform(new Vector3(1, 0.075, 0.12).normalize());
export const sunGlintTop = uniform(new Color(PALETTE.yellow));
export const sunGlintBottom = uniform(new Color(PALETTE.magenta));

/** 0..1: ночью окна и неон города ярче */
export const nightBoost = uniform(0);
