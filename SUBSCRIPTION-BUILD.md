# Local subscription edition

Based on upstream v0.3.38, commit cdfe31657202d9635f9bcf1e5b58e4b985ac79af.

- Whisper large-v3-turbo still transcribes locally.
- Organizing and Q&A use the official signed-in Claude Code or Codex CLI. The context-first organizer uses the pinned Achmage Transcript host workflow described in ACHMAGE-TRANSCRIPT.md.
- Yogurt uses a pinned official Codex 0.171.0 CLI under `~/.local/opt/yogurt/tools/codex-0.171.0` when installed; this supports GPT 6.2 catalogs while leaving other apps’ older CLI installations untouched. Install with `npm install --prefix ~/.local/opt/yogurt/tools/codex-0.171.0 --ignore-scripts --no-audit --no-fund @openai/codex@0.171.0`. Official clients keep using the existing login.
- Default: `gpt-6.2-sol` with `xhigh`. Settings select the provider/model/reasoning effort without a model call; the explicit connection test is separate. Claude remains an optional provider, never a fallback.
- No copying of subscription tokens, hidden provider fallback, local Gemma, embedding download or GPU notes worker. Optional Gmail uses its own registered Desktop OAuth client and read-only login; credentials stay local.
- Claude runs with safe mode, no tools/MCP/session persistence. Codex ignores user configuration and uses ChatGPT login, read-only mode, disabled shell/apps/plugins/multi-agent and ephemeral output.
- The settings panel discloses transcript transmission and subscription usage. Lexical meeting search remains available.
- Upstream automatic binary updates are disabled because they would overwrite the subscription edition.

## Rebuild

Install the pinned workspace dependencies with pnpm 10.7.0 and `--frozen-lockfile --ignore-scripts`. Run `pnpm --filter @yogurt/app exec electron-vite build`. Reuse the verified upstream AppImage's extracted AppDir, preserving its Electron, audio recorder, whisper/Vulkan and VAD helpers; do not rebuild native helpers.

Run `node app/scripts/package-subscription.mjs /absolute/upstream-AppDir /absolute/new-output-AppDir`. The output must not already exist. The script packs the built main/preload/renderer with the shipped runtime dependencies, removes unused llama native packages, and marks the version `0.3.38-achmage.6`.

Keep credentials and live meeting databases outside this repository. `YOGURT_USER_DATA` supports isolated QA profiles. On Linux use a short profile path for the UNIX MCP socket (under 108 bytes).

Before deployment, run the subscription/setup/notes tests, typecheck, inspect the actual settings UI, and verify a real saved summary. Keep the official AppImage for rollback. Delete downloaded Gemma/embedding weights only after replacement success; the settings cleanup only targets their exact filenames.
