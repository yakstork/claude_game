# Neon Rush — Game Design Document

Браузерная 3D-аркадная гонка в эстетике ретро-80-х и синтвейва. Вечный закат,
полосатое солнце, неоновая сетка, пальмы, low-poly город. Одиночные гонки на
3 круга против 5 ботов. Главная механика — **дрифт → нитро → скорость**.

---

## 1. Столпы дизайна

1. **Ощущение скорости важнее реализма.** Камера, FOV, линии скорости, звук и
   bloom работают на чувство скорости.
2. **Дрифт — сердце игры.** Занос легко начать (ручник или резкий поворот на
   скорости), им приятно управлять, он награждается очками и нитро.
3. **Цельный стиль.** Всё процедурное: flat shading, vertex colors, emissive-
   неон. Никаких серых прямоугольников и фото-текстур.
4. **Напряжённая гонка.** Боты с вариациями траектории, обгонами и мягким
   rubber banding — лидер не уезжает навсегда, аутсайдер не безнадёжен.

## 2. Игровой цикл

```
Меню (выбор машины, настройки) → Обратный отсчёт 3-2-1-GO → Гонка 3 круга
   → Финиш игрока → Экран результатов (позиции, времена, лучший круг, очки дрифта,
     новые рекорды) → Меню / Ещё раз
Esc / Start на геймпаде — пауза (Продолжить, Рестарт, Настройки, В меню).
```

## 3. Механики

### 3.1 Машина (аркадная физика, `src/vehicle/physics.ts`)
- **Raycast-подвеска:** 4 луча из точек крепления колёс вниз, пружина +
  демпфер. Даёт высоту кузова, крен/тангаж, отрыв от земли (трамплин) и мягкую
  посадку. Поверхность — только дорога (`Track.project`), по бокам — стены.
- **Модель сцепления:** скорость раскладывается на продольную и поперечную в
  системе машины. Поперечная сила = f(угол скольжения) с насыщением. Передняя и
  задняя оси считаются отдельно → естественные избыточная/недостаточная
  поворачиваемость.
- **Дрифт:** ручник или резкий руль на скорости > ~60 км/ч срывает заднюю ось
  (сцепление задней оси × `driftGrip`). В заносе включается «drift assist»:
  контр-руль стабилизирует угол, газ поддерживает занос, угол ограничен
  (~55°), выход из заноса — плавное восстановление сцепления.
- **Нитро:** шкала 0..1 заряжается дрифтом (`driftChargeRate` × интенсивность
  заноса × скорость). Shift — расход ~0.3/с, дополнительная тяга
  `nitroBoost` и +15% к максимальной скорости. Небольшой стартовый запас 0.25.
- **Стены:** при выходе за `halfWidth − 1` машину выталкивает, поперечная
  скорость гасится с отскоком, продольная теряет 10–30% — событие `wall` (искры,
  звук, сброс комбо дрифта).
- **Столкновения машин:** круги радиусом ~2.2 м, раздвигание + обмен импульсом
  (`src/vehicle/collisions.ts`).
- **Респаун:** клавиша R / кнопка Y — на осевую линию трассы в текущей точке.
  Автоматически, если машина перевернулась или «провалилась».

### 3.2 Три машины (все выдуманные)
| id | Название | Характер | Скорость | Управляемость | Дрифт |
|----|----------|----------|:---:|:---:|:---:|
| `razor` | **Razor 86** | лёгкий клиновидный купе, баланс | 0.65 | 0.85 | 0.70 |
| `grizzly` | **Grizzly V8** | тяжёлый маслкар, король заносов | 0.75 | 0.50 | 0.95 |
| `photon` | **Photon X** | гиперкар, быстрый и цепкий | 0.95 | 0.70 | 0.40 |

Параметры — в `src/vehicle/specs.ts` (`CarSpec`). Поле `stats` — для полосок в меню.

### 3.3 Очки дрифта (`src/race/drift.ts`)
- Очки начисляются, пока `drifting && speed > 12 м/с`: `angleFactor × speed × dt`.
- Комбо: каждые ~1.5 с непрерывного заноса (или связка заносов с паузой < 1 с)
  увеличивают множитель x1 → x5.
- Завершение комбо → всплывающая надпись по размеру: `DRIFT` (<500),
  `NICE DRIFT`, `GREAT DRIFT` (>1500), `INSANE DRIFT!` (>4000), `NEON GOD!!` (>9000).
- Удар в стену во время комбо → `COMBO LOST`, очки комбо сгорают.

### 3.4 Боты (`src/ai/`)
- 5 ботов разных цветов, у каждого профиль: `skill`, `aggression`,
  предпочитаемое смещение от идеальной линии, случайный «дрейф» линии (шум).
- Следуют по трассе с упреждением (look-ahead от скорости), тормозят перед
  поворотами по кривизне (`Track.curvatureAt`), срезают внутреннюю часть
  поворота.
- **Обгон:** если впереди в 4–25 м медленнее машина на той же полосе — смещение
  линии в сторону с бóльшим запасом ширины.
- Иногда входят в поворот заносом (визуально зрелищно), используют нитро на
  прямых.
- **Rubber banding** (`rubberBandFactor`): бот далеко позади игрока → до +10%
  мощности; далеко впереди → до −8%. Действует через `VehiclePhysics.powerScale`.

### 3.5 Гонка (`src/race/raceManager.ts`)
- 3 круга, старт с решётки 2×3 позади стартовой линии, игрок стартует 4-м–6-м.
- Чекпоинты по трассе (8 арок); круг засчитывается только после прохода всех
  чекпоинтов по порядку. Защита от «езды назад»: предупреждение WRONG WAY.
- Позиции по полному прогрессу (круги × длина + дистанция по трассе).
- Таймер текущего круга, последний и лучший круг, общее время.
- Финиш игрока → через ~2 с экран результатов. Незакончившим ботам время
  прогнозируется по средней скорости.

### 3.6 Камера (`src/core/camera.ts`)
- Chase-камера на пружине позади и выше машины, смотрит чуть вперёд по скорости.
- FOV 62° → до 82° на максимальной скорости и нитро.
- Лёгкая тряска на высокой скорости, сильнее — от ударов и нитро.
- Линии скорости при нитро (3D-инстансы вокруг камеры, emissive-циан).
- В меню — облёт выбранной машины (вращающееся превью).

## 4. Визуальный стиль

### 4.1 Палитра
| Токен | Цвет | Где |
|------|------|-----|
| `void` | `#0d0221` | ночная часть неба, фон UI |
| `deepViolet` | `#1a0b3b` | земля, асфальт |
| `purple` | `#2b0f54` | здания, панели UI |
| `violet` | `#7a04eb` | сетка, акценты |
| `magenta` | `#ff2a6d` | главный неон, заголовки |
| `pink` | `#ff6ec7` | подсветка, дрифт-надписи |
| `cyan` | `#05d9e8` | второй неон, нитро, ограждения |
| `orange` | `#ff9e3d` | закат, солнце, предупреждения |
| `yellow` | `#ffd319` | верх солнца, лучший круг |
| `white` | `#f5e9ff` | основной текст |

Небо: зенит `#12022e` → `#3b0a5e` → `#b3206e` → горизонт `#ff7b54`.
Солнце: градиент сверху `#ffd319` → снизу `#ff2a6d`, горизонтальные прорези,
расширяющиеся книзу.

### 4.2 Рендер
- `WebGPURenderer` (three.js r186) с автоматическим фолбэком на WebGL2.
- Все шейдеры (небо, солнце, сетка, окна зданий, ограждения) — **TSL**.
- Постобработка через `RenderPipeline`: `pass(scene)` с MRT `{output, emissive}`,
  **bloom только по emissive-каналу**, затем сложение с кадром.
- Flat shading, vertex colors, `MeshStandardNodeMaterial` с высокой шероховатостью.
- Свет: `HemisphereLight` (пурпурное небо / тёмная земля) + направленный
  оранжевый свет со стороны солнца. Без теней; под машинами — мягкая тень-блоб.
- Туман цвета горизонта скрывает дальний план.

### 4.3 Мир
- **Небо** — сфера с градиентным TSL-шейдером, полосатое солнце, звёзды в зените.
- **Земля** — большая плоскость с анимированной неоновой сеткой (TSL):
  линии `violet/magenta`, бегущие импульсы, затухание к горизонту.
- **Дорога** — лента по сплайну: тёмный асфальт, неоновые края, пунктир по
  центру, стартовая шахматка.
- **Ограждения** — светящиеся полосы циан/маджента вдоль всей трассы с бегущими
  шевронами на поворотах.
- **Эстакада** — участок на опорах, проходящий над другой частью трассы.
- **Трамплин** — гребень на прямой: машина отрывается от земли.
- **Здания** — инстансированные low-poly коробки/ступенчатые башни разной
  высоты, процедурные окна (TSL), неоновые кромки на крышах.
- **Пальмы** — сегментированный ствол + листья-клинья; **фонари** — столб +
  emissive-лампа. Всё через `InstancedMesh`.
- **Арки чекпоинтов** — неоновые рамки над дорогой, стартовая арка крупнее.
- **Горы** — силуэты low-poly хребтов на горизонте с неоновой кромкой.

### 4.4 Машины
Low-poly детали: кузов (клин / маслкар / гиперкар), кабина с тёмным стеклом,
колёса с неоновым ободом, спойлер, фары и стопы (emissive), неоновая подсветка
днища и полоса вдоль кузова. Цвет кузова и неона — из `CarSpec`/профиля бота.
Эффекты: следы шин (неоново-тёмные полосы), дым при заносе, искры при ударе,
пламя/свечение из выхлопа при нитро.

### 4.5 Интерфейс (DOM-оверлей поверх canvas)
- Шрифт: системный жирный курсив (`"Arial Black", "Trebuchet MS", sans-serif`),
  `letter-spacing`, неоновое свечение `text-shadow`. Внешние шрифты не грузим.
- Панели: полупрозрачный `#1a0b3b` c рамкой `magenta`/`cyan` и свечением,
  скошенные углы (`clip-path`).
- HUD: позиция (крупно, слева сверху), круг и таймеры (справа сверху),
  мини-карта (справа снизу, canvas 2D), спидометр-дуга + шкала нитро (слева
  снизу — центр кадра свободен для машины), очки дрифта и всплывающие надписи (центр).
- Меню: логотип NEON RUSH с хромовым градиентом, выбор машины (стрелки,
  название, полоски характеристик, превью в 3D-сцене), кнопки «Гонка»,
  «Настройки», таблица рекордов.

### 4.6 Звук (Web Audio, всё синтезируется)
- Мотор: 2 пилообразных осциллятора + суб-синус, частота от `rpm`, фильтр от
  газа; переключения передач — просадка оборотов.
- Визг шин: полосовой шум, громкость от `skid`.
- Нитро: шипящий шум с фильтром + низкий гул; старт нитро — «вжух».
- Удар: короткий шумовой импульс. Отсчёт — бипы, GO — аккорд.
- Музыка: синтвейв-луп (бас на восьмых, арпеджио, пэд, drum machine), 2 варианта:
  спокойный для меню, энергичный для гонки. Секвенсор с упреждающим планированием.

## 5. Трасса «Sunset Loop»
Замкнутый сплайн (centripetal Catmull-Rom) в форме восьмёрки ~2.4 км:
- длинная стартовая прямая с трамплином-гребнем,
- крутая шпилька под дрифт в восточной петле,
- серия S-поворотов,
- подъём на эстакаду высотой ~11 м, проходящую над стартовой прямой,
- спуск и быстрый широкий поворот обратно на прямую.
Ширина дороги 20 м (half-width 10 м), на шпильках 22–24 м.

## 6. Архитектура и интерфейсы модулей

Система координат: **Y вверх**, метры, секунды. Локальный «вперёд» машины = **+Z**,
«вправо» = **−X** в локальных координатах (right = forward × up). Модели
машин строятся носом по +Z.

```
src/
  main.ts            — точка входа
  core/              — (Opus) Game, цикл, рендер, камера, настройки, хранилище, типы
    types.ts         — ВСЕ общие интерфейсы (источник истины)
    game.ts          — стейт-машина и интеграция всех модулей
    loop.ts          — фиксированный шаг физики 120 Гц + рендер каждый кадр
    renderer.ts      — WebGPURenderer, RenderPipeline, bloom, качество
    camera.ts        — chase-камера, превью-камера
    storage.ts       — localStorage: настройки и рекорды
  world/             — (Opus) трасса, окружение, небо
    track.ts         — сплайн трассы, выборки, проекция точки (класс Track)
    trackData.ts     — контрольные точки «Sunset Loop»
    trackMesh.ts     — дорога, ограждения, эстакада, арки
    sky.ts, ground.ts, environment.ts, palette.ts
  vehicle/
    specs.ts         — (Opus; физ. числа может тюнить gameplay) CarSpec ×3, профили ботов
    physics.ts       — (gameplay) VehiclePhysics
    collisions.ts    — (gameplay) столкновения машин
    carModel.ts      — (Opus) low-poly модели
    effects.ts       — (Opus) следы, дым, искры, пламя нитро
  ai/                — (gameplay) BotDriver, rubberBandFactor
  race/              — (gameplay) RaceManager, DriftScorer
  ui/                — (ui-audio) UIManager, HUD, меню, экраны, стили
  audio/             — (ui-audio) AudioManager, синтез, музыка
  input/             — (Opus) клавиатура + геймпад
tests/unit/          — Vitest
tests/e2e/           — Playwright smoke
```

### 6.1 Общие типы (`src/core/types.ts`)
Полные сигнатуры — в файле, ниже — смысл.

```ts
interface VehicleControls { throttle 0..1; brake 0..1 (на месте = задний ход);
  steer -1(влево)..1(вправо); handbrake: boolean; nitro: boolean }

interface CarSpec { id; name; tagline; model: 'wedge'|'muscle'|'hyper';
  bodyColor; neonColor; accentColor;           // визуал (Opus)
  maxSpeed м/с; acceleration м/с²; brakeDecel; steerAngle рад; grip;
  driftGrip (множитель задней оси в заносе); driftChargeRate; nitroBoost м/с²;
  mass кг; stats {speed, handling, drift} 0..1 }

interface WheelState { compression 0..1; onGround; spin рад; steerAngle рад;
  skid 0..1; contact: Vector3 }

interface VehicleState { position (центр днища на высоте оси колёс);
  quaternion; velocity; heading (yaw, forward = (sin h, 0, cos h)); yawRate;
  speed (продольная, м/с, со знаком); rpm 0..1; gear; throttle; onGround; airTime;
  driftAngle рад (со знаком); drifting; driftIntensity 0..1; nitro 0..1; nitroActive;
  wheels [FL, FR, RL, RR]; trackS; lateral; }

type VehicleEvent = { type: 'wall'|'car'|'land'; strength 0..1; point: Vector3 }
```

### 6.2 Трасса (`world/track.ts`, Opus)
```ts
class Track {
  readonly length: number; readonly halfWidth: number;
  readonly checkpoints: number[];   // s-координаты арок; [0] — старт/финиш
  sampleAt(s): TrackSample          // {s, position, tangent, right, up, halfWidth, bank}
  project(p: Vector3, hintS?: number): TrackProjection
      // {s, lateral, height (высота дороги под точкой), normal, sample, distance}
      // hintS обязателен для движущихся машин (эстакада пересекает трассу!)
  curvatureAt(s): number            // 1/м, > 0 — поворот вправо
  gridPose(slot): {position, heading, s} // стартовая решётка
  outline(n): {x, z}[]              // для мини-карты
  wrapS(s), deltaS(a, b)            // кольцевая арифметика
}
```

### 6.3 Физика (`vehicle/physics.ts`, gameplay)
```ts
class VehiclePhysics {
  constructor(spec: CarSpec, track: Track)
  readonly state: VehicleState
  readonly events: VehicleEvent[]   // очищается в начале каждого step()
  powerScale = 1                    // rubber banding
  reset(position, heading, s)       // респаун/старт, всё обнуляется, nitro=0.25
  step(dt, controls)                // фиксированный шаг 1/120 с
  frozen = false                    // до GO: мотор крутится, машина стоит
}
resolveCarCollisions(cars: VehiclePhysics[]): void   // collisions.ts
```

### 6.4 ИИ (`ai/`, gameplay)
```ts
interface BotProfile { name; skill 0..1; aggression 0..1; lineBias -1..1;
  bodyColor; neonColor; carId }
class BotDriver {
  constructor(track: Track, profile: BotProfile, seed: number)
  update(dt, self: VehicleState, spec: CarSpec, others: readonly VehicleState[]): VehicleControls
}
function rubberBandFactor(botProgress, playerProgress, trackLength): number // 0.92..1.10
```

### 6.5 Гонка (`race/`, gameplay)
```ts
class RaceManager {
  constructor(track: Track, racers: {name: string; isPlayer: boolean}[], laps = 3)
  start(): void; update(dt, cars: readonly VehicleState[]): void
  readonly events: RaceEvent[]  // очищается в начале update()
     // {type:'lap', car, lap, lapTime, isBest} | {type:'checkpoint', car, index}
     // | {type:'finish', car, position, time} | {type:'wrongWay', car, value}
  standings(): RacerStanding[]  // отсортированы по позиции
  standing(car): RacerStanding; readonly raceTime; readonly laps
  progress(car): number         // метры с начала гонки
  projectedFinishTime(car): number
  isFinished(car): boolean; allFinished(): boolean
}
class DriftScorer {
  update(dt, state: VehicleState, hitWall: boolean): DriftEvent[]
  readonly total; readonly combo: {active, points, multiplier, time}; reset()
}
DriftEvent = {type:'comboEnd', points, multiplier, label} | {type:'comboLost', points}
           | {type:'multiplier', multiplier}
```

### 6.6 UI (`ui/`, ui-audio)
```ts
class UIManager {
  constructor(root: HTMLElement, opts: { cars: CarSpec[]; settings: Settings;
     records: Records; callbacks: UICallbacks })
  showLoading(text) / showMainMenu() / showRaceHud(outline: {x,z}[]) /
  showPause() / hidePause() / showResults(r: RaceResult)
  updateHud(d: HudData)            // каждый кадр, без аллокаций DOM
  setCountdown(v: 3|2|1|'GO'|null)
  popup(text, sub?, tone?: 'pink'|'cyan'|'orange'|'yellow')
  banner(text, tone?)              // «КРУГ 2/3», «ЛУЧШИЙ КРУГ», «ФИНАЛЬНЫЙ КРУГ»
  handleAction(a: MenuAction): void  // навигация с клавиатуры/геймпада
  setRecords(r: Records); setFps(fps: number | null)
}
interface UICallbacks { onPreviewCar(i); onStartRace(i); onSettingsChanged(s);
  onPause(); onResume(); onRestart(); onQuitToMenu(); onUiSound(kind: UiSound);
  onFirstInteraction() }
```

### 6.7 Звук (`audio/`, ui-audio)
```ts
class AudioManager {
  unlock(): Promise<void>                         // по первому жесту
  setVolumes(master, music, sfx)
  playMusic(track: 'menu'|'race'|null)
  updateEngine(p: EngineAudioParams | null)       // каждый кадр; null — тишина
     // {rpm, throttle, speed (м/с), skid 0..1, nitro, onGround}
  play(sfx: SfxName)  // 'countdown'|'go'|'lap'|'finish'|'hit'|'combo'|'comboLost'
                      // |'nitroStart'|'land'|'uiMove'|'uiSelect'|'uiBack'
  setPaused(p: boolean)
}
```

### 6.8 Ввод (`input/`, Opus)
```ts
class InputManager {
  controls(): VehicleControls      // клавиатура + геймпад, сглаженный руль
  consumeActions(): MenuAction[]   // 'up'|'down'|'left'|'right'|'confirm'|'back'|'pause'|'reset'
}
```
Клавиатура: WASD/стрелки, Space — ручник, Shift — нитро, R — респаун, Esc/P — пауза,
Enter — подтвердить. Геймпад (Standard mapping): RT газ, LT тормоз, левый стик
руль, A/X — ручник, B/RB — нитро, Y — респаун, Start — пауза.

### 6.8.1 Расширения контрактов (добавлены при реализации)
- `VehiclePhysics.needsRespawn` — машина застряла/улетела/NaN → ведущий делает респаун;
  `blockedTime`, `driftMode`, `pushEvent(type, strength, point)` (события из пула —
  ссылки не хранить). `steerScale(v)` — чувствительность руля от скорости.
- `BotDriver.stuckTime` (с без движения > 4 м/с) и `driftEnabled`.
- `RaceManager.hasStarted`, `finishedCount`; `driftLabel(points)` в `race/drift.ts`.
- `UIManager.showSettings()`, `hideAll()`.
- `Game.debugSimulate(seconds)` и `window.__neonRush.info()` — для e2e/QA.
- Конвенции: `driftAngle > 0` — нос правее вектора скорости; `wheels[].steerAngle > 0` —
  колесо повёрнуто влево; `gear` 1..6, 0 — задний ход.

### 6.9 Интеграция (`core/game.ts`, Opus)
Каждый шаг физики: input → `BotDriver.update` → `VehiclePhysics.step` →
`resolveCarCollisions` → события → `RaceManager.update` → `DriftScorer.update`.
Каждый кадр: модели машин и эффекты из состояний, камера, `ui.updateHud`,
`audio.updateEngine`, рендер. Отладочный хэндл `window.__neonRush` для e2e.

## 7. Производительность
- Цель — 60 FPS на среднем ноутбуке. < 150 draw calls: статичная геометрия
  сливается (`mergeGeometries`), повторяющиеся объекты — `InstancedMesh`.
- Качество **Низкое**: без bloom, pixelRatio 1, дальность камеры/тумана ~60%,
  меньше зданий и частиц. **Высокое**: bloom, pixelRatio до 2, всё включено.
- В цикле нет аллокаций в горячих путях (переиспользуемые Vector3).

## 8. Этапы
1. Документация, агенты. 2. Каркас (Vite, рендер, цикл, типы, трасса-сплайн,
CI/Pages). 3. Параллельно: мир/визуал (Opus), физика+ИИ+гонка (gameplay),
UI+звук (ui-audio). 4. Интеграция + QA. 5. Визуальная полировка + QA.
6. README, PR.
