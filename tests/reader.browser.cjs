const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = require('../plugins/local-file')();
const description = fs.readFileSync(path.join(__dirname, 'fixtures/reader.md'), 'utf8');
const baseURL = process.env.LEDGER_URL || 'http://127.0.0.1:4317';
const shots = process.env.SCREENSHOT_DIR;
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  if (shots) fs.mkdirSync(shots, { recursive: true });
});
after(async () => { await browser?.close(); });

async function setup(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [], writes = [], items = new Map();
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  if (options.stored !== undefined) await page.addInitScript(value => localStorage.setItem('ledger:panel-view', value), options.stored);
  if (options.noStorage) await page.addInitScript(() => {
    Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Storage disabled'); };
  });
  // All source traffic is an in-memory fixture; no live writes or external requests.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/') || url.pathname === '/api/themes') return route.continue();
    let data;
    if (url.pathname === '/api/source') data = { name: 'fixture', me: 'reader', capabilities: options.readOnly ? { readItem: true, hierarchy: true } : source.capabilities, theme: 'earendil' };
    else if (url.pathname === '/api/projects') data = { projects: source.listProjects() };
    else if (url.pathname === '/api/children') data = { nodes: source.getChildren(url.searchParams.get('parent'), Object.fromEntries(url.searchParams)) };
    else if (/^\/api\/item\/[^/]+(?:\/edit)?$/.test(url.pathname)) {
      const id = url.pathname.split('/')[3];
      if (!items.has(id)) items.set(id, { ...source.readItem(id), title: 'A calmer path from plan to shipment', description: options.empty ? '' : description, createDate: '2026-10-07T12:00:00Z' });
      const item = items.get(id);
      if (route.request().method() === 'POST') {
        const change = route.request().postDataJSON();
        writes.push(change); item[change.field] = change.value;
      }
      data = { item };
    } else data = {};
    return route.fulfill({ json: data });
  });
  await page.goto(baseURL);
  await page.locator('ledger-card').first().waitFor();
  return { page, writes, context };
}
async function openItem(page) {
  const card = page.locator('ledger-card').first();
  await card.hover();
  await card.locator('.card-act').filter({ hasText: 'view details' }).click();
  await page.locator('ledger-drawer[open] #d-title').filter({ hasText: 'A calmer path' }).waitFor();
}
async function closeItem(page) {
  await page.locator('ledger-drawer #d-close').click();
  await page.locator('ledger-drawer[open]').waitFor({ state: 'detached' });
}
async function fullscreen(page) {
  if (await page.locator('ledger-drawer').getAttribute('data-view') !== 'fullscreen') await page.locator('ledger-drawer #d-view').click();
  await page.evaluate(() => document.fonts.load('21px "Source Serif 4"'));
}
async function setDefault(page, full) {
  await page.locator('#settings-btn').click();
  const checkbox = page.locator('ledger-settings #panel-view-switch input');
  await checkbox.setChecked(full);
  await page.locator('ledger-settings #s-close').click();
}
async function shot(page, name) { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); }

// Expanding and shrinking affect the current item while the saved sidebar default remains intact.
test('sidebar default, temporary expansion, and close controls', async t => {
  const { page } = await setup(t);
  await openItem(page);
  assert.equal(await page.locator('ledger-drawer').getAttribute('data-view'), 'sidebar');
  await fullscreen(page);
  assert.equal(await page.locator('ledger-drawer .panel').evaluate(el => Math.round(el.getBoundingClientRect().width)), 1440);
  assert.equal(await page.locator('#d-metadata').evaluate(el => el.open), false);
  await page.locator('#d-view').click();
  assert.equal(await page.locator('#d-metadata').evaluate(el => el.open), true);
  await closeItem(page);
  await openItem(page);
  assert.equal(await page.locator('ledger-drawer').getAttribute('data-view'), 'sidebar');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('ledger-drawer').getAttribute('open'), null);
});

// The global toggle survives reloads and theme changes; temporary sidebar use does not rewrite it.
test('full-screen default persists independently of theme and temporary width', async t => {
  const { page } = await setup(t);
  await setDefault(page, true);
  await page.reload();
  await page.locator('ledger-card').first().waitFor();
  await openItem(page);
  assert.equal(await page.locator('ledger-drawer').getAttribute('data-view'), 'fullscreen');
  await page.locator('#d-view').click();
  await closeItem(page);
  await page.selectOption('#theme-select', 'professional');
  await openItem(page);
  assert.equal(await page.locator('ledger-drawer').getAttribute('data-view'), 'fullscreen');
  await closeItem(page);
  await setDefault(page, false);
  await page.reload();
  await openItem(page);
  assert.equal(await page.locator('ledger-drawer').getAttribute('data-view'), 'sidebar');
});

// A width change retains unsaved Markdown and selection and issues no write until Save.
test('description drafts survive width changes and save normally', async t => {
  const { page, writes } = await setup(t);
  await openItem(page);
  await fullscreen(page);
  await page.locator('#d-edit').click();
  const draft = '# Revised shipment\n\nAn unfinished description that must survive resizing.';
  await page.locator('#d-desc').fill(draft);
  await page.locator('#d-desc').evaluate(el => el.setSelectionRange(3, 10));
  await page.locator('#d-view').click();
  assert.equal(await page.locator('#d-desc').inputValue(), draft);
  assert.deepEqual(await page.locator('#d-desc').evaluate(el => [el.selectionStart, el.selectionEnd]), [3, 10]);
  await page.locator('#d-view').click();
  assert.equal(await page.locator('#d-desc').inputValue(), draft);
  assert.equal(writes.length, 0);
  await page.locator('#d-save').click();
  await page.locator('#d-desc-render h1').filter({ hasText: 'Revised shipment' }).waitFor();
  assert.deepEqual(writes, [{ field: 'description', value: draft }]);
});

// Metadata remains editable below the article, and changes update the compact byline.
test('details disclose planning and retain metadata editing', async t => {
  const { page, writes } = await setup(t);
  await openItem(page); await fullscreen(page);
  await page.locator('#d-show-details').click();
  assert.equal(await page.locator('#d-metadata').evaluate(el => el.open), true);
  await page.locator('#d-status-edit').selectOption('Closed');
  await page.locator('#d-byline').filter({ hasText: 'Closed' }).waitFor({ state: 'attached' });
  assert.deepEqual(writes, [{ field: 'status', value: 'Closed' }]);
  assert.ok(await page.locator('#d-contains').isVisible());
});

// The article stays bounded, tables/code scroll locally, and close controls stay visible at every width.
test('reader layout reflows from desktop to 320px', async t => {
  const { page } = await setup(t);
  await openItem(page); await fullscreen(page);
  for (const width of [1440, 1024, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('ledger-drawer .panel').evaluate(el => el.scrollTop = 0);
    const dims = await page.locator('ledger-drawer').evaluate(host => {
      const panel = host.shadowRoot.querySelector('.panel'), article = host.shadowRoot.querySelector('#d-article');
      const text = host.shadowRoot.querySelector('#d-desc-render'), style = getComputedStyle(text);
      return { panel: panel.clientWidth, scroll: panel.scrollWidth, article: article.getBoundingClientRect().width, font: parseFloat(style.fontSize), leading: parseFloat(style.lineHeight) };
    });
    assert.ok(dims.article <= 701 && dims.article <= width, JSON.stringify(dims));
    assert.ok(dims.scroll <= dims.panel + 1, JSON.stringify(dims));
    assert.ok(dims.leading / dims.font >= 1.5);
    if (width === 1440 || width === 390) await shot(page, `reader-${width}`);
    await page.locator('ledger-drawer .panel').evaluate(el => el.scrollTop = el.scrollHeight);
    const controls = await page.locator('#d-close').boundingBox();
    assert.ok(controls.y >= 0 && controls.y + controls.height < 1000);
    assert.ok(controls.x >= 0 && controls.x + controls.width <= width);
  }
});

// User text-spacing overrides and doubled type do not clip prose or the dialog controls.
test('reader tolerates expanded text spacing and enlarged type', async t => {
  const { page } = await setup(t);
  await openItem(page); await fullscreen(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('ledger-drawer').evaluate(host => {
    const style = document.createElement('style');
    style.textContent = '#d-desc-render, #d-desc-render * { line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important; } #d-desc-render p {margin-bottom:2em!important;} #d-desc-render {font-size:38px!important;}';
    host.shadowRoot.append(style);
  });
  assert.ok(await page.locator('ledger-drawer .panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.locator('#d-close').click();
  assert.equal(await page.locator('ledger-drawer').getAttribute('open'), null);
});

// Keyboard traversal reaches the comment composer and wraps to the persistent controls.
test('keyboard focus includes nested comments and disclosure controls', async t => {
  const { page } = await setup(t);
  await openItem(page); await fullscreen(page);
  const buttons = page.locator('#c-thread button:not([disabled])');
  await buttons.last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#d-edit').evaluate(el => el === el.getRootNode().activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await buttons.last().evaluate(el => el === el.getRootNode().activeElement), true);
  await page.locator('#d-metadata summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#d-metadata').evaluate(el => el.open), true);
});

// Invalid persisted values use sidebar; unavailable storage still supports a session default.
test('preference fallback handles invalid and unavailable storage', async t => {
  const { page } = await setup(t, { stored: 'invalid' });
  await openItem(page);
  assert.equal(await page.locator('ledger-drawer').getAttribute('data-view'), 'sidebar');
  const other = await setup(t, { noStorage: true });
  await setDefault(other.page, true);
  await openItem(other.page);
  assert.equal(await other.page.locator('ledger-drawer').getAttribute('data-view'), 'fullscreen');
});

// Read-only and empty items retain identity and an honest empty state without edit controls.
test('empty read-only descriptions remain usable', async t => {
  const { page } = await setup(t, { empty: true, readOnly: true });
  await openItem(page); await fullscreen(page);
  assert.equal(await page.locator('#d-desc-render').innerText(), 'No description.');
  assert.equal(await page.locator('#d-edit').isVisible(), false);
  assert.match(await page.locator('#d-byline').innerText(), /Open/);
  await closeItem(page);
});

// Each theme supplies readable article ink on its actual full-screen surface.
test('reading contrast and layout work across all installed themes', async t => {
  const { page } = await setup(t);
  for (const theme of ['earendil', 'professional', 'space-opera', 'the-ledger']) {
    await page.selectOption('#theme-select', theme);
    await page.locator(`html[data-theme="${theme}"]`).waitFor();
    await openItem(page); await fullscreen(page);
    const contrast = await page.locator('ledger-drawer').evaluate(host => {
      const text = getComputedStyle(host.shadowRoot.querySelector('#d-desc-render')).color;
      const style = getComputedStyle(host.shadowRoot.querySelector('.panel'));
      const grounds = [style.backgroundColor, ...(style.backgroundImage.match(/rgba?\([^)]*\)/g) || [])].filter(color => !color.startsWith('rgba(') || Number(color.match(/[\d.]+/g)[3]) === 1);
      const luminance = color => {
        const c = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
        return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
      };
      const a = luminance(text);
      return grounds.length ? Math.min(...grounds.map(bg => { const b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); })) : 0;
    });
    assert.ok(contrast >= 4.5, `${theme}: ${contrast}`);
    await shot(page, `reader-${theme}`);
    await closeItem(page);
  }
});

// The display toggles remain keyboard reachable and focus stays inside Settings.
test('settings keyboard focus includes nested display switches', async t => {
  const { page } = await setup(t);
  await page.locator('#settings-btn').click();
  const lastToggle = page.locator('ledger-settings ledger-switch input').last();
  await lastToggle.focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('ledger-settings #s-close').evaluate(el => el === el.getRootNode().activeElement), true);
  await page.locator('ledger-settings #panel-view-switch input').focus();
  await page.keyboard.press('Space');
  await page.locator('ledger-settings #s-close').click();
  await openItem(page);
  assert.equal(await page.locator('ledger-drawer').getAttribute('data-view'), 'fullscreen');
});

// The visible reading landmark stays in place when the user changes the panel width.
test('resizing retains the current reading position', async t => {
  const { page } = await setup(t);
  await openItem(page); await fullscreen(page);
  const heading = page.locator('#d-desc-render h2').first();
  await heading.evaluate(el => el.scrollIntoView({ block: 'start' }));
  const before = (await heading.boundingBox()).y;
  { const rect = await page.locator('#d-view').boundingBox(); await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2); }
  assert.ok(Math.abs((await heading.boundingBox()).y - before) < 5, `Reading landmark: ${before} -> ${(await heading.boundingBox()).y}`);
  { const rect = await page.locator('#d-view').boundingBox(); await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2); }
  assert.ok(Math.abs((await heading.boundingBox()).y - before) < 5, `Reading landmark: ${before} -> ${(await heading.boundingBox()).y}`);
});

// Description typography uses a locally served font and a readable actual line length.
test('self-hosted reading font loads and keeps the text measure readable', async t => {
  const { page } = await setup(t);
  await openItem(page); await fullscreen(page);
  assert.equal(await page.evaluate(() => document.fonts.check('21px "Source Serif 4"')), true);
  const characters = await page.locator('#d-desc-render p').first().evaluate(p => {
    const text = p.firstChild, range = document.createRange(), lines = new Map();
    for (let i = 0; i < text.length; i++) {
      range.setStart(text, i); range.setEnd(text, i + 1);
      const y = Math.round(range.getBoundingClientRect().top);
      lines.set(y, (lines.get(y) || 0) + 1);
    }
    return [...lines.values()].slice(0, -1);
  });
  const average = characters.reduce((a, b) => a + b, 0) / characters.length;
  assert.ok(average >= 45 && average <= 90, `Average characters per full line: ${average}`);
});

// Full-screen editing shares the top bar; width controls remain icon-only with accessible names.
test('top bar groups edit, resize, and close with labelled width icons', async t => {
  const { page } = await setup(t);
  await openItem(page); await fullscreen(page);
  assert.equal(await page.locator('#d-edit').evaluate(el => !!el.closest('.head')), true);
  assert.equal(await page.locator('#d-view').innerText(), '');
  assert.equal(await page.locator('#d-view svg').count(), 1);
  assert.equal(await page.locator('#d-view').getAttribute('aria-label'), 'Shrink to sidebar');
  await page.locator('ledger-drawer .panel').evaluate(el => el.scrollTop = el.scrollHeight);
  const edit = await page.locator('#d-edit').boundingBox();
  assert.ok(edit.y >= 0 && edit.y < 100);
  await page.locator('#d-view').click();
  assert.equal(await page.locator('#d-edit').evaluate(el => !!el.closest('.d-desc-head')), true);
  assert.equal(await page.locator('#d-view').getAttribute('aria-label'), 'Expand to full screen');
});
