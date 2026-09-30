/**
 * Отладочная панель тюнинга управления (только при ?debug).
 * lil-gui подгружается динамически, чтобы не попадать в основной бандл.
 * Панель универсальна: всё получает через параметры, игровых модулей не знает.
 */
import type { TuningParam } from '../core/types';

type Configs = Record<string, Record<string, number>>;

export interface DebugPanelOptions {
  /** Живые конфиги по id машины: панель мутирует их напрямую */
  configs: Configs;
  /** Заводские значения (для сброса) */
  defaults: Configs;
  carNames: Record<string, string>;
  /** Метаданные ключей configs (группа, подпись, min/max/step) */
  params: TuningParam[];
  /** Дополнительный общий конфиг (например, сглаживание клавиатуры) */
  extra?: { title: string; config: Record<string, number>; defaults: Record<string, number>; params: TuningParam[] };
  /** id машины игрока (по умолчанию редактируется она) */
  getActiveCarId(): string;
  /** Телеметрия для вывода, вызывается ~10 раз/с */
  telemetry(): Record<string, string | number | boolean>;
}

export interface DebugPanel {
  dispose(): void;
  setActiveCar(id: string): void;
}

export const TUNING_STORAGE_KEY = 'neonrush.tuning.v1';
const TELEMETRY_MS = 100;

interface StoredTuning {
  cars?: Record<string, Record<string, number>>;
  extra?: Record<string, number>;
}

// ── сохранение / загрузка (чистые функции, тестируются в Node) ────────────────

function diffConfig(cur: Record<string, number>, def: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(cur)) {
    if (cur[k] !== def[k]) out[k] = cur[k];
  }
  return out;
}

/** Только изменённые относительно defaults ключи; пустой результат — null. */
export function collectTuningOverrides(
  configs: Configs,
  defaults: Configs,
  extra?: { config: Record<string, number>; defaults: Record<string, number> },
): StoredTuning | null {
  const cars: Record<string, Record<string, number>> = {};
  let any = false;
  for (const id of Object.keys(configs)) {
    const d = diffConfig(configs[id], defaults[id] ?? {});
    if (Object.keys(d).length > 0) {
      cars[id] = d;
      any = true;
    }
  }
  const out: StoredTuning = {};
  if (any) out.cars = cars;
  if (extra) {
    const d = diffConfig(extra.config, extra.defaults);
    if (Object.keys(d).length > 0) {
      out.extra = d;
      any = true;
    }
  }
  return any ? out : null;
}

function applyNumbers(target: Record<string, number>, src: unknown): void {
  if (typeof src !== 'object' || src === null) return;
  const rec = src as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    // только существующие ключи и конечные числа
    if (k in target && typeof v === 'number' && Number.isFinite(v)) target[k] = v;
  }
}

/** Применяет сохранённое из localStorage; мусор молча игнорируется. */
export function loadTuningOverrides(configs: Configs, extra?: Record<string, number>): void {
  try {
    const raw = localStorage.getItem(TUNING_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== 'object' || data === null) return;
    const st = data as StoredTuning;
    if (typeof st.cars === 'object' && st.cars !== null) {
      for (const id of Object.keys(st.cars)) {
        const cfg = configs[id];
        if (cfg) applyNumbers(cfg, st.cars[id]);
      }
    }
    if (extra) applyNumbers(extra, st.extra);
  } catch {
    /* localStorage недоступен или JSON битый */
  }
}

function saveTuning(o: DebugPanelOptions): void {
  try {
    const data = collectTuningOverrides(o.configs, o.defaults, o.extra);
    if (data) localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(data));
    else localStorage.removeItem(TUNING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function fmtTelemetry(v: string | number | boolean): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return v;
}

/** Снимает фокус с поля панели, чтобы W/A/S/D не попадали в input. */
function blurActive(root: HTMLElement): void {
  const a = document.activeElement;
  if (a instanceof HTMLElement && root.contains(a)) a.blur();
}

// ── панель ────────────────────────────────────────────────────────────────────

export async function createDebugPanel(opts: DebugPanelOptions): Promise<DebugPanel> {
  const { default: GUI } = await import('lil-gui');
  type Ctrl = ReturnType<InstanceType<typeof GUI>['add']>;

  const gui = new GUI({ title: 'NEON RUSH · ТЮНИНГ', width: 300 });
  gui.domElement.classList.add('nr-debug');
  const root = gui.domElement;
  // Игровые клавиши (буквы, пробел, Shift) в числовом поле не печатаем: снимаем фокус,
  // а событие всплывает дальше — до игрового ввода на window.
  root.addEventListener(
    'keydown',
    (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      const isGameKey = /^Key[A-Z]$/.test(e.code) || e.code === 'Space' || e.code.startsWith('Shift');
      if (isGameKey) {
        e.preventDefault();
        t.blur();
      }
    },
    true,
  );

  // ── выбор машины
  const carIds = Object.keys(opts.configs);
  let activeId = carIds.includes(opts.getActiveCarId()) ? opts.getActiveCarId() : carIds[0];
  const carState = { car: activeId };
  const carOptions: Record<string, string> = {};
  for (const id of carIds) carOptions[opts.carNames[id] ?? id] = id;

  // proxy-объект, к которому привязаны слайдеры; при смене машины перезаполняется
  const view: Record<string, number> = {};
  const sliders: Ctrl[] = [];

  const refreshView = (): void => {
    const cfg = opts.configs[activeId] ?? {};
    for (const p of opts.params) view[p.key] = cfg[p.key] ?? opts.defaults[activeId]?.[p.key] ?? p.min;
    for (const c of sliders) c.updateDisplay();
  };

  const carCtrl = gui
    .add(carState, 'car', carOptions)
    .name('Машина')
    .onChange((id: string) => {
      activeId = id;
      refreshView();
      blurActive(root);
    });

  // ── папки по группам
  const folders = new Map<string, InstanceType<typeof GUI>>();
  let firstGroup = true;
  for (const p of opts.params) {
    let f = folders.get(p.group);
    if (!f) {
      f = gui.addFolder(p.group);
      if (!firstGroup) f.close();
      firstGroup = false;
      folders.set(p.group, f);
    }
    view[p.key] = opts.configs[activeId]?.[p.key] ?? p.min;
    const c = f
      .add(view, p.key, p.min, p.max, p.step)
      .name(p.label)
      .onChange((v: number) => {
        const cfg = opts.configs[activeId];
        if (!cfg) return;
        cfg[p.key] = v;
        saveTuning(opts);
      })
      .onFinishChange(() => blurActive(root));
    sliders.push(c);
  }
  refreshView();

  // ── общий (extra) конфиг
  const extraCtrls: Ctrl[] = [];
  if (opts.extra) {
    const ex = opts.extra;
    const f = gui.addFolder(ex.title);
    f.close();
    for (const p of ex.params) {
      const c = f
        .add(ex.config, p.key, p.min, p.max, p.step)
        .name(p.label)
        .onChange(() => saveTuning(opts))
        .onFinishChange(() => blurActive(root));
      extraCtrls.push(c);
    }
  }

  // ── кнопки
  const refreshAll = (): void => {
    refreshView();
    for (const c of extraCtrls) c.updateDisplay();
  };
  const actions = {
    resetCar: (): void => {
      const cfg = opts.configs[activeId];
      if (cfg) Object.assign(cfg, opts.defaults[activeId]);
      refreshAll();
      saveTuning(opts);
      blurActive(root);
    },
    resetAll: (): void => {
      for (const id of Object.keys(opts.configs)) Object.assign(opts.configs[id], opts.defaults[id]);
      if (opts.extra) Object.assign(opts.extra.config, opts.extra.defaults);
      refreshAll();
      saveTuning(opts);
      blurActive(root);
    },
    copyJson: (): void => {
      const json = JSON.stringify({ cars: opts.configs, extra: opts.extra?.config }, null, 2);
      const fallback = (): void => console.log(json);
      try {
        void navigator.clipboard.writeText(json).catch(fallback);
      } catch {
        fallback();
      }
      blurActive(root);
    },
    collapse: (): void => {
      gui.close();
      blurActive(root);
    },
  };
  gui.add(actions, 'resetCar').name('Сбросить машину');
  gui.add(actions, 'resetAll').name('Сбросить всё');
  gui.add(actions, 'copyJson').name('Копировать JSON');
  gui.add(actions, 'collapse').name('Свернуть');

  // ── телеметрия (read-only, ~10 Гц)
  const teleFolder = gui.addFolder('Телеметрия');
  const teleView: Record<string, string> = {};
  const teleCtrls = new Map<string, Ctrl>();
  const pollTelemetry = (): void => {
    if (gui._closed) return;
    const t = opts.telemetry();
    for (const key of Object.keys(t)) {
      const s = fmtTelemetry(t[key]);
      const c = teleCtrls.get(key);
      if (!c) {
        teleView[key] = s;
        const nc = teleFolder.add(teleView, key).name(key).disable();
        teleCtrls.set(key, nc);
      } else if (teleView[key] !== s) {
        teleView[key] = s;
        c.updateDisplay();
      }
    }
  };
  pollTelemetry();
  const timer = window.setInterval(pollTelemetry, TELEMETRY_MS);

  // Escape / Enter в поле — снять фокус (игровые клавиши снова работают)
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Enter') blurActive(root);
  };
  root.addEventListener('keydown', onKey);

  return {
    dispose(): void {
      window.clearInterval(timer);
      root.removeEventListener('keydown', onKey);
      gui.destroy();
    },
    setActiveCar(id: string): void {
      if (!(id in opts.configs)) return;
      activeId = id;
      carState.car = id;
      carCtrl.updateDisplay();
      refreshView();
    },
  };
}
