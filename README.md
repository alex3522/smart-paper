# Smart Paper

A single-file daily writing surface. Open it, type all day. No accounts, no sync, no build step.

![Smart Paper screenshot showing the editor, tree panel, and grove](https://via.placeholder.com/900x500/faf9f6/2a2a2a?text=Smart+Paper)

---

## What it is

Smart Paper is a distraction-free writing tool built around one idea: **a blank piece of paper that remembers what you wrote today**.

- Type freely — thoughts, tasks, notes, anything
- Hour markers (`## 09:00`) are inserted automatically as you cross hour boundaries
- Everything is saved to `localStorage` as you type, restored on reload
- At end of day, download a clean `.md` file (Obsidian daily-note compatible)

There are no tags, no tasks, no formatting toolbar. Just text.

---

## Features

### Writing
- Full-page textarea with word/line count
- Auto-save to `localStorage` (debounced 300ms + final save on tab close)
- Automatic `## HH:00` hour headers — inserted on the first keystroke after an hour rolls over
- **Typewriter mode** — keeps the cursor vertically centred as you type

### Sprint timer (Pomodoro-style)
- 3 focus rounds × 20 min, each separated by a 5-min break = one sprint
- Up to 4 sprints per day
- After the last focus round: a **90-second capture window** — type 30+ characters to preserve your sprint tree, or let it wither

### Animated tree
- Each sprint grows a randomly-chosen species: oak, willow, or cherry
- The tree sways during focus/break, slows when paused, and withers if the capture window expires
- Sky behind the tree shifts through sunrise → midday → dusk → night in real time
- A ground shadow tracks the sun's direction through the day
- Preserved trees turn autumnal

### Grove
- Completed sprints accumulate as small tree icons in the "Today's grove" panel
- Grove resets at midnight; sprint count and content persist until you clear them

### Audio
| Sound | Source |
|---|---|
| Rain | Streamed MP3 (jsDelivr CDN) |
| Fire | Streamed MP3 (jsDelivr CDN) |
| Wind | Procedural — Web Audio API brown noise + bandpass + LFO |
| Lo-fi radio | SomaFM Groove Salad live stream |
| Drone Zone | SomaFM Drone Zone live stream |
| Mission Control | SomaFM Mission Control live stream |

Volume slider controls ambient sound. Sprint chimes bypass the slider so they stay audible.

### Sprint chimes
Three distinct tones signal transitions:
- **Focus → break**: descending D5 → A4 ("rest now")
- **Break → focus**: ascending A4 → D5 ("back to it")
- **Sprint complete**: triple E5 E5 A5 ("capture now")

Optional OS notifications fire when the tab is in the background.

### Themes
| Theme | Character |
|---|---|
| Light | Cream paper, default |
| Dark | Dark grey |
| Sepia | Warm parchment |
| Midnight | Deep blue-grey |
| Forest | Deep green |

All preferences (theme, sound, volume, typewriter mode, chimes) persist across sessions.

---

## Usage

Open [Smart Paper on GitHub Pages](https://alex3522.github.io/smart-paper/) in any modern browser, or clone the repo and open `index.html` directly from disk.

No server, no install, no dependencies.

### Install as an app (PWA)

Smart Paper is installable as a Progressive Web App. In Chrome or Edge, click the install icon in the address bar. On iOS Safari, use **Share → Add to Home Screen**. Once installed it works fully offline.

### Export
Click **Download .md** to save the day's writing as `YYYY-MM-DD.md`. The file includes your notes and an inline SVG grove showing completed sprints. Compatible with Obsidian daily notes out of the box.

### Clear
Click **Clear** to wipe the editor and grove. Settings are preserved. Download first — this can't be undone.

---

## Design philosophy

- **Blank paper, not another productivity tool.** No tags, tasks, or formatting toolbar.
- **Persistence over prompting.** Never ask the user to do anything — auto-save, auto-insert, auto-restore.
- **Aesthetic mood matters.** Themes, ambient sound, and time-of-day tint exist because writing surfaces should feel inviting.
- **No build step, no dependencies.** Clone, open `index.html`, bookmark. No bundler, no npm, no framework.

---

## Architecture

No build step, no bundler, no dependencies — just files the browser loads directly.

| File | Responsibility |
|---|---|
| `index.html` | Markup and asset references |
| `styles.css` | All CSS, including the 5 theme palettes via custom properties |
| `app.js` | Main IIFE: timer, sound engine, editor, theme, export (~1120 lines) |
| `tree.js` | ES module: SVG tree rendering, sky/shadow/atmosphere (~390 lines) |
| `sw.js` | Service worker: cache-first PWA shell |
| `manifest.json` | PWA metadata and icon |

`app.js` is a single IIFE organised into numbered sections:

| Section | Responsibility |
|---|---|
| 1–2 | DOM references, storage keys, sprint constants |
| 3–4 | Theme system, time-of-day tint |
| 5–6 | Ambient sound engine, sprint chimes |
| 7–8 | Typewriter mode, date display & daily reset |
| 9–11 | Sprint state, editor stats/autosave, hour headers |
| 12 | Tree rendering → `tree.js` |
| 13–14 | Sprint state machine, grove storage |
| 15–17 | Event wiring, export/clear, initialisation |

All state lives in `localStorage` under `smart-paper-*` keys. Multiple instances on different paths coexist without collision.

---

## Browser compatibility

Requires a modern browser with:
- `localStorage`
- Web Audio API (for procedural wind and chimes; other sounds fall back to `<audio>` element)
- ES6+ (arrow functions, template literals, destructuring)

Tested in Chrome 120+, Firefox 121+, Safari 17+.

---

## License

MIT
