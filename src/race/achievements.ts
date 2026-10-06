/** Достижения: чистая логика (без DOM) + сохранение в localStorage. */

export type AchievementMode = 'race' | 'timeAttack' | 'cup';
export type AchievementDifficulty = 'easy' | 'normal' | 'hard';

/** Итоги одной завершённой гонки — собирает игра. */
export interface RaceStats {
  mode: AchievementMode;
  difficulty: AchievementDifficulty;
  trackId: string;
  /** Место игрока (1 = победа) */
  position: number;
  /** Сколько гонщиков на трассе (с игроком); 1 — заезд на время без ботов */
  racers: number;
  /** Очки дрифта за гонку */
  driftScore: number;
  /** Лучшее комбо дрифта за гонку */
  bestCombo: number;
  /** Идеальный старт (нитро на старте в окно) */
  perfectStart: boolean;
  /** Сколько раз ударился о стену */
  wallHits: number;
  /** Поставлен новый рекорд круга */
  newBestLap: boolean;
  /** Кубок завершён и выигран (только на последней гонке кубка) */
  cupWon: boolean;
}

/** Сохраняемое состояние. */
export interface AchievementProgress {
  unlocked: string[];
  /** Всего завершённых гонок */
  races: number;
  /** Победы подряд (в гонках с соперниками) */
  winStreak: number;
  /** Подиумы (места 1–3 в гонках с соперниками) */
  podiums: number;
  /** id трасс, на которых есть победа */
  wonTracks: string[];
}

export interface AchievementDef {
  id: string;
  title: string;
  /** Условие (показывается и на закрытой карточке) */
  desc: string;
  /** Символ-иконка (один глиф) */
  icon: string;
  tone: 'pink' | 'cyan' | 'orange' | 'yellow';
  /** Проверка после обновления счётчиков */
  test(s: RaceStats, p: AchievementProgress): boolean;
}

export const STORAGE_KEY = 'neonrush.achievements.v1';
export const TRACK_IDS = ['sunset', 'heights', 'coast', 'storm'] as const;
export const DRIFT_COMBO_GOAL = 4000;
export const DRIFT_SCORE_GOAL = 20000;
export const RACES_GOAL = 10;
export const STREAK_GOAL = 3;
export const PODIUMS_GOAL = 5;

/** Победа над соперниками (заезд на время не считается). */
export function isWin(s: RaceStats): boolean {
  return s.racers > 1 && s.position === 1 && s.mode !== 'timeAttack';
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_win', title: 'ПЕРВАЯ КРОВЬ', desc: 'Выиграй гонку с соперниками', icon: '★', tone: 'yellow', test: (s) => isWin(s) },
  { id: 'hard_win', title: 'НА ПРЕДЕЛЕ', desc: 'Выиграй гонку на сложности «Хард»', icon: '☠', tone: 'pink', test: (s) => isWin(s) && s.difficulty === 'hard' },
  { id: 'cup_win', title: 'ЧЕМПИОН', desc: 'Выиграй кубок', icon: '♛', tone: 'yellow', test: (s) => s.cupWon },
  { id: 'record_lap', title: 'РЕКОРДСМЕН', desc: 'Побей свой рекорд круга в заезде на время', icon: '⏱', tone: 'cyan', test: (s) => s.mode === 'timeAttack' && s.newBestLap },
  { id: 'combo_4000', title: 'КОМБО-МАСТЕР', desc: `Собери комбо дрифта от ${DRIFT_COMBO_GOAL} очков`, icon: '≋', tone: 'pink', test: (s) => s.bestCombo >= DRIFT_COMBO_GOAL },
  { id: 'drift_20k', title: 'КОРОЛЬ ДРИФТА', desc: `Набери ${DRIFT_SCORE_GOAL} очков дрифта за гонку`, icon: '◢', tone: 'orange', test: (s) => s.driftScore >= DRIFT_SCORE_GOAL },
  { id: 'perfect_start', title: 'ИДЕАЛЬНЫЙ СТАРТ', desc: 'Выполни идеальный старт', icon: '⚡', tone: 'cyan', test: (s) => s.perfectStart },
  { id: 'clean_race', title: 'ЧИСТАЯ ГОНКА', desc: 'Финишируй без единого удара о стену', icon: '✦', tone: 'cyan', test: (s) => s.wallHits === 0 },
  { id: 'all_tracks', title: 'ПОКОРИТЕЛЬ ТРАСС', desc: 'Выиграй на каждой из четырёх трасс', icon: '◈', tone: 'orange', test: (_s, p) => TRACK_IDS.every((t) => p.wonTracks.includes(t)) },
  { id: 'races_10', title: 'ВЕТЕРАН', desc: `Заверши ${RACES_GOAL} гонок`, icon: '⚑', tone: 'pink', test: (_s, p) => p.races >= RACES_GOAL },
  { id: 'streak_3', title: 'СЕРИЯ', desc: `Выиграй ${STREAK_GOAL} гонки подряд`, icon: '▲', tone: 'yellow', test: (_s, p) => p.winStreak >= STREAK_GOAL },
  { id: 'podium_5', title: 'ПОДИУМ', desc: `Займи место в тройке ${PODIUMS_GOAL} раз`, icon: '♦', tone: 'orange', test: (_s, p) => p.podiums >= PODIUMS_GOAL },
];

export const ACHIEVEMENT_IDS: readonly string[] = ACHIEVEMENTS.map((a) => a.id);

export function emptyProgress(): AchievementProgress {
  return { unlocked: [], races: 0, winStreak: 0, podiums: 0, wonTracks: [] };
}

/**
 * Учесть гонку: обновить счётчики и проверить достижения.
 * Возвращает id только что открытых и новое состояние (входное не мутируется).
 */
export function evaluate(
  stats: RaceStats,
  progress: AchievementProgress,
): { unlocked: string[]; progress: AchievementProgress } {
  const p: AchievementProgress = {
    unlocked: progress.unlocked.slice(),
    races: progress.races + 1,
    winStreak: progress.winStreak,
    podiums: progress.podiums,
    wonTracks: progress.wonTracks.slice(),
  };
  // серия и подиумы считаются в гонках с соперниками (заезд на время их не прерывает)
  if (stats.racers > 1 && stats.mode !== 'timeAttack') {
    if (stats.position === 1) {
      p.winStreak += 1;
      if (!p.wonTracks.includes(stats.trackId)) p.wonTracks.push(stats.trackId);
    } else {
      p.winStreak = 0;
    }
    if (stats.position <= 3) p.podiums += 1;
  }
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.unlocked.includes(a.id)) continue;
    if (a.test(stats, p)) {
      p.unlocked.push(a.id);
      unlocked.push(a.id);
    }
  }
  return { unlocked, progress: p };
}

// ── сохранение ──────────────────────────────────────────────────────────────

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e9) : 0;
}

function strings(v: unknown, allowed?: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || out.includes(x)) continue;
    if (allowed && !allowed.includes(x)) continue;
    out.push(x);
  }
  return out;
}

/** Привести произвольные данные к корректному состоянию (мусор → нули). */
export function sanitize(raw: unknown): AchievementProgress {
  if (typeof raw !== 'object' || raw === null) return emptyProgress();
  const o = raw as Record<string, unknown>;
  return {
    unlocked: strings(o.unlocked, ACHIEVEMENT_IDS),
    races: count(o.races),
    winStreak: count(o.winStreak),
    podiums: count(o.podiums),
    wonTracks: strings(o.wonTracks).slice(0, 32),
  };
}

export function loadProgress(): AchievementProgress {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? sanitize(JSON.parse(s)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(p: AchievementProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* хранилище недоступно */
  }
}
