# Aloy — Version History & Changelog

All notable changes to the **Aloy** desktop application (formerly Ollama Pro) will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/):
* **MAJOR (x.0.0)**: Breaking changes or major architectural overhauls.
* **MINOR (1.x.0)**: New features, capabilities, or major integrations.
* **PATCH (1.0.x)**: Bug fixes, UI polishes, and minor updates.

---

## [1.0.0] — 2026-07-29

### Changed
* **Renamed to Aloy**: Rebranded from "Ollama Pro" — window title, sidebar branding, installer/executable name, and taskbar/Start Menu shortcuts. The underlying npm package name was left unchanged to preserve the existing app-data folder (chats, memories, projects, finances).

## [1.0.0] — 2026-07-27

### Added
* **Native Windows Desktop Packaging**: Transformed React + Vite web application into a standalone Windows `.exe` application using Electron and `electron-builder`.
* **Local File & Folder Access**: Integrated native Windows directory selection dialogs (`dialog.showOpenDialog`), recursive directory scanning, and disk file reader (`fs.readFile`) into RAG vector embeddings engine.
* **Automated Unit & E2E Testing Suite**:
  * Integrated **Vitest** for unit tests (`src/services/ollama.test.js`, `src/services/rag.test.js`).
  * Integrated **Playwright** + Chromium for end-to-end UI automation testing (`e2e/app.spec.js`).
* **Responsive UI/UX Layout System**: Dynamic flexbox and grid styling with media queries for screen resolutions from 400px to 4K.
* **Windows Taskbar & Start Menu Shortcuts**: Created shortcuts in `Start Menu\Programs` and `Quick Launch\User Pinned\TaskBar`.
