// Transient UI feedback: the toast strip and the loading indicator. Small,
// stateless, and dependency-free so any module can surface a message.

import { $ } from './dom.js';

let toastTimer: number | undefined;

/** Flash a message in the toast strip; `isErr` styles it as an error. */
export function toast(msg: string, isErr = false): void {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show${isErr ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 3200);
}

/** Toggle the "reading the archive…" loading row. */
export function showLoading(on: boolean): void {
  const l = $('#loading');
  if (l) l.style.display = on ? 'flex' : 'none';
}
