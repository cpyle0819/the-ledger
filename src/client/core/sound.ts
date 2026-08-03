// Foley cues, reconfigurable per theme. The Ledger's originals are two
// public-domain clips (Wikimedia Commons): a page turn when a record opens, a
// quill scratch when an edit saves. A theme can swap these for its own world's
// sounds (a hatch seal, a relay click) via configureSfx — the theme controller
// calls it from the active theme's manifest entry.
//
// Audio is lazy — the browser blocks playback until the first user gesture, so
// we don't preload aggressively and we swallow the autoplay rejection silently
// (a muted cue is never an error worth surfacing).

interface CueOpts { volume?: number; startAt?: number; maxMs?: number }

// One cue name → its clip + playback shaping. A theme's manifest supplies this
// map; a name absent from a theme resolves to a no-op cue (silence, not error),
// so a theme need only override the cues it wants to change.
export interface CueSpec extends CueOpts { src: string }
export type SoundConfig = Partial<Record<keyof Sfx, CueSpec>>;

function makeCue(src: string, { volume = 0.55, startAt = 0, maxMs = 0 }: CueOpts = {}): () => void {
  const base = new Audio(src);
  base.preload = 'auto';
  // Seeking currentTime on a reused element AFTER it has `ended` races with
  // play() (Chrome resets to 0) — so play a FRESH clone each time. The clone
  // shares the buffered resource (no re-download); we just wait for its
  // metadata before seeking to the start offset.
  const start = (a: HTMLAudioElement) => {
    a.volume = volume;
    try { a.currentTime = startAt; } catch { /* seek not ready — plays from 0 */ }
    const p = a.play();
    if (p) p.catch(() => {}); // autoplay blocked until first gesture — fine
    if (maxMs) setTimeout(() => { a.pause(); }, maxMs);
  };
  return () => {
    try {
      const a = base.cloneNode() as HTMLAudioElement;
      if (a.readyState >= 1) start(a); // HAVE_METADATA — safe to seek now
      else a.addEventListener('loadedmetadata', () => start(a), { once: true });
    } catch { /* no audio support — silent */ }
  };
}

const noop = (): void => {};

export interface Sfx { pageTurn(): void; quill(): void }

// The live cue functions. Mutated in place by configureSfx so every module that
// imported `sfx` keeps a stable reference while the underlying clips swap with
// the theme. Defaults to the Ledger's own foley so the app is audible before any
// theme applies (and if a theme declares no sounds).
export const sfx: Sfx = {
  pageTurn: makeCue('/sounds/page-turn.ogg', { volume: 0.5, startAt: 1.7 }),
  quill: makeCue('/sounds/quill.ogg', { volume: 0.45, maxMs: 1400 }),
};

// Rebind the cues from a theme's sound config. A cue the theme omits becomes
// silent rather than falling back to another theme's clip — a theme's soundscape
// is all-or-per-cue, never a mix. Called by the theme controller on apply.
export function configureSfx(config: SoundConfig): void {
  const cue = (spec: CueSpec | undefined) => (spec?.src ? makeCue(spec.src, spec) : noop);
  sfx.pageTurn = cue(config.pageTurn);
  sfx.quill = cue(config.quill);
}
