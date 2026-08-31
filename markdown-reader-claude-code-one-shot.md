# One-Shot Claude Code Prompt — Minimal Markdown Reader PWA

You are Claude Code operating in an empty project directory.

Build the complete application described below. This is a **one-shot implementation task**: make the architectural decisions, create the files, implement the application, test it, and leave the directory in a working state. Do not stop after scaffolding or ask for confirmation unless you encounter a genuinely blocking ambiguity.

## Mission

Create a tiny, deterministic, offline-capable Markdown document reader for Chromium browsers, with particular attention to **Android Chrome**.

The application is a vanilla **Vite + TypeScript** web application and an installable **Progressive Web App (PWA)**.

Version 1.0 is intentionally a **reader**, not an editor.

The primary workflow is:

```text
Open application
       |
       +--> Select .md / .markdown file
       |          |
       |          v
       |     Read rendered document
       |          |
       |          +--> Print
       |
       +--> Android "Share to" application
                  |
                  v
             Read rendered document
                  |
                  +--> Print
```

The application must work offline after the PWA has been installed/cached.

The architecture must deliberately leave room for a future editing capability without implementing editing in v1.

---

# 1. Hard Requirements

## 1.1 Technology

Use:

- Vite
- TypeScript
- Vanilla HTML
- Vanilla CSS
- Vanilla browser APIs

Do **not** use:

- React
- Vue
- Svelte
- Angular
- Lit
- Tailwind
- Bootstrap
- UI component libraries
- Markdown parsing libraries
- Markdown rendering libraries
- state-management libraries
- unnecessary runtime dependencies

The Markdown parser must be **hand-rolled**.

Keep the dependency graph as close to zero as reasonably possible.

Vite itself and the minimum development/build tooling required by Vite are acceptable.

Do not add a dependency merely for convenience.

---

# 2. Platform Requirements

## 2.1 Chromium

The primary browser target is modern Chromium.

The application must work on:

- desktop Chromium
- Android Chrome

Do not build separate mobile and desktop applications.

Use responsive CSS and normal browser capabilities.

## 2.2 Android file selection

Provide a visible **Open Markdown File** action.

Use the browser File System / file picker capability appropriate for Chromium.

The file picker must restrict selection to:

- `.md`
- `.markdown`

Do not claim that arbitrary files are supported.

Read the selected file entirely in the browser.

There must be no upload to a server.

The selected document is local user data and must remain local.

## 2.3 Android Share Target

Make the PWA installable and register it as an Android share target using the appropriate Web App Manifest / Web Share Target mechanism.

The intent is that a user can do approximately:

```text
Android file manager
    -> Share
    -> Markdown Reader
    -> application opens the shared Markdown file
```

The implementation must correctly handle the Share Target POST request and retrieve the shared file from the incoming request.

The shared file should enter the same internal document-loading pipeline as a file selected through the application UI.

Do not create a second rendering implementation for shared documents.

The application should validate the incoming file extension and accept only:

- `.md`
- `.markdown`

If the platform provides a filename, use it.

If the incoming share does not contain a supported Markdown file, show a small, understandable error.

## 2.4 PWA

Create a valid installable PWA.

Include the necessary:

- Web App Manifest
- service worker
- application icons/placeholders as appropriate
- secure-context-compatible architecture

The service worker must cache the application shell and assets required for offline use.

The application must not depend on a network request to render a local Markdown file after installation.

Do not introduce a server backend.

---

# 3. Markdown Renderer

The Markdown renderer is intentionally hand-written.

Do not import or copy an existing Markdown parser.

Implement a small parser for a deliberately defined Markdown subset.

The parser should support at minimum:

## Block elements

- headings `#` through `######`
- paragraphs
- blank lines
- unordered lists using `-`, `*`, and `+`
- ordered lists
- nested lists where reasonably straightforward
- blockquotes
- fenced code blocks using triple backticks
- horizontal rules
- links
- images
- tables
- task-list syntax such as `- [ ] item` and `- [x] item`
- strikethrough
- escaped Markdown characters

## Inline elements

Support at minimum:

- emphasis
- strong emphasis
- inline code
- links
- images
- strikethrough
- automatic escaping of HTML-sensitive characters

Do **not** allow arbitrary HTML from the Markdown document to become executable HTML.

The renderer must protect against basic HTML/script injection.

For example, Markdown containing:

```html
<script>alert("x")</script>
```

must not execute the script.

Prefer constructing DOM nodes safely or escaping text rather than concatenating untrusted Markdown directly into `innerHTML`.

If `innerHTML` is used for controlled renderer output, make the safety boundary explicit and ensure user-provided text is escaped.

---

# 4. Renderer Architecture

Do not make the renderer a giant regular expression.

Use a simple, understandable pipeline such as:

```text
source text
    |
    v
normalization
    |
    v
block parsing
    |
    v
inline parsing
    |
    v
rendered DOM
```

The exact implementation is your architectural decision.

Prefer small, composable functions.

Keep parsing independent from the UI.

The core Markdown parser should be usable without knowing anything about:

- buttons
- application state
- browser UI
- file pickers
- PWA behavior

Likewise, the UI should not need to know the internal details of Markdown parsing.

Establish a clean boundary around a future document model.

A useful conceptual architecture is:

```text
Document Source
     |
     v
Document Model
     |
     +---------> Reader Renderer
     |
     +---------> Future Editor
```

Do not implement the editor.

---

# 5. Security Boundary

Treat every loaded Markdown document as untrusted input.

At minimum:

- escape HTML-sensitive text
- never execute scripts from Markdown
- do not permit event-handler attributes
- do not blindly inject raw Markdown into the DOM
- make links safe
- avoid dangerous URL schemes such as `javascript:`

Images and links may reference external resources, but the application itself must not require network access to render the document.

Do not build a complete sanitization framework. The goal is a small, understandable security boundary appropriate for this renderer.

---

# 6. Reader UI

The UI should be deliberately minimal.

Do not turn this into a full document-management application.

A reasonable layout is:

```text
+------------------------------------------------+
| Open Markdown                         Print    |
+------------------------------------------------+

             Document Title

       rendered Markdown content

       rendered Markdown content

       rendered Markdown content
```

The exact visual design is yours, but optimize for:

- readability
- whitespace
- typography
- narrow mobile screens
- large touch targets
- desktop reading
- printing

The current filename may be displayed subtly.

Do not add:

- accounts
- cloud storage
- document synchronization
- databases
- editing
- file management
- recent-document history
- annotations
- collaboration
- authentication
- analytics
- telemetry
- advertisements

unless absolutely required by the platform implementation.

The application should feel like a small native document reader rather than a web dashboard.

---

# 7. Empty State

When no document is loaded, show a simple empty state.

It should tell the user what the application does and provide the Open action.

Keep it minimal.

Do not display a tutorial or onboarding sequence.

---

# 8. Error Handling

Handle at least:

- unsupported file extension
- inability to read a selected file
- malformed/unsupported Markdown constructs without crashing
- malformed Share Target requests
- missing shared file
- browser capability limitations

Errors should be understandable to a normal user.

Do not expose stack traces in the UI.

The application must fail gracefully.

---

# 9. Printing

The Print action should use the browser's native printing mechanism:

```ts
window.print()
```

Do not build a PDF engine.

Create dedicated print CSS.

Printed output should:

- contain the rendered document
- omit application controls
- use printer-friendly typography
- preserve headings and readable spacing
- avoid awkward page breaks where reasonably possible
- print code blocks legibly
- print tables sensibly
- avoid printing UI chrome

The browser should handle the actual printer/PDF destination.

---

# 10. Responsive Design

Design mobile-first.

The application must be comfortable on a typical Android Chrome viewport.

Pay attention to:

- touch target sizes
- viewport width
- long code lines
- wide tables
- long URLs
- images wider than the viewport
- readable body text
- scrolling behavior

Wide content should not cause the entire page to become horizontally unusable.

A table may scroll horizontally within its own container if necessary.

---

# 11. Offline Architecture

The application must be usable offline after the initial application shell has been cached/installed.

The following must not be required at runtime:

- CDN resources
- Google Fonts
- remote JavaScript
- remote CSS
- remote Markdown parser
- API calls
- backend services

Bundle everything necessary.

Prefer system fonts.

The service worker should use a straightforward cache strategy appropriate for a static application shell.

Do not build an elaborate offline synchronization system.

Remember:

**offline application ≠ offline external images.**

External images referenced by a Markdown document may naturally fail when offline. The application itself must still function.

---

# 12. File Handling Model

Create one internal document-loading path.

Conceptually:

```text
File Picker --------\
                     \
                      -> loadDocument(...)
                     /
Share Target --------/
```

Both paths should produce the same document representation.

For example:

```ts
interface MarkdownDocument {
    name: string;
    source: string;
}
```

You may use a better representation if appropriate, but keep it small.

The renderer should consume the document/source independently of where it came from.

---

# 13. Share Target Details

Implement the Web Share Target flow according to current Chromium/PWA behavior.

The manifest should declare a share target capable of receiving a shared file.

Use an appropriate POST action and multipart form-data configuration.

The application must distinguish between:

- normal navigation to the application
- opening a selected local file
- receiving a shared file

Do not rely on URL query parameters containing the entire Markdown document.

Do not encode an entire Markdown file into a URL.

For a shared file:

1. Receive the POST.
2. Retrieve the file from the multipart request.
3. Validate the filename/type.
4. Read the text.
5. Feed it into the normal document-loading pipeline.
6. Render it.
7. Replace the Share Target POST state with a normal application URL/history state where appropriate so that refresh/back navigation does not repeatedly resubmit the document.

Use a robust approach compatible with service-worker-mediated Share Target handling.

Document any important browser/PWA limitation in the README.

---

# 14. URL and Navigation Safety

If Markdown contains links:

- normal HTTP/HTTPS links should work
- do not permit `javascript:` links
- do not execute arbitrary URL schemes

If you use `target="_blank"`, apply an appropriate `rel` value.

Images should be rendered as images rather than interpreted as arbitrary HTML.

---

# 15. Project Structure

Use a small, logical structure.

Do not create dozens of files.

A structure similar to this is desirable:

```text
.
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── manifest.webmanifest
│   ├── icons/
│   └── ...
├── src/
│   ├── main.ts
│   ├── style.css
│   ├── markdown/
│   │   ├── parser.ts
│   │   ├── inline.ts
│   │   └── renderer.ts
│   ├── document/
│   │   └── document.ts
│   ├── input/
│   │   ├── file-picker.ts
│   │   └── share-target.ts
│   └── pwa/
│       └── ...
├── tests/
│   └── ...
└── README.md
```

This is guidance, not a requirement.

If a smaller structure is better, use it.

Do not split files merely to make the tree look sophisticated.

---

# 16. Tests

Testing is required.

At minimum, test the Markdown parser/renderer against representative inputs for:

- headings
- paragraphs
- emphasis
- strong text
- inline code
- fenced code
- unordered lists
- ordered lists
- nested lists
- blockquotes
- links
- images
- tables
- task lists
- strikethrough
- escaping
- malicious HTML/script input
- dangerous link schemes
- empty documents

Test behavior rather than implementation details.

Keep the testing solution lightweight.

Do not introduce a large testing framework solely because it is familiar.

If a small test harness is sufficient, prefer it.

---

# 17. This Prompt Is Also a Renderer Test

An important requirement:

**This Markdown document is itself intended to be used as a test document for the finished renderer.**

Preserve this document as a Markdown file in the project, for example:

```text
TEST.md
```

Do not substantially simplify the Markdown used here.

The finished renderer should be capable of loading this document and rendering its:

- headings
- paragraphs
- bold text
- inline code
- fenced code blocks
- lists
- nested lists
- tables
- links
- blockquotes
- horizontal rules
- escaped characters

Include a small representative Markdown test section if necessary to exercise any syntax not naturally represented elsewhere in this document.

The test document should remain useful as a human-readable application specification and renderer fixture.

---

# 18. Example Test Content

Ensure the renderer handles examples equivalent to the following:

## Inline formatting

This is **bold**, this is *italic*, this is `inline code`, and this is ~~strikethrough~~.

## Lists

- One
- Two
  - Nested A
  - Nested B
- Three

1. First
2. Second
3. Third

## Tasks

- [ ] Future feature
- [x] Implement reader

## Quote

> This is a blockquote.
>
> It contains more than one paragraph.

## Code

```typescript
function hello(name: string): string {
    return `Hello, ${name}!`;
}
```

## Table

| Feature | v1.0 |
| --- | --- |
| Reading | Yes |
| Editing | No |
| Printing | Yes |
| Offline | Yes |

## Link

[Chromium](https://www.chromium.org/)

## Escaping

These characters should remain text:

`<script>alert("hello")</script>`

---

# 19. Future Editing Boundary

Do not implement editing.

However, design the code so a future v2 could add:

```text
Reader
   |
   +---- Markdown source
   |
   +---- Editor
```

The renderer must not mutate the source document.

The document source should be treated as a separate concern from rendered DOM.

Avoid architecture that assumes documents are permanently read-only internally.

Do not create an editor abstraction merely for theoretical purity.

The goal is a **small v1 with a clean seam for v2**.

---

# 20. Accessibility

Use semantic HTML.

At minimum:

- proper heading hierarchy
- buttons for actions
- accessible labels
- keyboard accessibility on desktop
- visible focus states
- sensible contrast
- meaningful document title

Do not add a custom accessibility framework.

Use native HTML semantics wherever possible.

---

# 21. Browser Compatibility

Target modern Chromium.

Do not add polyfills for unrelated legacy browsers.

Where a required capability is unavailable, fail gracefully with a useful message.

The application should not pretend to support functionality that the current browser cannot provide.

---

# 22. Build and Verification

When implementation is complete:

1. Install dependencies.
2. Run the development/build tooling as necessary.
3. Run all tests.
4. Run a production build.
5. Inspect the generated output.
6. Fix all TypeScript errors.
7. Fix all test failures.
8. Verify the PWA manifest is present in the production output.
9. Verify the service worker is included/registered appropriately.
10. Verify no accidental CDN/runtime dependencies exist.
11. Verify `.md` and `.markdown` are the only accepted document extensions.
12. Verify the application can render `TEST.md`.

Do not finish with known build errors.

---

# 23. README

Create a concise README explaining:

- what the application is
- how to install dependencies
- how to run development mode
- how to build
- how to run tests
- how to install the PWA on Android Chrome
- how Android Share Target works
- supported Markdown syntax
- known limitations
- how the architecture leaves room for future editing

Do not write a giant developer manual.

---

# 24. Engineering Principles

Follow these principles throughout the implementation.

### Small is a feature

Prefer the smallest implementation that satisfies the requirements.

### No speculative features

Do not implement features because they might be useful later.

### No unnecessary dependencies

Every dependency must justify its existence.

### Clear boundaries

Separate:

- document input
- document representation
- Markdown parsing
- DOM rendering
- application UI
- PWA/share-target infrastructure

### Browser-native first

If the browser already provides the capability, use it.

### Local first

Markdown documents are local data.

Do not introduce servers, databases, accounts, or cloud storage.

### Deterministic

The project should build from its declared dependencies without relying on undocumented local state.

### Explain important trade-offs

If you choose an approach that is not obvious, document the reason briefly in the code or README.

---

# 25. Explicit Non-Goals for v1.0

Do NOT implement:

- Markdown editing
- saving modified Markdown
- cloud storage
- accounts
- authentication
- collaboration
- document synchronization
- document history
- search across documents
- bookmarks
- annotations
- PDF generation
- custom print engine
- remote backend
- telemetry
- analytics
- external font dependencies
- syntax-highlighting dependency
- Markdown library
- JavaScript framework
- elaborate design system

If something is not necessary to satisfy the requirements above, leave it out.

---

# 26. Definition of Done

The project is complete only when all of the following are true:

- [ ] `npm install` succeeds.
- [ ] Development server starts.
- [ ] Production build succeeds.
- [ ] TypeScript is clean.
- [ ] Tests pass.
- [ ] The app loads without a backend.
- [ ] The UI is usable on Android Chrome.
- [ ] A user can select a `.md` file.
- [ ] A user can select a `.markdown` file.
- [ ] Unsupported extensions are rejected.
- [ ] Markdown is rendered without a third-party Markdown library.
- [ ] Dangerous HTML does not execute.
- [ ] Dangerous URL schemes are rejected.
- [ ] Code blocks render correctly.
- [ ] Tables render correctly.
- [ ] Lists render correctly.
- [ ] The app can print using the browser's print facility.
- [ ] Print CSS hides application controls.
- [ ] The PWA manifest is valid.
- [ ] The service worker provides the application shell offline.
- [ ] The PWA can be installed in Chromium.
- [ ] The Web Share Target is configured.
- [ ] A shared Markdown file enters the same rendering pipeline as a picked file.
- [ ] The application does not require a network connection to render a local document once the application shell is available.
- [ ] `TEST.md` can be loaded and rendered.
- [ ] The README explains the resulting project.
- [ ] No unnecessary framework or dependency has been introduced.

---

# 27. Final Implementation Behavior

When you are done, the application should feel like this:

**On desktop**

```text
Open Markdown    Print

----------------------------------------

                My Document

# Heading

Readable Markdown content...

----------------------------------------
```

**On Android**

```text
File Manager
     |
     +-- Share
           |
           +-- Markdown Reader
                    |
                    v
              rendered document
                    |
                    +-- Print
```

The user should not have to understand how the application works internally.

The implementation should be small enough that a developer can read the entire codebase and understand it.

---

# 28. Final Instructions to Claude Code

Do the work now.

Start by inspecting the directory.

Create the project.

Implement the architecture.

Implement the Markdown parser.

Implement the reader.

Implement file selection.

Implement PWA installation support.

Implement Android Share Target handling.

Implement offline caching.

Implement printing.

Implement tests.

Create `TEST.md` from this specification, preserving it as a useful Markdown renderer fixture.

Create the README.

Run the tests and production build.

Fix problems you encounter.

At the end, report briefly:

1. What was created.
2. The final project structure.
3. The Markdown subset implemented.
4. How Share Target handling works.
5. How offline/PWA support works.
6. Test/build results.
7. Any browser limitations that remain.

Do not provide a proposed implementation instead of implementing it.

Do not stop at analysis.

**Implement the complete working v1.0 now.**
