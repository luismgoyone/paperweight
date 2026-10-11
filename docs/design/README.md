# Design mockups

Generated with Google Stitch (project "PDF Editor (privacy-first)") on 2026-10-12.
They guide visuals only; spec §5 defines structure and behaviour.

- `viewer.jpg` / `viewer.html`: main editor layout (pages sidebar, canvas, properties panel).

`viewer.html` is a reference export. It loads Tailwind and fonts from third-party CDNs,
so it must never be served by the app (the app's CSP would block it anyway).
