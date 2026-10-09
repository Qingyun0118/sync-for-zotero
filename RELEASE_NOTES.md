# v0.0.19 — Qingyun maintained release

Based on upstream v0.0.18, retaining DeepSeek file-input PDF uploads,
history recovery, MV3 keepalive and current ChatGPT composer support.

- Synchronize Zotero literature conversation titles with ChatGPT through
  `RENAME_CHAT`, including verified read-back and conflict handling.
- Read both current ChatGPT transcript markup variants without duplicate turns.
- Preserve code-card indentation, blank rows, nested fences and math.
- Preserve image-only answers, images outside Markdown owners and portable SVG
  diagrams. Copy already loaded pixels when permitted, with size limits; keep
  HTTP(S) URLs when the browser protects cross-origin pixels.
- Publish this maintained companion from Qingyun0118/sync-for-zotero.
- Verify the complete extractor, rename protocol and release CLI test suites
  before publishing the archive.

Use with LLM for Zotero v3.9.12. Download extension.zip, update the fixed
unpacked extension directory, reload the extension, and refresh chat pages.

Original project by Yile Wang and contributors; original license retained.
