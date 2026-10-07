# Item reading view

Settings → Display → **Full-screen item panels** sets the browser-wide default
for newly opened items. Sidebar is the fallback. The preference survives reloads
and theme changes; unavailable storage keeps the choice for the current session.
An open item has expand/shrink icons with accessible labels and a **close** control. Resizing the
current item leaves the saved default and unfinished description intact.

Full screen presents the title, a status/assignee/date line, and the description
as an article. **Details & planning** opens the supporting fields below the
article. Comments follow those details. The source's permissions and existing
editing actions apply in both widths. Width changes preserve the visible reading
landmark. Edit, resize, and close share the persistent top bar in full screen. Save and cancel occupy the same editing-control group.

## Typography decisions

The body uses self-hosted Source Serif 4, with real regular, italic, and bold
faces. A system sans-serif supplies the title and section headings. This pairing
separates narrative from controls and metadata. Local serving makes the reading
font available without an external font request and avoids relying on an
operating system's Georgia substitute.

The article is capped at 700 CSS pixels. Body type scales from 19 to 21 pixels,
with a 1.65 line-height and 1.4em space after paragraphs. The title scales from
30 to 44 pixels with a 1.15 line-height. Text is left aligned; long identifiers
wrap. Code blocks and tables scroll within their own width. The reader uses the
active theme's sheet surface and text colors, including dark themes.

These dimensions are design choices informed by the following primary sources,
consulted on 7 October 2026:

| Source | Guidance and application |
| --- | --- |
| [USWDS Typography](https://designsystem.digital.gov/components/typography/) | Recommends 45–90 characters per line, with 66 as a useful long-text target, and at least 1.5 line-height for long text. The bounded article and browser-measured line-length check follow this guidance. |
| [W3C Visual Presentation](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html) | Describes mechanisms for controlling text presentation, including unjustified text, bounded line lengths, and resizing. The reader uses left alignment and reflow; this design note does not claim full AAA conformance. |
| [W3C Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) | Requires that specified spacing overrides cause no loss of content or functionality. The browser suite checks 1.5 line-height, 2em paragraph spacing, .12em letter spacing, and .16em word spacing with enlarged body text. |
| [Butterick: line length](https://practicaltypography.com/line-length.html) | Recommends measuring average characters rather than relying only on physical width. The test measures actual lines in the shipped font. |
| [Butterick: line spacing](https://practicaltypography.com/line-spacing.html) | Recommends a tighter 120–145% range. This reader chooses the more open USWDS screen-reading guidance and validates it with rendered long-form content. |
| [Adobe Source Serif](https://github.com/adobe-fonts/source-serif) | Supplies the open-source serif design and OFL license. The distributed files, source URLs, and license live in `public/fonts/source-serif/`. |

## Validation

Run a local Ledger server, then:

```sh
npm run test:reader
```

`LEDGER_URL` selects the local server. `CHROMIUM_PATH` selects an installed
Chromium binary; otherwise Playwright uses its browser installation.
`SCREENSHOT_DIR` optionally records the rendered layouts.

Every API request except the theme registry uses an in-memory fixture. The suite
blocks external requests and does not write to the
configured source. It covers defaults, reloads, theme changes, editing, drafts,
metadata, keyboard focus, unavailable storage, reading position, font loading,
320–1440px viewports, enlarged text and spacing, and reading contrast across the
installed themes. The existing profile resolver tests run with
`node tests/profile.test.cjs` after building.
