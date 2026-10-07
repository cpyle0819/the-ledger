// Full-screen reading keeps the article measure independent of the viewport width.
export const readerSheet = new CSSStyleSheet();
readerSheet.replaceSync(`
  .panel { box-sizing: border-box; overflow-anchor: none; }
  .d-window-actions { display: flex; flex-wrap: wrap; flex-shrink: 0; align-items: center; gap: 8px; }
  .d-view-btn { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; padding: 8px !important; }
  .d-window-actions .d-desc-actions { flex-wrap: wrap; }
  .dh-left { flex-wrap: wrap; min-width: 0; }
  .d-reader-context { display: none; }
  .d-metadata, .d-article { min-width: 0; }
  .d-metadata > summary { display: none; }
  .head { position: sticky; top: -26px; z-index: 10; padding: 12px 0;
    background: var(--sheet-surface); }
  .panel { scroll-padding-top: 84px; }
  :focus-visible { outline-color: var(--focus-ring-onlight, var(--text)); }

  :host([data-view="fullscreen"]) .panel {
    --reader-padding: clamp(20px, 5vw, 72px);
    width: 100%; height: 100%; inset: 0; border: 0; box-shadow: none;
    padding: 0 var(--reader-padding); overflow-x: hidden; overflow-y: auto;
    background: var(--reader-surface, var(--sheet-surface, var(--surface-bright)));
    font-family: var(--reader-font, Georgia, serif);
    font-size: 21px; line-height: 1.65;
    scrollbar-gutter: stable;
  }
  :host([data-view="fullscreen"]) .panel::before { display: none; }
  :host([data-view="fullscreen"]) .panel > :not(.head) {
    box-sizing: border-box; width: min(100%, var(--reader-measure, 700px)); align-self: center;
  }
  :host([data-view="fullscreen"]) .head {
    top: 0; width: calc(100% + 2 * var(--reader-padding));
    margin-inline: calc(-1 * var(--reader-padding)); padding: 12px var(--reader-padding);
    box-sizing: border-box; min-height: 64px; align-items: center;
    border-bottom: 1px solid var(--border);
    background: var(--reader-surface, var(--sheet-surface, var(--surface-bright)));
  }
  :host([data-view="fullscreen"]) .head :is(.ghost-btn, .d-save-btn) {
    font: 14px/1.4 var(--gara, sans-serif); padding: 8px 12px; box-shadow: none;
  }
  :host([data-view="fullscreen"]) .d-title,
  :host([data-view="fullscreen"]) .d-title-edit {
    margin: 48px 0 18px; font-family: var(--reader-heading-font, system-ui, sans-serif);
    font-size: clamp(30px, 3.4vw, 44px); font-weight: 650; line-height: 1.15;
    letter-spacing: -.025em; text-wrap: pretty; overflow-wrap: anywhere;
  }
  :host([data-view="fullscreen"]) .d-reader-context {
    display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline; margin-bottom: 32px;
    color: var(--text-muted); font: 14px/1.6 var(--gara, sans-serif);
  }
  .d-byline { margin: 0; overflow-wrap: anywhere; }
  .d-details-link { color: var(--text-muted); font: inherit; padding: 2px 0;
    border: 0; background: none; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
  .d-details-link:hover { color: var(--text); }
  :host([data-view="fullscreen"]) .d-rule { display: none; }
  :host([data-view="fullscreen"]) .d-desc-head { display: none; }
  :host([data-view="fullscreen"]) .d-desc-label { display: none; }
  :host([data-view="fullscreen"]) .d-desc-head button {
    font: 14px/1.4 var(--gara, sans-serif); box-shadow: none;
  }
  :host([data-view="fullscreen"]) .d-desc-render,
  :host([data-view="fullscreen"]) .d-desc {
    font-family: var(--reader-font, Georgia, serif); font-size: clamp(19px, 1.6vw, 21px);
    line-height: 1.65; letter-spacing: normal; text-align: start; overflow-wrap: anywhere;
  }
  :host([data-view="fullscreen"]) .d-desc-render p { margin: 0 0 1.4em; }
  :host([data-view="fullscreen"]) .d-desc-render :is(h1, h2, h3, h4, h5, h6) {
    font-family: var(--reader-heading-font, system-ui, sans-serif); font-weight: 650;
    line-height: 1.25; letter-spacing: -.015em; margin: 1.8em 0 .7em;
    color: var(--text); overflow-wrap: anywhere;
  }
  :host([data-view="fullscreen"]) .d-desc-render h1 { font-size: 1.65em; }
  :host([data-view="fullscreen"]) .d-desc-render h2 { font-size: 1.4em; }
  :host([data-view="fullscreen"]) .d-desc-render h3 { font-size: 1.2em; }
  :host([data-view="fullscreen"]) .d-desc-render :is(h4, h5, h6) { font-size: 1em; }
  :host([data-view="fullscreen"]) .d-desc-render :is(ul, ol) { margin: 0 0 1.4em; padding-left: 1.5em; }
  :host([data-view="fullscreen"]) .d-desc-render li { margin: .45em 0; }
  :host([data-view="fullscreen"]) .d-desc-render blockquote {
    margin: 1.5em 0; padding: .25em 1.1em; border-left: 3px solid var(--text-muted);
    color: var(--text); font-style: italic;
  }
  :host([data-view="fullscreen"]) .d-desc-render a { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
  :host([data-view="fullscreen"]) .d-desc-render code { font-size: .78em; background: var(--inset-bg); }
  :host([data-view="fullscreen"]) .d-desc-render pre {
    margin: 1.5em 0; padding: 20px; background: var(--inset-bg); border: 1px solid var(--border);
    border-radius: var(--control-radius, 4px); overflow-x: auto; line-height: 1.6; overflow-wrap: normal;
  }
  :host([data-view="fullscreen"]) .d-desc-render pre code { font-size: 15px; }
  :host([data-view="fullscreen"]) .d-desc-render table {
    display: block; max-width: 100%; overflow-x: auto; font: 15px/1.6 var(--gara, sans-serif); margin: 1.5em 0;
  }
  :host([data-view="fullscreen"]) .d-desc-render :is(th, td) { padding: 10px 14px; }
  :host([data-view="fullscreen"]) .d-desc-render hr { margin: 2em 0; background: var(--border); }
  :host([data-view="fullscreen"]) .d-metadata {
    margin-top: 48px; border-block: 1px solid var(--border); font: 15px/1.6 var(--gara, sans-serif);
  }
  :host([data-view="fullscreen"]) .d-metadata > summary {
    display: list-item; padding: 18px 0; cursor: pointer; font-weight: 600; color: var(--text-muted);
  }
  :host([data-view="fullscreen"]) .d-metadata-body { padding: 12px 0 24px; }
  :host([data-view="fullscreen"]) .d-metadata .d-risk { margin-top: 0; }
  :host([data-view="fullscreen"]) .d-comments { margin-top: 36px; font: 16px/1.6 var(--gara, sans-serif); }
  :host([data-view="fullscreen"]) .scroll-tail { height: 80px; }
  :host([data-view="fullscreen"]) .d-back { margin: 20px 0 0; font-size: 14px; }

  @media (max-width: 600px) {
    .panel { width: 100%; padding-inline: 20px; border-left: 0; }
    .head { gap: 8px; flex-wrap: wrap; }
    .d-window-actions { margin-left: auto; }
    .d-window-actions .ghost-btn { font-size: 14px; padding: 8px 10px; }
    .d-grid { grid-template-columns: minmax(0, 1fr); }
    .d-toolbar { flex-wrap: wrap; }
    .d-tool-hint { flex-basis: 100%; margin: 4px 0; }
    :host([data-view="fullscreen"]) .d-title { margin-top: 30px; }
    :host([data-view="fullscreen"]) .d-reader-context { margin-bottom: 20px; }
  }
`);
