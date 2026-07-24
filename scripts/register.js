'use strict';

// `npm run register` — install The Ledger as a per-user background service that
// starts on host boot and stays reachable at http://localhost:4317 across
// login/logout cycles, then start it immediately.
//
// The service is a singleton owned by the OS init system (systemd/launchd/Task
// Scheduler), NOT something a login shell spawns — so logging out and back in
// never starts a second copy. Re-running this script is idempotent: it rewrites
// the unit and restarts the one instance.
//
// On a Cloud Desktop there is no persistent desktop session, so "start on login"
// alone would die when your last SSH session ends. The Linux path calls
// `loginctl enable-linger`, which keeps your user systemd manager alive from
// boot with no active session — that is what makes "always running" true here.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
// Absolute node path is baked into the unit because init systems don't inherit
// your interactive PATH (mise shims included). A node upgrade moves this path;
// just re-run `npm run register` to refresh the unit.
const NODE = process.execPath;
// The compiled server (TypeScript builds to dist/); see ensureBuild.
const SERVER = path.join(REPO, 'dist', 'server', 'server.js');
const NAME = 'the-ledger';
const LABEL = 'com.corepyle.the-ledger';
const PORT = process.env.PORT || '4317';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  return r.status;
}

// Deps must exist before the service starts, and the service itself must not run
// `npm install` on every boot (that would hit the network and crash-loop when
// offline). So install once here, at register time.
function ensureDeps() {
  console.log('› installing dependencies…');
  const status = run('npm', ['install'], { cwd: REPO });
  if (status !== 0) throw new Error(`npm install failed (exit ${status})`);
}

// Compile TypeScript once, here at register time — the service runs the emitted
// dist/server/server.js and must never build on boot (that would be slow and
// could crash-loop). `npm install` also runs `prepare` (tsc -b), but build here
// explicitly so a re-register with unchanged deps still refreshes the output.
function ensureBuild() {
  console.log('› building…');
  const status = run('npm', ['run', 'build'], { cwd: REPO });
  if (status !== 0) throw new Error(`build failed (exit ${status})`);
}

function registerLinux() {
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  fs.mkdirSync(unitDir, { recursive: true });
  const unitPath = path.join(unitDir, `${NAME}.service`);

  const unit = `[Unit]
Description=The Ledger — local task board
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO}
Environment=PORT=${PORT}
ExecStart=${NODE} ${SERVER}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
  fs.writeFileSync(unitPath, unit);
  console.log(`› wrote ${unitPath}`);

  // Keep the user manager alive at boot with no active session. Already-on is
  // fine; this is safe to repeat. May need root on some hosts — a non-zero exit
  // is non-fatal (linger may already be set).
  if (run('loginctl', ['enable-linger', os.userInfo().username]) !== 0) {
    console.log('  (enable-linger returned non-zero — likely already enabled)');
  }

  run('systemctl', ['--user', 'daemon-reload']);
  // enable --now enables at boot and starts immediately; restart guarantees a
  // re-register replaces any running instance rather than leaving a stale one.
  run('systemctl', ['--user', 'enable', '--now', `${NAME}.service`]);
  run('systemctl', ['--user', 'restart', `${NAME}.service`]);
  console.log(`\n✓ ${NAME} enabled and running. Check: systemctl --user status ${NAME}`);
}

function registerMac() {
  const agentDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(agentDir, { recursive: true });
  const plistPath = path.join(agentDir, `${LABEL}.plist`);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${NODE}</string><string>${SERVER}</string></array>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>EnvironmentVariables</key><dict><key>PORT</key><string>${PORT}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
`;
  fs.writeFileSync(plistPath, plist);
  console.log(`› wrote ${plistPath}`);

  // Unload-then-load makes re-register idempotent (bootout fails harmlessly if
  // not loaded). RunAtLoad + KeepAlive give boot-start + crash-restart.
  const uid = process.getuid();
  run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
  run('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
  run('launchctl', ['kickstart', '-k', `gui/${uid}/${LABEL}`]);
  console.log(`\n✓ ${LABEL} loaded and running. Check: launchctl print gui/${uid}/${LABEL}`);
}

function registerWindows() {
  // A scheduled task with an ONLOGON trigger and /RL LIMITED runs as the current
  // user at logon. /F overwrites an existing task, making re-register idempotent.
  const tr = `\"${NODE}\" \"${SERVER}\"`;
  run('schtasks', ['/Create', '/SC', 'ONLOGON', '/TN', NAME, '/TR', tr, '/RL', 'LIMITED', '/F']);
  run('schtasks', ['/Run', '/TN', NAME]);
  console.log(`\n✓ ${NAME} scheduled task created and started. Check: schtasks /Query /TN ${NAME}`);
  console.log('  Note: Windows has no session-independent equivalent of linger; the app runs while you are logged in.');
}

function main() {
  ensureDeps();
  ensureBuild();
  switch (process.platform) {
    case 'linux':
      return registerLinux();
    case 'darwin':
      return registerMac();
    case 'win32':
      return registerWindows();
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

main();
