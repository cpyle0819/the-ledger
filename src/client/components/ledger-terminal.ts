// <ledger-terminal> — an embedded shell overlaid at the bottom of the board. A
// panel that slides up from the bottom edge, holding an xterm.js terminal wired to
// a real shell on the host via a WebSocket the server bridges to a pseudo-
// terminal. Its purpose: run the user's own local tooling — an agent CLI, git, a
// shell — beside the board without leaving it.
//
// A fixed bottom overlay, not a reflow dock: it floats over the lower part of the
// board rather than pushing content up, so the board stays put and shows through
// the terminal's 80%-opacity background. Not modal — the board above the overlay
// stays visible and interactive (no scrim).
//
// Enabled only when the host reports `terminal: true` from /api/source; app.ts
// mounts the button and this element only then. The element owns its socket
// lifecycle: it connects on first open (fetching the handshake token), and keeps
// the session alive across close/reopen so a long-running command isn't killed by
// hiding the panel.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { chromeSheet } from './shared-styles.js';

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  /* A bottom overlay, not a reflow dock: fixed to the viewport's bottom edge and
     floating over the board, so the board stays put and shows through the
     terminal's 80%-opacity background. Slides up from below on open. */
  :host {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 520;
    height: min(42vh, 460px); pointer-events: none;
    transform: translateY(100%); transition: transform .3s cubic-bezier(.2,.8,.2,1);
    border-top: 1px solid var(--metal-dim, #7a5f30);
  }
  :host([open]) { transform: translateY(0); pointer-events: auto; }
  .panel {
    height: 100%; display: flex; flex-direction: column;
    /* Transparent so the terminal's 80%-opacity background lets the board beneath
       the overlay show through; the header keeps its own opaque fill. */
    background: transparent;
    box-shadow: 0 -18px 40px rgba(0,0,0,.4);
  }
  @media (prefers-reduced-motion: reduce) { :host { transition: none; } }

  .t-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 10px 14px; border-bottom: 1px solid var(--metal-dim, #7a5f30);
    background: linear-gradient(180deg, var(--frame-raised, #2a1c10), var(--frame, #1c130a));
    flex: 0 0 auto;
  }
  .t-title {
    font-family: var(--fell-sc, serif); font-size: 14px; letter-spacing: .08em;
    color: var(--metal-bright, #d8b878); margin: 0;
  }
  .ghost-btn {
    font-family: var(--fell, serif); font-style: italic; font-size: 15px; color: var(--metal-bright, #d8b878);
    background: linear-gradient(180deg, var(--frame, #2a1c10), var(--frame-raised, #33230f));
    border: 1px solid var(--metal-dim, #7a5f30); border-radius: 2px; padding: 5px 12px; cursor: pointer; transition: .15s;
  }
  .ghost-btn:hover { color: #fff; border-color: var(--metal, #b08d4f); }

  /* xterm mounts here; it fills the panel below the header. Horizontal padding
     insets the terminal from the panel edges; no TOP padding, so the surface meets
     the header with no gap. */
  .t-body { flex: 1 1 auto; min-height: 0; padding: 0 10px; background: transparent; overflow: hidden; }

  /* xterm.css hardcodes an opaque #000 on .xterm and .xterm-viewport, which paints
     over the translucent theme background — so the prompt area stays black despite
     allowTransparency. Force those layers transparent so the terminal's own
     80%-opacity theme background is the only fill, and drop the viewport's grey
     scrollbar track (the bar on the right) to transparent too. */
  .t-body .xterm, .t-body .xterm-viewport, .t-body .xterm-screen { background: transparent !important; }
  .t-body .xterm-viewport { scrollbar-width: thin; scrollbar-color: var(--metal-dim, #7a5f30) transparent; }

  :focus-visible { outline: 2px solid var(--metal-bright, #d8b878); outline-offset: 2px; }
`);

export class LedgerTerminal extends HTMLElement {
  #term: Terminal | null = null;
  #fit: FitAddon | null = null;
  #ws: WebSocket | null = null;
  #connected = false;
  #lastFocus: HTMLElement | null = null;
  #ro: ResizeObserver | null = null;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.adoptedStyleSheets = [chromeSheet, sheet];
    // A dock, not a modal: no scrim, no aria-modal — the board above stays visible
    // and interactive while the shell is open.
    this.shadowRoot!.innerHTML = `
      <div class="panel" role="region" aria-label="Terminal" part="panel">
        <div class="t-head">
          <h2 class="t-title">Terminal</h2>
          <button class="ghost-btn" id="t-close" aria-keyshortcuts="Escape" title="Close (Esc)">✕ close</button>
        </div>
        <div class="t-body" id="t-body"></div>
      </div>`;
    // xterm styles its own .xterm nodes, which live in this shadow root, so its
    // stylesheet must be adopted here (a document-level <link> wouldn't reach in).
    // Fetched from the vendor route as text, once; the browser caches it.
    this.#adoptXtermCss();
    this.#$('#t-close').addEventListener('click', () => this.close());
    this.shadowRoot!.addEventListener('keydown', (e) => {
      // Only Escape is handled here; every other key belongs to the shell.
      if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); this.close(); }
    });
    // The open/close height animation changes the terminal's usable size only when
    // it finishes; re-fit on transition end so xterm's grid matches the final box.
    this.addEventListener('transitionend', (e) => {
      if ((e as TransitionEvent).propertyName === 'height' && this.hasAttribute('open')) {
        this.#fit?.fit(); this.#sendResize();
      }
    });
  }

  #$<T extends Element = HTMLElement>(sel: string): T { return this.shadowRoot!.querySelector(sel) as T; }

  async #adoptXtermCss(): Promise<void> {
    try {
      const css = await (await fetch('/vendor/xterm/xterm.css')).text();
      const s = new CSSStyleSheet();
      s.replaceSync(css);
      this.shadowRoot!.adoptedStyleSheets = [...this.shadowRoot!.adoptedStyleSheets, s];
    } catch { /* the terminal still works unstyled if the sheet 404s */ }
  }

  async open(): Promise<void> {
    if (this.hasAttribute('open')) return;
    this.#lastFocus = document.activeElement as HTMLElement | null;
    this.setAttribute('open', '');
    if (!this.#term) this.#initTerm();
    if (!this.#connected) await this.#connect();
    // Fit to the panel now that it's laid out, then focus the shell.
    requestAnimationFrame(() => { this.#fit?.fit(); this.#sendResize(); this.#term?.focus(); });
  }

  close(): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    // The socket + PTY are left running (see the header note on session survival).
    if (this.#lastFocus && this.#lastFocus.isConnected) this.#lastFocus.focus();
    this.#lastFocus = null;
  }

  #initTerm(): void {
    // allowTransparency lets the rgba background blend with what's behind the
    // terminal (the transparent panel, and the board beneath the overlay); without
    // it xterm paints an opaque cell layer and the alpha is ignored.
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      allowTransparency: true,
      theme: { background: 'rgba(10, 7, 3, 0.8)' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(this.#$('#t-body'));
    // Keystrokes -> PTY.
    term.onData((d) => { if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(d); });
    // Re-fit whenever the panel resizes (window resize, and the initial layout).
    this.#ro = new ResizeObserver(() => { if (this.hasAttribute('open')) { fit.fit(); this.#sendResize(); } });
    this.#ro.observe(this.#$('#t-body'));
    this.#term = term;
    this.#fit = fit;
  }

  async #connect(): Promise<void> {
    let token: string;
    try {
      token = (await (await fetch('/api/terminal')).json()).token as string;
    } catch {
      this.#term?.write('\r\n\x1b[31m[terminal unavailable]\x1b[0m\r\n');
      return;
    }
    // The token rides as the WS subprotocol; the server rejects the upgrade
    // without it (see server/terminal.ts).
    const ws = new WebSocket(`ws://${location.host}`, token);
    ws.onmessage = (e) => this.#term?.write(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => { this.#connected = false; this.#term?.write('\r\n\x1b[31m[connection closed]\x1b[0m\r\n'); };
    ws.onerror = () => { this.#connected = false; };
    await new Promise<void>((resolve) => { ws.onopen = () => { this.#connected = true; resolve(); }; });
    this.#ws = ws;
  }

  #sendResize(): void {
    if (this.#ws?.readyState === WebSocket.OPEN && this.#term) {
      this.#ws.send(JSON.stringify({ type: 'resize', cols: this.#term.cols, rows: this.#term.rows }));
    }
  }
}

if (!customElements.get('ledger-terminal')) customElements.define('ledger-terminal', LedgerTerminal);
