'use strict';

// Small DOM helpers shared by the Ledger components. Kept dependency-free so any
// component that imports this stays usable on its own.

export const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

// Make a non-button element behave like a button for keyboard users: role, tab
// stop, and Enter/Space activation mirroring the click handler.
export const asButton = (node, onActivate, label) => {
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('click', onActivate);
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(e); }
  });
  return node;
};

// Copy a URL to the clipboard, with brief visual feedback on the button. Works
// from a shadow root: the textarea fallback is appended to the button's own root
// so it stays inside the same tree when the async Clipboard API is unavailable
// or blocked (permission denied, non-secure context).
export async function copyLink(url, btn) {
  const root = btn?.getRootNode?.() || document;
  const legacyCopy = () => {
    const ta = el('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    (root.body || root).append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    if (!ok) throw new Error('copy command rejected');
  };
  try {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url); }
      catch { legacyCopy(); }
    } else legacyCopy();
    if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1200); }
    return true;
  } catch { return false; }
}

// A compact relative time ("3d ago", "2h ago", "just now"); falls back to a date.
export function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
