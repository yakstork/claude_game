/**
 * Раскладка объектов на трассах: бустер-пластины и канистры нитро.
 * Положение — доля длины круга f (0..1) и смещение от осевой, м (+ вправо).
 * Геометрию трасс (trackData.ts) не трогаем: таблица по track.id.
 */
export interface PickupSpot {
  /** Доля длины круга 0..1 */
  f: number;
  /** Смещение от осевой, м (+ вправо); ограничивается шириной трассы */
  offset: number;
}

export interface PickupLayout {
  pads: PickupSpot[];
  cans: PickupSpot[];
}

const p = (f: number, offset = 0): PickupSpot => ({ f, offset });

export const PICKUP_LAYOUTS: Record<string, PickupLayout> = {
  sunset: {
    // перед трамплином, на выходе из шпильки, задняя прямая, эстакада, выход из левого
    pads: [p(0.012), p(0.34), p(0.45, -3), p(0.575), p(0.76, 4)],
    // внутренние линии шпильки, S-поворотов и левого перед эстакадой; край задней прямой
    cans: [p(0.29, 8), p(0.37, -6), p(0.425, 6), p(0.48, 7), p(0.665, -7), p(0.83, -6), p(0.94, -7), p(0.12, 7)],
  },
  heights: {
    pads: [p(0.012), p(0.33), p(0.46), p(0.62), p(0.72, -3), p(0.96)],
    cans: [p(0.262, 8), p(0.312, -6), p(0.377, 6), p(0.426, 7), p(0.59, -7), p(0.8, -7), p(0.885, 8), p(0.918, -8)],
  },
  coast: {
    pads: [p(0.09), p(0.27), p(0.5), p(0.62, 3), p(0.9)],
    cans: [p(0.156, -7), p(0.331, -8), p(0.39, 7), p(0.7, -8), p(0.76, 7), p(0.84, -7), p(0.45, 7)],
  },
  storm: {
    pads: [p(0.008), p(0.17), p(0.31), p(0.545), p(0.78, -3)],
    cans: [p(0.27, 8), p(0.37, 8), p(0.51, 8), p(0.74, -8), p(0.88, -8), p(0.98, -8), p(0.12, 7), p(0.65, 7)],
  },
};

const EMPTY: PickupLayout = { pads: [], cans: [] };

export function pickupLayoutFor(trackId: string): PickupLayout {
  return PICKUP_LAYOUTS[trackId] ?? EMPTY;
}
