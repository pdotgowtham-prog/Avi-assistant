# AVI Phase 4D — Memory Quality and User Control

## Goal
Improve memory quality without silently changing saved facts. Preserve the existing account model, revision-checked operation queue, history table, and single Supabase project.

## Delivery slices

### 4D-A — Conservative near-duplicate detection (in progress)
- Add deterministic text similarity checks for likely paraphrases.
- Treat matches as review candidates only.
- Never automatically merge, overwrite, or delete a memory.
- Test paraphrases, unrelated facts, short text, and invalid input.

### 4D-B — Conflict-aware fact updates
- Identify candidate conflicts separately from duplicates.
- Require strong evidence that two statements describe the same subject and attribute.
- Preserve both versions and history until the user confirms which is current.
- Do not infer that a newer statement supersedes an older one merely because it is newer.
- Keep automatic extraction best-effort; conflicts must never block chat replies.

### 4D-C — Memory review controls
- Surface potential duplicates and conflicts in the memory manager.
- Provide explicit actions: keep both, edit, replace after confirmation, or dismiss.
- Route mutations through the existing revision-checked avi_apply_memory_operation RPC and offline queue.
- Keep UI text escaped through DOM text APIs.

### 4D-D — Sync and recovery hardening
- Test simultaneous edits from two devices, offline create/update/delete, stale revisions, account switching, retries, and duplicate operation IDs.
- Preserve pending operations until acknowledged; never let cached rows write themselves to the cloud.
- Add diagnostics that do not expose memory text or account identifiers.

## Safety and invariants
- User ID always comes from the authenticated session or auth.uid().
- No service-role key in the browser.
- RLS remains enabled; no broad anon access.
- No destructive data migration, bulk merge, or history backfill.
- Existing memories, IDs, revisions, tombstones, conversations, and operation records remain intact.
- Similarity scores are advisory, not proof of equivalence.
- Phase 4C sensitive-data exclusions remain in force.

## Deployment gates
1. Regression checks pass.
2. Review the complete diff and generated SQL before applying migrations.
3. Apply additive, reversible database changes only when required.
4. Deploy Edge Function only after tests pass.
5. Verify GitHub Pages workflow and Supabase function version independently.
6. User acceptance test on laptop and mobile with the same account.

## Current scope boundary
Phase 4D-A adds a deterministic near-duplicate candidate detector and tests. It does not alter existing memories or production database rows. Conflict-aware replacement and UI wiring are separate slices to avoid silent data loss.