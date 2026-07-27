'use strict';

// `npm run serve` — install deps and run the server in the foreground.
//
// If the registered background service (see scripts/register.js) is already up,
// the port is taken and a second `node server.js` would die with a cryptic
// EADDRINUSE. So probe the port first: if it's already serving, warn plainly and
// exit 0 rather than crash-starting a doomed second instance.

const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
// Port precedence: a CLI arg (`npm run serve -- 8080`) wins, then the PORT env
// var, then the default. The server reads PORT from its env, so a CLI arg is
// forwarded by setting PORT for the spawned process below.
const PORT = parseInt(process.argv[2] || process.env.PORT || '4317', 10);

// Resolves true if something is already accepting connections on PORT.
function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ port: PORT, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false)); // ECONNREFUSED — nothing there
  });
}

async function main() {
  if (await portInUse()) {
    console.warn(
      `\n⚠  The Ledger is already running at http://localhost:${PORT} ` +
      `(likely the registered background service).\n` +
      `   Not starting a second instance. To manage the service:\n` +
      `     systemctl --user status the-ledger     # Linux\n` +
      `     launchctl print gui/$(id -u)/com.corepyle.the-ledger   # macOS\n`
    );
    return;
  }

  const install = spawnSync('npm', ['install'], { cwd: REPO, stdio: 'inherit' });
  if (install.status !== 0) process.exit(install.status);

  // Compile TypeScript (server -> dist/, client -> public/build/) before running.
  const build = spawnSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status);

  const server = spawnSync(process.execPath, [path.join(REPO, 'dist', 'server', 'server.js')], {
    cwd: REPO,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(PORT) },
  });
  process.exit(server.status ?? 0);
}

main();
