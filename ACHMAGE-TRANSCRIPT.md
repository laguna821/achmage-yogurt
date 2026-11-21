# Context-first transcript organizer in Yogurt

Clicking the organizing action opens a preparation window before any model call. Choose a meeting, lecture, own teaching, seminar, colloquium, interview, conversation or automatic classification, then a detailed personal record or distribution minutes. Add freeform notes, speaker clues, links, multiple files, screenshots/clipboard images or selected Gmail messages. Preparation can be saved without running the model.

The host snapshots the complete original and user materials, extracts text/images, creates an issue ledger, and reads related Achmage/Obsidian sources. Links to original handouts are followed through bounded searches. It matches speakers, terms and dates with actual source receipts, then checks remaining issues in connected read-only Gmail and public entity searches. Search excerpts and AI-generated earlier records are fallible evidence. Each receipt has an ID, locator and source revision when available. The model receives data through text-only official subscription clients; it cannot run tools or choose side effects. The host permits only bounded read operations. Private transcript text is not sent to a public search engine.

The pinned owner-authored Python prepare/apply/lint/facts helpers actually run. Confirmed speaker identities require two clue categories, and one room microphone is never globally assigned to a person. Exact confirmed nonnumeric term corrections affect only the derived work copy. Numeric/date conflicts are resolved in the record with their sources and in-session changes preserved. Raw audio, transcript rows and typed notes are not rewritten. Full-source drafting and review retain reasoning, examples, objections and qualifications. A failed pass or incomplete output retains the prior saved record; bounded continuations preserve the complete original task and exact output prefix.

A usable draft is saved before a single batch of up to eight material questions is shown. Defaults retain uncertainty. Explicit answers become durable evidence, are applied throughout a fresh complete draft, and pass the same checks. The expandable ledger shows actual connections, speaker scope/confidence, corrections, source excerpts and checks. Local per-run work folders contain original snapshots, source receipts, mappings, checks and record; prior completed records are backed up. An interrupted run can be retried without deleting the previous record.

Source: user-authorized adaptation of `Achmage_OS/20_Master-Skills/achmage-transcript`, version 0.3.0. Pinned SHA-256:

| Source | SHA-256 |
| --- | --- |
| SKILL.md | fe72b3524969cfd79bf14ea162e8d42e494e1f76b50f2939eb5aee8fa31fe5b3 |
| references/writing.md | 5c20dc634312e6d309de235da0f069e57389fe1198e1955881449cd64884b9e2 |
| references/format.md | e4191e81bd71fb3f733a24670ed1e85ba2e964f4bcd50bda06a6a28b2f315d05 |
| references/speakers.md | 4e6759eb2482146f4cad4653708ba81dc0a01c7b630bca518d8654b2449f9f86 |
| references/corrections.md | 1c4c104535391d77d9303d98cb51b1399af6dcbdb51cbc79bf311e6fe26ac0da |
| references/diagrams.md | 135ef60fec1f8e41aeb516a341a3c0e4d3f86a1b8285bff168cb53ba9bd34dc2 |

The selected skill and its references/scripts are bundled and pinned in app/resources/achmage-transcript/manifest.json. Future vault edits do not silently execute code or change the app. The original skill remains untouched and is not globally activated.

AI settings separate provider/subscription, model and reasoning effort from General and Source Connections. The default is GPT 6.2 Sol with xhigh. Saving only checks the selected CLI login and persists the selection; a separate explicit connection-test button consumes one short model call. There is no hidden Sonnet fallback. Actual model access and quota follow the signed-in subscription. Official CLI authorization is reused without copying its tokens.

Gmail settings implement a native Desktop OAuth PKCE/loopback flow using only gmail.readonly. Import a Google Desktop OAuth client JSON and complete Google login on this computer. Google requires a registered client, enabled Gmail API and any consent/test-user configuration. Tokens stay in this computer's profile, use Electron safe storage when available, and local files are restricted. Another computer's Aside browser connection does not connect this app. Until configured, mail is explicitly skipped, never claimed as verified. EML files and pasted email text also work without a Gmail connection.

The editor preserves complete prose, editable GFM tables, headings and Mermaid source through save/export. Mermaid is bundled locally, strict, and disallows external actions/resources. The skill's lint and numeric candidate checks are not a proof of factual accuracy. Diagram rendering is verified in the native UI; the per-run ledger does not claim an unperformed visual check.

## Validation

Run scoped organizer, Gmail, subscription, notes, transcript-record, markdown, setup and localization tests, TypeScript and electron-vite build. Mocked tests exercise PKCE/state/read-only mail calls, full pinned Python execution, no automatic model call after recording, durable answers, invalid citations and output cutoffs. A separate opt-in test reads real vault evidence without an LLM. Use an isolated native profile for settings/preparation QA, then test a real saved meeting through the actual organizing button with the selected model. Compare original transcript/audio hashes and typed notes, reload the record and restart the normal app. Private QA data and live SQLite backups stay outside Git.
