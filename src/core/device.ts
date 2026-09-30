/** Определение возможностей устройства (безопасно вне браузера). */

/** Основной ввод — касание (телефон/планшет) */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
    return coarse && touch;
  } catch {
    return false;
  }
}

/** Лёгкая вибрация (Android/Chrome; на iOS не поддерживается — молча игнорируем) */
export function vibrate(ms: number): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  } catch {
    /* нет поддержки */
  }
}
