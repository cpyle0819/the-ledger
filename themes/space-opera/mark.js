// <space-opera-mark> — Space Opera's masthead logo: a ship-registry roundel (a
// stenciled hull-decal disc with a registry glyph and a cyan status LED) beside
// "THE LEDGER" set in the squared techno display face with a phosphor-cyan fill.
// The reading-room's wax seal, re-imagined as a painted-on hull marking: flat,
// stenciled, scuffed — not a pressed wax pour.
//
// A THEME ASSET (the space-opera theme package declares it as `logo`). Plain JS,
// self-registering, shadow-DOM encapsulated so its gradient ids don't collide
// with a sibling theme's logo. Everything is live SVG.
//
// Reads the theme's own font by name ('Chakra Petch'); the theme's `fonts` link
// loads it. Colors are baked (a logo is a fixed mark), tuned to the theme's
// phosphor-cyan + gunmetal palette.

class SpaceOperaMark extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;   // idempotent
    const root = this.attachShadow({ mode: 'open' });

    // Layout mirrors <ledger-mark>: a 64-unit roundel at the left, then the
    // wordmark; viewBox trimmed to the measured word once the font loads.
    const H = 64, disc = 64, gap = 16;
    const wordX = disc + gap;
    const cx = 32, cy = 34;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${wordX + 340} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');   // the masthead <h1> carries the name
    svg.innerHTML = `
      <defs>
        <!-- Brushed gunmetal disc: cool steel, lit from upper-left. -->
        <radialGradient id="so-disc" cx="40%" cy="34%" r="72%">
          <stop offset="0" stop-color="#3a4a58"/>
          <stop offset="0.6" stop-color="#26313d"/>
          <stop offset="1" stop-color="#161e27"/>
        </radialGradient>
        <!-- Phosphor-cyan wordmark fill: lit crown → cooler foot. -->
        <linearGradient id="so-cyan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9af0f8"/>
          <stop offset="0.5" stop-color="#58d7e6"/>
          <stop offset="1" stop-color="#2f9fb0"/>
        </linearGradient>
        <!-- Soft glow the LED and rim bleed. -->
        <filter id="so-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <!-- Hull-decal roundel: a scuffed steel disc, a stenciled double ring, a
           registry chevron glyph, and a live status LED. Flat and painted-on —
           the sci-fi analogue of the wax seal. -->
      <g>
        <circle cx="${cx}" cy="${cy}" r="27" fill="#000" opacity="0.35"/>
        <circle cx="${cx}" cy="${cy}" r="26" fill="url(#so-disc)" stroke="#46596a" stroke-width="1"/>
        <!-- stenciled registry rings, cyan, slightly worn (dashed inner). -->
        <circle cx="${cx}" cy="${cy}" r="21.5" fill="none" stroke="#58d7e6" stroke-opacity="0.7" stroke-width="1.5"/>
        <circle cx="${cx}" cy="${cy}" r="17.5" fill="none" stroke="#58d7e6" stroke-opacity="0.4" stroke-width="1" stroke-dasharray="3 3"/>
        <!-- registry glyph: an upward chevron (ascent / launch) over a baseline,
             the ship's mark. Cyan, with a faint glow. -->
        <g filter="url(#so-glow)">
          <path d="M ${cx} ${cy - 9} L ${cx + 9} ${cy + 4} L ${cx + 3.5} ${cy + 4} L ${cx + 3.5} ${cy + 8.5} L ${cx - 3.5} ${cy + 8.5} L ${cx - 3.5} ${cy + 4} L ${cx - 9} ${cy + 4} Z"
                fill="#7fe8f2"/>
        </g>
        <!-- status LED at the disc's lower-right, lit cyan. -->
        <circle cx="${cx + 15}" cy="${cy + 15}" r="2.4" fill="#7fe8f2" filter="url(#so-glow)"/>
        <!-- a scuff: a thin dark scratch across the disc for the lived-in wear. -->
        <path d="M ${cx - 16} ${cy + 9} L ${cx - 4} ${cy - 6}" stroke="#0d131b" stroke-opacity="0.4" stroke-width="1" stroke-linecap="round"/>
      </g>

      <!-- Wordmark: THE LEDGER, squared techno caps, cyan fill, wide tracking for
           the stenciled-panel look. A dark offset underneath seats it on the hull. -->
      <g font-family="'Chakra Petch', 'Segoe UI', sans-serif" font-weight="600"
         font-size="31" letter-spacing="2.5" dominant-baseline="alphabetic">
        <text class="so-word" x="${wordX + 1}" y="44" fill="#000" fill-opacity="0.5">THE LEDGER</text>
        <text class="so-word" x="${wordX}" y="43" fill="url(#so-cyan)">THE LEDGER</text>
      </g>`;

    const style = document.createElement('style');
    style.textContent = ':host { display: block; height: 100%; } svg { height: 100%; width: auto; display: block; }';
    root.append(style, svg);

    // Trim the viewBox to the measured wordmark once the display font is ready.
    const fit = () => {
      const word = svg.querySelector('.so-word');
      if (!word) return;
      try {
        const box = word.getBBox();
        svg.setAttribute('viewBox', `0 0 ${Math.ceil(box.x + box.width + 6)} ${H}`);
      } catch { /* not laid out yet; the guess stands */ }
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); else fit();
  }
}

if (!customElements.get('space-opera-mark')) customElements.define('space-opera-mark', SpaceOperaMark);
