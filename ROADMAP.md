# 🐒 Monkii — Roadmap

The guiding rule for everything here: **it stays local.** Nothing on this list should ever require an account, a cloud service, or sending your data off the machine. Ideas are grouped by the promise they serve — keeping Monkii **local, secure, and yours**.

Have an idea? Open an issue — local-first, private-by-default proposals move to the top.

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

## More local

*Install it, and it works and stays entirely on your machine — no separate installs, no calls out, no dependency you didn't choose.*

- [ ] **Version check off by default** — the daily Ollama-release ping to GitHub is the *only* thing that leaves the machine (it sends no data). Make it opt-in so "nothing leaves" is literally true on a fresh install
- [ ] **Self-contained Ollama** — run (and ideally ship) the Ollama runtime so Monkii works without a separate Ollama install. It already auto-starts Ollama when it's installed (via the desktop app when present, else a hidden `ollama serve`); the gap is when it isn't installed at all. Tradeoff from investigation: the `ollama` binary is only ~34 MB, but the GPU runtimes (CUDA/ROCm) are ~2.8 GB, so full bundling would balloon the installer — likely path is to ship the small binary + CPU backend and fetch the GPU runtime on first run, with models still stored separately
- [ ] **First-run chat-model bootstrap** — offer a one-click pull of a small default *chat* model so a clean install can start chatting immediately instead of showing "no models" (the embedding model is already offered automatically — see Shipped)

## More secure

*The base is already strong — loopback-only, Host/Origin checks, CSP, a sandboxed renderer, path confinement. These push from "safe by design" to "safe by default, and defensible to hand to someone else."*

- [ ] **Fence the file browser by default** — the `MONKII_FS_ROOTS` allowlist exists but is opt-in, so browsing and attachments can currently reach the whole disk. Default it to your user profile with a one-click widen
- [ ] **Encryption at rest** — chats and projects are plaintext JSON (great for inspection, less so on an unencrypted disk). Add an optional encrypted data folder, or surface a clear "enable device encryption" note in Preferences
- [ ] **CA-signed certificate** — the installer is signed but self-signed, so other machines still see "unknown publisher." A CA cert (e.g. Azure Trusted Signing) removes the SmartScreen warning for anyone you share it with
- [ ] **Untrusted-attachment awareness** — attached files and imported skills feed straight into the prompt, so a hostile document could steer the model. Wrap attachment content as clearly-marked untrusted data and flag skills/files that read like instructions
- [ ] **Backup & wipe controls** — one-click "export a backup" (zip the data dir), a clear "erase everything," and a visible data-location shortcut. Ownership includes being able to take it and to leave cleanly
- [ ] **Auto-update** for the desktop app (`electron-updater`) — with pinned signature verification when it lands

## More yours

*Control, portability, and a look that's yours — so it feels like a tool you own, not one you rent.*

- [ ] **Theming** — built-in palette presets (Cyber Deco, Speakeasy Noir, Gothic Library, Midnight), a light/dark/system toggle, a custom-color editor with live preview and contrast check, font choices (bundled + system-installed), background options (solid / gradient / local image), and density & text-size controls. All rendered offline; themes persist per-user and never phone home. The UI already runs on CSS variables, so it's within reach
- [ ] **Export & import projects** — move a project (skills, knowledge refs, settings, chats) as one portable file: backups, and carrying your work between machines
- [ ] **Edit · regenerate · branch messages**, and copy a whole conversation as Markdown
- [ ] **Search** across chats and projects — the lists are flat and unsearchable today
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
- [ ] **macOS & Linux builds**
