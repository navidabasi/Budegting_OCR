# Budgeting OCR — Audit & Improvement Plan

Status: **DRAFT v1 — waiting on answers to the "Open decisions" section before implementation starts.**
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
9. The storage layer is local-first (PGlite in the browser mirrored to Supabase). Adding a column to `receipts` requires changes in **five** places; see §8 "Adding a field checklist". New small tables (budgets, goals, rules) are **Supabase-only with a localStorage cache** to avoid that cost (decision D10).

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
| Infra | **Production backend is currently paused** | Both candidate Supabase projects ("navidabasi's Project" = `oorwminabbdyfftdbibn`, referenced in `PRODUCTION_SETUP.md`, and "OCRAPP") are in state INACTIVE. Sign-in and sync cannot work until it is restored. |
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
Client (React PWA)
  ├─ Quick Add sheet ──────────────┐
  ├─ Scan → /api/extract-receipt ──┼──► Vercel Node functions (api/*.js)
  ├─ Review screen (image + fields)│      ├─ _lib/llm.js      provider-agnostic chat client (OpenAI-compatible)
  ├─ Transactions list / Dashboard │      ├─ _lib/ocr.js      OCR.Space text fallback
  ├─ Budgets & Goals               │      ├─ extract-receipt.js  image|text → structured receipt JSON
  ├─ Insights card / chat          │      ├─ categorize.js       merchant list → categories (batch)
  └─ storage: PGlite ⇄ Supabase ◄──┘      └─ insights.js         aggregates → narrative + suggestions
                                                   │
                                     DeepSeek / OpenRouter / Gemini / Ollama (env-configured)
Supabase
  ├─ receipts (+ image_path, amount_base, extraction, merchant_key, goal_id)
  ├─ budgets, savings_goals, merchant_rules, insights_cache   (new)
  └─ Storage bucket "receipts" (private, per-user folder)
```

LLM provider abstraction: every model is reached through the OpenAI-compatible Chat Completions API. Configuration is by environment variables only:

| Variable | Purpose | Example |
|---|---|---|
| `LLM_BASE_URL` | Text model endpoint | `https://api.deepseek.com` |
| `LLM_API_KEY` | Key for it | |
| `LLM_MODEL` | Model id | `deepseek-chat` |
| `LLM_VISION_BASE_URL` / `LLM_VISION_API_KEY` / `LLM_VISION_MODEL` | Optional vision-capable model used for receipt images. If unset, OCR.Space text + text model is used. | OpenRouter `google/gemini-2.5-flash`, or Gemini's OpenAI-compatible endpoint |
| `OCR_SPACE_API_KEY` | Fallback OCR (already exists) | |
| `AI_DAILY_LIMIT_PER_USER` | Rate limit (default 50) | |

Note for the implementer: at the time of writing DeepSeek's public API (`deepseek-chat`, `deepseek-reasoner`) is text-only and supports `response_format: { type: 'json_object' }` (the prompt must contain the word "json"). Verify against the current DeepSeek docs before coding. A self-hosted model (Ollama/vLLM) also exposes the same API shape; only the base URL changes.

---

## 4. Data model changes (one migration file, Phase 0)

Create `supabase/migrations/20261110_v13_budgets_goals_rules.sql`:

```sql
-- receipts: new columns
alter table receipts
  add column if not exists image_path text,              -- storage object path, null if none
  add column if not exists amount_base numeric(12,2),    -- total converted to user's base currency at write time
  add column if not exists base_currency text,           -- the base currency used for amount_base
  add column if not exists exchange_rate numeric(14,6),  -- rate used (1 when same currency)
  add column if not exists merchant_key text,            -- normalised merchant (lowercase, no punctuation/legal suffixes)
  add column if not exists goal_id uuid,                 -- for transaction_type = 'savings'
  add column if not exists extraction jsonb;             -- {provider, model, confidence:{merchant,date,total,items}, rawText, durationMs}
create index if not exists idx_receipts_user_date on receipts(user_id, date desc);
create index if not exists idx_receipts_merchant_key on receipts(user_id, merchant_key);

-- transaction_type now allows 'savings'
-- (no constraint exists today; document the allowed values: expense | income | savings)

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null,            -- '*' = overall monthly budget
  amount numeric(12,2) not null,
  currency text not null,
  period text not null default 'monthly',  -- monthly only in v1
  starts_on date not null default date_trunc('month', now())::date,
  ends_on date,                      -- null = open ended
  rollover boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, category, starts_on)
);

create table if not exists savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  target_amount numeric(12,2) not null,
  currency text not null,
  target_date date,
  monthly_contribution numeric(12,2),  -- planned, optional
  color text,
  icon text,
  is_archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  merchant_key text not null,
  category text not null,
  source text not null default 'user',   -- user | llm | seed
  hit_count int default 1,
  updated_at timestamptz default now(),
  unique (user_id, merchant_key)
);

create table if not exists insights_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  period text not null,                -- 'YYYY-MM'
  input_hash text not null,            -- hash of the aggregates sent; regenerate when it changes
  payload jsonb not null,
  model text,
  created_at timestamptz default now(),
  unique (user_id, period)
);

-- RLS: same pattern as receipts for all four tables (select/insert/update/delete where auth.uid() = user_id)
-- updated_at triggers: reuse update_updated_at_column()
-- Storage: bucket 'receipts' (private). Policy: authenticated users can read/write objects whose first path segment = auth.uid()::text
```

Allowed `category` values after Phase 2 (seeded defaults; users may add their own):
`Groceries, Dining, Fuel, Transport, Housing, Utilities, Subscriptions, Shopping, Health, Personal care, Entertainment, Travel, Education, Insurance, Gifts, Fees, Other, Income, Savings`.
Migration map from old names: `Restaurant→Dining`, `Gas→Fuel`, `Transportation→Transport`, `Healthcare→Health`. Existing data must be migrated with an `update receipts set category = ... where category = ...` block in the same migration and the i18n keys renamed.

---

## 5. Phases and tasks

### Phase 0 — Foundations (exit: app signs in, installs as PWA, tests run)

**P0-T1 (S) Fix the docs that will mislead the implementer.**
Files: `CLAUDE.md`, `AGENTS.md`, `README.md`, `OCR_SETUP.md`.
- Replace the Dexie description with PGlite (`src/services/electricStorage.js`), note `api/ocr.py` is the active OCR endpoint until Phase 1, link to this plan.
- Remove `Veryfi` mentions.
Acceptance: `grep -ri dexie CLAUDE.md AGENTS.md` returns nothing.

**P0-T2 (S) Restore / choose the Supabase project and record it.**
Owner task, not implementer: unpause the production project (decision D1) and add its URL/anon key to Vercel. Implementer: add `docs/ENVIRONMENT.md` listing every env var in §3 and where it is set.
Acceptance: login works on the deployed URL.

**P0-T3 (S) Consolidate SQL into `supabase/migrations/`.**
Move the 12 root SQL files into `supabase/migrations/` with date-prefixed names in the order they were written (setup, v4, v5, v5_parent, v6, v7, v8, v9, v10, v11, v12, fix_rls, electric_setup). Add the v13 file from §4. Do not edit their content. Delete `api/__pycache__`, `.Rhistory`, `TypeScript-Claude/.Rhistory`; add them to `.gitignore`.
Acceptance: `ls *.sql` at root is empty; `supabase/migrations` has 14 files; v13 applied to the project.

**P0-T4 (S) PWA assets and naming.**
Files: `public/`, `index.html`, `vite.config.js`, `public/manifest.json`.
- Generate `pwa-192x192.png`, `pwa-512x512.png`, maskable variants, `apple-touch-icon.png`, `favicon.ico`, `mask-icon.svg` from `wallet icon.svg` (use `sharp` in a one-off script, then delete the script or keep under `scripts/`). Move the source SVG to `src/assets/`.
- One name everywhere (decision D13; default "Where my money went?").
- Delete `public/manifest.json` (vite-plugin-pwa generates it) or make it identical.
- Replace the "Loading React App..." placeholder in `index.html` with a centred logo + spinner that matches the theme color.
Acceptance: Lighthouse PWA audit on the preview build shows installable; no 404 in the network tab on first load.

**P0-T5 (M) Add Vitest and the first tests.**
Files: `package.json`, `vitest.config.js`, `src/**/__tests__/`.
- `npm run test` runs Vitest with jsdom.
- Tests for: `parseLocalNumber`, `extractDateFromText` (helpers.js), `getEffectiveAmount`, `normalizeTrackingData`, `calculateNextRecurringDate`.
Acceptance: `npm test` green; CI step added to a `.github/workflows/ci.yml` running `npm ci && npm run build && npm test`.

**P0-T6 (S) Remove the "premium" gate.**
Files: `src/components/layout/AddReceiptModal.jsx`, `src/components/receipts/ReceiptUpload.jsx`, `src/pages/SettingsPage.jsx`, `src/languages/*.js`.
- Camera/upload are always enabled. The per-user OCR key field moves under Settings → "AI & scanning → Advanced" as optional "Use my own OCR.Space key". All `premium*` strings removed.
Acceptance: a fresh account can scan without entering a key when the server has `OCR_SPACE_API_KEY`.

### Phase 1 — OCR v2: AI structured extraction (exit: ≥ 90 % correct merchant/date/total on the owner's sample set)

**P1-T0 (owner, S) Provide a test set.** 20–30 real receipt photos (various stores, some blurry, at least one PDF, one restaurant bill) with the expected merchant/date/total written in `test-receipts/expected.json`. Keep images out of git if private (add folder to `.gitignore`), but keep `expected.json`.

**P1-T1 (M) `api/_lib/llm.js` — provider-agnostic client.**
```js
// chat({ messages, json: true, images?: [{ mime, base64 }], maxTokens, temperature, vision: false })
// - picks LLM_* or LLM_VISION_* env set based on `vision`
// - POST {base}/v1/chat/completions (OpenAI shape); images sent as image_url data URLs (only when vision=true)
// - response_format json_object when json=true; strips ``` fences; JSON.parse; throws LlmError{status, provider, body}
// - 25 s timeout, 1 retry on 429/5xx with backoff
// - returns { data, usage, model, durationMs }
```
Also `api/_lib/auth.js`: verify the Supabase JWT from the `Authorization: Bearer` header using `SUPABASE_URL` + `SUPABASE_ANON_KEY` (`supabase.auth.getUser(token)`); return `userId`. Every new endpoint requires it. Also `api/_lib/ratelimit.js`: per-user daily counter in `insights_cache`-style table or in-memory (serverless best effort) — use a small `ai_usage` table (`user_id, day, count`) to make it real.
Acceptance: unit test with a mocked fetch; endpoint returns 401 without token.

**P1-T2 (M) `api/_lib/ocr.js` — OCR.Space text fallback in Node.**
Port the multipart call from `api/ocr-proxy.js` (engine 2, overlay off, `scale=true`, `detectOrientation=true`, language from the user's app language). Single call, no language scoring loops. Return `{ text, durationMs }`.
Acceptance: returns text for a sample image within 15 s.

**P1-T3 (L) `api/extract-receipt.js` — the new endpoint.**
Input: `{ image: base64, mime, fileName, hints: { language, defaultCurrency, categories: [..], knownMerchants: [..top 50 merchant names of the user..] } }`.
Pipeline:
1. Auth + rate limit.
2. If `LLM_VISION_MODEL` is set → send the image to the vision model with the extraction prompt. Else → `ocr.js` text → text model with the same prompt plus the raw text.
3. Validate the JSON against the schema below (use `zod`). Compute `confidence` per field: vision/text model returns its own 0–1 confidence; additionally set `total.confidence = min(given, 0.5)` when `|sum(items) − total| > 0.02 × total` and items are non-empty; `date.confidence = 0` if the date is in the future or > 2 years old.
4. Return `{ receipt, extraction: { provider, model, usedOcrFallback, rawText, durationMs, confidence } }`.

Output schema (the only shape the client accepts):
```json
{
  "merchant": "Lidl",
  "merchantRaw": "LIDL ITALIA SRL",
  "date": "2026-11-08",
  "time": "18:42",
  "total": 23.47,
  "currency": "EUR",
  "paymentMethod": "card|cash|unknown",
  "category": "Groceries",
  "items": [{ "name": "Latte intero 1L", "quantity": 1, "unitPrice": 1.19, "price": 1.19, "category": "Groceries" }],
  "tax": 2.11,
  "confidence": { "merchant": 0.95, "date": 0.9, "total": 0.98, "items": 0.7 },
  "notes": "short free text only if something is odd (e.g. 'total unreadable, estimated from items')"
}
```
Prompt (store in `api/_prompts/extract-receipt.md`, load at runtime):
- System: "You extract structured data from retail receipts. Return only JSON matching the schema. Use ISO dates. Decimal point. The `merchant` is the consumer-facing brand (e.g. 'Lidl', not 'Lidl Italia S.r.l.'). Pick `category` from the provided list only. Items: skip weights, VAT lines, unit prices, subtotals, change ('RESTO'), loyalty lines. If a value is unreadable, set it to null and lower its confidence. Known merchants of this user: … (prefer these spellings)."
- User: the image (vision) or "OCR text:\n…" (text).
Acceptance: run `scripts/eval-extraction.mjs` (write it) over the P1-T0 set and print a table: field, accuracy. Target ≥ 90 % for merchant/date/total, ≥ 60 % item-level. Record results in `docs/OCR_EVAL.md`.

**P1-T4 (M) Store the receipt image.**
Files: `src/services/receiptImageService.js` (new), `src/services/supabaseService.js`, `electricStorage.js`, `ReceiptUpload.jsx`.
- After a successful save, upload the optimised JPEG to bucket `receipts` at `${userId}/${receiptId}.jpg`; set `image_path`. Generate signed URLs (1 h) for display. Delete the object when the receipt is deleted.
- Offline: queue the upload (store the blob in PGlite as bytea or IndexedDB) and flush on sync. If too complex, v1 may require being online to scan (decision D9).
Acceptance: receipt detail shows the image; deleting the receipt removes the file.

**P1-T5 (L) Review screen replaces "OCR result → giant form".**
Files: `src/components/receipts/ScanReviewSheet.jsx` (new), `ReceiptUpload.jsx`, `ReceiptForm.jsx`.
- Layout (mobile): image on top (pinch-zoom via CSS `touch-action` + a simple zoom library or native `<img>` in a scrollable container), below it the four primary fields: merchant (with autocomplete from the user's merchants), date, total, category chips. Fields with `confidence < 0.7` get an amber left border and a "Check this" hint.
- "Items (n)" collapsed section; "More" expands notes/group/tags/split/recurring.
- Primary button "Save"; secondary "Rescan"; link "Enter manually instead".
- Save path: same `createReceipt` as today plus `extraction` and image upload.
Acceptance: scanning a receipt and saving takes ≤ 3 taps when the extraction is right.

**P1-T6 (S) Retire the old OCR code.**
Delete `api/ocr.py`, `api/templates/`, `api/requirements.txt`, `api/ocr-proxy.js`, the Python runtime entry in `vercel.json`, and the parsing functions in `src/services/ocrApi.js` (keep `fileToBase64`). Update CSP `connect-src` (no direct `api.ocr.space` from the client).
Acceptance: build passes; scan still works end-to-end on the preview deployment.

### Phase 2 — Categorization v2 (exit: ≥ 85 % of new transactions get the right category without manual change)

**P2-T1 (M) New category list + migration.**
Files: `src/utils/constants.js`, `src/languages/*.js`, migration v13 (§4), `categoryService.js`.
- Replace `CATEGORIES`/`DEFAULT_CATEGORIES` with the §4 list (names, colors, lucide icon names instead of emoji).
- SQL update for existing receipts (old → new names) in v13; same mapping applied client-side on pull for old local rows.
Acceptance: existing receipts show the new names; category chart colours stable in light/dark.

**P2-T2 (M) `merchantKey()` normaliser + rule engine.**
Files: `src/utils/merchant.js` (new), `src/services/categoryService.js`, tests.
- `merchantKey("LIDL ITALIA S.R.L. - FIL. 0231")` → `"lidl"`. Steps: lowercase, strip accents, remove legal suffixes (`s.r.l., srl, s.p.a., spa, snc, sas, ltd, gmbh, inc, llc, sa`), remove store numbers / "fil." / "punto vendita" / addresses after a dash, keep the first 2 significant words.
- Resolution order in `suggestCategory({ merchant, items })`:
  1. `merchant_rules` for this user by `merchant_key` (exact), then by prefix (first word).
  2. Seed rules (`src/data/merchantSeeds.it.json` + `.en.json`): ~150 Italian/EU merchants and keywords with **word-boundary** regex (`\bconad\b`, `\besselunga\b`, `\beurospin\b`, `\bcoop\b`, `\bcarrefour\b`, `\bmd\b`, `\bpam\b`, `\btigros\b`, `\bdespar\b`, `\bfarmacia\b`, `\bparafarmacia\b`, `\btabacch`, `\beni\b|\bagip\b|\bq8\b|\besso\b|\btamoil\b|\bip\b`, `\btrenitalia\b|\bitalo\b|\batm\b|\batac\b|\bgtt\b`, `\benel\b|\bedison\b|\ba2a\b|\bhera\b|\biren\b|\bsorgenia\b`, `\btim\b|\bvodafone\b|\bwindtre\b|\biliad\b|\bfastweb\b`, `\bamazon\b|\bzalando\b|\bikea\b|\bleroy merlin\b|\bmediaworld\b|\bunieuro\b|\bdecathlon\b`, `\bnetflix\b|\bspotify\b|\bdisney\b|\bdazn\b|\bsky\b|\bprime video\b`, `\bmcdonald|\bburger king\b|\bautogrill\b|\bpizzeria\b|\bristorante\b|\btrattoria\b|\bosteria\b|\bbar\b|\bcaff[eè]\b`, …). Word boundaries are mandatory; add a test proving `busta` ≠ Transport and `gastronomia` ≠ Fuel.
  3. Item keywords (only when no merchant match), word-boundary, Italian + English.
  4. Return `{ category, source: 'rule|seed|item|none', confidence }`.
Acceptance: unit tests for ≥ 40 merchants incl. the false-positive cases above.

**P2-T3 (S) Learn from corrections.**
Files: `electricStorage.js` (`createReceipt`/`updateReceipt`), `src/services/merchantRulesService.js` (new, Supabase-only + localStorage cache).
- Whenever a receipt is saved with a category different from the suggestion, or the user edits the category, upsert `merchant_rules(user_id, merchant_key, category, source='user', hit_count+1)`.
- Offer "Apply to all 12 receipts from Lidl?" via a toast action when a rule changes (uses the existing `showToast` with an action button; add action support to `Toast.jsx`).
Acceptance: categorise "Conad" once; next "CONAD CITY" receipt is suggested as Groceries.

**P2-T4 (M) `api/categorize.js` — LLM fallback for unknown merchants (batch).**
- Input: `{ merchants: [{ key, raw, sampleItems: [..≤5] }], categories }` (≤ 50 per call). Output: `{ results: [{ key, category, confidence }] }`.
- Client calls it (a) after a scan when the rule engine returned `none`, (b) from a "Categorise uncategorised" button on the Transactions page which batches all `Other` receipts. Results with confidence ≥ 0.8 are stored as `merchant_rules(source='llm')`; lower ones are only suggested.
Acceptance: a receipt from an unseen merchant gets a non-"Other" category within 3 s; the "Other" count on the owner's data drops below 10 %.

**P2-T5 (S) Fix the form behaviour.**
Files: `ReceiptForm.jsx`, `ScanReviewSheet.jsx`.
- Re-suggest when the merchant changes (any mode) unless the user has already touched the category field (track `categoryTouched`).
- Line items default to the receipt category; item-level suggestion only via explicit "auto" chip.
- Remove the client-side override in `ocrApi.postProcessResult` (Phase 1 deleted it; verify nothing reintroduces a US map).
Acceptance: manual test on both paths.

### Phase 3 — Budgets, savings goals, monthly view (exit: the owner can answer "how much did I save this month and am I on track?")

**P3-T1 (M) `savings` transaction type + base-currency amounts.**
Files: `ReceiptForm.jsx`/Quick Add, `electricStorage.js`, `supabaseService.js` (`transformReceiptToSupabase` + reverse), `src/utils/money.js` (new), `src/utils/tracking.js`.
- Transaction type selector gets a third option "Savings" (icon piggy bank). A savings transaction is excluded from expenses and income, included in goal progress.
- On every create/update compute `amount_base`, `base_currency`, `exchange_rate` using the user's default currency (`exchangeRateService`, cached per day in localStorage; if offline and no cached rate, set rate=null and recompute on next sync). All dashboard math uses `amount_base` when present, falling back to `total` when currency equals base.
- Backfill: a one-off client routine "Recalculate base amounts" under Settings → Advanced.
Acceptance: dashboard totals no longer flicker; a USD receipt contributes its EUR value.

**P3-T2 (M) Budgets service + UI.**
Files: `src/services/budgetService.js` (new, Supabase-only with localStorage cache), `src/pages/BudgetsPage.jsx` (new), route `/budgets`, nav entry, `src/components/budgets/BudgetBar.jsx`.
- CRUD monthly budgets per category and one overall budget. Copy last month's budgets automatically when a new month starts (lazy: on first load in a month).
- Budget math in `src/utils/budgetMath.js` (pure, tested): `spent`, `remaining`, `pacePct = spent / (budget × dayOfMonth / daysInMonth)`, `projectedEndOfMonth`, status `ok | warning (pace > 1.1) | over`.
- BudgetsPage: month switcher, list of category bars (spent / budget, remaining, projected), tap → transactions filtered by category+month, "+ Add budget" sheet with suggested amount = 3-month average for that category.
Acceptance: unit tests for budgetMath; bars render correctly for current and previous months.

**P3-T3 (M) Savings goals service + UI.**
Files: `src/services/goalsService.js` (new), `src/pages/GoalsPage.jsx` (or a section inside Budgets page, decision D6), `src/components/goals/GoalCard.jsx`.
- CRUD goals; progress = sum of `savings` transactions with `goal_id` (+ optional manual "starting balance" field on the goal). Show: saved / target, % ring, months left at current average contribution, "needed per month to hit the date".
- Quick action on a goal: "Add contribution" → creates a `savings` transaction prefilled.
Acceptance: creating a goal, adding two contributions, progress and projection update.

**P3-T4 (M) Monthly summary + savings rate on the dashboard.**
Files: `SummaryCards.jsx` → `MonthSummary.jsx`, `HomePage.jsx` month selector in `PageHeader`, `src/utils/monthMath.js`.
- Replace the four all-time KPI cards with the selected month: **Spent** (vs budget), **Income**, **Saved** (savings transactions + optionally `income − spent − saved` as "unallocated"), **Savings rate** = saved / income (hidden when income is 0 with hint "log your income to see your savings rate"). Tap → filtered list.
- "Safe to spend today" (optional widget): `(overallBudget − spent) / daysRemaining`.
- All widgets receive the selected month from a `useSelectedMonth()` hook (URL param `?m=YYYY-MM`) instead of each computing its own.
Acceptance: switching month updates every widget; previous-month comparison arrow on Spent.

**P3-T5 (S) Recurring → planned bills clean-up.**
Files: `RecurringPayments.jsx`, `RecurringManager.jsx`, `tracking.js`, languages.
- Rename "Tracking / Mark as done" to "Planned (unpaid)" / "Mark paid" everywhere in copy. Planned-but-unpaid amounts are shown as "Upcoming this month: €X" on the dashboard and included in the budget projection.
Acceptance: no occurrence of the word "tracked" in `en.js` user-facing strings.

### Phase 4 — AI insights (exit: a monthly insight card that says something true and useful about the owner's data)

**P4-T1 (M) Deterministic insights engine (no LLM).**
Files: `src/services/insightsEngine.js` (pure functions, tested), `src/utils/stats.js`.
Input: receipts (last 6 months), budgets, goals, selected month. Output: array of `{ id, type, severity: info|warning|good, title, body, amount?, category?, merchant?, link? }` for:
- `category_change`: category spend vs 3-month average, |Δ| ≥ 25 % and ≥ €20.
- `budget_pace`: projected over budget by end of month.
- `unusual_transaction`: amount > mean + 2σ for that merchant or category (min 5 samples).
- `new_subscription`: same merchant_key, amount within 5 %, ~30 ± 3 days apart, ≥ 2 occurrences, not already marked recurring → suggest marking recurring.
- `savings_rate`: this month vs last 3 months average.
- `top_merchant_share`: one merchant > 30 % of the month.
- `no_income_logged`: income = 0 for the month while expenses > 0 (nudge, info).
Acceptance: unit tests with synthetic data for every rule.

**P4-T2 (M) `api/insights.js` — LLM narrative + suggestions.**
- Client builds `aggregates` (no raw receipts, no notes): monthly totals by category for 6 months, top 10 merchants (merchant_key, count, sum), budgets vs actual, goals progress, savings rate series, recurring list, and the deterministic findings from P4-T1. Hash it; if `insights_cache[period].input_hash` matches, return the cached payload.
- Prompt (`api/_prompts/insights.md`): "You are a frank personal-finance coach. Based only on the JSON provided, write for the month {period}: `headline` (≤ 15 words), `summary` (≤ 80 words), `wins` (≤ 3), `concerns` (≤ 3, each with a concrete number), `actions` (≤ 3, each specific and measurable, e.g. 'cap Dining at €150, you are at €212'), `questions` (≤ 2 things you would ask the user to clarify). Currency {currency}. Language {language}. Return JSON." Temperature 0.4.
- Output validated with zod; stored in `insights_cache`; returned with `generatedAt` and `model`.
Acceptance: endpoint returns within 10 s; second call for the same month hits the cache.

**P4-T3 (M) Insights card + page.**
Files: `src/components/dashboard/InsightsCard.jsx` (new widget in `WidgetRegistry.js`, default on, order 1), `src/pages/InsightsPage.jsx` (route `/insights`).
- Card: headline + first concern + first action, "See all" → page. Page: deterministic findings as a list (each tappable to the filtered transactions), then the LLM narrative, "Regenerate" button (rate-limited), timestamp, model name, and a privacy note "Only monthly totals are sent, never receipt contents".
- Empty state when < 10 transactions: explain what is needed.
Acceptance: works offline with the deterministic findings only (LLM section shows "Connect to generate").

**P4-T4 (L, optional) "Ask about my spending" chat.**
- `api/insights-chat.js`: same aggregates + last 12 months category totals as context; conversation kept client-side (last 10 turns); streaming not required.
- UI: simple thread at the bottom of InsightsPage with 3 suggested questions ("Where can I cut €100/month?", "Am I on track for {goal}?", "What changed since last month?").
Acceptance: answers reference actual numbers from the aggregates.

### Phase 5 — UX overhaul (exit: adding a transaction manually ≤ 4 taps; owner's satisfaction)

Use the `frontend-design` skill for every task in this phase. Keep the existing green brand (`#00573f`) but define tokens in `tailwind.config.js` (`surface`, `surface-raised`, `ink`, `ink-muted`, `accent`, `positive`, `negative`, `warning`) and migrate components to them as they are touched.

**P5-T1 (L) Quick Add bottom sheet.**
Files: `src/components/add/QuickAddSheet.jsx` (new), `BottomNav.jsx`, `AddReceiptModal.jsx` (delete).
- Tapping "+" opens a bottom sheet (not a centred modal): amount field focused with numeric keyboard, type segmented control (Expense / Income / Savings), merchant input with autocomplete (recent + frequent merchants), category chips (suggested first, then the rest, "+" for more), date chip (Today / Yesterday / pick), "More" accordion for items, notes, group, tags, split, recurring, planned.
- Two icon buttons in the sheet header: Camera (opens camera immediately) and Gallery.
- Save closes the sheet with an undo toast ("Added €12.40 at Bar Roma — Undo").
Acceptance: manual add of an expense = tap +, type amount, tap merchant suggestion, tap category, tap Save (≤ 5 taps including the FAB).

**P5-T2 (L) Transactions list rewrite.**
Files: split `ReceiptsPage.jsx` into `TransactionsPage.jsx`, `components/transactions/TransactionRow.jsx`, `DayGroup.jsx`, `FilterBar.jsx`, `GroupsPage.jsx` (group management moves to `/groups`).
- Grouped by day with a day total; sticky month header with month total and a month switcher.
- Filter chips: type, category (multi), date range (This month / Last month / Custom), group, "Unpaid", "Uncategorised". Sort: date, amount. Search matches merchant, notes, amount (`12.4`, `12,40`).
- Row: category icon in a colored circle, merchant, category · group tag, amount right-aligned (income green with +, savings blue), small camera icon when an image exists, swipe left → delete (with undo), swipe right → change category.
- Virtualised list (`@tanstack/react-virtual`) replacing the manual "load more".
Acceptance: 2,000 synthetic receipts scroll at 60 fps on a mid-range phone; filters persist in the URL.

**P5-T3 (M) Transaction detail page.**
Files: `ReceiptDetailPage.jsx`, `ReceiptDetail.jsx`.
- Image (if any) with tap-to-zoom; fields editable inline (tap a value to edit); items table; "Was this category right?" quick chips when `extraction.confidence.category < 0.8`; actions: Mark paid, Duplicate, Delete.
Acceptance: editing the category from the detail page creates/updates a merchant rule.

**P5-T4 (M) Dashboard layout.**
Files: `HomePage.jsx`, widgets.
- Order: month header with switcher → MonthSummary (P3-T4) → Budgets strip (top 3 categories closest to limit, "See all") → InsightsCard → Category donut (same month) → Spending trend (daily cumulative line for this month vs last month instead of the raw 30-day spikes) → Upcoming bills → Goals strip.
- Widget names/descriptions translated. Keep the customiser.
Acceptance: first paint shows the month summary without waiting for charts (lazy-load chart.js with `React.lazy`).

**P5-T5 (S) Settings clean-up.**
- Sections: Profile, Currency & language, Appearance, Notifications, AI & scanning (toggle "Use AI to read receipts", "Use AI insights", privacy text, optional own keys), Data (export CSV, import CSV — see P6-T3, clear local cache), About (version, privacy, terms). Demo data moves to the empty state of the dashboard ("Try with sample data").
Acceptance: no "premium", no "Veryfi", no "Electric" wording visible.

**P5-T6 (S) Onboarding.**
- First run: 3 screens (what the app does, pick currency + language, set a monthly budget or skip). Then the empty dashboard with two big buttons: "Scan a receipt", "Add manually".
Acceptance: shown once per account; skippable.

### Phase 6 — Tech debt and nice-to-haves (do after 1–5, in any order)

**P6-T1 (L) Decide on the local-first layer (decision D10).** Options: (a) keep PGlite; (b) replace with Dexie + a simple outbox (~400 lines instead of 1,900, no 12 MB wasm); (c) online-first with a React Query cache. Recommendation: (b) if offline entry matters, (c) otherwise. Write an ADR in `docs/adr/0001-storage.md` before touching code.

**P6-T2 (M) Push notifications** for planned bills via Supabase Edge Function + Web Push (VAPID) so reminders work when the app is closed.

**P6-T3 (M) CSV import** (bank/card export): map columns (date, description, amount), run the rule engine + `api/categorize.js` on descriptions, de-duplicate against existing receipts (same date ± 1 day, same amount). This is the single biggest lever for "track savings properly" because most spending is card payments without a paper receipt.

**P6-T4 (S) Lint + format**: ESLint (react, hooks) + Prettier, `npm run lint` in CI.

**P6-T5 (S) Remove dead code**: `src/services/storage.js` wrapper methods never called, `getUserByEmail/createUser/getUserById` stubs, `seedDemoData` duplicates in `electricStorage`.

---

## 6. Open decisions (owner must answer before Phase 1)

| ID | Question | Default if unanswered |
|---|---|---|
| D1 | Which Supabase project is production, and will you unpause it (free tier pauses after inactivity) or upgrade? | `oorwminabbdyfftdbibn`, unpause. |
| D2 | Who uses the app: only you, family, public? Who pays for AI calls? | Personal/family; owner pays; server-side keys; per-user daily limit 50. |
| D3 | AI provider for **extraction**: DeepSeek is text-only, so receipts would go OCR.Space → DeepSeek. A vision model (Gemini 2.5 Flash via OpenRouter or Google's OpenAI-compatible endpoint, GPT-4o-mini, Claude Haiku) reads the image directly and is far more accurate. Which do you allow? Do you have a self-hosted DeepSeek (Ollama/vLLM) or the hosted API? | Vision model for extraction, DeepSeek for categorise/insights. |
| D4 | Privacy: is sending receipt images/text and monthly aggregates to a third-party model acceptable? Any region constraint? | Yes; aggregates only for insights. |
| D5 | Receipts: mostly Italian supermarkets? Any PDFs/e-receipts/emails? Do you need **line items** at all, or merchant + total + date + category? (Items are the hardest and most expensive part.) | Items optional, collapsed, lower accuracy accepted. |
| D6 | Savings: how do you actually save? (automatic transfer to another account, % of salary, irregular). Do you log income in the app? Do you want budgets, goals, savings rate, all three? Should goals live on the Budgets page or their own tab? | All three; goals as a section on Budgets page; income logged monthly. |
| D7 | Categories: accept the new list in §4 and the migration of old names? Add/remove any? Subcategories needed? | Accept; no subcategories in v1. |
| D8 | Groups, tags, split, recurring, planned: which do you really use? Anything we can delete to simplify? | Keep all, demote to "More". |
| D9 | Store receipt images (Supabase Storage, 1 GB free)? Must scanning work offline? | Store images; scanning requires online. |
| D10 | Keep PGlite local-first, or simplify (Phase 6 options)? New small tables Supabase-only? | Keep PGlite for receipts for now; new tables Supabase-only + cache. |
| D11 | CSV/bank import wanted (P6-T3)? Which bank formats? | Yes, generic CSV mapper. |
| D12 | Multi-currency really needed? | Keep, but store base amounts. |
| D13 | App name: "Where my money went?", "Money Tracker", or "Receipt Manager"? | "Where my money went?" |
| D14 | Implementer budget: which model, how many hours/sessions? (Phases 1–4 ≈ 25–35 h of focused work for a capable model; Phase 5 ≈ 20 h.) | — |

---

## 7. Definition of done for the whole plan

- Owner's 20–30 receipt test set: merchant/date/total ≥ 90 % correct, no manual category needed in ≥ 85 % of scans.
- Dashboard answers in one screen: spent vs budget this month, income, saved, savings rate, next bills.
- At least one true and actionable insight per month on the owner's data.
- Manual add ≤ 5 taps; scan-to-saved ≤ 3 taps when extraction is right.
- `npm test` ≥ 60 tests green; CI on every push; Lighthouse PWA installable; no console errors on first load.

---

## 8. Adding a field to `receipts` — checklist (local-first plumbing)

1. Supabase migration (`supabase/migrations/…`).
2. PGlite `createSchema()` in `src/services/electricStorage.js` (both `CREATE TABLE` and an `ALTER TABLE ADD COLUMN IF NOT EXISTS` for existing installs).
3. `createReceipt`, `updateReceipt` (column lists + param arrays) and `pullFromSupabase` (`INSERT … ON CONFLICT … DO UPDATE SET`) in `electricStorage.js`.
4. `transformReceiptToSupabase` / `transformReceiptFromSupabase` (or equivalent mapping) in `src/services/supabaseService.js`.
5. `field_timestamps` key list (v8 migration comment) if the field should merge per-field.
6. A test that round-trips the field through the transform functions.

---

## Follow-ups (append while implementing)

- (empty)
