# Neon Rush — правила проекта

Браузерная 3D-аркадная гонка в стиле синтвейв. Дизайн, стиль, палитра и
**интерфейсы модулей** — в `GAME_DESIGN.md` (источник истины). Документация и
общение — на русском; идентификаторы в коде — на английском.

## Стек (версии зафиксированы точно, без `^`/`~`)
- TypeScript 7 (strict) + Vite 8, ES-модули.
- three.js 0.186.1: `WebGPURenderer` (импорт из `three/webgpu`) с автофолбэком на
  WebGL2; шейдеры — только TSL (`three/tsl`); постобработка — `RenderPipeline` +
  `BloomNode` (bloom только по emissive через MRT).
- Физика — собственная аркадная (raycast-подвеска + модель сцепления). Физических
  движков не подключать.
- Звук — только Web Audio API, всё синтезируется кодом.
- Тесты: Vitest (`tests/unit`), Playwright (`tests/e2e`, headless Chromium из
  `/opt/pw-browsers`, не запускать `playwright install`).
- Деплой: `.github/workflows/deploy.yml` → GitHub Pages, base-путь через
  `VITE_BASE` (`/<repo>/`).

## Команды
```
npm run dev        # дев-сервер
npm run build      # tsc --noEmit + vite build (должен проходить всегда)
npm test           # vitest
npm run test:e2e   # playwright smoke (сам собирает и поднимает preview)
```
Отладочные URL-параметры: `?autostart=1&car=0` — сразу в гонку;
`?quality=low|high`; `?fps=1`; `?debug` — панель тюнинга управления
(все числа управления — `src/vehicle/handling.ts`). Хэндл `window.__neonRush` — для e2e.

## Жёсткие ограничения
- Никаких внешних ассетов, генераций и платных сервисов: графика, шрифты,
  звук — кодом. Никаких CDN в рантайме.
- Машины выдуманные, без реальных марок и логотипов.
- Стиль: low-poly, flat shading, vertex colors, emissive-неон. Палитра — только
  из `GAME_DESIGN.md` §4.1 (`src/world/palette.ts` для 3D, CSS-переменные в UI).
- Без незапрошенных фич: сначала MVP целиком.

## Архитектура и владение файлами
| Зона | Файлы | Владелец |
|------|-------|----------|
| Ядро, интеграция | `src/core/*`, `src/main.ts`, `index.html` | ведущий (Opus) |
| Мир и визуал | `src/world/*`, `src/vehicle/carModel.ts`, `src/vehicle/effects.ts` | ведущий |
| Ввод | `src/input/*` | ведущий |
| Характеристики машин | `src/vehicle/specs.ts` | ведущий; gameplay-engineer тюнит физ. числа |
| Физика, ИИ, гонка | `src/vehicle/physics.ts`, `src/vehicle/collisions.ts`, `src/ai/*`, `src/race/*`, `tests/unit/{physics,ai,race,drift}*.test.ts` | gameplay-engineer |
| UI и звук | `src/ui/*`, `src/audio/*` | ui-audio-engineer |
| Проверка | — (код не правит) | qa-tester |

- Общие типы живут в `src/core/types.ts`. Менять их может только ведущий; если
  нужен новый контракт — опиши в отчёте.
- Модули общаются только через интерфейсы из `GAME_DESIGN.md` §6. Логика
  (`physics`, `ai`, `race`) не импортирует рендер и DOM — она тестируется в Node.
- Горячие пути (шаг физики, кадр) — без аллокаций: переиспользуй `Vector3`.
- Координаты: Y вверх, метры; вперёд машины = +Z, heading: forward = (sin h, 0, cos h).

## Стиль кода
- `strict`, без `any`; `import type` для типов. Небольшие модули, понятные имена.
- Комментарии — кратко, по делу, на русском или английском (единообразно в файле).
- Перед коммитом: `npm run build && npm test`.

## Субагенты
Описания ролей — `.claude/agents/` (`gameplay-engineer`, `ui-audio-engineer`,
`qa-tester`, все на `model: sonnet`). Параллельные агенты не трогают одни и те
же файлы. Каждый в конце отчитывается: что сделано, какие файлы, сомнения.
