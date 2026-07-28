'use strict';

// The Ledger — GitHub source plugin. Renders a repo's work as the
// Epic/Story/Task board by mapping GitHub's grouping primitives onto the three
// tiers:
//
//   EPIC  = a Project (v2) linked to the repo
//   STORY = a Milestone
//   TASK  = an Issue
//
// GitHub has no native three-level hierarchy, so the tree is synthesized. A
// milestone (story) sits under a project (epic) when the issues in that
// milestone belong to that project; an issue (task) sits under its milestone, or
// directly under a project when it has none, or at the root when it has neither.
// A milestone whose issues span multiple projects is placed under the first
// project seen on its issues (a documented v1 limitation for a mixed board).
//
// Auth model: shells out to the `gh` CLI, which uses the viewer's existing
// GitHub authentication. No token is read into or held by this process — `gh`
// owns the credential and every call is attributed to the signed-in user, who
// can read and write exactly what they already can. Requires `gh` on PATH and an
// authenticated session (`gh auth login`).
//
// Source-native terms that stay inside this plugin: a GitHub `number` (issue,
// milestone, project) maps to the contract's `id` behind a one-letter tier
// prefix (I/M/P) so the three number spaces can't collide. `owner/repo` is the
// backing repo, from GITHUB_REPO.

const { execFile, execFileSync } = require('child_process');

// The backing repo, "owner/name". Defaults to this board's own repo; override to
// point the plugin at any repo the signed-in user can reach.
const REPO = process.env.GITHUB_REPO || 'cpyle0819/the-ledger';
const [OWNER, NAME] = REPO.split('/');
const ME = process.env.GITHUB_ME || null; // resolved lazily from `gh api user` when unset

// Coverage caps for the single forest query. GraphQL connections cap a single
// page at 100 records, so that's the ceiling here (no pagination yet — a
// personal board sits well under it). A build logs a warning, not a silent
// truncation, if the repo has more issues than one page holds.
const MAX_ISSUES = 100;
const MAX_MILESTONES = 100;
const MAX_PROJECTS = 50;

// ---- gh transport -------------------------------------------------------

// Run `gh` and resolve its stdout parsed as JSON. A non-zero exit surfaces gh's
// stderr; an unauthenticated session (or missing gh) maps to 401 so the board
// shows the same "session expired" affordance every source uses, with a message
// telling the user how to recover.
function gh(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || '');
        if (/gh auth login|not logged|authentication|HTTP 401/i.test(msg) || err.code === 'ENOENT') {
          const how = err.code === 'ENOENT'
            ? 'GitHub CLI (`gh`) not found on PATH.'
            : 'GitHub session not authenticated — run `gh auth login` and retry.';
          return reject(Object.assign(new Error(how), { status: 401 }));
        }
        const status = /HTTP (\d{3})/.exec(msg)?.[1];
        return reject(Object.assign(new Error(`gh ${args[0]} failed: ${msg.slice(0, 300)}`), { status: status ? Number(status) : 502 }));
      }
      try { resolve(stdout ? JSON.parse(stdout) : null); }
      catch { reject(Object.assign(new Error(`gh ${args[0]}: non-JSON response`), { status: 502 })); }
    });
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
  });
}

// A REST call through `gh api`. A body object is sent as JSON on stdin via
// `--input -` so arrays and nested fields round-trip exactly (the -f/-F flags
// flatten those). path is repo-relative, e.g. `issues/5`.
function rest(method, path, body) {
  const args = ['api', '-X', method, `repos/${OWNER}/${NAME}/${path}`];
  if (body) return gh([...args, '--input', '-'], { input: JSON.stringify(body) });
  return gh(args);
}

// A GraphQL call through `gh api graphql`. Variables are passed with -F so
// numbers/strings keep their type as GraphQL expects.
function graphql(query, vars = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push('-F', `${k}=${v}`);
  return gh(args);
}

// The viewer's login, resolved once at startup. The host reads plugin.me
// synchronously (it seeds the default assignee filter and the /api/source
// response before any async method runs), so this can't be lazy. One `gh api
// user` subprocess at construction; falls back to 'me' if gh isn't ready (the
// board still works, just without a personalized default filter).
function whoAmISync() {
  if (ME) return ME;
  try {
    const out = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
    return out || 'me';
  } catch {
    return 'me';
  }
}

// ---- status mapping -----------------------------------------------------

// A GitHub issue's OPEN/CLOSED state -> the contract's binary status. The close
// reason (completed vs not_planned) is not surfaced: the contract status is
// binary, so any closed issue reads 'Closed' regardless of why it closed.
function issueStatus(state) {
  return String(state).toUpperCase() === 'OPEN' ? 'Open' : 'Closed';
}
// Milestones/projects carry only open/closed; map straight across.
function openClosed(stateOrClosed) {
  const closed = stateOrClosed === true || String(stateOrClosed).toUpperCase() === 'CLOSED';
  return closed ? 'Closed' : 'Open';
}

function passesStatus(status, filter) {
  if (filter === 'ALL') return true;
  const closed = status === 'Closed';
  return filter === 'Closed' ? closed : !closed;
}

// The tier label drives the wax-seal chip; a `bug`-labelled issue reads BUG (red
// chip) while staying a task in the hierarchy.
function issueType(labels) {
  return labels.some((l) => l.toLowerCase() === 'bug') ? 'BUG' : 'TASK';
}

// ---- forest -------------------------------------------------------------
//
// One GraphQL query pulls the whole board: the repo's linked projects, its
// milestones, and its issues with each issue's milestone, assignees, labels, and
// project memberships. The hierarchy is derived from these in-process — no
// per-node fetch — and cached per filter signature so a root load and the drills
// that follow read one consistent structure. Writes clear the cache.

const FOREST_QUERY = `
query($owner:String!,$name:String!,$issues:Int!,$milestones:Int!,$projects:Int!){
  repository(owner:$owner,name:$name){
    projectsV2(first:$projects){ nodes{ number title shortDescription closed } }
    milestones(first:$milestones, states:[OPEN,CLOSED]){ nodes{ number title description state } }
    issues(first:$issues, states:[OPEN,CLOSED], orderBy:{field:CREATED_AT,direction:ASC}){
      totalCount
      nodes{
        number title state stateReason
        milestone{ number }
        assignees(first:10){ nodes{ login } }
        labels(first:20){ nodes{ name } }
        projectItems(first:10){ nodes{ project{ ... on ProjectV2 { number } } } }
        comments{ totalCount }
      }
    }
  }
}`;

async function buildForest() {
  const data = await graphql(FOREST_QUERY, {
    owner: OWNER, name: NAME, issues: MAX_ISSUES, milestones: MAX_MILESTONES, projects: MAX_PROJECTS,
  });
  const repo = data.data.repository;

  const projects = new Map();
  for (const p of repo.projectsV2.nodes) projects.set(p.number, p);

  const milestones = new Map();
  for (const m of repo.milestones.nodes) milestones.set(m.number, m);

  const total = repo.issues.totalCount;
  if (total > MAX_ISSUES) {
    console.warn(`[ledger:github] ${REPO} has ${total} issues; showing the first ${MAX_ISSUES}. Raise MAX_ISSUES to see the rest.`);
  }

  const issues = repo.issues.nodes.map((n) => ({
    number: n.number,
    title: n.title,
    status: issueStatus(n.state),
    milestone: n.milestone?.number ?? null,
    assignees: n.assignees.nodes.map((a) => a.login),
    labels: n.labels.nodes.map((l) => l.name),
    projects: n.projectItems.nodes.map((i) => i.project?.number).filter((x) => projects.has(x)),
    commentCount: n.comments.totalCount,
  }));

  // The project a milestone belongs to: the first project seen on any of its
  // issues. Computed over all issues (not the filtered match set) so a
  // milestone's epic is stable across filters.
  const milestoneEpic = new Map();
  for (const it of issues) {
    if (it.milestone != null && it.projects.length && !milestoneEpic.has(it.milestone)) {
      milestoneEpic.set(it.milestone, it.projects[0]);
    }
  }
  // The epic a task hangs under: its milestone's epic, else its own first project.
  const issueEpic = (it) => (it.milestone != null ? milestoneEpic.get(it.milestone) ?? null : (it.projects[0] ?? null));

  return { projects, milestones, issues, milestoneEpic, issueEpic };
}

// The visible set for a filter. Only issues can match (projects/milestones are
// containers with no assignee/status of their own); every matching issue pulls
// its milestone and project in as context ancestors, so a match always has a
// place in the tree and a container with no matching descendant never shows.
function computeVisible(forest, { status, assignee }) {
  const anyone = !assignee || assignee === 'anyone';
  const assigneeOk = (it) => anyone || it.assignees.includes(assignee);
  const matches = forest.issues.filter((it) => passesStatus(it.status, status) && assigneeOk(it));

  const matchNums = new Set(matches.map((it) => it.number));
  const visMilestones = new Set();
  const visProjects = new Set();
  for (const it of matches) {
    if (it.milestone != null && forest.milestones.has(it.milestone)) visMilestones.add(it.milestone);
    const epic = forest.issueEpic(it);
    if (epic != null) visProjects.add(epic);
    // A milestone's own epic, even when this match hangs on the milestone.
    if (it.milestone != null) { const me = forest.milestoneEpic.get(it.milestone); if (me != null) visProjects.add(me); }
  }
  return { matches, matchNums, visMilestones, visProjects, anyone };
}

// ---- node/item shaping --------------------------------------------------

const ISSUE_URL = (n) => `https://github.com/${OWNER}/${NAME}/issues/${n}`;
const MILESTONE_URL = (n) => `https://github.com/${OWNER}/${NAME}/milestone/${n}`;
const PROJECT_URL = (n) => `https://github.com/users/${OWNER}/projects/${n}`;

function projectNode(p, childCount, context) {
  return {
    id: `P:${p.number}`, shortId: `P${p.number}`, kind: 'epic', type: 'EPIC',
    title: p.title || '(untitled project)', status: openClosed(p.closed),
    assignee: null, project: null, context, childCount, url: PROJECT_URL(p.number),
  };
}
function milestoneNode(m, childCount, context) {
  return {
    id: `M:${m.number}`, shortId: `M${m.number}`, kind: 'story', type: 'STORY',
    title: m.title || '(untitled milestone)', status: openClosed(m.state),
    assignee: null, project: null, context, childCount, url: MILESTONE_URL(m.number),
  };
}
function issueNode(it, context) {
  return {
    id: `I:${it.number}`, shortId: `${it.number}`, kind: 'task', type: issueType(it.labels),
    title: it.title, status: it.status,
    assignee: it.assignees[0] || null, project: null, context, childCount: 0,
    url: ISSUE_URL(it.number),
  };
}

// ---- id parsing ---------------------------------------------------------

function parseId(id) {
  const m = /^([PMI]):(\d+)$/.exec(String(id));
  if (!m) throw Object.assign(new Error(`Unrecognized id '${id}'`), { status: 400 });
  return { tier: m[1], number: Number(m[2]) };
}

// ---- plugin factory -----------------------------------------------------

module.exports = function createGithubPlugin() {
  const meLogin = whoAmISync();     // the viewer's login, resolved once at startup
  let forest = null;                // cached forest
  let forestSig = null;             // filter signature the cache was built for

  async function ensureForest(sig) {
    if (!forest || forestSig !== sig) { forest = await buildForest(); forestSig = sig; }
    return forest;
  }
  const invalidate = () => { forest = null; forestSig = null; };

  return {
    name: 'github',
    apiVersion: 1,
    me: meLogin,

    // Projects are the epic tier, so the board's own project picker is off: the
    // hierarchy already surfaces them as the top column. No workflow steps and no
    // point estimates on GitHub, so those stay off too.
    capabilities: {
      hierarchy: true,
      readItem: true,
      editFields: ['status', 'assignee', 'description'],
      comment: true,
      editOwnComments: true,
      searchAssignees: true,
      stepOptions: false,
      projects: false,
      attachments: false,
      points: false,   // GitHub issues have no point estimates
      taskDates: false, // no start/completion date model on GitHub issues
    },

    // parentId null => roots (projects with a visible task, orphan milestones,
    // orphan tasks); a project => its milestones + its direct (milestone-less)
    // tasks; a milestone => its tasks. Only issues match the assignee/status
    // filter; containers ride in as context ancestors of a match.
    async getChildren(parentId, filters = {}) {
      const status = filters.status || 'Open';
      const assignee = filters.assignee;
      const sig = JSON.stringify({ status, assignee: assignee || null });
      const f = await ensureForest(!parentId ? null : sig); // rebuild on root load
      forestSig = sig;
      const { matches, matchNums, visMilestones, visProjects, anyone } = computeVisible(f, { status, assignee });
      const ctx = (isMatch) => !anyone && !isMatch;

      if (!parentId) {
        const epics = [...visProjects]
          .map((n) => f.projects.get(n)).filter(Boolean)
          .map((p) => projectNode(p, projectChildCount(f, matches, p.number), ctx(false)));
        const orphanStories = [...visMilestones]
          .filter((n) => f.milestoneEpic.get(n) == null)
          .map((n) => f.milestones.get(n)).filter(Boolean)
          .map((m) => milestoneNode(m, matches.filter((it) => it.milestone === m.number).length, ctx(false)));
        const orphanTasks = matches
          .filter((it) => it.milestone == null && f.issueEpic(it) == null)
          .map((it) => issueNode(it, ctx(true)));
        return [...epics, ...orphanStories, ...orphanTasks];
      }

      const { tier, number } = parseId(parentId);
      if (tier === 'P') {
        const stories = [...visMilestones]
          .filter((n) => f.milestoneEpic.get(n) === number)
          .map((n) => f.milestones.get(n)).filter(Boolean)
          .map((m) => milestoneNode(m, matches.filter((it) => it.milestone === m.number).length, ctx(false)));
        const directTasks = matches
          .filter((it) => it.milestone == null && f.issueEpic(it) === number)
          .map((it) => issueNode(it, ctx(true)));
        return [...stories, ...directTasks];
      }
      if (tier === 'M') {
        return matches.filter((it) => it.milestone === number).map((it) => issueNode(it, ctx(true)));
      }
      return []; // an issue (task) has no children in this mapping
    },

    async readItem(id) {
      const { tier, number } = parseId(id);
      if (tier === 'I') return readIssue(number);
      if (tier === 'M') return readMilestone(number);
      return readProject(number);
    },

    // Edits target issues (status, assignee, description) and a milestone's
    // open/closed status. The forest is invalidated so the next load reflects the
    // change. Returns the re-read item.
    async editField(id, field, value) {
      const { tier, number } = parseId(id);
      if (tier === 'I') {
        if (field === 'status') {
          // Binary status in: 'Open' reopens, 'Closed' closes. GitHub wants a
          // close reason; 'completed' is the natural "done" that maps back to
          // 'Closed' on the next read (the not_planned distinction isn't modeled).
          if (value === 'Open') await rest('PATCH', `issues/${number}`, { state: 'open' });
          else await rest('PATCH', `issues/${number}`, { state: 'closed', state_reason: 'completed' });
        } else if (field === 'assignee') {
          await rest('PATCH', `issues/${number}`, { assignees: value ? [String(value)] : [] });
        } else if (field === 'description') {
          await rest('PATCH', `issues/${number}`, { body: String(value ?? '') });
        } else {
          throw Object.assign(new Error(`Field '${field}' is not editable on an issue`), { status: 400 });
        }
        invalidate();
        return readIssue(number);
      }
      if (tier === 'M' && field === 'status') {
        await rest('PATCH', `milestones/${number}`, { state: value === 'Open' ? 'open' : 'closed' });
        invalidate();
        return readMilestone(number);
      }
      throw Object.assign(new Error(`Field '${field}' is not editable on this item`), { status: 400 });
    },

    async addComment(id, message) {
      const { tier, number } = parseId(id);
      if (tier !== 'I') throw Object.assign(new Error('Comments are supported on issues (tasks) only'), { status: 400 });
      if (!message || !message.trim()) throw Object.assign(new Error('Empty comment'), { status: 400 });
      await rest('POST', `issues/${number}/comments`, { body: message });
      invalidate();
      return readIssue(number);
    },

    async editComment(id, commentId, message) {
      const { tier, number } = parseId(id);
      if (tier !== 'I') throw Object.assign(new Error('Comments are supported on issues (tasks) only'), { status: 400 });
      await rest('PATCH', `issues/comments/${commentId}`, { body: message });
      return readIssue(number);
    },

    async deleteComment(id, commentId) {
      const { tier, number } = parseId(id);
      if (tier !== 'I') throw Object.assign(new Error('Comments are supported on issues (tasks) only'), { status: 400 });
      await rest('DELETE', `issues/comments/${commentId}`);
      return readIssue(number);
    },

    // Repo-assignable users, filtered by the typeahead query. GitHub returns the
    // set a user can be assigned to; the board shows alias (login) only.
    async searchAssignees(query) {
      const q = String(query || '').toLowerCase();
      const users = await gh(['api', `repos/${OWNER}/${NAME}/assignees?per_page=100`]);
      return (users || [])
        .filter((u) => !q || u.login.toLowerCase().includes(q))
        .slice(0, 20)
        .map((u) => ({ alias: u.login, fullName: u.login }));
    },
  };
};

// The direct children of a project: its milestones (stories) plus its
// milestone-less matching issues (tasks on the epic).
function projectChildCount(f, matches, projectNumber) {
  const stories = [...f.milestones.keys()].filter((n) => f.milestoneEpic.get(n) === projectNumber &&
    matches.some((it) => it.milestone === n)).length;
  const direct = matches.filter((it) => it.milestone == null && f.issueEpic(it) === projectNumber).length;
  return stories + direct;
}

// ---- targeted reads (drawer) --------------------------------------------

const ISSUE_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    issue(number:$number){
      number title state stateReason body createdAt updatedAt
      milestone{ number } projectItems(first:10){ nodes{ project{ ... on ProjectV2 { number } } } }
      assignees(first:10){ nodes{ login } }
      labels(first:20){ nodes{ name } }
      comments(first:100){ nodes{ databaseId body createdAt updatedAt author{ login } viewerDidAuthor } }
    }
  }
}`;

async function readIssue(number) {
  const data = await graphql(ISSUE_QUERY, { owner: OWNER, name: NAME, number });
  const n = data.data.repository.issue;
  if (!n) throw Object.assign(new Error('Issue not found'), { status: 404 });
  const labels = n.labels.nodes.map((l) => l.name);
  return {
    id: `I:${n.number}`, shortId: `${n.number}`, kind: 'task', type: issueType(labels),
    title: n.title, status: issueStatus(n.state),
    assignee: n.assignees.nodes[0]?.login || null, project: null, context: false, childCount: 0,
    url: ISSUE_URL(n.number),
    description: n.body || '', descriptionContentType: 'text/markdown', estimate: null,
    // viewerDidAuthor is GitHub's own "did the signed-in user write this" flag —
    // more reliable than comparing logins, so it drives isMine (which gates the
    // edit/delete affordances).
    comments: n.comments.nodes.map((c) => ({
      id: String(c.databaseId),
      message: c.body || '',
      contentType: 'text/markdown',
      author: c.author?.login || null,
      isMine: !!c.viewerDidAuthor,
      createDate: c.createdAt || null,
      lastUpdatedDate: c.updatedAt || null,
    })),
    createDate: n.createdAt || null, lastUpdatedDate: n.updatedAt || null,
  };
}

async function readMilestone(number) {
  const m = await rest('GET', `milestones/${number}`);
  return {
    id: `M:${m.number}`, shortId: `M${m.number}`, kind: 'story', type: 'STORY',
    title: m.title || '(untitled milestone)', status: openClosed(m.state),
    assignee: null, project: null, context: false,
    childCount: (m.open_issues || 0) + (m.closed_issues || 0),
    url: MILESTONE_URL(m.number),
    description: m.description || '', descriptionContentType: 'text/markdown', estimate: null,
    comments: [], createDate: m.created_at || null, lastUpdatedDate: m.updated_at || null,
  };
}

const PROJECT_QUERY = `
query($owner:String!,$number:Int!){
  user(login:$owner){ projectV2(number:$number){ number title shortDescription readme closed items{ totalCount } } }
}`;

async function readProject(number) {
  const data = await graphql(PROJECT_QUERY, { owner: OWNER, number });
  const p = data.data.user?.projectV2;
  if (!p) throw Object.assign(new Error('Project not found'), { status: 404 });
  return {
    id: `P:${p.number}`, shortId: `P${p.number}`, kind: 'epic', type: 'EPIC',
    title: p.title || '(untitled project)', status: openClosed(p.closed),
    assignee: null, project: null, context: false, childCount: p.items?.totalCount || 0,
    url: PROJECT_URL(p.number),
    description: p.readme || p.shortDescription || '', descriptionContentType: 'text/markdown', estimate: null,
    comments: [], createDate: null, lastUpdatedDate: null,
  };
}
