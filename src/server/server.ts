// The Ledger — host. Serves the UI and a plugin-agnostic API over one active
// source plugin. The host knows nothing about any backing system: it loads the
// active plugin (plugin-interface), routes requests through the guarded gateway,
// and lets the frontend read the plugin's capabilities to decide which actions
// to show. Source-specific logic lives entirely in plugins/<name>.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { callPlugin, loadActiveSource, REPO_ROOT } from './plugin-interface';
import type { CreatableField, CreateInput, Filters, SourcePlugin } from '../shared/contract';

const PORT = Number(process.env.PORT) || 4317;

const source = loadActiveSource();

// Static assets (index.html, styles, compiled client, sounds) live under
// public/ at the repo root — resolved from REPO_ROOT since this compiled server
// runs from dist/server/.
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

// ---- http helpers -------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.map': 'application/json',
};

function sendJSON(res: http.ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, urlPath: string): void {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, buf) => {
    if (err) return sendJSON(res, 404, { error: 'not found' });
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    // Always send Content-Length (never chunked) and advertise range support.
    // Media needs this: without a known length the browser reports duration
    // Infinity and treats the stream as unseekable, so setting audio
    // currentTime is silently ignored (the page-turn start-offset regression).
    const rangeHeader = req.headers.range;
    const range = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? parseInt(range[2], 10) : buf.length - 1;
      if (start > end || end >= buf.length) {
        res.writeHead(416, { 'content-range': `bytes */${buf.length}` });
        return res.end();
      }
      const slice = buf.subarray(start, end + 1);
      res.writeHead(206, {
        'content-type': type,
        'content-length': slice.length,
        'content-range': `bytes ${start}-${end}/${buf.length}`,
        'accept-ranges': 'bytes',
      });
      return res.end(slice);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': buf.length, 'accept-ranges': 'bytes' });
    res.end(buf);
  });
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

// Route a request through the active plugin's method via the guarded gateway.
const call = (method: keyof SourcePlugin, ...args: unknown[]) => callPlugin(source.plugin, method, args);

// Build a CreateInput from a request body against the source's declared
// createFields. `type` and `title` are always required; every other field is
// carried only when the source declares it, so a client can't smuggle a field
// the source never advertised. Throws a 400 the http layer maps for the caller.
function buildCreateInput(body: Record<string, unknown>, createFields: CreatableField[]): CreateInput {
  const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!type) throw bad('type is required');
  if (!title) throw bad('title is required');
  const input: CreateInput = { type, title };
  const declared = new Set(createFields);
  if (declared.has('parent') && body.parent != null) input.parent = String(body.parent);
  if (declared.has('project') && body.project != null) input.project = String(body.project);
  if (declared.has('assignee') && body.assignee != null) input.assignee = String(body.assignee);
  if (declared.has('description') && body.description != null) input.description = String(body.description);
  if (declared.has('estimate') && body.estimate != null) input.estimate = Number(body.estimate) || null;
  return input;
}

// ---- routing ------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const p = url.pathname;
  const q = url.searchParams;
  try {
    // The frontend reads this once to learn who it's acting as and which actions
    // the active source supports, then hides the rest.
    if (p === '/api/source') {
      return sendJSON(res, 200, { name: source.name, me: source.plugin.me, capabilities: source.capabilities });
    }

    // Lazy hierarchy: no `parent` => roots (epics); otherwise that node's children.
    // `project` (a source grouping id) scopes the roots when the source supports
    // projects; it's one more filter dimension alongside assignee and status.
    if (p === '/api/children' && req.method === 'GET') {
      const filters: Filters = {
        assignee: q.get('assignee') || source.plugin.me,
        status: (q.get('status') as Filters['status']) || 'Open',
      };
      if (source.capabilities.projects && q.get('project')) filters.project = q.get('project');
      const nodes = await call('getChildren', q.get('parent') || null, filters);
      return sendJSON(res, 200, { parent: q.get('parent') || null, assignee: filters.assignee, nodes });
    }

    // Story/task rollup for a set of epics, under the current filters. Called
    // after the roots render, so it never blocks first paint; the card shows the
    // raw child count until the counts arrive. `epics` is a comma-separated id list.
    if (source.capabilities.epicCounts && p === '/api/counts' && req.method === 'GET') {
      const filters: Filters = {
        assignee: q.get('assignee') || source.plugin.me,
        status: (q.get('status') as Filters['status']) || 'Open',
      };
      if (source.capabilities.projects && q.get('project')) filters.project = q.get('project');
      const epicIds = (q.get('epics') || '').split(',').filter(Boolean);
      const counts = epicIds.length ? await call('countEpicTasks', epicIds, filters) : {};
      return sendJSON(res, 200, { counts });
    }

    if (source.capabilities.projects && p === '/api/projects' && req.method === 'GET') {
      return sendJSON(res, 200, { projects: await call('listProjects') });
    }

    if (source.capabilities.searchAssignees && p === '/api/assignees' && req.method === 'GET') {
      return sendJSON(res, 200, { users: await call('searchAssignees', q.get('q') || '') });
    }

    if (source.capabilities.stepOptions && p === '/api/steps' && req.method === 'GET') {
      return sendJSON(res, 200, { steps: await call('stepOptions', { project: q.get('project') }) });
    }

    // Create: forward a validated create request to the active plugin. Rejected
    // when the source doesn't advertise create; the body is validated against the
    // source's declared createFields before the plugin is called.
    if (p === '/api/item' && req.method === 'POST') {
      if (!source.capabilities.create) return sendJSON(res, 400, { error: `Source '${source.name}' does not support create` });
      const input = buildCreateInput(await readBody(req), source.capabilities.createFields);
      return sendJSON(res, 200, { item: await call('createItem', input) });
    }

    const itemMatch = p.match(/^\/api\/item\/([^/]+)$/);
    if (itemMatch && req.method === 'GET') {
      return sendJSON(res, 200, { item: await call('readItem', itemMatch[1]) });
    }

    const editMatch = p.match(/^\/api\/item\/([^/]+)\/edit$/);
    if (editMatch && req.method === 'POST') {
      const { field, value } = await readBody(req);
      return sendJSON(res, 200, { item: await call('editField', editMatch[1], field, value) });
    }

    // Comments: add (POST), edit/delete a specific comment by id (POST/DELETE).
    const commentAdd = p.match(/^\/api\/item\/([^/]+)\/comment$/);
    if (commentAdd && req.method === 'POST') {
      const { message } = await readBody(req);
      return sendJSON(res, 200, { item: await call('addComment', commentAdd[1], message) });
    }
    const commentOne = p.match(/^\/api\/item\/([^/]+)\/comment\/([^/]+)$/);
    if (commentOne && req.method === 'POST') {
      const { message } = await readBody(req);
      return sendJSON(res, 200, { item: await call('editComment', commentOne[1], commentOne[2], message) });
    }
    if (commentOne && req.method === 'DELETE') {
      return sendJSON(res, 200, { item: await call('deleteComment', commentOne[1], commentOne[2]) });
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'unknown endpoint' });
    // serve the smoke-drift Web Component (npm dep) from node_modules
    if (p === '/vendor/smoke-drift.js') {
      return fs.readFile(require.resolve('smoke-drift'), (err, buf) => {
        if (err) return sendJSON(res, 404, { error: 'smoke-drift not installed — run npm install' });
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(buf);
      });
    }
    return serveStatic(req, res, p);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    sendJSON(res, e.status || 500, { error: e.message });
  }
});

// A stray plugin promise rejection must not take down the http server.
process.on('unhandledRejection', (e) => console.error('[ledger] unhandled rejection', e));

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  The Ledger  ·  http://localhost:${PORT}`);
  console.log(`  source:   ${source.name} (as ${source.plugin.me})`);
  console.log(`  supports: ${Object.entries(source.capabilities).filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([k]) => k).join(', ')}\n`);
});
