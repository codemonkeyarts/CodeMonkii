# 🐒 Monkii — Roadmap

The guiding rule for everything here: **local by default, honest always.** Nothing on this list may ever *require* an account, a cloud service, or sending your data off the machine — anything remote (like the optional OpenRouter backend) is opt-in, per chat, and clearly labeled. Ideas are grouped by the promise they serve — keeping Monkii **local-first, honest, and yours**.

Have an idea? Open an issue — local-first, private-by-default proposals move to the top.

## Next up

The current focus, in priority order (details in the sections below). With the local/secure foundation in place, this round is about making Monkii a great daily tool:

1. ~~**Search across chats & projects**~~ — **shipped**: ⌕ Search in the rail (or Ctrl+K) searches project names, chat titles, and every message at once, with match-centered snippets and jump-to-exact-message
2. **Edit · regenerate · branch messages** — fix a prompt and re-run, branch an alternate take, copy a conversation as Markdown *(shipped so far: ↻ retry on the last reply; edit-and-resend on any past message of your own, with a heads-up before discarding more than its own reply; copy/save a whole conversation as Markdown, real source not a flattened render. Remaining: branching an alternate take without losing the original)*
3. ~~**Backup & wipe controls**~~ — **shipped**: Preferences → Data & backup — one-click backup (zips the data dir to a folder you pick) and a real "erase everything" (projects, chats, and cached embeddings) gated behind typing the exact confirmation phrase, plus a live project-count/data-path readout and an "Open data folder" shortcut in the desktop app
4. **Theming** — palette presets, light/dark/system, font & density controls (the UI already runs on CSS variables) *(shipped so far: seven presets in Preferences → Theme — dark: Cyber Deco, Speakeasy Noir, Gothic Library, Midnight; light: Parchment, Daylight, Porcelain — applied pre-paint, persisted, all WCAG-AA contrast-checked. Remaining: system-follow toggle, custom colors, fonts, density)*
5. **Completion notifications** — a desktop toast (optional sound) when a long generation finishes while Monkii is in the background

*(The CA-signed certificate is deliberately deferred for now.)*

### OpenRouter deepening

Folding in the parts of OpenRouter's API that serve Monkii's promises — privacy first, then cost transparency, then writing workflow:

- [x] **Privacy routing by default** — remote requests demand `data_collection: deny` (only providers that don't log/train see your words), with a Preferences opt-out for wider provider choice
- [x] **Cost per reply** — token counts and exact $ cost under each remote reply, plus a running per-chat total in the header (the remote sibling of the local token meter)
- [x] **Credits & key check in Preferences** — a live "$ used (of $ limit)" readout next to where the key is saved
- [x] **Reasoning-model support** — R1-class models stream their thinking separately; it renders as a collapsible "thinking…" block (open while the model thinks, folded once the answer starts) and persists with the message
- [x] **Free tier & routing variants** — a "free only" filter in the browse dialog, and a per-project `or_route` option (`floor` = cheapest provider, `nitro` = fastest)
- [x] **Prompt caching** — automatic cache markers on the system prompt for models that support it (Claude, Gemini); big savings for the resend-the-manuscript editing pattern
- [ ] **Fallback models** — an ordered backup list so a provider outage fails over instead of erroring
- [ ] **Web search per chat** — OpenRouter's search plugin, opt-in and badged like remote itself (it's a second place your query text goes)

## Shipped

- [x] Projects, chats, and quick chat (no project needed)
- [x] Claude-format skills: always-on toggles + `/` per-message invocation
- [x] Create skills three ways — blank template, written by a local model, or imported (folder / `SKILL.md` / packaged `.skill`)
- [x] Skill detail view (instructions + bundled reference files)
- [x] Live file & directory knowledge, re-read from disk each message — at **two levels**: shared project knowledge and per-chat knowledge
- [x] Per-project model settings — context length, temperature, and the full advanced Ollama option set
- [x] Model info (size, quantization, context, use-case fit) and in-app model management — pull, delete, disk usage
- [x] Token & context awareness — live estimate, auto-compaction, and an overflow dialog with a clean way out
- [x] Right-click menus and native text-field editing
- [x] Error logging to a rotating file (open it from the app menu)
- [x] Signed Windows desktop app with an installer; per-user data in `%APPDATA%`
- [x] Rebrand to Monkii (`appId` `com.codalanguez.monkii`) with a one-time data migration from the old install
- [x] **Local retrieval over big knowledge** — a large attachment (manuscript or codebase) is embedded on-device (via Ollama) and only the passages relevant to your question are injected; small attachments are still included whole, an embed model is auto-detected, and it all runs offline (falls back to the plain dump when no embed model is present)
- [x] **Attachment reads cached** by size + modified-time, so unchanged knowledge isn't re-read from disk on every message
- [x] **Embedding-model bootstrap** — on first run, if no embed model is installed, Monkii offers to download the recommended one (`nomic-embed-text`) via Ollama, so large-attachment search works out of the box
- [x] **Quiet, self-managing Ollama** — Monkii starts Ollama through its desktop app (or a hidden-console `ollama serve`), so loading a model no longer pops terminal windows on Windows
- [x] **Ollama update prompt** — a native "a newer Ollama is available" popup (with a per-version "don't remind me"), alongside the status-bar pill
- [x] **Retrieval index is private & self-cleaning** — the on-disk embedding index (which holds chunked attachment text in plaintext) is deleted when you detach the attachment or delete the project, the index directory is size-capped with least-recently-used eviction, and it's gitignored; `MONKII_RETRIEVAL=off` writes none at all
- [x] **First-run chat-model bootstrap** — on a clean install with no models, Monkii offers to pull a small default chat model (`llama3.2`) so you can start chatting immediately (mirrors the embedding-model bootstrap; both share one flow)
- [x] **Background indexing with progress** — a large attachment starts embedding in the background the moment you attach it, with an "indexing %" badge on the attachment, so the first message no longer waits on the (~90 s for a 2 MB manuscript) build; if you send before it's ready, that send still reuses the same in-flight build
- [x] **File browser fenced by default** — the desktop app confines the file browser and attachment reads to your **home folder** out of the box; widen it in **Preferences → File access** (add folders, or allow the whole disk). `MONKII_FS_ROOTS` still overrides, symlink/junction escapes are blocked, and a repo checkout (`npm start`) stays whole-disk unless you set the env var
- [x] **Update check off by default** — the daily Ollama-release ping to GitHub is now opt-in (off on a fresh install), so out of the box nothing leaves your machine at all; enable it in **Preferences → Update check** (or `MONKII_UPDATE_CHECK=on`)
- [x] **Untrusted-attachment awareness** — attached files and retrieved passages are wrapped as clearly-marked *untrusted reference data* with an explicit instruction to treat them as content, never commands; content that reads like a prompt injection ("ignore previous instructions", forged `System:`/`Assistant:` turns) is flagged in the prompt's attachment notes
- [x] **Help, About & in-app Preferences everywhere** — Help/FAQ and About dialogs, Preferences in the menu bar (`Ctrl+,`), a scrollable preferences panel, an in-app confirm dialog (no more native `confirm()` focus loss), and a Clear-conversation command that resets a chat's context in place
- [x] **Honest failure messages** — a crashed model runner (usually GPU out-of-memory from a too-high context length) now explains itself and says which knob to turn, instead of surfacing raw socket errors; a context-length warning in Model settings flags VRAM-hungry values before they bite
- [x] **Optional remote models via OpenRouter** — an opt-in second backend for machines that can't carry the model the work needs: add an API key in **Preferences → Remote models**, browse the 300+ model catalog (context + $/M pricing), ★ favorites into the picker, and choose them per chat. Local by default and honest about the exception: a **☁ remote** badge marks every chat whose text leaves the machine, retrieval embeddings stay on-device, the key is stored OS-encrypted and never reaches the UI, and with no key configured the app makes zero remote calls — verified by audit
- [x] **↻ Retry** — re-run the last prompt from a button on the conversation's final reply; works after errors and Stop, and respects a model switch so you can compare takes across models (first slice of edit·regenerate·branch)
- [x] **Seven theme presets** — dark: Cyber Deco, Speakeasy Noir, Gothic Library, Midnight; light: Parchment, Daylight, Porcelain. Applied pre-paint (no flash), persisted, WCAG-AA contrast-checked, and the entire chrome (glows, scrollbars, chips, scrims) derives from theme tokens via `color-mix` — no hardcoded accent survives a theme switch (first slice of theming)
- [x] **Adapter test suite** — `npm test` covers the OpenRouter boundary: privacy routing present, option remapping, routing-variant suffixes, cache markers, SSE→NDJSON translation, and hard numeric coercion of provider-supplied usage data
- [x] **Preview & save files** — click a file in the browser to preview it (markdown rendered, binary refused, size-capped); right-click any message → **Save as file…** writes the real markdown source to disk (not a flattened copy — headings/code/links survive) via a folder-pick + in-app filename dialog, never silently overwriting. Fenced by the same `MONKII_FS_ROOTS` allowlist as everything else
- [x] **Multi-file attach** — the file browser's attach flow now lets you toggle-select any number of files and folders, even across different folders as you navigate, and attach them all in one action (one project/chat write for the whole batch, not one per file); a summary reports what was added vs. already-attached vs. failed instead of one path aborting the rest
- [x] **Search across chats & projects** — ⌕ Search in the rail (or Ctrl+K) searches every project name, chat title, and message at once against a local endpoint (no index to maintain at this scale); results are grouped with a match-centered snippet, and clicking one opens the right project and chat and scrolls straight to (and briefly flashes) the exact message
- [x] **Edit & resend** — right-click any of your own past messages → Edit & resend… turns it into an inline textarea; saving discards that message and everything after it (its own reply is expected) and resends the edited text, asking first only when more than that would be lost
- [x] **Copy / save a conversation as Markdown** — right-click a chat for Copy as Markdown (clipboard) or Save as file… (the same folder-pick + filename flow as a per-message save); it's the real stored source, not a flattened render
- [x] **macOS build** — native `.dmg`/`.zip` for both Intel (x64) and Apple Silicon (arm64), built in one `npm run dist` run via electron-builder's cross-packaging; unsigned for now (Gatekeeper needs a right-click → Open on first launch), per-user data lives under `~/Library/Application Support/Monkii`. Linux is still on the list
- [x] **Compact the embedding index** — vectors are now stored as raw binary Float32 in a sibling `.bin` file instead of JSON-encoded decimal text, cutting a typical index by roughly 75–90% (measured, not estimated) with no change to what's indexed or how retrieval scores; a pre-upgrade index just misses the cache once and rebuilds in the new format
- [x] **Backup & wipe controls** — **Preferences → Data & backup**: one-click backup zips your projects & chats to a folder you choose (cached embeddings are excluded — they rebuild automatically), and "Erase everything" clears every project, chat, and cached embedding in place, gated behind typing the exact confirmation phrase so it can't happen by a stray click. A live readout above the buttons shows the project count and data-folder path; the desktop app adds an "Open data folder" shortcut

## More local

*Install it, and it works and stays entirely on your machine — no separate installs, no calls out, no dependency you didn't choose.*

- [ ] **Self-contained Ollama** — run (and ideally ship) the Ollama runtime so Monkii works without a separate Ollama install. It already auto-starts Ollama when it's installed (via the desktop app when present, else a hidden `ollama serve`); the gap is when it isn't installed at all. Tradeoff from investigation: the `ollama` binary is only ~34 MB, but the GPU runtimes (CUDA/ROCm) are ~2.8 GB, so full bundling would balloon the installer — likely path is to ship the small binary + CPU backend and fetch the GPU runtime on first run, with models still stored separately

## More secure

*The base is already strong — loopback-only, Host/Origin checks, CSP, a sandboxed renderer, path confinement. These push from "safe by design" to "safe by default, and defensible to hand to someone else."*

- [ ] **Encryption at rest** — chats, projects, and the retrieval indexes (which hold chunked attachment text) are plaintext JSON (great for inspection, less so on an unencrypted disk). Add an optional encrypted data folder, or surface a clear "enable device encryption" note in Preferences
- [ ] **CA-signed certificate** — the installer is signed but self-signed, so other machines still see "unknown publisher." A CA cert (e.g. Azure Trusted Signing) removes the SmartScreen warning for anyone you share it with
- [ ] **Auto-update** for the desktop app (`electron-updater`) — with pinned signature verification when it lands

## More yours

*Control, portability, and a look that's yours — so it feels like a tool you own, not one you rent.*

- [ ] **Theming** — built-in palette presets (Cyber Deco, Speakeasy Noir, Gothic Library, Midnight), a light/dark/system toggle, a custom-color editor with live preview and contrast check, font choices (bundled + system-installed), background options (solid / gradient / local image), and density & text-size controls. All rendered offline; themes persist per-user and never phone home. The UI already runs on CSS variables, so it's within reach
- [ ] **Export & import projects** — move a project (skills, knowledge refs, settings, chats) as one portable file: backups, and carrying your work between machines
- [ ] **Branch messages** — fork an alternate take from any point in a conversation without losing the original (edit-and-resend and copy/save-as-Markdown are already shipped, see the roadmap's Next-up section)
- [ ] **Prompt & snippet library** — save reusable prompts and system-prompt templates you can drop into any chat or project
- [ ] **Organize — pin, tag, folder** — pin the chats that matter, tag or group projects; a flat list stops scaling once the work piles up
- [ ] **Per-chat option overrides** on top of the project defaults
- [ ] **Completion notifications** — a desktop toast (and optional sound) when a generation finishes while Monkii is in the background, so you can start a long response and step away
- [ ] **Save & share themes** — export a theme as a small file and import someone else's (local-first, no gallery required)

## Exploring

*Bigger or less-certain bets.*

- [ ] **Image input** for multimodal models (llava, etc.)
- [ ] **Voice** in and out, entirely on-device
- [ ] **A skill "shelf"** for browsing and one-click installing shared `.skill` packs
- [ ] **Linux build**
