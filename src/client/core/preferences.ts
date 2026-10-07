export type PanelView = 'sidebar' | 'fullscreen';

const PANEL_VIEW_KEY = 'ledger:panel-view';
let sessionPanelView: PanelView = 'sidebar';
let sessionOnly = false;

/** The browser-wide default applies to each newly opened item, across themes. */
export function defaultPanelView(): PanelView {
  if (sessionOnly) return sessionPanelView;
  try {
    const stored = localStorage.getItem(PANEL_VIEW_KEY);
    sessionPanelView = stored === 'fullscreen' ? 'fullscreen' : 'sidebar';
  } catch { /* Storage can be unavailable; retain this session's preference. */ }
  return sessionPanelView;
}

export function saveDefaultPanelView(view: PanelView): void {
  sessionPanelView = view;
  try { localStorage.setItem(PANEL_VIEW_KEY, view); } catch { sessionOnly = true; }
}
