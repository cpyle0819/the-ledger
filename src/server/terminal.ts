// The Ledger — optional embedded terminal. Off by default; enabled by a
// `terminal: true` field in ledger.config.json. When on, the host attaches a
// WebSocket upgrade handler that bridges the browser's xterm.js to a real shell
// on this machine via a pseudo-terminal (node-pty).
//
// This is deliberately NOT a source-plugin concern: a terminal is source-
// agnostic (it runs the user's own local tooling — an agent CLI, git, a shell),
// so it lives in the host beside the static/API routes, gated by its own config
// flag rather than a plugin capability.
//
// Security posture (single-user local app on 127.0.0.1):
//   - The board's own bind (127.0.0.1) keeps the port off the network.
//   - A per-boot token, minted here and read once by the page from /api/terminal,
//     must ride the WS handshake as a subprotocol — so another local process or a
//     drive-by page can't open a shell just by reaching the port.
//   - The Origin must be one of the app's own loopback origins, blocking a
//     cross-site WebSocket from a page the user happens to have open.
// A full shell is by definition full local access; this guards against OTHER
// local actors, not against the user, which is the intended capability.

import type { Server, IncomingMessage } from 'node:http';
import * as crypto from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import * as pty from 'node-pty';

// One token per server boot. The page fetches it from /api/terminal and presents
// it as the WS subprotocol; the upgrade is rejected without it.
const TOKEN = crypto.randomBytes(16).toString('hex');

// A cap so a runaway client (or a bug) can't spawn unbounded shells on the host.
const MAX_SESSIONS = 8;
let sessions = 0;

// The shell to spawn. Honors $SHELL when set (the user's login shell on
// macOS/Linux); on Windows, where $SHELL is normally unset, falls back to
// %COMSPEC% (cmd.exe) or PowerShell rather than a 'bash' that may not exist.
function defaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe';
  return 'bash';
}

/** Is the embedded terminal enabled? Read from the parsed config's `terminal`
 *  field — any truthy boolean turns it on. Absent/false → the feature is dark and
 *  no upgrade handler is attached. */
export function terminalEnabled(config: Record<string, unknown> | null): boolean {
  return config?.terminal === true;
}

/** The page reads this once to learn the feature is on and to get the handshake
 *  token. Returns null when disabled, so the route can 404. */
export function terminalHandshake(enabled: boolean): { token: string } | null {
  return enabled ? { token: TOKEN } : null;
}

// The loopback origins the app serves itself from — the browser may reach it via
// either host depending on IPv4/IPv6 resolution, and the Origin header mirrors
// whichever the user typed.
function allowedOrigins(port: number): Set<string> {
  return new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
}

/** Attach the terminal WebSocket to an existing http server. One PTY per socket;
 *  the shell is the user's login shell, started in their home directory with the
 *  server's own environment. */
export function attachTerminal(server: Server, port: number): void {
  const origins = allowedOrigins(port);
  const wss = new WebSocketServer({
    server,
    // The token rides as the WS subprotocol (not a query string — those leak into
    // logs). handleProtocols echoes it to accept; verifyClient rejects a wrong
    // token or a foreign Origin before the upgrade completes.
    handleProtocols: (protocols) => (protocols.has(TOKEN) ? TOKEN : false),
    verifyClient: (info: { req: IncomingMessage }) => {
      const origin = info.req.headers.origin;
      if (origin && !origins.has(origin)) return false;
      const sub = info.req.headers['sec-websocket-protocol'];
      return typeof sub === 'string' && sub.split(',').map((s) => s.trim()).includes(TOKEN);
    },
  });

  wss.on('connection', (ws: WebSocket) => {
    if (sessions >= MAX_SESSIONS) {
      ws.close(1013, 'too many terminal sessions');
      return;
    }
    sessions++;

    const shell = defaultShell();
    const term = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME,
      env: process.env as Record<string, string>,
    });

    // PTY output -> browser.
    term.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
    term.onExit(() => { if (ws.readyState === ws.OPEN) ws.close(); });

    // Browser -> PTY. Two message shapes: a JSON {type:'resize',cols,rows} control,
    // or raw keystrokes written straight through.
    ws.on('message', (msg: Buffer | string) => {
      const s = msg.toString();
      if (s.startsWith('{')) {
        try {
          const m = JSON.parse(s) as { type?: string; cols?: number; rows?: number };
          if (m.type === 'resize' && m.cols && m.rows) { term.resize(m.cols, m.rows); return; }
        } catch { /* not a control frame — fall through to a raw write */ }
      }
      term.write(s);
    });

    const cleanup = () => { term.kill(); sessions = Math.max(0, sessions - 1); };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}
