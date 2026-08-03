# Authoring a Ledger theme

A theme is an npm package that re-skins The Ledger. It ships a `theme.css` (fills
the token contract, paints its own decoration) and, optionally, a logo web
component, an ambient backdrop, custom sounds, and web fonts. There is no build
step and no code change in The Ledger — the server discovers every installed
theme package and the client swaps the stylesheet, fonts, logo, ambient, and
sounds live.

Themes live outside this repo, as independent packages. The two bundled themes —
**the-ledger** (the leather-and-parchment reference) and **space-opera** (a dark
data-plate inversion) — are published from the
[`ledger-themes`](https://github.com/cpyle0819/ledger-themes) monorepo; read them
as worked examples. This guide takes you from an empty folder to an installed,
switchable theme. Read [`CLAUDE.md`](CLAUDE.md) for the theming architecture and
[`public/base.css`](public/base.css) for the neutral token baseline you are
overriding; read the reference theme's
[`theme.css`](https://github.com/cpyle0819/ledger-themes/blob/main/packages/the-ledger/theme.css)
as the annotated token contract and worked example at once.

## A theme is code — install only ones you trust

A theme is not a stylesheet; it is an npm package that runs with your app's full
privileges. Its logo and ambient are ES modules The Ledger `import()`s into the
page, so a theme's JavaScript executes in your origin: it can read and write every
board item through `/api/*`, exactly as you can. Its `subtitle` is injected as
HTML, and its `fonts` URL is fetched as you load the page. There is no sandbox.

This is by design — themes ship web components — and it is no more access than any
npm dependency already has (a package's install scripts run on your machine before
its code ever reaches the browser). But it means a theme carries the same trust as
a plugin or any other dependency: **vet a third-party theme's source before
installing it, and pin the version.** Treat "install this theme" as "run this
person's code," because that is what it is.

## How theming works

The Ledger loads two stylesheets in order: `public/base.css`, then your
`theme.css`. `base.css` is the theme-agnostic skeleton — layout, accessibility,
motion — and a **complete neutral baseline** for every design token (flat grey,
system font, no texture). Your `theme.css` overrides the tokens and paints the
handful of backdrop rules `base.css` leaves bare.

Two kinds of token carry the skin:

- **Named tokens** (`--leather`, `--parch`, `--ink`, `--brass`, `--seal-*`, …) —
  the palette. The names are historical, but `base.css` and the components treat
  them **semantically**: `--leather` is app chrome, `--parch` is the card
  surface, `--ink` is text on a card, `--brass` is the primary metal, `--seal-*`
  are tier accents. Keep the names, re-point the values.
- **Recipe tokens** (`--card-surface`, `--sheet-surface`, `--deckle-filter`,
  `--card-frame`, …) — decoration a single colour can't express: layered
  backgrounds, textures, and SVG edge filters. Components read these with
  fallbacks, so you restyle a surface by setting the recipe, never by editing a
  component.

The tokens are CSS custom properties on `:root`, so they inherit through shadow
roots for free — every component reads `var(--token)` with no per-component
theming machinery.

**The extraction test governs everything:** a theme with an empty `theme.css`
must resolve to the neutral baseline, not to any real theme. Your theme's
distinctive look lives ONLY in your package. If removing your theme reveals
another theme's parchment or gilt, something leaked into `base.css` or a
component — fix it there, not in your theme.

## Package layout

```
your-theme/
  package.json        # name, files, and the ledgerTheme manifest block
  theme.css           # token overrides + your decoration — the one required file
  mark.js             # optional: your <…-mark> logo web component
  sounds/             # optional: page-turn / quill foley
  <assets>            # optional: background images, textures, SVGs
```

Assets referenced relatively from `theme.css` (`url("./texture.jpg")`) resolve
against the served stylesheet, so keep them beside it and list them in the
package's `files` array.

## Step 1 — scaffold the package

Copy an existing theme as your starting point. In the
[`ledger-themes`](https://github.com/cpyle0819/ledger-themes) repo, `space-opera`
is the better template than the reference theme: it inverts the card surface from
light parchment to a dark data-plate, so it exercises the full contract —
text-token flips, recipe overrides, a distinct logo — without the reference
theme's baked-in texture assets.

```
git clone https://github.com/cpyle0819/ledger-themes.git
cp -r ledger-themes/packages/space-opera your-theme
```

Then edit `package.json`: set `name` (the bundled themes use
`@cpyle0819/ledger-theme-<id>`, but any name works — The Ledger discovers any
package with a `ledgerTheme` block, so a third-party theme uses its own scope or
an unscoped `ledger-theme-<id>`), write a one-line `description` of the look, and
fill the `ledgerTheme` block.

### The `ledgerTheme` manifest

```jsonc
"ledgerTheme": {
  "id": "<id>",                    // stable id; assets serve under /theme/<id>/…
  "name": "Your Theme",            // shown in the masthead switcher
  "tagline": "a one-line hook",    // sits under the name in the switcher
  "subtitle": "an archive of <em>epics</em>, <em>stories</em> &amp; <em>tasks</em>",
  "stylesheet": "./theme.css",     // required
  "fonts": "https://fonts.googleapis.com/css2?family=…&display=swap",  // optional
  "logo":    { "tag": "your-mark", "src": "./mark.js" },               // optional
  "ambient": { "tag": "star-field", "src": "@cpyle0819/ambience/starfield",
               "attrs": { "density": "44", "flip": true } },           // optional
  "sounds": {                                                          // optional
    "pageTurn": { "src": "./sounds/hatch.wav", "volume": 0.4 },
    "quill":    { "src": "./sounds/relay.wav", "volume": 0.4, "maxMs": 900 }
  },
  "settings": [                                                        // optional
    { "target": "ambient", "attr": "flip", "type": "boolean", "label": "Flip-and-burn", "default": true },
    { "target": "ambient", "attr": "speed", "type": "range", "label": "Cruise speed",
      "min": 500, "max": 3000, "step": 100, "default": 1500 }
  ]
}
```

- **`id`** is the addressing key: own files serve at `/theme/<id>/<file>`, a theme
  dependency at `/theme/<id>/@dep/<specifier>`. It must be unique across installed
  themes.
- **`stylesheet`** is the only required field. Omit `fonts`, `logo`, `ambient`, or
  `sounds` and The Ledger falls back — no fonts loaded, the reference
  `<ledger-mark>` logo, no backdrop drift, no foley.
- **`logo`** and **`ambient`** name a custom element `{tag, src, attrs}`. The
  controller mounts the tag and copies `attrs` onto it verbatim — it understands
  no specific tag or attribute, so ship any self-registering element.
- **`sounds`** — `pageTurn` plays on drawer open, `quill` on a save. `volume`
  (0–1), optional `startAt` (seconds into the clip) and `maxMs` (cap the
  playback length).
- **`settings`** — the knobs the masthead gear exposes (below). Omit it and the
  theme has no gear.

Keep `package.json` honest with reality: the `files` array must list every asset
you ship (`theme.css`, `mark.js`, `sounds/`, any images), and a `smoke-drift`- or
`starfield`-style ambient adds `@cpyle0819/ambience` to `peerDependencies`.

### User-tunable knobs (`settings`)

The masthead gear lets a user tune your theme's atmosphere; you decide what it
exposes. Each entry in `settings` names one attribute on your `ambient` (or
`logo`) component and how to edit it:

| Field | Meaning |
|---|---|
| `target` | which component the attr lives on — `ambient` (default) or `logo` |
| `attr` | the attribute name set on that component |
| `type` | `boolean` (renders a switch) or `range` (renders a slider) |
| `label` | the control's visible label |
| `default` | your shipped value — the reset target, and what "off the default" is measured against |
| `min` / `max` / `step` | range only |

The chosen value is written straight onto the mounted component's attribute
(live, no reload) and saved per-theme in the browser's localStorage. So a knob is
only meaningful for an attribute the component actually observes — declare knobs
for the same attrs you set in `ambient.attrs`, and confirm the underlying element
reacts to them (e.g. `star-field` observes `flip`, `planets`, `speed`;
`smoke-drift` observes `fire`, `wind`). The `default` should match the value you
ship in `attrs`, so "Reset to theme defaults" returns the theme to how it looks
out of the box. The controller understands no specific attr — it renders whatever
you declare — so nothing but this schema decides which knobs a user sees.

## Step 2 — fill the token contract

Open `theme.css` and re-point the tokens. Work in the semantic families; the
reference theme documents each one inline. The contract in full:

| Family | Tokens | Meaning |
|---|---|---|
| Fonts | `--fell`, `--fell-sc`, `--gara`, `--mono` | display, small-caps, body, mono |
| App chrome | `--leather`, `--leather-2`, `--wood` | the surrounding room / frame |
| Primary metal | `--brass`, `--brass-lo`, `--brass-hi` | rules, hardware, the lit accent |
| Card surface | `--parch`, `--parch-lo`, `--parch-hi`, `--parch-edge` | the item slip |
| Text on card | `--ink`, `--ink-soft`, `--ink-faint`, `--ink-red` | reading text + correction red |
| Tier accents | `--seal-epic`, `--seal-story`, `--seal-task`, `--seal-bug`, `--wax` | the four tiers + wax |
| Planning risk | `--risk-over`, `--risk-under` | over / under estimated effort |
| Semantic helpers | `--focus-ring`, `--chip-fg`, `--hover-wash`, `--closed-ink`, … | focus, chips, states |
| Chrome seams | `--well`, `--hairline`, `--chrome-sheen`, `--masthead-*`, `--controls-bg` | wells, hairlines, sheen |
| Panel + sheet | `--panel-surface`, `--sheet-surface`, `--sheet-surface-tl`, `--sheet-edge` | outline epics, drawer, compose |
| Card recipe | `--card-surface`, `--card-surface-selected`, `--card-shadow*`, `--card-radius`, `--deckle-filter*`, `--card-frame*`, `--stamp-*` | the full card decoration |
| Field surfaces | `--field-bg`, `--field-bg-focus`, `--field-edge`, `--inset-bg`, `--onlight-chip-bg` | inputs inside shadow leaves |

You need only override the tokens whose value differs from neutral — anything you
leave out keeps the `base.css` default. But override deliberately: the semantic
names are a trap when your surface inverts. `space-opera` uses a **dark** card, so
its `--ink` tokens flip to *light* readout text while `--parch*` stays light
(those slots also carry body/control text on the dark hull) and the dark plate
lives in the recipe tokens instead. Read its header comment before inverting
light/dark — the first cut of that theme shipped dark-on-dark text by trusting the
names literally.

### Meet the accessibility floor

`base.css` supplies the focus-ring and screen-reader structure; your job is
contrast. Text tokens must clear WCAG AA (4.5:1) against the surface they sit on —
`--ink*` on `--parch*`, `--parch*`/chrome text on `--leather`/`--wood`. Set
`--focus-ring` to a hue visible on your chrome and `--focus-ring-onlight` to one
visible on your card fill. The reference theme darkened `--ink-faint` specifically
to clear AA on parchment; hold that bar.

## Step 3 — paint the backdrop

The tokens skin the components; a few paint-only rules skin the page itself.
`base.css` leaves these as bare structure for your theme to fill — override them
after your `:root` block:

- **`ledger-board`** — the app backdrop (the desktop behind the cards). The
  reference theme layers a photographed leather texture; `space-opera` paints a
  gunmetal hull.
- **`.grain`** — a faint noise overlay multiplied over everything.
- **`.vignette`** — a soft corner-darkening (an `inset` box-shadow).
- **`::-webkit-scrollbar*`** — scrollbar thumb/track for light-DOM scrollers.
  Shadow-DOM scrollers pick up the matching constructable sheet from
  `src/client/components/shared-styles.ts`, so styling these covers the visible
  rest.

For a realistic material backdrop, a CC0 photo texture (e.g. from ambientCG) baked
into an image reads far better than a procedural SVG filter. Recolor it with a
blend mode over a base gradient, as the reference theme's `ledger-board` rule
does.

## Step 4 — ship a logo (optional)

The logo is a self-registering custom element served from your package, declared
in the manifest as `{tag, src}`. Model it on the reference theme's
[`mark.js`](https://github.com/cpyle0819/ledger-themes/blob/main/packages/the-ledger/mark.js):

- Use Shadow DOM so your gradient/filter ids can't collide with the page or a
  sibling theme's logo.
- Make `connectedCallback` idempotent (`if (this.shadowRoot) return`) and register
  once (`if (!customElements.get('your-mark')) customElements.define(…)`).
- Mark decorative SVG `aria-hidden="true"` — the masthead `<h1>` carries the
  accessible name.
- Plain JS, no build step; it ships as a static asset beside `theme.css`.

Declare no logo and the masthead falls back to the reference `<ledger-mark>`.

## Step 5 — install and verify

Install your theme into a Ledger deployment — discovery is automatic, no code
change. Use a published name, a git URL, or a `file:` path at a local checkout:

```
npm install <your-theme-package>      # published name
npm install /path/to/your-theme       # local checkout, while developing
```

Select it from the masthead switcher (the choice persists per-browser in
localStorage), or set it as the deployment default with a `theme` field in
`ledger.config.json`.

Verify by **rendering, not by reasoning** — screenshot the live page and look.
Check both lenses (columns and outline), open a card drawer, and confirm every
text/surface pairing is legible and every tier still reads distinctly. Layout and
contrast bugs hide from static reading of the CSS.

## Step 6 — publish

Publish your theme package to npm however you release packages; scoped packages
set `publishConfig.access: "public"` so they land public.

```
npm publish
```

(The bundled themes live in a workspaces monorepo and publish together with
`npm run publish:all`; a standalone theme is a plain `npm publish`.) Bump the
package `version` on each release.

## Checklist

- [ ] `package.json` — `name`, `description`, complete `files` array, filled
      `ledgerTheme` block, `peerDependencies` for any ambient.
- [ ] Every text token clears WCAG AA against its surface, both lenses.
- [ ] `--focus-ring` and `--focus-ring-onlight` visible on chrome and card fills.
- [ ] Backdrop rules (`ledger-board`, `.grain`, `.vignette`, scrollbars) painted.
- [ ] Logo (if shipped) uses Shadow DOM, idempotent `connectedCallback`, guarded
      registration, `aria-hidden` decorative SVG.
- [ ] Assets referenced relatively and listed in `files`.
- [ ] Extraction test: emptying `theme.css` resolves to the neutral baseline, not
      to any real theme.
- [ ] Verified by rendering the live page, not by reading the CSS.
