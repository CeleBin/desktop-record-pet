# Routes / window modes

Routing is selected by `?window=` in `src/App.tsx`, not React Router.

| Window value | Entry component | Notes |
| --- | --- | --- |
| default / `main-panel` | `src/components/panel/MainPanel.tsx` | Three-column main workspace |
| `pet` | `src/components/pet/PetShell.tsx` | Floating desktop pet |
| `quick-input` | `src/components/capture/QuickInput.tsx` | Quick-capture window |
| `supplement-box` | `src/components/capture/SupplementBox.tsx` | Capture supplement window |
| `screenshot-overlay` | `src/components/capture/ScreenshotOverlay.tsx` | Screenshot UI |
| `todo-overlay` | `src/components/todo/TodoOverlay.tsx` | To-do overlay |

Relevant router source: `src/App.tsx`. Main-panel selection flows through Zustand record/tag/task stores; layout state is kept within `MainPanel`.
