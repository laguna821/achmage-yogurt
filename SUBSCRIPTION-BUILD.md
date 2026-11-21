# Local subscription edition

Based on upstream v0.3.38, commit cdfe31657202d9635f9bcf1e5b58e4b985ac79af.

- Whisper large-v3-turbo still transcribes locally.
- Summary and Q&A use the official signed-in Claude Code or Codex CLI. Summary / Write again uses the pinned Achmage Transcript detailed record adaptation described in ACHMAGE-TRANSCRIPT.md.
- Default: `claude-sonnet-5-5`. Optional: `gpt-6.2-sol`, only after its connection test succeeds for the account.
- No OAuth token copying, API key setup, hidden provider fallback, local Gemma, embedding download or GPU notes worker.
- Claude runs with safe mode, no tools/MCP/session persistence. Codex ignores user configuration and uses ChatGPT login, read-only mode, disabled shell/apps/plugins/multi-agent and ephemeral output.
- The settings panel discloses transcript transmission and subscription usage. Lexical meeting search remains available.
- Upstream automatic binary updates are disabled because they would overwrite the subscription edition.

## Rebuild

Install the pinned workspace dependencies with pnpm 10.7.0 and `--frozen-lockfile --ignore-scripts`. Run `pnpm --filter @yogurt/app exec electron-vite build`. Reuse the verified upstream AppImage's extracted AppDir, preserving its Electron, audio recorder, whisper/Vulkan and VAD helpers; do not rebuild native helpers.

Run `node app/scripts/package-subscription.mjs /absolute/upstream-AppDir /absolute/new-output-AppDir`. The output must not already exist. The script packs the built main/preload/renderer with the shipped runtime dependencies, removes unused llama native packages, and marks the version `0.3.38-achmage.4`.

Keep credentials and live meeting databases outside this repository. `YOGURT_USER_DATA` supports isolated QA profiles. On Linux use a short profile path for the UNIX MCP socket (under 108 bytes).

Before deployment, run the subscription/setup/notes tests, typecheck, inspect the actual settings UI, and verify a real saved summary. Keep the official AppImage for rollback. Delete downloaded Gemma/embedding weights only after replacement success; the settings cleanup only targets their exact filenames.
