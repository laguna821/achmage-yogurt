# Detailed transcript record in Yogurt

The existing Summary / Write again action now runs the subscription client through three passes: a bounded evidence index, a full detailed draft, and an independent check against the original timed transcript. The index is a navigation aid; both later passes receive the complete original. Only the checked pass is displayed and saved. A failed pass or context overflow retains the previous saved summary. A detected output cutoff retains the exact partial text in memory and allows at most two continuations, each with the complete original task/source and exact prefix. The complete visible stream is reconciled with the CLI result, which may contain only its last text block. Ambiguous mismatches and missing overview sections are rejected. Only a normally completed and structurally valid record replaces the saved summary; failed or exhausted continuations preserve it. Original recordings, transcript turns and typed notes are not rewritten. Claude uses explicit medium effort and separate 16K analysis / 24K record budgets; short title requests retain at least 4K total output room so reasoning cannot consume a tiny answer budget.

The default is a personal detailed record. The model distinguishes meetings, lectures, seminars and interviews; retains reasoning, examples, objections, quantities and qualifications; distinguishes proposals from decisions; and records consequential uncertainties. Audio channels and invitations do not establish speaker identity. Existing fuzzy spelling replacements are bypassed for this workflow. Complete source is used again at review rather than compact intermediate summaries.

Source: user-authorized adaptation of `Achmage_OS/20_Master-Skills/achmage-transcript`, version 0.3.0. Pinned SHA-256:

| Source | SHA-256 |
| --- | --- |
| SKILL.md | fe72b3524969cfd79bf14ea162e8d42e494e1f76b50f2939eb5aee8fa31fe5b3 |
| references/writing.md | 5c20dc634312e6d309de235da0f069e57389fe1198e1955881449cd64884b9e2 |
| references/format.md | e4191e81bd71fb3f733a24670ed1e85ba2e964f4bcd50bda06a6a28b2f315d05 |
| references/speakers.md | 4e6759eb2482146f4cad4653708ba81dc0a01c7b630bca518d8654b2449f9f86 |
| references/corrections.md | 1c4c104535391d77d9303d98cb51b1399af6dcbdb51cbc79bf311e6fe26ac0da |
| references/diagrams.md | 135ef60fec1f8e41aeb516a341a3c0e4d3f86a1b8285bff168cb53ba9bd34dc2 |

This pins the app's adaptation; future vault edits do not silently execute code or change app behavior. The original skill is not modified. The app receives only the current transcript, typed notes, attendee metadata and preferred spellings. It has no vault/mail/web tools, and cannot claim those checks happened. Unresolved names and facts remain flagged. This is not the skill host's full nine-step workflow or an approved official minutes document.

The rich editor preserves ending prose, editable GFM tables, H4 headings and Mermaid source through save/export. Mermaid 12.3.0 is bundled locally, lazy loaded, runs in strict mode, allows a small set of diagram types and rejects actions, external URLs, directives and styling. SVG is a view; Markdown source remains authoritative and editable. No remote diagram service or extra model provider is introduced.

## Validation

Scoped tests cover the three-pass source/review contract, evidence at the end, context overflow, prose/fence preservation, table/diagram round trips, output budgeting and incomplete-output rejection. Existing notes tests cover persistence, cancelled/failed rewrites and user edits. Run typecheck and `electron-vite build`, package with `app/scripts/package-subscription.mjs`, then verify real tables/diagrams/save behavior in an isolated native profile before changing the normal launcher. Compare a saved real meeting through the actual Write again menu, verify against original turns, and compare recording/transcript hashes. Keep private QA data and the live SQLite backup outside Git.
