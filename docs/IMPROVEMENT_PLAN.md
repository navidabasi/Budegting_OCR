# Budgeting OCR — Audit & Improvement Plan

Status: **v2 — decisions taken (see §6). Ready for implementation.**
Design reference (touch-first, 9 screens): https://claude.ai/artifact/EstNe5pd4gpTfuqm74VTMW — the implementer builds Phase 5 screens to match it.
Audience: the implementer (a cheaper AI model or a developer) and the owner.
Written: 2026-11-10, from a full read of the codebase on `main` (commit a9af340).

---

## 0. How to use this document (read first, implementer)

1. Work **one task at a time**, in the order given inside each phase. Tasks are sized S (< 1 h), M (1–3 h), L (half a day+). Do not start a phase before the previous phase's "exit criteria" are green.
2. Every task lists the files it touches and an **acceptance criteria** block. Do not mark a task done until every criterion is verified by running the app or a test.
3. **Do not refactor outside the task's file list.** If you find a problem elsewhere, write it down under "Follow-ups" at the bottom of this file and move on.
4. Follow `CLAUDE.md` and `UI_DESIGN_RULES.md` for UI rules (dark mode on everything, no `confirm()`, 44 px touch targets, mobile first). For new screens, use the `frontend-design` skill if available.
5. Keep commits small: one task = one commit, message prefixed with the task ID (e.g. `P1-T3: add extract-receipt endpoint`).
6. **Never put API keys in the client bundle or in the repo.** Keys live in Vercel environment variables. `VITE_*` variables are public.
7. New serverless endpoints are **Node (`api/*.js`)**, not Python. The Python OCR function is to be retired (Phase 1).
8. Any text visible to the user goes through `useTranslation()` and must be added to `src/languages/en.js` **and** every other language file (`it`, `de`, `es`, `fr`, `fa`, `ar`). Machine-translate the non-English ones; keep keys identical.
9. Storage becomes **online-first with an offline outbox** in Phase 1 (decision D10). Until Phase 1 is done, do not add columns to the PGlite layer; after it, the §8 checklist applies.

---

## 1. Executive summary of the audit

The app has a lot of features but the core loop (scan → correct → categorize → see where money goes → act) is weak at every step:

| Area | What is wrong today | Root cause |
|---|---|---|
| OCR | Wrong merchant, wrong total, garbage line items, slow (up to 3 OCR calls per image) | OCR.Space returns plain text; ~1,700 lines of regex heuristics in `api/ocr.py` try to parse it. Regex cannot handle receipt variety. The image is discarded after scanning. |
| Auto-category | Almost always "Other" | `MERCHANT_CATEGORY_MAP` is a list of US chains (Walmart, Kroger…) while the receipts are Italian (Lidl, Conad, Carrefour templates, EUR default). Matching is `includes()` substring, so `bus` matches "busta", `gas` matches "gastronomia", `bp` matches anything. Nothing is learned from the user's corrections. |
| Savings | Cannot be tracked | The data model only knows `expense` and `income`. There are no budgets, no savings goals, no "transfer to savings" type, no monthly savings rate. "Net balance" is all-time income minus all-time expenses. |
| Insights | None | All dashboard widgets are descriptive charts. No LLM, no rules engine. |
| UX | Too many steps and concepts; key info hidden | Add flow is 3 modals deep ending in a 700-line form. Four overlapping organising concepts (category, group, tag, pin) plus "tracking", "split", "recurring". Dashboard shows all-time totals instead of this month. No date range filter, no sort. |
| Infra | **Production backend is currently paused** | The budgeting data lives in the Supabase project "navidabasi's Project" (`oorwminabbdyfftdbibn`, as `PRODUCTION_SETUP.md` says). It is INACTIVE (free-tier auto-pause). "OCRAPP" is an unrelated project. Sign-in and sync cannot work until it is restored. |
| Quality | No tests, stale docs | `CLAUDE.md` says Dexie; the app uses PGlite (`src/services/electricStorage.js`, 1,900 lines). 12 loose SQL files, no migration tool. PWA icons referenced in `vite.config.js` and `public/manifest.json` do not exist in `public/`, so "install app" is broken and the favicon 404s. |

The plan below fixes these in 6 phases. Phases 1–4 are the ones that change what the app *does*; Phase 5 is the UX overhaul; Phase 0 and 6 are hygiene.

---

## 2. Detailed findings (evidence for the plan)

### 2.1 OCR pipeline (`api/ocr.py`, `api/ocr-proxy.js`, `src/services/ocrApi.js`, `src/components/receipts/ReceiptUpload.jsx`)

- Flow today: client resizes image to ≤ 2200 px / ≤ 4 MB JPEG → POST base64 to `/api/ocr` (Python) → OCR.Space engine 2 (`isTable`, overlay) → `parse_receipt()` → if score < 72 the server **re-runs OCR.Space up to 2 more times with other languages** (each call has a 30 s timeout) → JSON → client `postProcessResult()` re-guesses the category with the US map and overwrites the server's value.
- `match_template()` in `api/ocr.py` picks a YAML template by keyword count. `generic.yml` keywords are `P.IVA` and `TOTALE`, which appear on nearly every Italian receipt, so the generic template often wins with a single loose regex for the total and `(\d{2}[/-]\d{2}[/-]\d{2,4})` for the date (first match wins, so a VAT number fragment or a phone number can become the date).
- `extract_merchant_from_text()` returns the first line that is not in a short ban-list. On Italian receipts the first lines are the legal company name, address, or "DOCUMENTO COMMERCIALE DI VENDITA O PRESTAZIONE"; the brand name is often a logo that OCR does not read.
- `extract_line_items_from_token_stream()` flattens the whole text into tokens and pairs words with the next price-like token. Any price-like token (weight "0,500", VAT "22%", unit price "1,99/kg") produces a fake item. `sanitize_item_name` keeps only the last 9 words of merged chunks.
- Total fallback is "largest number on the receipt", which is wrong whenever `TOTALE` is misread or a card-receipt subtotal/"RESTO" (change) line exists.
- Two endpoints (`/api/ocr` Python, `/api/ocr-proxy` JS) with different parsers; the client silently falls back between them, so results differ between runs.
- The scanned **image is never stored**. The user cannot look at the receipt later to verify a value.
- OCR is gated behind a per-user "premium" OCR.Space key (`AddReceiptModal.jsx`, `ReceiptUpload.jsx`) even though the server supports `OCR_SPACE_API_KEY`. There is no premium plan; the wording confuses users.
- The result is dumped into the full `ReceiptForm` with no confidence indication and no image next to the fields.

### 2.2 Categorization (`src/utils/constants.js`, `src/services/categoryService.js`, `ReceiptForm.jsx`)

- `MERCHANT_CATEGORY_MAP`: 42 US entries. Keyword `water` maps to Utilities, but item keyword `water` maps to Groceries. `phone` maps to Utilities (buying a phone is Shopping). `target`, `shell`, `bp`, `bus`, `gas`, `train` match substrings inside unrelated words.
- `suggestCategory(merchantName, itemName)` concatenates merchant + item, so every line item inherits the merchant's match before the item keywords are considered.
- In `ReceiptForm.jsx` the merchant→category effect runs only when `!initialData`, so after an OCR scan, fixing the merchant never re-suggests a category.
- No per-user learning: the same merchant must be re-categorised forever. Supabase `user_categories` only stores custom category names/colors.
- Default categories (`Groceries, Restaurant, Gas, Utilities, Shopping, Entertainment, Healthcare, Transportation, Education, Other`) lack Rent/Housing, Subscriptions, Insurance, Travel, Personal care, Gifts, Savings, Transfers, Fees. "Gas" is ambiguous (fuel vs. utility).

### 2.3 Savings and budgeting (`SummaryCards.jsx`, `CashFlow.jsx`, `electricStorage.js`)

- `transaction_type` is `expense | income`. A transfer into a savings account must be logged as an expense (inflating spending) or not logged.
- "Net balance" = all-time income − all-time expenses, which is only meaningful if every income ever was logged.
- No `budgets`, no `savings_goals`, no accounts, no monthly savings rate, no "safe to spend".
- Multi-currency totals are converted at render time via a live API (`CurrencyTotalDisplay.jsx`, `exchangeRateService.js`), so numbers flicker and change day to day. The base-currency amount should be stored at write time.

### 2.4 Insights

- Nothing exists. The only "trend" is a 30-day line chart.

### 2.5 UX (pages and components)

- Add flow: FAB → `AddReceiptModal` (3 choices) → `ReceiptUpload` modal → `ReceiptForm` modal. The form contains transaction type, merchant, date, N line items each with category, total, category, currency with live conversion, notes, group picker with inline "new group", tags, split manager, recurring manager, tracking toggle. Manual entry of a coffee takes ~10 taps.
- `ReceiptsPage.jsx` (1,512 lines) mixes the list, filters, group CRUD, group drag-and-drop, delete confirmations. Filters: category, month/year, type, tracking. Missing: date range, sort, amount search, merchant filter from the list itself.
- "Tracking" / "Mark as done" is a hidden feature that really means "planned / unpaid bill". The name does not explain itself.
- Dashboard: KPI cards are all-time totals; the month is chosen separately inside the category chart; widget names in `WidgetRegistry.js` are hard-coded English; "Last 30 days" line chart is dominated by spikes.
- Notifications only fire while the app is open (`notificationService.js` runs on a 5-minute interval in `App.jsx`).
- Settings contains "Load demo data" / "Clear demo data", "Clear & resync", and the "premium" OCR key with three paragraphs of hints.
- `index.html` title "Receipt Manager" vs. manifest "Where my money went?" vs. app copy "Money Tracker". `public/` has no `pwa-192x192.png`, `pwa-512x512.png`, `favicon.ico`, `apple-touch-icon.png`, `mask-icon.svg` although all are referenced. The icon files exist at the repo root (`Wallet--Streamline-Phosphor.png`, `wallet icon.svg`) but are not served.
- Startup: PGlite ships ~12 MB of wasm/data into the precache (`maximumFileSizeToCacheInBytes: 12 MB`), which is heavy on mobile data and the main source of sync complexity.

### 2.6 Code quality / infra

- No test runner, no lint script. `package.json` has only `dev/build/preview`.
- `CLAUDE.md` and `AGENTS.md` describe Dexie + `api/ocr-proxy.js`; reality is PGlite + `api/ocr.py`. The implementer will be misled by them. (Fixed in P0-T1.)
- 12 SQL files at repo root, applied by hand. No record of which were applied.
- `api/__pycache__/*.pyc` committed. `.Rhistory` files committed.
- Settings table still uses column `veryfi_api_key` for the OCR key.

---

## 3. Target architecture (what we are building toward)

```
Client (React PWA, online-first)
  ├─ Quick Add sheet ─────────────────┐
  ├─ Scan → /api/extract-receipt ─────┼──► Vercel Node functions (api/*.js)
  ├─ Review screen (image + fields)   │      ├─ _lib/llm.js        provider-agnostic chat client (OpenAI-compatible)
  ├─ Activity / Home / Budgets / Plan │      ├─ _lib/ocr.js        OCR.Space text fallback
  ├─ Insights + chat (last phase)     │      ├─ _lib/auth.js       Supabase JWT check → userId
  └─ data layer: React Query cache    │      ├─ extract-receipt.js image|pdf|text → structured receipt JSON
       + IndexedDB mirror (read offline)      ├─ categorize.js      merchant batch → categories
       + outbox (writes offline, flushed)     ├─ insights.js        aggregates → narrative + actions
                                              ├─ import-csv.js      Revolut/PostePay rows → transactions (dedupe)
                                              └─ chat.js            (Phase 7) questions over aggregates
                                                       │
                                         DeepSeek / Gemini / OpenRouter / Ollama (env-configured, server keys)
Supabase ("navidabasi's Project")
  ├─ receipts (+ account_id, to_account_id, image_path, amount_base, extraction, merchant_key, goal_id, import_ref)
  ├─ accounts, budgets, savings_goals, merchant_rules, insights_cache, ai_usage      (new)
  ├─ groups → trips (dates, budget, currency, auto-attach)                            (extended)
  └─ Storage bucket "receipts" (private, per-user folder)
```

**Storage principle (D10).** Supabase is the source of truth. The client keeps an IndexedDB mirror (Dexie) of the user's transactions, accounts, budgets, goals and rules so every screen opens offline. Writes go to an **outbox** table in IndexedDB first, are applied optimistically to the mirror, and are flushed to Supabase in order when online (with retry and conflict rule "server `updated_at` wins unless the outbox entry is newer"). Receipt images queue the same way. This replaces the 1,900-line PGlite layer and the 12 MB wasm download.

**LLM provider abstraction.** Every model is reached through the OpenAI-compatible Chat Completions API. Keys are server-side only (you are the only user; reuse the keys from your AI assistant project). Configuration by environment variables:

| Variable | Purpose | Example |
|---|---|---|
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Text model for categorize, insights, chat | `https://api.deepseek.com`, `deepseek-chat` |
| `LLM_VISION_BASE_URL` / `LLM_VISION_API_KEY` / `LLM_VISION_MODEL` | Vision model for receipt images/PDFs | OpenRouter `google/gemini-2.5-flash`, or Gemini's OpenAI-compatible endpoint |
| `OCR_SPACE_API_KEY` | Fallback OCR when no vision model is configured | existing |
| `AI_DAILY_LIMIT_PER_USER` | Per-user daily cap on AI calls (default 100) | |

Note: at the time of writing DeepSeek's hosted API (`deepseek-chat`, `deepseek-reasoner`) is text-only and supports `response_format: {"type":"json_object"}` (the prompt must contain the word "json"). Verify against current DeepSeek docs before coding. A self-hosted model (Ollama/vLLM) exposes the same API shape; only the base URL changes. Because the owner allowed sending receipts to a reliable model, **extraction uses the vision model**; DeepSeek handles the text-only jobs.

**Multi-user readiness (D2).** Single user today, friends later: every table has `user_id` + RLS, every endpoint checks the JWT and rate-limits per user, AI usage is logged per user in `ai_usage` so subscriptions can be added later without redesign. Nothing is shared between users.

---

## 4. Data model (one migration, applied in Phase 0)

Create `supabase/migrations/20261110_v13_accounts_budgets_goals.sql`:

```sql
-- Accounts: where money sits. Savings = a transfer INTO an account of kind savings/investment.
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,                     -- Revolut, PostePay, Cash, Savings account, Investments
  kind text not null,                     -- spending | savings | investment | cash
  currency text not null default 'EUR',
  opening_balance numeric(12,2) default 0,
  opening_date date default current_date,
  color text, icon text,
  is_archived boolean default false,
  sort_order int default 0,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, name)
);

-- receipts: new columns (table name stays; UI calls them "transactions")
alter table receipts
  add column if not exists account_id uuid,            -- money left this account (expense/transfer) or arrived here (income)
  add column if not exists to_account_id uuid,         -- transfers only
  add column if not exists image_path text,
  add column if not exists amount_base numeric(12,2),
  add column if not exists base_currency text,
  add column if not exists exchange_rate numeric(14,6),
  add column if not exists merchant_key text,
  add column if not exists goal_id uuid,               -- transfers only: which goal this contributes to
  add column if not exists import_ref text,            -- 'revolut:<hash of row>' for CSV dedupe
  add column if not exists extraction jsonb;           -- {provider, model, confidence:{merchant,date,total,items}, rawText, durationMs}
-- transaction_type allowed values: expense | income | transfer   (document; add check constraint after backfill)
create index if not exists idx_receipts_user_date on receipts(user_id, date desc);
create index if not exists idx_receipts_merchant_key on receipts(user_id, merchant_key);
create unique index if not exists idx_receipts_import_ref on receipts(user_id, import_ref) where import_ref is not null;

-- Trips (travel sessions). The existing groups table is extended rather than replaced:
-- a trip is a group with kind='trip' and dates. Receipts keep using group_id.
alter table groups
  add column if not exists kind text not null default 'group',      -- group | trip | project
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists budget_amount numeric(12,2),
  add column if not exists currency text,
  add column if not exists is_active boolean default false,          -- manual start/stop; dates are the default
  add column if not exists exclude_from_budgets boolean default true,-- trip spend counts under one "Travel" line, not per category
  add column if not exists companions text[];                        -- names for splits
create index if not exists idx_groups_active on groups(user_id, is_active) where kind = 'trip';

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null,                 -- '*' = whole-month budget
  amount numeric(12,2) not null,
  currency text not null default 'EUR',
  starts_on date not null,                -- first day of the month it applies from
  ends_on date,                           -- null = open ended (copied forward)
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, category, starts_on)
);

create table if not exists savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  target_amount numeric(12,2) not null,
  currency text not null default 'EUR',
  target_date date,
  account_id uuid,                        -- optional: the account that holds this goal's money
  starting_amount numeric(12,2) default 0,
  color text, icon text,
  is_archived boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  merchant_key text not null,
  category text not null,
  display_name text,                      -- "Lidl" for key "lidl"
  source text not null default 'user',    -- user | llm | seed
  hit_count int default 1,
  updated_at timestamptz default now(),
  unique (user_id, merchant_key)
);

create table if not exists insights_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  period text not null,                   -- 'YYYY-MM'
  input_hash text not null,
  payload jsonb not null,
  model text,
  created_at timestamptz default now(),
  unique (user_id, period)
);

create table if not exists ai_usage (
  user_id uuid not null,
  day date not null,
  kind text not null,                     -- extract | categorize | insights | chat
  calls int default 0,
  tokens_in bigint default 0, tokens_out bigint default 0,
  primary key (user_id, day, kind)
);

-- RLS on every new table: select/insert/update/delete where auth.uid() = user_id (same pattern as receipts).
-- updated_at triggers: reuse update_updated_at_column().
-- Storage: bucket 'receipts' (private); policy: authenticated users read/write objects whose first path segment = auth.uid()::text.
-- Backfill: insert a default 'Cash' spending account per existing user; set receipts.account_id to it where null.
```

**Savings semantics (D6).** A transfer from a spending account to a `savings` or `investment` account is "saving". Monthly `saved` = sum of such transfers in the month minus transfers back out. `savings rate` = saved / income (hidden when income is 0). Goal progress = `starting_amount` + transfers with that `goal_id` (or, when `account_id` is set and no goal_id is used, the account balance). Account balance = opening balance + income − expenses − transfers out + transfers in. This removes the need to log savings as fake "income".

**Trip semantics (D15).** Exactly one trip can be *active* at a time: `is_active = true`, or today within `starts_on..ends_on` when no manual flag is set. While active, every new transaction (Quick Add, scan, share-to-app, CSV import rows dated inside the trip) gets `group_id = trip.id` by default; the user can detach it in "More". The category stays normal. Trip total = Σ `amount_base` of its expenses (minus incomes/refunds in the trip); per-day burn = total / days elapsed; "your share" uses split data. When `exclude_from_budgets` is true (default), trip expenses are not counted against per-category monthly budgets; they appear as one "Travel (trip name)" line on Home and in the whole-month total, so a holiday does not break November's Dining budget. Past trips are listed with totals for side-by-side comparison.

**Categories after Phase 2** (seeded defaults; users may add their own):
`Groceries, Dining, Fuel, Transport, Housing, Utilities, Subscriptions, Shopping, Health, Personal care, Entertainment, Travel, Education, Insurance, Gifts, Fees, Other` plus the system types `Income` and `Transfer` (not user-pickable as expense categories). Old → new: `Restaurant→Dining`, `Gas→Fuel`, `Transportation→Transport`, `Healthcare→Health`.

---

## 5. Phases and tasks

Order matters: Phase 1 (storage) comes before OCR because every later feature adds tables, and adding them to the PGlite layer would be wasted work.

### Phase 0 — Foundations (exit: app signs in, installs as PWA, tests run)

**P0-T1 (S) Fix the docs that mislead the implementer.** `CLAUDE.md`, `AGENTS.md`, `README.md`, `OCR_SETUP.md`, `PRODUCTION_SETUP.md`: describe the real stack, point at this plan and the design link, remove Veryfi/Dexie-era text. Acceptance: `grep -ri "dexie\|veryfi" *.md` returns nothing.

**P0-T2 (owner, S) Restore the production Supabase project** "navidabasi's Project" (`oorwminabbdyfftdbibn`) and confirm Vercel's `VITE_SUPABASE_URL` points at it. Consider the paid tier to stop auto-pausing. Implementer: add `docs/ENVIRONMENT.md` listing every env var in §3 and where it is set.

**P0-T3 (S) Consolidate SQL** into `supabase/migrations/` (date-prefixed, original order, content untouched) and add the v13 file from §4; apply it. Delete `api/__pycache__`, `.Rhistory` files; add to `.gitignore`.

**P0-T4 (S) PWA assets and naming.** Generate the icon set from `wallet icon.svg` into `public/`; one app name everywhere ("Where my money went?"); remove the duplicate `public/manifest.json`; replace the "Loading React App..." placeholder with a themed splash. Add `share_target` to the manifest (needed for e-receipts in P2-T6). Acceptance: Lighthouse says installable; no 404s on first load.

**P0-T5 (M) Vitest + CI.** `npm test` with jsdom; tests for `parseLocalNumber`, `extractDateFromText`, `getEffectiveAmount`, `normalizeTrackingData`, `calculateNextRecurringDate`; `.github/workflows/ci.yml` runs build + test.

**P0-T6 (S) Remove the "premium" gate.** Camera/upload always enabled; delete all `premium*` strings; per-user OCR key becomes an optional "Advanced" setting.

### Phase 1 — Storage: online-first with offline outbox (exit: app works offline, adds sync when back online, PGlite gone)

**P1-T1 (M) ADR + data layer skeleton.** Write `docs/adr/0001-storage.md` (decision D10). Add `@tanstack/react-query` and `dexie`. Create `src/data/db.js` (Dexie schema: `transactions`, `accounts`, `budgets`, `goals`, `rules`, `outbox`, `images`, `meta`), `src/data/api.js` (thin Supabase CRUD per table with the camelCase↔snake_case mappers moved out of `supabaseService.js`), `src/data/sync.js` (pull-since-`updated_at` per table into Dexie; flush outbox FIFO with retry; `online`/`focus`/interval triggers), `src/data/hooks.js` (`useTransactions(month)`, `useAccounts()`, `useBudgets(month)`, `useGoals()`, `useRules()`, `useMutation*` that write outbox + mirror and invalidate queries).
Acceptance: unit tests for the outbox (enqueue → flush → conflict rule) with a mocked API.

**P1-T2 (L) Migrate screens to the new hooks.** Replace every `storageService`/`electricStorage` call in pages, components and `App.jsx` with the hooks; delete the `window.dispatchEvent('refresh*')` pattern (React Query invalidation replaces it). Keep behaviour identical.
Acceptance: all existing flows (add, edit, delete, pin, groups, categories, settings, mark paid, recurring) work online and offline (airplane mode: add 3 transactions, reconnect, they appear in Supabase).

**P1-T3 (S) Remove PGlite.** Delete `src/services/electricStorage.js`, `src/services/storage.js`, `supabase_electric_setup.sql` usage, the wasm precache settings in `vite.config.js`, the `@electric-sql/pglite` dependency. Acceptance: bundle size drops by > 10 MB; first load on a throttled 4G profile < 3 s.

### Phase 2 — OCR v2: AI structured extraction (exit: ≥ 90 % correct merchant/date/total, ≥ 70 % item-level on the owner's sample set)

**P2-T0 (owner, S) Test set.** 20–30 real receipts (several chains, a restaurant bill, a blurry one, a long one, a PDF e-receipt, one non-Italian) with expected merchant/date/total/item count in `test-receipts/expected.json`. Images stay out of git.

**P2-T1 (M) `api/_lib/llm.js`, `api/_lib/auth.js`, `api/_lib/ratelimit.js`.**
`chat({ messages, json, images, vision, maxTokens, temperature })` → OpenAI-shaped POST to `{base}/v1/chat/completions`; images as `image_url` data URLs when `vision`; `response_format json_object` when `json`; strip fences, parse, validate with `zod`; 25 s timeout, one retry on 429/5xx; returns `{ data, usage, model, durationMs }`. Auth verifies the Supabase JWT (`supabase.auth.getUser(token)`), rate limit increments `ai_usage` and refuses over `AI_DAILY_LIMIT_PER_USER`. Acceptance: unit tests with mocked fetch; 401 without token; 429 over limit.

**P2-T2 (S) `api/_lib/ocr.js`** — single OCR.Space call in Node (engine 2, `scale`, `detectOrientation`), returns `{ text }`. Used only when no vision model is configured.

**P2-T3 (L) `api/extract-receipt.js`.** Input `{ file: base64, mime (image/* or application/pdf), hints: { language, defaultCurrency, categories, knownMerchants[≤50], accounts[] } }`. PDF: render page 1 to PNG client-side with `pdfjs-dist` before upload (keeps the function small). Pipeline: auth → rate limit → vision model with the prompt in `api/_prompts/extract-receipt.md` (or OCR text + text model) → zod validation → derived confidence (`total` ≤ 0.5 when |Σitems − total| > 2 %; `date` = 0 when future or > 2 years old) → `{ receipt, extraction }`.
Output schema (the only shape the client accepts):
```json
{ "merchant": "Lidl", "merchantRaw": "LIDL ITALIA S.R.L.", "date": "2026-11-08", "time": "18:42",
  "total": 23.47, "currency": "EUR", "paymentMethod": "card|cash|unknown", "category": "Groceries",
  "items": [{ "name": "Latte intero 1L", "quantity": 1, "unitPrice": 1.19, "price": 1.19, "category": "Groceries" }],
  "tax": 2.11, "confidence": { "merchant": 0.95, "date": 0.9, "total": 0.98, "items": 0.7 },
  "notes": "only when something is odd" }
```
Prompt essentials: consumer brand as merchant (not legal name); ISO date; decimal point; category only from the given list; skip weights/VAT/unit-price/subtotal/change/loyalty lines; null + low confidence when unreadable; prefer the user's known merchant spellings; handle Italian, German, French, Spanish, Dutch receipts.
Acceptance: `scripts/eval-extraction.mjs` prints per-field accuracy over the test set; results recorded in `docs/OCR_EVAL.md`; targets met. **Gate on items:** if item-level accuracy < 70 %, items stay extracted but the review screen shows them collapsed with a "check" badge (as in the design); if < 50 %, hide items by default behind a setting.

**P2-T4 (M) Store the receipt image.** `src/data/images.js`: after save, upload the optimised JPEG/PNG to bucket `receipts` at `${userId}/${transactionId}.jpg`; set `image_path`; signed URLs (1 h) for display; queue in the Dexie `images` table when offline; delete the object with the transaction. Acceptance: detail page shows the image online; offline scan saves and uploads later.

**P2-T5 (L) Scan review screen** = design screen 3. Image on top (tap to zoom), merchant/date/total/category, amber edge + "Check this" on fields with confidence < 0.7, items collapsed with count and sum, "More" for account/group/tags/split/notes, big "Save 23,47 € at Lidl" button in the thumb zone, "Enter manually instead". Acceptance: a correct scan saves in ≤ 3 taps.

**P2-T6 (M) E-receipts.** (a) PDF upload path through P2-T3. (b) Web Share Target: manifest `share_target` (POST, multipart, `files` accepting image/* and application/pdf) + service-worker `fetch` handler that stores the shared file in Dexie and opens `/scan?shared=1`, so a receipt PDF can be shared from Mail/Gmail straight into the app. (c) Optional later: an inbound email address (Resend/Postmark inbound → Supabase Edge Function). Acceptance: sharing a PDF from the phone's mail app lands on the review screen.

**P2-T7 (S) Retire the old OCR code.** Delete `api/ocr.py`, `api/templates/`, `api/requirements.txt`, `api/ocr-proxy.js`, the Python runtime in `vercel.json`, the regex parsers in `src/services/ocrApi.js`; tighten CSP.

### Phase 3 — Categorization v2 (exit: ≥ 85 % of new transactions need no manual category)

**P3-T1 (M) New category list + migration** (names, colours, lucide icons; SQL update for old names; i18n keys).

**P3-T2 (M) `merchantKey()` + rule engine** in `src/utils/merchant.js` and `src/services/categorizer.js`: normalise (lowercase, strip accents, legal suffixes `s.r.l./srl/s.p.a./spa/snc/sas/gmbh/ag/sarl/sas/ltd/bv`, store numbers, addresses), then resolve in order: user `merchant_rules` (exact key, then first-word prefix) → seed rules (`src/data/merchantSeeds.json`, ~250 entries covering Italian and major EU chains, **word-boundary regex only**) → item keywords → `none`. Also used for Revolut/PostePay descriptions (`"LIDL 0231 TORINO"`, `"PAGAMENTO POS ESSELUNGA"`). Tests must include false-positive cases (`busta`, `gastronomia`, `bpm`).

**P3-T3 (S) Learn from corrections.** Any category change on a transaction upserts a user rule and offers "Apply to all N receipts from Lidl?" via a toast action (as in the design's detail screen).

**P3-T4 (M) `api/categorize.js`** batch LLM fallback (≤ 50 merchants per call, with sample items and, for imports, the raw bank description). Confidence ≥ 0.8 → stored as `source='llm'` rule. "Categorise uncategorised" button on Activity when the "Uncategorised" chip count > 0.

**P3-T5 (S) Form behaviour fixes** (re-suggest on merchant change unless the category was touched; items default to the receipt category).

### Phase 4 — Accounts, budgets, savings, imports (exit: "how much did I save this month and am I on track?" answered on one screen)

**P4-T1 (M) Accounts + transfers.** `useAccounts`, Settings → Accounts (create Revolut, PostePay, Cash, Savings account, Investments with opening balances), transaction type segmented control Expense / Income / Transfer, account chip on Quick Add (defaults to the last used), transfer picker (from → to, optional goal). Balances computed in `src/utils/money.js` (tested). Acceptance: accounts list shows correct balances after a mix of expenses, income and transfers.

**P4-T2 (S) Base-currency amounts.** Compute `amount_base`/`exchange_rate` at write time (rate cached per day); all totals use `amount_base`; one-off "Recalculate" under Settings → Advanced. Removes the render-time conversion flicker.

**P4-T3 (M) Budgets** = design screen 5. `budgetMath.js` (tested): spent, remaining, pace tick at today's position, projected end of month, status ok/warning/over, "slow down to X €/day". Whole-month budget + per-category; copy forward on month start; "Add budget" suggests the 3-month average.

**P4-T4 (M) Savings & goals** = design screen 6. Saved-this-month card with savings rate and 3-month average; goals with ring, months-to-target at current pace, needed-per-month; "Add contribution" opens Quick Add preset to Transfer with the goal selected; accounts list with balances and total.

**P4-T5 (M) Home month summary** = design screen 1. The "month as a receipt" card (spent vs budget with pace tick, income, saved, upcoming bills, safe-to-spend per day), budgets strip, insight card, upcoming unpaid bills with "Paid" buttons. All widgets read the selected month from a `useSelectedMonth()` hook (URL `?m=YYYY-MM`). Rename "tracking / mark as done" to "planned / unpaid / mark paid" everywhere.

**P4-T6 (L) CSV import (Revolut, PostePay).** `src/import/parsers/revolut.js` (columns `Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance`; `TRANSFER`/`TOPUP` rows between own accounts become transfers; `CARD_PAYMENT` → expense; negative/positive sign by `Amount`; skip `REVERTED`), `postepay.js` (ask the owner for one export to pin the columns; build a generic column-mapper UI as fallback). Flow: Settings → Accounts → Import CSV → pick account → preview table (date, description, amount, suggested category, "duplicate of scanned receipt?" when same amount within ±1 day) → import. `import_ref` = `provider:sha1(row)` guarantees idempotent re-imports. After import, run P3-T4 on unknown descriptions. Acceptance: importing the same file twice adds nothing; a scanned Lidl receipt and its Revolut row merge into one transaction (the receipt keeps the items and image, the row supplies the account).


**P4-T7 (M) Trips (travel sessions)** = design screen 9 + the Home banner. Extend `useGroups` → `useTrips` (kind='trip'); "Start a trip" sheet (name, dates, budget, currency, companions) from Home's header menu and from Budgets › Savings & accounts › Trips; `useActiveTrip()` hook; default `group_id` in Quick Add, Scan review, share-to-app and CSV import to the active trip (rows dated inside the trip range); Home shows the "On a trip" banner with the running total and the "Travel (name)" line in the month receipt; Trip page: hero (total vs budget with pace tick, per-day burn, your share), category split, latest transactions, "Add to trip", "End trip"; past trips list with totals. Budget math respects `exclude_from_budgets`. Acceptance: start a 4-day trip, add 5 transactions (2 via CSV import dated inside it), end it → trip total equals their sum, November's Dining budget unchanged, Home's whole-month total includes it.

### Phase 5 — UX overhaul to the design (exit: manual add ≤ 5 taps; screens match the canvas)

Use the `frontend-design` skill and the design canvas for every task. Tokens in `tailwind.config.js`: ground `#F4F6F3`, surface `#FFFFFF`, ink `#10211B`, ink-muted `#5C6B64`, line `#E4E9E5`, forest `#00573F`, mint `#E6F0EB`, income `#1B7F55`, savings `#2458D6`, warn `#B45309` / `#8A5A00` text, over `#C2410C` / `#A33A0A` text. Fonts: Bricolage Grotesque (display), Albert Sans (body), IBM Plex Mono (all amounts, `font-variant-numeric: tabular-nums`). Amount rows use the dotted-leader pattern (`.lead`). Dark mode: invert ground/surface to `#0E1512`/`#162019`, keep forest/savings hues, raise text contrast; every token gets a dark value.

**P5-T1 (L) Quick Add bottom sheet** = screen 2. Amount-first with in-app keypad, Expense/Income/Transfer control, camera + gallery shortcuts, merchant input with recent chips, category chips (suggested first), Today/Yesterday/Pick, account chips, "More" accordion (items, notes, group, tags, split, recurring, planned). Undo toast after save.
**P5-T2 (L) Activity** = screen 4. Split `ReceiptsPage.jsx` into `ActivityPage`, `TransactionRow`, `DayGroup`, `FilterBar`; groups management moves to `/groups`. Day groups with totals, month strip, chips (month, type, category, account, Unpaid, Uncategorised), search by merchant/notes/amount, sort, swipe actions, virtualised list.
**P5-T3 (M) Detail** = screen 8. Inline category chips with "applies to all N" hint, details rows, items with unreadable lines flagged, Duplicate/Edit/Delete in the thumb zone.
**P5-T4 (M) Home + bottom nav** = screen 1 (with the trip banner) and the Trip page = screen 9. Five-slot nav (Home, Activity, +, Budgets, Insights); Budgets tab hosts the Budgets / Savings & accounts segments. Lazy-load chart.js.
**P5-T5 (S) Settings** clean-up: Profile · Accounts · Currency & language · Appearance · Notifications · AI & scanning (toggles, privacy text) · Data (import CSV, export CSV, clear local cache) · About. Demo data moves to the empty-state "Try with sample data".
**P5-T6 (S) Onboarding**: currency + language, create accounts (Revolut/PostePay/Cash preselected), set a whole-month budget or skip.

### Phase 6 — Insights (exit: one true, actionable insight per month on the owner's data)

**P6-T1 (M) Deterministic engine** `src/services/insightsEngine.js` (pure, tested): category change vs 3-month average (≥ 25 % and ≥ 20 €), budget pace projection, unusual transaction (> mean + 2σ, min 5 samples), new subscription (same merchant_key, amount ±5 %, ~30 ± 3 days, ≥ 2 times, not recurring), savings rate vs average, top merchant share > 30 %, no income logged, uncategorised count. Output `{ id, type, severity, title, body, amount, category, merchant, link }`.
**P6-T2 (M) `api/insights.js`.** Client sends aggregates only (6 months by category, top merchants by key, budgets vs actual, goals, savings series, recurring, engine findings); hash → `insights_cache`; prompt in `api/_prompts/insights.md` returns `{ headline, summary, wins[], concerns[], actions[], questions[] }` with concrete numbers, in the user's language.
**P6-T3 (M) Insights screen** = screen 7 without the chat row: narrative card (with "made from monthly totals only · model · time"), findings list linking to filtered Activity/Budgets, Refresh (rate-limited), offline shows findings only.

### Phase 7 — Chat about your money (last, per owner's request)

**P7-T1 (L) `api/chat.js` + chat row on Insights** = bottom of screen 7. Context = the same aggregates plus 12 months of category totals and the goals; conversation kept client-side (last 10 turns); suggested questions ("Where can I cut 100 €?", "On track for Japan?", "What changed vs October?"); answers must cite numbers from the aggregates; tool-style follow-ups allowed later (e.g. "set Dining budget to 180" → opens the prefilled budget sheet, never writes directly).

### Phase 8 — Hygiene (any time after Phase 1)

Push notifications for unpaid bills (Supabase Edge Function + Web Push); ESLint + Prettier in CI; delete dead code (`storage.js` stubs, demo seeding duplicates); translate `WidgetRegistry` names; remove `console.log` noise.

---

## 6. Decisions taken (from the owner, 2026-11-10)

| ID | Decision |
|---|---|
| D1 | Production Supabase = "navidabasi's Project" (`oorwminabbdyfftdbibn`); owner restores it. "OCRAPP" is a different app. |
| D2 | Single user now, friends maybe later. Server-side AI keys reused from the owner's AI assistant project. Strict per-user isolation (RLS, per-user rate limits, `ai_usage`); subscriptions later. |
| D3/D4 | Receipts may be sent to a reliable model. Vision model for extraction; DeepSeek (or any OpenAI-compatible text model) for categorize/insights/chat. |
| D5 | Line items wanted if reliable; gated by the eval in P2-T3 (collapsed < 70 %, hidden by default < 50 %). E-receipts: PDF upload + share-to-app; inbound email optional later. Italy first, rest of Europe supported (seeds + prompt). |
| D6 | Savings = transfers into savings/investment accounts (accounts model), not "income with a title". Budgets, goals and savings rate all built. Goals live on the Budgets tab's second segment. |
| D7 | New category list accepted; old names migrated. |
| D8 | Groups, tags, split, recurring, planned are kept and demoted under "More". |
| D9/D11 | Images stored; Revolut CSV import first, PostePay once a sample export is provided. |
| D10 | Online-first with an IndexedDB mirror and an offline outbox (Phase 1). PGlite removed. |
| D12 | Multi-currency kept; base amounts stored at write time. |
| D13 | App name: "Where my money went?" |
| D14 | Chat is the last phase (Phase 7). |
| D15 | Owner travels a lot: **Trips** are first-class travel sessions (auto-attach while active, own budget/currency, total and per-day burn, kept out of regular category budgets by default). Built on the existing groups table. |

Still open: a PostePay CSV sample (for P4-T6) and the receipt test set (P2-T0).

---

## 7. Definition of done for the whole plan

- Test set: merchant/date/total ≥ 90 %, items ≥ 70 % (or gated as in P2-T3); ≥ 85 % of scans and imports need no manual category.
- Works offline: open the app, add transactions, scan (queued), reconnect → everything in Supabase.
- Home answers in one screen: spent vs budget with pace, income, saved, savings rate, safe-to-spend, next bills.
- Revolut CSV imported idempotently, deduplicated against scanned receipts.
- A trip started on the phone collects every transaction made during it, shows its total and per-day burn, and leaves the monthly category budgets untouched.
- At least one true and actionable insight per month; chat answers cite real numbers.
- Manual add ≤ 5 taps; scan-to-saved ≤ 3 taps when extraction is right.
- `npm test` ≥ 80 tests green; CI on every push; Lighthouse installable; bundle < 1.5 MB gzipped; no console errors on first load.

---

## 8. Adding a field to a synced table — checklist (after Phase 1)

1. Supabase migration (`supabase/migrations/…`).
2. Dexie schema version bump in `src/data/db.js` (indexes only if queried).
3. Mapper in `src/data/api.js` (camelCase ↔ snake_case) in both directions.
4. Outbox payload: make sure `sync.js` sends the field on create and update.
5. A round-trip test for the mapper.

---

## Follow-ups (append while implementing)

- (empty)
