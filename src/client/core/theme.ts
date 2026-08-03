// Theme controller — themes are npm packages like plugins. Each is a package
// (themes/<id>/, or a third-party dependency) carrying a `ledgerTheme` block in
// its package.json: display name, fonts, foley, and two theme-provided components
// (logo, ambient). The server discovers every installed theme package and returns
// the registry — with asset `src` values rewritten to /theme/<id>/… URLs — from
// /api/themes. This module fetches that registry, resolves the active theme,
// swaps the stylesheet/fonts/logo/ambient/sound live, and drives the masthead
// switcher.
//
// The token layer (base.css) is always loaded; only the theme's stylesheet <link>
// swaps.
// Because the design tokens are CSS custom properties that inherit through every
// shadow boundary, swapping the theme sheet recolours the whole app — light DOM
// and every component's shadow root — in one assignment, with no per-component
// theming machinery.
//
// Resolution order, most to least specific:
//   1. the browser's stored choice (localStorage) — the switcher's last pick
//   2. the server's configured default (ledger.config.json `theme`, via
//      /api/source) — passed in as `configured`
//   3. the registry's own `default`
//   4. the first theme in the registry (last resort)

import { $ } from '../ui/dom.js';
import { configureSfx, type SoundConfig } from './sound.js';

// A theme-provided custom element: an ES module (`src`) that self-registers an
// element (`tag`), mounted into a fixed host with `attrs` set on it. This is the
// one shape behind both the masthead logo and the ambient layer — the controller
// imports the module, creates <tag>, applies attrs verbatim, and never
// understands any attr's meaning. A theme adds a visual layer by declaring one of
// these; the controller branches on nothing. `attrs` with a `false`/`null` value
// is omitted (lets a boolean attr like `fire` be turned off per theme).
export interface ThemeComponent { tag: string; src: string; attrs?: Record<string, string | number | boolean | null> }
export interface Theme {
  id: string;
  name: string;
  tagline?: string;      // shown in the switcher option's world
  subtitle?: string;     // the masthead sub-line HTML (may contain <em>)
  stylesheet: string;    // URL of the theme's token+decoration CSS (served from the theme package)
  fonts?: string;
  logo?: ThemeComponent;    // masthead mark; falls back to <ledger-mark>
  ambient?: ThemeComponent; // backdrop drift layer; absent → no ambient
  sounds?: SoundConfig;
}
interface Manifest { default: string; themes: Theme[] }

const STORAGE_KEY = 'ledger:theme';
// The fallback logo — the-ledger's wax-seal mark, loaded when a theme declares
// no logo of its own (or its logo module fails to load/register).
const FALLBACK_LOGO: ThemeComponent = { tag: 'ledger-mark', src: '/theme/the-ledger/mark.js' };

let manifest: Manifest | null = null;
let active: Theme | null = null;

/** The currently applied theme id, or null before the first apply. */
export function activeThemeId(): string | null { return active?.id ?? null; }

// Fetch + cache the theme registry — the server enumerates every installed theme
// package and returns its manifest with asset URLs already rewritten. A failure
// here leaves the app on whatever the HTML shipped with (base.css + the default
// theme link), so a registry hiccup can't blank the page.
async function loadManifest(): Promise<Manifest | null> {
  if (manifest) return manifest;
  try {
    manifest = await (await fetch('/api/themes')).json() as Manifest;
  } catch { manifest = null; }
  return manifest;
}

function findTheme(id: string | null | undefined): Theme | undefined {
  if (!id || !manifest) return undefined;
  return manifest.themes.find((t) => t.id === id);
}

// Swap the theme stylesheet <link>. One element with a stable id, so applying a
// theme is a single href assignment; the previous sheet is dropped when the new
// one loads. Returns a promise that resolves when the new sheet has loaded, so
// callers can defer a re-render (title, ambient) until the tokens are live and
// avoid a flash of the old palette.
function swapSheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    let link = $<HTMLLinkElement>('#theme-css');
    if (!link) {
      link = document.createElement('link');
      link.id = 'theme-css'; link.rel = 'stylesheet';
      document.head.append(link);
    }
    if (link.getAttribute('href') === href) { resolve(); return; }
    // Resolve on load/error, but NEVER hang the rest of theme application on a
    // stylesheet event that can silently not fire (a missed `load` on an
    // href swap wedged the logo/ambient/foley steps that run after this await).
    // A short timeout is the backstop: the sheet still applies once the browser
    // fetches it — the token cascade doesn't need us to await it — so resolving
    // early only lets the post-sheet steps proceed, at worst one frame before the
    // new palette paints.
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
    setTimeout(finish, 1500);
    link.href = href;
  });
}

// Inject the theme's font stylesheet (Google Fonts href). A stable id so it
// swaps in place; a theme without a `fonts` entry keeps whatever is loaded.
function swapFonts(theme: Theme): void {
  if (!theme.fonts) return;
  let link = $<HTMLLinkElement>('#theme-fonts');
  if (!link) {
    link = document.createElement('link');
    link.id = 'theme-fonts'; link.rel = 'stylesheet';
    document.head.append(link);
  }
  if (link.getAttribute('href') !== theme.fonts) link.href = theme.fonts;
}

// Mount a theme-provided component into a host element: import its module (which
// self-registers the element), wait for the definition to upgrade, then place a
// fresh instance carrying `attrs`. Replaces the host's children, so re-mounting
// on a theme switch swaps the element cleanly. Returns whether it mounted; a
// failed import / unregistered tag returns false without throwing, so a caller
// can fall back. This is the ONE place that turns a {tag, src, attrs} into live
// DOM — logo and ambient both route through it, and nothing here understands any
// specific tag or attr.
async function mountComponent(host: Element, comp: ThemeComponent): Promise<boolean> {
  try {
    await import(comp.src);
    // A custom element upgrades asynchronously after definition; wait so the tag
    // is registered before we create it.
    await customElements.whenDefined(comp.tag);
    if (!customElements.get(comp.tag)) return false;
    const el = document.createElement(comp.tag);
    for (const [k, v] of Object.entries(comp.attrs ?? {})) {
      // Omit false/null; render a bare boolean `true` as a valueless attribute
      // (e.g. `fire`), everything else as its string value.
      if (v === false || v == null) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
    host.replaceChildren(el);
    return true;
  } catch { return false; }
}

// The masthead logo. A theme declares one; a theme that doesn't — or whose logo
// module fails to load — falls back to the-ledger's <ledger-mark>, so the
// masthead is never empty. The host <h1> keeps the accessible name; the mark is
// decorative chrome.
async function applyLogo(theme: Theme): Promise<void> {
  const host = $('.ledger-title');
  if (!host) return;
  const logo = theme.logo ?? FALLBACK_LOGO;
  if (await mountComponent(host, logo)) return;
  if (logo.src !== FALLBACK_LOGO.src) await mountComponent(host, FALLBACK_LOGO);
}

// The ambient drift layer (pipe smoke, starfield, …). A theme declares its own
// ambient component; a theme with none gets an empty layer (the host is cleared),
// so switching from a themed ambient to none removes it. No fallback — ambient is
// optional atmosphere, not required chrome.
async function applyAmbient(theme: Theme): Promise<void> {
  const host = $('#ambient-layer');
  if (!host) return;
  if (theme.ambient) await mountComponent(host, theme.ambient);
  else host.replaceChildren();
}

// Apply a theme end to end: stylesheet, fonts, logo, ambient, foley, subtitle.
// The sheet swap is awaited so the logo/ambient reconfigure against the new
// tokens, not the old.
export async function applyTheme(id: string): Promise<void> {
  const theme = findTheme(id);
  if (!theme) return;
  active = theme;
  document.documentElement.setAttribute('data-theme', id);
  await swapSheet(theme.stylesheet);
  swapFonts(theme);
  await applyLogo(theme);
  await applyAmbient(theme);
  configureSfx(theme.sounds || {});
  // The masthead sub-line is themed prose; a theme without one keeps the HTML's.
  const sub = $('.mast-sub');
  if (sub && theme.subtitle) sub.innerHTML = theme.subtitle;
}

// Resolve the active theme id and apply it. `configured` is the server default
// from /api/source (may be null). Called once at startup after the manifest and
// the source handshake are in hand.
export async function initTheme(configured: string | null): Promise<void> {
  const m = await loadManifest();
  if (!m) return;                       // no manifest — keep the HTML's shipped sheet
  const stored = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
  const pick =
    findTheme(stored)?.id ??            // 1. the browser's stored choice
    findTheme(configured)?.id ??        // 2. the server-configured default
    findTheme(m.default)?.id ??         // 3. the manifest default
    m.themes[0]?.id;                    // 4. first listed
  if (pick) await applyTheme(pick);
  buildSwitcher();
}

// Persist + apply a switcher choice. Stored per-browser, so a chosen theme
// survives reloads and overrides the server default from then on.
async function chooseTheme(id: string): Promise<void> {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode — session only */ }
  await applyTheme(id);
}

// Populate the masthead theme <select> from the manifest and wire its change.
// The control lives in index.html next to refresh/help; this fills its options
// and marks the active one. No-op if the control or manifest is absent.
function buildSwitcher(): void {
  const sel = $<HTMLSelectElement>('#theme-select');
  if (!sel || !manifest) return;
  sel.replaceChildren();
  for (const t of manifest.themes) {
    const opt = document.createElement('option');
    opt.value = t.id; opt.textContent = t.name;
    if (t.id === active?.id) opt.selected = true;
    sel.append(opt);
  }
  sel.onchange = () => { void chooseTheme(sel.value); };
}
