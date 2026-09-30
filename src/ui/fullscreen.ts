/** Полноэкранный режим: поддержка, переключение, кнопка для меню/паузы. */
import { el } from './dom';
import type { Nav } from './nav';

export const FS_ENTER = 'НА ВЕСЬ ЭКРАН';
export const FS_EXIT = 'ВЫЙТИ ИЗ ПОЛНОЭКРАННОГО';

interface FsDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface OrientationLockable {
  lock?: (o: string) => Promise<void>;
  unlock?: () => void;
}

/** Есть ли Fullscreen API (на iPhone нет — кнопку прячем). */
export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDocument;
  return d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true;
}

export function isFullscreen(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

function orientation(): OrientationLockable | null {
  try {
    return (screen.orientation as unknown as OrientationLockable) ?? null;
  } catch {
    return null;
  }
}

/** Войти/выйти из полноэкранного. Ошибки (нет жеста, запрет, блокировка ориентации) молча игнорируются. */
export function toggleFullscreen(): void {
  const d = document as FsDocument;
  try {
    if (!isFullscreen()) {
      const root = document.documentElement as FsElement;
      const req = root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen?.();
      void Promise.resolve(req)
        .then(() => {
          try {
            // на телефонах фиксируем альбомную ориентацию; на десктопе/iOS бросит — игнорируем
            void orientation()?.lock?.('landscape')?.catch?.(() => undefined);
          } catch {
            /* не поддерживается */
          }
        })
        .catch(() => undefined);
    } else {
      try {
        orientation()?.unlock?.();
      } catch {
        /* не поддерживается */
      }
      const out = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
      void Promise.resolve(out).catch(() => undefined);
    }
  } catch {
    /* запрещено политикой/нет жеста */
  }
}

const labels = new Set<HTMLElement>();
let listening = false;

function refreshLabels(): void {
  const t = isFullscreen() ? FS_EXIT : FS_ENTER;
  for (const l of labels) if (l.textContent !== t) l.textContent = t;
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('fullscreenchange', refreshLabels);
  document.addEventListener('webkitfullscreenchange', refreshLabels);
}

/**
 * Кнопка «На весь экран» (подпись меняется на «Выйти из полноэкранного»).
 * Возвращает null и ничего не создаёт, если Fullscreen API недоступен.
 */
export function addFullscreenButton(parent: HTMLElement, nav: Nav): HTMLElement | null {
  if (!fullscreenSupported()) return null;
  listen();
  const b = el('div', 'btn btn-fs', undefined, parent);
  b.setAttribute('role', 'button');
  const label = el('span', undefined, isFullscreen() ? FS_EXIT : FS_ENTER, b);
  labels.add(label);
  // активация — из click/pointerup (жест) либо из confirm с клавиатуры/геймпада
  nav.add({ el: b, activate: toggleFullscreen, viaClick: true });
  return b;
}
