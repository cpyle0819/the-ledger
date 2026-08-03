// <ledger-mark> — The Ledger's masthead logo: a wax-seal emblem carrying a
// debossed "TL" monogram beside "The Ledger" set in IM Fell English with a
// brushed-brass gilt fill. The seal doubles as the app's standalone mark
// (public/seal.svg, also the favicon).
//
// This is a THEME ASSET, not an app component: it's the logo the-ledger theme
// declares in its manifest (`logo`), loaded by the theme controller and placed
// in the masthead. It's also the controller's fallback when a theme declares no
// logo of its own. A theme provides its own logo the same way — a self-
// registering custom element module served from the theme's folder.
//
// Plain JS (no build step) so it lives beside theme.css and ships as a static
// asset. Everything is live SVG: real <text> for the wordmark (accessible +
// crisp at any size, no font baked to paths) and static shapes for the seal.
// Shadow DOM keeps its gradients/ids from colliding with the page or a sibling
// theme's logo.

// Wax-seal geometry, shared verbatim with public/seal.svg — keep the two in
// sync. A real seal is a roughly-circular but IRREGULAR pour of wax with broad,
// squeezed-out lobes and smooth continuous curves (not a struck coin). SEAL_BLOB
// is the outer edge; SEAL_DISC is the pressed inner face (a lower level, so the
// rim between them reads as a raised glossy ridge); SEAL_RING_* are two grooves
// on the disc echoing the same irregular outline.
const SEAL_BLOB = 'M 59.07 32.44 C 58.71 40.15, 50.32 52.60, 44.84 56.49 C 39.37 60.38, 32.33 57.84, 26.21 55.78 C 20.08 53.73, 10.91 50.43, 8.09 44.16 C 5.27 37.89, 6.91 23.95, 9.29 18.18 C 11.68 12.41, 16.11 10.87, 22.40 9.54 C 28.68 8.22, 40.90 6.42, 47.01 10.23 C 53.13 14.05, 59.43 24.73, 59.07 32.44 Z';
const SEAL_DISC = 'M 52.54 32.33 C 52.26 38.19, 45.89 47.52, 41.72 50.53 C 37.55 53.54, 32.17 51.94, 27.52 50.39 C 22.87 48.85, 15.95 46.07, 13.81 41.25 C 11.67 36.43, 12.90 25.90, 14.70 21.47 C 16.50 17.04, 19.81 15.71, 24.60 14.70 C 29.39 13.69, 38.79 12.46, 43.45 15.40 C 48.11 18.34, 52.83 26.48, 52.54 32.33 Z';
const SEAL_RING_OUT = 'M 51.04 32.31 C 50.77 37.74, 44.87 46.38, 41.01 49.17 C 37.14 51.96, 32.16 50.48, 27.85 49.05 C 23.54 47.61, 17.12 45.04, 15.14 40.57 C 13.16 36.11, 14.30 26.34, 15.97 22.24 C 17.64 18.14, 20.70 16.90, 25.14 15.96 C 29.58 15.03, 38.29 13.89, 42.61 16.62 C 46.93 19.34, 51.31 26.88, 51.04 32.31 Z';
const SEAL_RING_IN = 'M 50.04 32.29 C 49.79 37.43, 44.19 45.62, 40.53 48.27 C 36.87 50.91, 32.15 49.51, 28.07 48.15 C 23.98 46.79, 17.90 44.35, 16.03 40.12 C 14.15 35.89, 15.23 26.64, 16.81 22.75 C 18.39 18.87, 21.30 17.69, 25.50 16.81 C 29.71 15.92, 37.96 14.85, 42.05 17.43 C 46.14 20.01, 50.29 27.15, 50.04 32.29 Z';

class LedgerMark extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;   // idempotent — connectedCallback can fire again on a move
    const root = this.attachShadow({ mode: 'open' });

    // Layout: a 64-unit seal at the left, then the wordmark. The viewBox height
    // is the seal's; the width is a generous guess, trimmed to the wordmark once
    // the display font has loaded and the real glyph advance is measurable.
    const H = 64, seal = 64, gap = 16;
    const wordX = seal + gap;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${wordX + 300} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // Decorative: the masthead <h1> carries the accessible name ("The Ledger").
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <defs>
        <!-- Molten-gold wax body, lit upper-left, deepening lower-right. -->
        <radialGradient id="lg-wax" cx="40%" cy="34%" r="70%">
          <stop offset="0" stop-color="#f6e08f"/>
          <stop offset="0.5" stop-color="#d9a92e"/>
          <stop offset="1" stop-color="#8a6015"/>
        </radialGradient>
        <!-- The pressed inner disc: darker/flatter than the raised rim. -->
        <radialGradient id="lg-disc" cx="42%" cy="38%" r="66%">
          <stop offset="0" stop-color="#e8c25a"/>
          <stop offset="0.6" stop-color="#c7961f"/>
          <stop offset="1" stop-color="#9a6f18"/>
        </radialGradient>
        <!-- Broad specular sheen for a shiny, lacquered wax finish. -->
        <radialGradient id="lg-sheen" cx="36%" cy="28%" r="46%">
          <stop offset="0" stop-color="#fff6d8" stop-opacity="0.8"/>
          <stop offset="0.5" stop-color="#fff6d8" stop-opacity="0.13"/>
          <stop offset="1" stop-color="#fff6d8" stop-opacity="0"/>
        </radialGradient>
        <!-- Brushed-brass gilt for the wordmark: lit crown, warm midtone,
             shadowed foot — the same fitting-metal as the masthead rule. -->
        <linearGradient id="lg-gilt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f0d79b"/>
          <stop offset="0.42" stop-color="#d8b878"/>
          <stop offset="0.62" stop-color="#b08d4f"/>
          <stop offset="1" stop-color="#7a5f30"/>
        </linearGradient>
      </defs>

      <!-- The wax seal (shares geometry with public/seal.svg): blob body, a
           groove shadow + pressed inner disc for the raised-rim relief, irregular
           die rings, the debossed monogram, and a specular sheen over it all. -->
      <g>
        <ellipse cx="33" cy="36" rx="27" ry="27" fill="#000" opacity="0.3"/>
        <path fill="url(#lg-wax)" d="${SEAL_BLOB}"/>
        <path fill="#000" opacity="0.18" d="${SEAL_DISC}"/>
        <path fill="url(#lg-disc)" d="${SEAL_DISC}"/>
        <path fill="none" stroke="#6e4e12" stroke-opacity="0.6" stroke-width="1" d="${SEAL_RING_OUT}"/>
        <path fill="none" stroke="#fbeeb6" stroke-opacity="0.5" stroke-width="0.8" d="${SEAL_RING_IN}"/>
        <!-- Embossed, same gold as the disc — read entirely by edge relief. Light
             from top-left: lit crowns up-left, shaded far walls down-right. -->
        <g font-family="'IM Fell English', Georgia, serif" font-size="21" text-anchor="middle" font-style="italic">
          <text x="31.15" y="39.15" fill="#fff4cf" fill-opacity="0.9">TL</text>
          <text x="32.85" y="40.85" fill="#5a3e0e" fill-opacity="0.85">TL</text>
          <text x="32" y="40" fill="#cf9f28">TL</text>
        </g>
        <path fill="url(#lg-sheen)" pointer-events="none" d="${SEAL_BLOB}"/>
      </g>

      <!-- The wordmark: live text, gilt fill, a hair of tracking for the caps. A
           soft dark offset underneath lifts the brass off the leather. -->
      <g font-family="'IM Fell English', Georgia, serif" font-size="40" letter-spacing="0.6"
         dominant-baseline="alphabetic">
        <text class="lg-word" x="${wordX + 1}" y="45.5" fill="#000" fill-opacity="0.42">The Ledger</text>
        <text class="lg-word" x="${wordX}" y="44.5" fill="url(#lg-gilt)">The Ledger</text>
      </g>`;

    const style = document.createElement('style');
    style.textContent = ':host { display: block; height: 100%; } svg { height: 100%; width: auto; display: block; }';
    root.append(style, svg);

    // Trim the viewBox to the measured wordmark once the display font is ready,
    // so the logo box hugs the text instead of the 300-unit guess. getBBox needs
    // the node laid out; fonts.ready fires after IM Fell English loads.
    const fit = () => {
      const word = svg.querySelector('.lg-word');
      if (!word) return;
      try {
        const box = word.getBBox();
        svg.setAttribute('viewBox', `0 0 ${Math.ceil(box.x + box.width + 6)} ${H}`);
      } catch { /* getBBox can throw if not yet rendered; the guess stands */ }
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); else fit();
  }
}

if (!customElements.get('ledger-mark')) customElements.define('ledger-mark', LedgerMark);
