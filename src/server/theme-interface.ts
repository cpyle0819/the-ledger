// Theme discovery + asset resolution — the theme analogue of plugin-interface.
// A theme is an npm package (like a source plugin), declared as a dependency of
// the-ledger and carrying its identity in a `ledgerTheme` block in its own
// package.json. The host DISCOVERS every installed theme package (unlike a
// source, where exactly one is active) and serves each theme's assets over HTTP,
// so a third-party theme is usable just by being an installed dependency.
//
// Two kinds of asset a theme's manifest can point at, distinguished exactly like
// resolveSource's path-vs-package split:
//   - an OWN FILE (`./theme.css`, `./mark.js`, `./sounds/x.ogg`) — resolved
//     within the theme's package directory and served from /theme/<id>/<path>.
//   - a bare DEPENDENCY specifier (`smoke-drift`) — resolved from the THEME's
//     own node_modules (its package.json lists it), served from
//     /theme/<id>/@dep/<specifier>. This is how the-ledger owns the pipe-smoke
//     ambient component as its dependency rather than the app's.
//
// The browser never sees a package-relative path: discovery rewrites every
// manifest `src` to one of those URLs, so the client just fetches/imports URLs.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './plugin-interface';

// The bundled default, mirroring plugin-interface's DEFAULT_SOURCE. The client's
// resolution order is localStorage choice → ledger.config.json `theme` → this.
export const DEFAULT_THEME = 'the-ledger';

// The URL prefix every theme asset is served under. /theme/<id>/… for own files;
// /theme/<id>/@dep/<specifier> for a theme dependency.
const ASSET_ROOT = '/theme';
const DEP_MARK = '@dep';

interface RawSound { src: string; volume?: number; startAt?: number; maxMs?: number }
interface RawComponent { tag: string; src: string; attrs?: Record<string, unknown> }
// A user-tunable knob a theme declares; carries no asset path, so it passes to
// the client verbatim (the settings panel renders a control from it).
interface RawSetting { target?: string; attr: string; type: string; label: string; default: unknown; min?: number; max?: number; step?: number; options?: { value: string; label: string }[] }
// The `ledgerTheme` block as authored in a theme package's package.json, with
// asset `src` values relative to that package (own-file or dep specifier).
interface ThemeManifest {
  id: string;
  name: string;
  tagline?: string;
  subtitle?: string;
  stylesheet: string;
  fonts?: string;
  logo?: RawComponent;
  ambient?: RawComponent;
  sounds?: Record<string, RawSound>;
  settings?: RawSetting[];
}

interface DiscoveredTheme {
  id: string;
  dir: string;                 // the theme package's directory
  manifest: ThemeManifest;
}

// The root package.json's dependency names — the set we probe for themes. A theme
// is any dependency whose package.json carries a `ledgerTheme` block (source
// plugins and the ambient component don't, so they're skipped).
function dependencyNames(): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    return Object.keys(pkg.dependencies || {});
  } catch { return []; }
}

// Resolve a dependency's own directory (the folder holding its package.json),
// via Node's resolver so it works whether npm symlinked (file:) or hoisted it.
function packageDir(name: string): string | null {
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [REPO_ROOT] }));
  } catch { return null; }
}

// Discover every installed theme package. Cached after first scan — the installed
// set doesn't change while the server runs.
let cache: DiscoveredTheme[] | null = null;
export function discoverThemes(): DiscoveredTheme[] {
  if (cache) return cache;
  const themes: DiscoveredTheme[] = [];
  for (const name of dependencyNames()) {
    const dir = packageDir(name);
    if (!dir) continue;
    let pkg: { ledgerTheme?: ThemeManifest };
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
    const m = pkg.ledgerTheme;
    if (m && typeof m.id === 'string' && typeof m.stylesheet === 'string') themes.push({ id: m.id, dir, manifest: m });
  }
  cache = themes;
  return themes;
}

// Rewrite one manifest `src` into the browser URL that serves it. Own files land
// at /theme/<id>/<normalized-path>; a dependency specifier at /theme/<id>/@dep/<spec>.
function assetUrl(id: string, src: string): string {
  if (src.startsWith('.') || src.startsWith('/')) {
    const rel = src.replace(/^\.?\//, '');   // "./mark.js" | "/mark.js" → "mark.js"
    return `${ASSET_ROOT}/${id}/${rel}`;
  }
  return `${ASSET_ROOT}/${id}/${DEP_MARK}/${src}`;   // bare specifier → dep route
}

// The browser-facing registry: every theme's manifest with asset `src` values
// rewritten to URLs, plus the default id. This is what /api/themes returns and
// the client's theme controller consumes directly.
export function themeRegistry(): unknown {
  const rewriteComponent = (id: string, c?: RawComponent) =>
    c ? { ...c, src: assetUrl(id, c.src) } : undefined;
  const rewriteSounds = (id: string, s?: Record<string, RawSound>) => {
    if (!s) return undefined;
    const out: Record<string, RawSound> = {};
    for (const [k, v] of Object.entries(s)) out[k] = { ...v, src: assetUrl(id, v.src) };
    return out;
  };
  const themes = discoverThemes().map(({ id, manifest: m }) => ({
    id,
    name: m.name,
    tagline: m.tagline,
    subtitle: m.subtitle,
    stylesheet: assetUrl(id, m.stylesheet),
    fonts: m.fonts,
    logo: rewriteComponent(id, m.logo),
    ambient: rewriteComponent(id, m.ambient),
    sounds: rewriteSounds(id, m.sounds),
    settings: m.settings,   // no asset paths — passed to the client verbatim
  }));
  return { default: DEFAULT_THEME, themes };
}

// Resolve a /theme/<id>/… request path to an absolute file on disk, or null if it
// doesn't map to a real theme asset. `rest` is the path after the theme id. An
// @dep/<specifier> path resolves from the theme package's own node_modules; any
// other path is an own file resolved within the theme dir, guarded against
// traversal outside it.
export function resolveThemeAsset(id: string, rest: string): string | null {
  const theme = discoverThemes().find((t) => t.id === id);
  if (!theme) return null;
  if (rest.startsWith(`${DEP_MARK}/`)) {
    const spec = rest.slice(DEP_MARK.length + 1);
    if (!spec) return null;
    try { return require.resolve(spec, { paths: [theme.dir] }); } catch { return null; }
  }
  const file = path.join(theme.dir, path.normalize(rest).replace(/^(\.\.[/\\])+/, ''));
  // Containment guard: the resolved path must stay within the theme directory.
  if (file !== theme.dir && !file.startsWith(theme.dir + path.sep)) return null;
  return file;
}
