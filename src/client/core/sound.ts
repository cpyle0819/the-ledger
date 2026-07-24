// Two short foley cues, public-domain (Wikimedia Commons): a page turn when a
// record opens, a quill scratch when an edit saves. Audio is lazy — the browser
// blocks playback until the first user gesture, so we don't preload aggressively
// and we swallow the autoplay rejection silently (a muted cue is never an error
// worth surfacing). The quill clip is long; we clip it to a brief scratch.

interface CueOpts { volume?: number; startAt?: number; maxMs?: number }

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

export interface Sfx { pageTurn(): void; quill(): void }

export const sfx: Sfx = {
  // The page-turn recording has ~1.7s of lead-in before the actual turn.
  pageTurn: makeCue('/sounds/page-turn.ogg', { volume: 0.5, startAt: 1.7 }),
  quill: makeCue('/sounds/quill.ogg', { volume: 0.45, maxMs: 1400 }),
};
