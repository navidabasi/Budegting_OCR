# ADR 0001: Online-first storage with an IndexedDB mirror and an offline outbox

Status: accepted (decision D10 in `docs/IMPROVEMENT_PLAN.md`)
Date: 2026-11-10

## Context

The app stored data twice: a local PGlite database (Postgres compiled to WASM, ~12 MB of wasm/data in
the service-worker precache) and Supabase, kept in step by ~1,900 lines in `src/services/electricStorage.js`
(per-row `_synced` flags, bidirectional "push everything unsynced, pull everything", ad-hoc fallbacks
when PGlite failed to start). The mixed truth made every new table expensive (Phase 2-4 add accounts,
budgets, goals, rules, images), made bugs hard to reason about, and made first load heavy on mobile.

## Decision

* **Supabase is the source of truth.** The client keeps a **Dexie (IndexedDB) mirror** of the user's rows so
  every screen opens instantly and offline.
* **Reads** always come from the mirror (TanStack Query queries under the `['data', ...]` key prefix).
* **Writes** are applied to the mirror optimistically and appended to an **outbox** table in the same
  IndexedDB transaction. When online the outbox is flushed immediately; otherwise on `online`, window
  focus, tab visibility and every 5 minutes.
* **Pull** fetches rows with `updated_at >= cursor` per table (cursor stored per user and table in `meta`)
  and upserts them into the mirror. Deletions made on other devices are detected by comparing the id list
  (`reconcile`, at most every 10 minutes or on a manual resync).
* **Conflict rule: server `updated_at` wins unless the outbox entry is newer.**
  * On flush, an update/upsert whose server row has a newer `updated_at` than the entry timestamp is
    discarded (an update for a row deleted on the server is discarded too).
  * On pull, a server row never overwrites a mirror row while a newer outbox entry exists for it; an older
    entry is discarded and the server row wins.
* **FIFO with retry.** Entries are sent in order. A transient failure (offline, 5xx, 429, timeout) stops
  the flush and the entry is retried later. A permanent failure (validation, RLS, constraint) parks the
  entry as `failed` so it does not block the queue. Consecutive writes to the same pending record are
  coalesced. Inserts are idempotent (upsert on primary key).
* **Optional tables.** Tables introduced by the v13 migration (accounts, budgets, goals, rules) are skipped
  by pull and keep their queued writes until the table exists remotely; `user_layouts` (older deployments
  may lack it) degrades to local-only.
* If IndexedDB itself is unavailable (private browsing, blocked storage) the repository talks to Supabase
  directly so the app still works online, and the "cache unavailable" banner is shown.

## Module layout (`src/data/`)

| File | Responsibility |
|---|---|
| `db.js` | Dexie schema: `transactions, groups, categories, settings, layouts, accounts, budgets, goals, rules, outbox, images, meta` |
| `api.js` | Thin Supabase CRUD per table and the camelCase <-> snake_case mappers (single field list per table) |
| `sync.js` | Outbox (`enqueue`, `flushOutbox`), `pullAll`, `syncNow`, `clearAndResync`, `startSync` triggers, observable sync state |
| `repo.js` | Local-first reads and writes (mirror + outbox), business helpers (mark as done, demo data, group delete) |
| `hooks.js` | React hooks on TanStack Query: `useTransactions(month)`, `useAccounts()`, `useBudgets(month)`, `useGoals()`, `useRules()`, mutation hooks |
| `queryClient.js` | The shared `QueryClient`; `notifyDataChanged()` replaces the old `window` `refresh*` events |

The Dexie database is named `wmw-data-v1`. It is a new database; the old PGlite database
(`receipts-electric-v2`) is not migrated because Supabase already holds the data and the first sync pulls it.

## Consequences

* The 12 MB PGlite wasm/data download and the matching precache settings go away.
* Adding a field to a synced table is a mechanical checklist (plan section 8).
* Device clocks matter for the conflict rule: entry timestamps come from the device, `updated_at` from the
  server. A device whose clock is far behind can see its edits discarded as "older"; acceptable for a
  single-user app, revisit if it shows up (e.g. compare against the `updated_at` last seen for the row).
* Data written only to PGlite and never synced (the old "unsynced" state) is not carried over.
* Hard deletes on the server are only noticed through the id reconciliation, not through `updated_at`.
