# Improvement pass 2: inspection map

Written 2026-11-11 against `main` @ 81342f3 (branch `claude/upbeat-darwin-zqt7sd`), before any pass 2 change.
Spec: `docs/IMPROVEMENT_PASS_2.md`. Part 1 covers sections 1, 2 (save semantics), 3, 4, 5 and 8. Part 2 covers 6, 7, 9, 10, 11 and
the AI parts of 3 and 5. Nothing below was inferred from the design boards; every "works" entry was read in the code.

Legend: **Works** = present and verified by reading/tests. **Incomplete** = present but short of the brief. **Part 1** = this
pass. **Part 2** = left for the next session.

---

## 1. Inspect and improve the existing app

* **Works**: Dexie mirror + outbox + Supabase pull (`src/data/{db,sync,repo,api,hooks}.js`, ADR 0001); camelCase/snake_case mappers with
  optional (v13) columns (`api.js`); 618 tests; additive-only migrations (`supabase/migrations/`); old receipts without items are valid
  (`lineItems: []`); category rename v14 handled read-side (`normalizeCategoryName`).
* **Incomplete**: no backup/restore of local data (only CSV export, `src/utils/exportCsv.js`); payday and other unspecified preferences
  have no settings (only `savingsTarget` lives in `user_layouts.layout.prefs`, `src/hooks/useUserPrefs.js`).
* **Part 1**: JSON backup/restore (all user tables + optional images), new preference keys in `layout.prefs` (payCycle, people) so no
  schema change is needed.
* **Part 2**: nothing specific.

## 2. Fast capture

* **Works**: Quick Add sheet with keypad, amount first, merchant, category ranking, date chips, account chips, More section
  (`src/components/quickadd/QuickAddSheet.jsx`, `MoreSection.jsx`); scan flow with camera/gallery/PDF/share target
  (`src/pages/ScanPage.jsx`, `src/services/receiptScan.js`, `sharedFiles.js`); Undo toast after save; a `saving` flag blocks double taps in
  React state; offline scans become a placeholder transaction + queued photo (`src/services/pendingScans.js`); CSV import dedupe matches
  bank rows to existing transactions (`src/import/dedupe.js`); client-generated UUIDs for every new record.
* **Incomplete**:
  * "Saved" toast is shown after the Dexie transaction commits (good) but the scan photo is only held in memory until Save. If the app is
    closed or updated while the photo is being read, it is lost. The photo is not persisted before extraction.
  * Quick Add draft state is React state only: dismissing the sheet, closing the app or an SW update (`skipWaiting`, autoUpdate) loses it.
    The Scan review form has the same weakness. No "Resume draft".
  * `saving` is a state value: two taps in the same frame can both pass the guard. Needs a synchronous ref.
  * Matching a scan to an existing manual transaction (and vice versa) exists only for CSV imports, not for scans.
  * Date/account/currency reachability on narrow phones is already chip rows with horizontal scroll; currency lives in More.
* **Part 1**: drafts (IndexedDB), synchronous duplicate-submit guard, photo persisted before extraction, manual total while extraction is
  pending (see §8), scan-to-manual match (`src/utils/scanMatch.js`, needed for §12 case 2: the scan review offers "Attach to existing"
  when an unscanned manual transaction has the same amount within a day; the photo and items are attached, nothing is duplicated).
  **Part 2**: keyboard-obscuring fixes and layout polish (§10).

## 3. Receipt items

* **Works**: `lineItems` jsonb (`{ name, quantity, price, category }`) on `receipts`; extraction returns items
  (`api/_lib/receiptSchema.js`, `api/_prompts/extract-receipt.md`); Scan review edits items (`src/components/scan/ReviewScreen.jsx`);
  Detail lists items with unreadable lines flagged (`ReceiptDetail.jsx`, `isUnreadable`); item categories survive `normalizeTransaction`.
  Historical receipts mostly have no items.
* **Incomplete**: no rawText, subcategory, unit, unitPrice, discount, review status or per-field edit provenance; no normaliser/versioned
  shape; no grocery subcategories; Quick Add edit mode flattens item categories to the receipt category (known follow-up);
  no reconciliation (total vs items vs discounts), no unallocated amount; no item analysis (merchant ranking, subcategory, coverage,
  recurring products, unit prices, period comparison); no "Spending breakdown" screen; correction scope is always the receipt;
  `categoryLearning` only touches the transaction, merchant rules are not item-scoped.
* **Part 1**: versioned item shape + normaliser (`src/utils/receiptItems.js`), subcategories in `categoryNames.js`, extraction
  prompt/schema, item review list (Detail + Scan review), per-item correction scope with explicit "also future purchases" rule and bulk
  preview, reconciliation with `unallocated`, `src/utils/itemAnalysis.js` (pure, tested), "Spending breakdown" page with coverage banner and
  drill-through. **Part 2**: AI use of item data and coverage statements (§6), reprocessing from the stored image with review.

## 4. Salary-to-salary cycles

* **Works**: everything is month-keyed and pure: `monthMath.js`, `money.js` (`monthTotals`, `spentByCategory`, `cumulativeSpend`),
  `budgetMath.js`, `savingsMath.js`, `insightsAggregates.js`, `insightsEngine.js`; `useSelectedMonth()` keeps `?m=YYYY-MM` in the URL for
  Home, Plan and Insights; Activity filters by month via `MonthStrip`; budgets rows use `starts_on` (first of month) with copy-forward
  (`useCopyForwardBudgets`).
* **Incomplete**: no payday, timezone or period concept; no "days left" for a cycle; comparisons are calendar month vs previous
  calendar month; budgets are bound to calendar months.
* **Part 1**: `src/utils/payCycle.js`, settings (payday, weekend rule, timezone, per-cycle overrides in `layout.prefs.payCycle`),
  `usePeriod()` replacing `useSelectedMonth` on Home, Activity, Plan (Budgets, Savings), Trips totals and the insights aggregates.
  Money functions accept either a `'YYYY-MM'` string (unchanged behaviour) or a period object. **Part 2**: AI answers state the
  period basis (§6); chart/pace polish (§10/11).

## 5. Shared expenses

* **Works**: `splitData` jsonb in two legacy shapes (`{ method: 'equal', people, yourShare? }` and `{ method: 'custom', users:[{name,amount,percentage}] }`,
  `SplitManager.jsx`); `getEffectiveAmount` (`src/utils/helpers.js`) and `money.shareAmount` give the personal share used for totals;
  accounts can be `debt`/`receivable` with a `counterparty` (`AccountsManager.jsx`, `displayBalance`, `netWorth`); trips carry
  `companions`.
* **Incomplete**: floating-point shares (no exact cents, rounding invisible); no payer concept (paying for others vs others paying for
  me); no people list; no item-level split; no settlements (a repayment would be logged as income); balances use the full amount
  even when others reimburse; no "Shared" view; refunds are not linked to splits.
* **Part 1**: versioned split shape (v2) + reader for old shapes (`src/utils/splits.js`), exact cent reconciliation with visible
  remainder, personal-share vs cash basis, settlements (transfer-type records with `settles`), people list in `layout.prefs.people`,
  "Shared" screen, `getEffectiveAmount` delegating to the new reader. **Part 2**: AI answers for "what I owe", trip share views (§9).

## 6. AI assistant with evidence (Part 2)

* **Works**: `/api/insights`, `/api/chat`, insights engine (`insightsEngine.js`) computing numbers client-side, chat panel with suggested
  questions and previewed actions (`ChatPanel.jsx`).
* **Incomplete / Part 2**: evidence (period, basis, coverage, supporting receipts), undoable bookkeeping actions, staleness labels.
  Part 1 only provides the calculation layer they will use (`itemAnalysis`, `payCycle`, `splits`).

## 7. Outbound data boundary (Part 2)

* **Works**: keys server-side only (`api/_lib/llm.js`), per-user rate limit, DeepSeek via OpenAI-compatible client.
* **Incomplete / Part 2**: pseudonymisation, stripping, outbound inspector, image setting. Part 1 does not send new data to AI.
  The extract-receipt prompt change in item 2 only adds output fields; the request payload is unchanged.

## 8. Offline

* **Works**: app shell precached, SPA navigation fallback, share-target (`src/sw.js`, `vite.config.js` injectManifest; build verified:
  `index.html` in the precache, 86 entries); mirror + outbox survive restarts (IndexedDB); FIFO flush with retry on `online`, focus,
  visibility and a 5-minute interval (`sync.js`); insert is an upsert by client id so a retried insert never duplicates (`api.insert`);
  consecutive writes coalesce; offline scan creates placeholder + queued blob (`pendingScans.js`, `images.js`);
  deleting a never-sent record drops its queued insert; deleting a transaction removes its queued image.
* **Incomplete**:
  * Outbox rows have no stable operation id (only an auto-increment `seq`).
  * `processPendingScans` overwrites merchant, total, date, category and items with the extraction result without checking whether the
    user edited the placeholder in the meantime (violates "extraction never overwrites newer manual corrections").
  * No per-record sync state, no global indicator, no manual "Retry now"; failed outbox entries are parked and invisible
    (`useSyncStatus` only exposes counts); failed image uploads likewise.
  * No `navigator.storage.persist()`, no storage estimate, no honest storage-failure message beyond the "cache unavailable" banner.
  * No JSON backup/restore (browser storage is not a backup).
  * Cancelling a pending scan (delete placeholder) removes the transaction and image but an update coalescing race is untested.
  * Conflict handling: flush drops a stale update silently (`conflict` result only triggers a refresh); no explicit resolution UI.
* **Part 1**: operation ids, userEdited guard, outbox/image cancel on delete, sync states per record (record / image / analysis),
  global indicator + "Retry now", "Needs attention" list (retry/discard), persist() + estimate, backup export/restore, drafts, manual
  total while extraction is pending. Conflict UI beyond "newer server value kept, surfaced in Needs attention" is Part 2.

## 9. Travel currencies and trips (Part 2)

* **Works**: `amountBase`, `baseCurrency`, `exchangeRate` stored at write time (`baseAmount.js`, `repo.baseFor`), pending conversion
  filled after sync (`fillMissingBaseAmounts`), trips with companions and totals (`tripMath.js`, `TripPage.jsx`).
* **Part 1 touches**: trip totals use the period/personal-share helpers. **Part 2**: rate basis display, confirmed vs estimated,
  incomplete-conversion warnings in totals.

## 10. Layouts (Part 2)

* **Works**: phone-first screens following `docs/design`, bottom nav, sheets with safe areas, dark mode, RTL.
* **Incomplete / Part 2**: tablet list/detail and PC table; Settings is a sidebar drawer (`Sidebar.jsx` hosts `SettingsPage`) without a
  route. Part 1 adds new screens (Spending breakdown `/breakdown`, Shared `/shared`) as phone-first pages with the existing shell, and
  places the new settings in the existing Settings drawer.

## 11. Motion (Part 2)

* **Works**: global `prefers-reduced-motion` reset (`src/index.css:57`), sheet/fade keyframes.
* **Part 2**: motion tokens, optional app setting, list insert/delete transitions. Part 1 adds no new animation beyond existing classes.

## 12. Verification cases

Part 1 verifies cases 1-9 and 13 (numbered in the order of the brief's semicolon-separated list) with synthetic data; see the test
names in the final report. Cases 10-12 belong to part 2. Case 7 (foreign currency offline) is verified for "original kept, EUR missing
is detectable" in part 1; the visible warning in totals is part 2 (§9).

---

## Part 1 status (written at the end of part 1)

Implemented and tested: section 8 offline capture (outbox operation ids, idempotent retries, userEdited merge, cancellation, drafts, sync states and Needs attention, storage persist/estimate, JSON backup/restore), section 2 save semantics and scan-to-manual attach, section 3 receipt items (v2 shape, subcategories, reconciliation, item review list, scoped corrections and rules, itemAnalysis, Spending breakdown), section 4 pay cycles (`payCycle.js`, `usePeriod`, settings), section 5 shared expenses (`splits.js`, SplitSheet, Shared page, settlements).

Storage choices (no migration needed, nothing to apply): pay-cycle settings, people list and custom subcategories live in `user_layouts.layout.prefs` (`payCycle`, `people`, `subcategories`); item rules reuse `merchant_rules` (`merchant_key = 'item:<product>'`, `category = 'Category::subcategory'`); settlements reuse `receipts.split_data` (`kind: 'settlement'`); conflict log and sync cursors stay in the local `meta` store. Dexie schema v2 adds `drafts` and `outbox.opId`.

Known limitations / for part 2: no holiday calendar for the weekend rule (use a per-cycle override); unit/plural strings such as "1 lines" are not pluralised; conflict choices exist for updates only (inserts/deletes follow "delete wins, server newer is kept"); trip views and Activity totals do not yet label personal-share vs full amount; foreign-currency totals do not yet warn about missing EUR amounts (case 7 only verifies the data is kept and detectable); the AI endpoints still get calendar-month keys for custom ranges (`aggregates.period` carries the exact dates).
