# Sanitized Markdown Rendering Design

## Goal

Render Conversation Navigator messages as complete GitHub-Flavored Markdown, including safely cleaned raw HTML and remote images, without allowing transcript content to execute code or control the surrounding application UI.

## Root Cause

Codex App Server and the navigator HTTP API preserve Markdown source correctly. The browser loses formatting because `renderTranscript` passes each message directly to `createElement`, which assigns it to `textContent`. The change belongs entirely in the browser rendering layer and its static-asset/CSP support.

## Confirmed Product Behavior

- Render both user messages and visible Codex `final_answer` messages as Markdown.
- Support headings, paragraphs, emphasis, strikethrough, links, autolinks, images, block quotes, ordered and unordered lists, task lists, fenced and inline code, horizontal rules, tables, and raw HTML.
- Automatically load `http:` and `https:` images. Keep raster `data:image/` sources available while rejecting SVG data images.
- Open links in a new tab with `noopener noreferrer` and no referrer.
- Continue hiding Codex `commentary`, reasoning, command, tool, and other non-message items.
- Fall back to readable plain text when Markdown parsing or sanitization fails.

## Selected Approach

Bundle pinned browser ESM distributions of Marked 18.0.6 and DOMPurify 3.4.12 inside the skill. Marked converts Markdown and raw HTML into HTML; DOMPurify sanitizes that result before it reaches the transcript DOM.

This approach is selected over a custom Markdown parser because complete Markdown, tables, nested structures, and raw HTML are too broad for a small reliable parser. It is selected over a custom regex sanitizer because HTML/XSS safety requires browser-aware parsing. The libraries are self-hosted so rendering does not depend on a CDN or send transcript text to an external service.

Include the libraries' license files beside the vendored bundles. Pin their exact versions so the checked-in behavior remains reproducible.

## Components

### Markdown Renderer

Add a focused browser module that:

1. Normalizes leading zero-width characters that can interfere with Markdown parsing.
2. Parses with Marked in GFM mode.
3. Sanitizes the generated HTML with a DOMPurify instance bound to the current browser window.
4. Sanitizes to a `DocumentFragment` with explicit `ALLOWED_TAGS` and `ALLOWED_ATTR` lists, with data and ARIA attributes disabled.
5. Post-processes the fragment to scope table alignment and dimensions, validate URLs, fix safe link/image attributes, and rebuild task checkboxes.
6. Returns a plain-text fragment if parsing, sanitization, or DOMPurify browser support fails.

`app.js` replaces the message body's children with the returned fragment. It must never write untrusted or merely parsed markup directly to `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write`.

### Vendored Assets

Store these files under `assets/web/vendor/`:

- Marked ESM browser distribution and MIT license.
- DOMPurify ESM browser distribution and Apache-2.0/MPL-2.0 license material.

Serve only those explicit files through the existing static-file allowlist. Do not expose `node_modules`, arbitrary paths, or a directory index.

### Markdown Styles

Scope Markdown styles beneath `.message-text` so raw content cannot affect the application shell. Style headings, paragraphs, lists, block quotes, inline code, fenced code, tables, links, images, details, and task-list checkboxes. Tables and code blocks scroll horizontally within the message card; images remain within the card and have a bounded viewport-relative height.

## Sanitization Policy

Use explicit DOMPurify `ALLOWED_TAGS` and `ALLOWED_ATTR` lists with unknown protocols disabled, named-property protection enabled, and both `ALLOW_DATA_ATTR: false` and `ALLOW_ARIA_ATTR: false`. Do not use the broad HTML profile. The element list is limited to complete GFM output, approved table structure and safe text-formatting/container elements, `details`/`summary`, and `input` solely for the later disabled task-checkbox rebuild. The attribute list is limited to approved content metadata and attributes that are validated or replaced during post-processing.

Remove at minimum:

- `script`, `style`, `iframe`, `frame`, `frameset`, `object`, `embed`, `applet`, `base`, `meta`, and `link` elements.
- `form`, `button`, `textarea`, `select`, and `option` elements, plus every `input` except a disabled task-list checkbox.
- `video`, `audio`, `source`, and `track` elements.
- All inline `style`, `id`, `name`, `class`, `srcset`, `background`, `role`, ARIA, and data attributes.
- Event handler attributes and other attributes DOMPurify considers unsafe.
- SVG, MathML, custom elements, and executable or unknown URL schemes.

Keep approved safe HTML formatting elements such as `div`, `span`, text-formatting and ruby elements, figures, tables, lists, code, anchors, and images. Keep user-approved `details`/`summary`, including `open`. Do not admit application landmarks or controls, `canvas`, `marquee`, forms, media, frames/objects, SVG/MathML, custom elements, `template`, `dialog`, or `label`.

After sanitization:

- Accept link destinations only when they resolve to `http:`, `https:`, `mailto:`, a relative URL, or a same-document fragment. Convert `file:` links to the read-only local code viewer backed by the local-file endpoint; remove other `href` values.
- Set every surviving link to `target="_blank"`, `rel="noopener noreferrer"`, and `referrerpolicy="no-referrer"`.
- Accept image sources only for `http:`, `https:`, or raster `data:image/` media types. Remove other `src` values, including SVG data images.
- Remove `width` and `height` from every non-image element. On images, keep each dimension only when its raw value is a canonical positive integer from 1 through 10000 inclusive.
- Set every surviving image to `loading="lazy"`, `decoding="async"`, and `referrerpolicy="no-referrer"`.
- Keep `align` only on table header/data cells and only for `left`, `center`, or `right`.
- Keep only disabled `input[type="checkbox"]` elements inside list items, strip all other attributes, and restore only `type`, `disabled`, and an optional `checked` state.

The user accepts that remote images still reveal network metadata such as IP address and load time to the image host.

## Content Security Policy

Keep scripts and connections self-hosted. Change image policy to allow the approved remote sources and add explicit defense-in-depth directives:

```text
img-src 'self' data: http: https:
media-src 'none'
frame-src 'none'
object-src 'none'
form-action 'none'
```

Keep `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `connect-src 'self'`, `base-uri 'none'`, and `frame-ancestors 'none'`.

## Error Handling

- If the vendored module cannot load, the browser module import fails visibly rather than silently executing an unsafe fallback.
- If a specific message cannot be parsed or sanitized, render that message with `textContent` and continue rendering the remaining conversation.
- If DOMPurify reports that the browser is unsupported, use the same per-message plain-text fallback.
- Preserve the last successfully rendered transcript when a later polling request fails, as before.

## Testing

Use jsdom 29.1.1 as a pinned development-only dependency to exercise the actual vendored Marked and DOMPurify modules with the Node test runner. Its test environment requires Node.js 20.19 or newer. Do not add runtime npm dependencies.

Test successful rendering of:

- Headings, emphasis, links, lists, task lists, fenced code, tables, images, and safe raw HTML.
- External link target, relationship, and referrer attributes.
- Remote image source, lazy loading, asynchronous decoding, and referrer attributes.
- Canonical image dimensions from 1 through 10000, plus GFM left/center/right table alignment.

Test removal of:

- Scripts, event attributes, dangerous protocols, styles, interactive form controls, iframes, embedded objects, active media, SVG, MathML, custom elements, dangerous classes/IDs, `srcset`, misplaced dimensions, and invalid image dimensions.

Also test:

- Plain-text fallback on parser/sanitizer failure.
- Static serving of every vendored module and rejection of unlisted paths.
- CSP remote-image allowance and active-content prohibitions.
- Existing final-answer filtering, search, instant navigation, polling, authentication, loopback binding, and rollout-file immutability.
- Skill package validation and a live local-server smoke test.

## Completion Criteria

- A real Codex final answer containing common Markdown renders with visible structure rather than literal markers.
- Safe raw HTML and remote images render under the approved policy.
- The XSS regression fixture cannot create scripts, event handlers, dangerous URLs, forms, frames, embedded objects, active media, SVG, or MathML.
- Links and images receive the required fixed safety/privacy attributes.
- No transcript text is sent to a Markdown CDN or other rendering service.
- Parser/sanitizer failure preserves readable plain text.
- All automated tests, skill validation, and live read-only checks pass.
