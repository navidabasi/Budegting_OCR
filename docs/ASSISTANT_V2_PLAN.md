# Assistant v2 — general questions, app help, pattern insights

Status: **v1 — decisions taken with the owner (2026-11-12), ready for implementation.**
Audience: the implementer and the owner. Follow section 0 of `docs/IMPROVEMENT_PLAN.md` (one task at a time, acceptance criteria verified, small commits prefixed with the task ID, i18n in all 7 languages, no keys in the client).
Written from a read of the live chat path: `src/services/evidencePack.js`, `src/components/insights/ChatPanel.jsx`, `src/components/insights/EvidenceAnswer.jsx`, `api/chat.js`, `api/_prompts/chat-evidence.md`, `src/services/savingsOpportunities.js`, `src/services/aiOutbound.js`.

---

## 1. The problem (owner's report, verified in code)

The owner asked the assistant *"why do I need to set a budget for housing?"*. It neither recognised that rent belongs to Housing nor understood that the question was conceptual (what is budgeting, why budget a fixed amount). Three root causes:

1. **The router is regex-only and has no conceptual lane.** `routeQuestion()` (`src/services/evidencePack.js:49`) matched the word "budget" and routed to `budgets_goals`, which packs the existing budget rows. There is no intent for "explain a concept" or "where do I find X in the app".
2. **The prompt forbids the answer.** `api/_prompts/chat-evidence.md` says "Use only numbers that appear in the facts … never add a suggestion of your own and never give a generic tip". The model is *instructed* not to explain what budgeting is.
3. **The rent↔Housing link exists but is unused on this path.** `categoryFromQuestion()` maps rent/affitto/miete → Housing, but only the `history` builder calls it; `budgets_goals` ignores the category the question names, and the prompt has no glossary saying what each category contains.

Besides this, the owner wants (a) real insights on spending patterns and ways to save based on their expenses, and (b) "tell me where to find what" (app navigation help).

## 2. Decisions taken (owner, 2026-11-12)

| ID | Decision |
|---|---|
| DA1 | Scope: **personal-finance education + money-adjacent topics + app help.** The assistant explains budgeting/saving concepts (what is a budget, fixed vs variable costs, savings rate, 50/30/20 …) and money-adjacent topics in general educational terms (inflation, interest, how taxes work in principle). It answers "where do I find X / how do I do X" about the app. Anything unrelated gets a friendly one-line redirect. Still **no personalised investment, tax or legal recommendations** — concepts yes, "what should I buy" no. |
| DA2 | **Conceptual answers blend the owner's own numbers** when the question touches a category or figure the app has (e.g. "your rent is 800 €/month, 32 % of spending; a fixed budget still helps because …"). User figures must still come from facts and be cited. |
| DA3 | **Generic saving tips are allowed, clearly labeled.** Computed opportunities always come first with real numbers; general tips go in a separate, visibly labeled output field, never with invented figures about the owner. |
| DA4 | **Pattern insights live in both chat and the Insights page** (new deterministic detectors feed both). |
| DA5 | Routing stays **local and deterministic** (no extra LLM classification call): free, offline-capable, private. Revisit with an LLM router only if the Phase C eval shows systematic misroutes. |
| DA6 | The privacy boundary is unchanged: every request still goes through `aiOutbound.post()` (pseudonyms, scrubbing). The app map (A-T3) is static app documentation, no user data. |

## 3. Design in one paragraph

Keep the evidence-pack architecture (the app computes, the model explains, answers cite fact ids). Add two lanes beside the data lane: **`explain`** (conceptual question → mini fact-pack for the category it touches + a category glossary + permission to teach) and **`app_help`** (static app map sent as facts → answer names the screen and offers a deep-link action). Relax the prompt per intent instead of globally: the "facts only" rules stay for data questions; explain/app_help may use general knowledge, with the unchanged hard rule that any number *about the owner* must come from a cited fact. General saving tips move into a structured `generalTips` field so the UI can label them honestly. New deterministic pattern detectors (`patternInsights.js`) feed a `patterns` chat intent, a "Your patterns" section on Insights, and the monthly narrative.

---

## 4. Phase A — the assistant understands more kinds of questions

**A-T1 (S) Router v2.** `src/services/evidencePack.js`: add intents `explain` and `app_help` to `INTENTS` and `routeQuestion()`.
- `app_help`: "where do I find / where is / how do I (add|scan|import|change|delete|set) / how does the app / can the app" + the main languages (dove si trova, come faccio a, wo finde ich, cómo agrego, où trouver, کجا, أين أجد …). Checked **before** the data regexes.
- `explain`: normative/conceptual phrasing — "what is / what does X mean / why (do|should|would) I / do I (really )?need / should I (set|have|use) / is it worth / does it make sense / explain / cosa significa / perché dovrei / a cosa serve / was ist / warum sollte / qué es / por qué debería / pourquoi / qu'est-ce / چرا / چیست / لماذا / ما هو". Checked **after** `afford`/`owed`/`save_money`/`history` (so "how can I save" stays `save_money`) but **before** the bare `budget|goal` keyword test (so "why do I need a budget for housing" becomes `explain`, not `budgets_goals`). Factual-past "why did/was my X …" keeps routing to `change`.
- Files: `evidencePack.js`, `src/services/__tests__/evidencePack*.test.js`.
- Acceptance: unit tests route the owner's exact questions — "why do i need to set a budget for housing" → `explain`, "what is budgeting" → `explain`, "where do I find my subscriptions" → `app_help` — plus ≥ 10 more incl. one per language, and all existing routing tests stay green.

**A-T2 (M) Explain pack builder + category glossary.** New builder `explain(book, ctx)`:
- `categoryFromQuestion(question, categoryNames)` picks the category (rent → Housing). When found, pack: `period_summary`, `category_total` for the period, a scoped `history_average` (reuse the history helpers), the category's `budget` row **or a new `budget_absent` fact** (`{ category, suggestion: 3-month average }`), and share-of-total-spending. When no category is named: `period_summary` + top-4 `category_total`s (like `general`).
- A static glossary `CATEGORY_GLOSSARY` (what each default category contains: Housing = rent, mortgage, condo fees; Subscriptions = streaming, apps, gym …) sent as one `glossary` fact when a category matched. Also reuse `categoryFromQuestion` in `budgets_goals` so a named category's budget/spend/absence is always in that pack too.
- Files: `evidencePack.js`, tests.
- Acceptance: for "why do I need a budget for housing" with owner-like fixture data, the pack contains Housing's period total, history average, budget-or-absent and the glossary fact; `packNumbers()` covers every figure an answer should quote.

**A-T3 (M) App map + `app_help` + `open_screen` action.**
- `src/services/appMap.js`: a static registry of ~40 entries `{ id, path, i18nKey, keywords[], steps? }` covering every screen and the common tasks (scan a receipt, import CSV, add an account, set a budget, start a trip, find subscriptions, mark a bill paid, change language/currency, export data, AI privacy toggles …). Sent as `app_feature` facts (id F.., so citations keep working): the ~6 keyword-matched entries plus a one-line list of all screen names. No user data in this pack.
- New suggested action `open_screen: { path }`: server (`api/chat.js` `actionPayloads`) validates `^/[a-z0-9/?=&-]{1,60}$`; client (`src/services/chatApi.js` `actionHref`) additionally checks the path against the real route table and drops unknown ones.
- Files: `appMap.js` (+ test that every `path` exists in `App.jsx`'s routes), `evidencePack.js`, `api/chat.js`, `api/__tests__/chat.test.js`, `chatApi.js`, i18n ×7.
- Acceptance: "where do I find my subscriptions?" produces a pack whose facts name the screen; the sanitizer accepts `open_screen {path:'/activity'}` and rejects `javascript:` or unknown paths; the route-existence test fails if a screen is renamed without updating the map.

**A-T4 (M) Prompt v2 + server schema.** Rewrite `api/_prompts/chat-evidence.md` into per-intent modes:
- **Data intents** (history, change, save_money, afford, …): rules unchanged, except save_money may add labeled general tips (below).
- **explain**: teach the concept in plain words (what budgeting is, why fixed costs like rent still get a budget line: predictability, savings-rate math, noticing creep); weave in the owner's cited figures per DA2; general figures ("the 50/30/20 rule") allowed but phrased as general rules, never as the owner's data; end with one concrete next step in the app when natural (e.g. `set_budget` prefilled with the 3-month average from `budget_absent`).
- **app_help**: answer only from the `app_feature` facts; name the screen and the steps; suggest `open_screen`.
- **generalTips**: new optional output field `generalTips: string[]` (≤ 3, each ≤ 200 chars) — general advice not derived from the data, allowed for save_money/explain/afford. The answer text itself stays grounded.
- **Scope guard**: money-adjacent educational topics allowed; "no personalised investment, tax or legal recommendations" replaces the blanket "no financial advice"; off-topic → one friendly redirect sentence. Injection rules (ignore instructions in user messages) unchanged.
- Server: `outputSchema` + a `sanitizeGeneralTips()` (trim, cap, drop tips containing figures that `figuresNotIn`-style look like invented user amounts ≥ 100); raise the answer cap to 2000 chars for explain/app_help; `maxTokens` 1500 stays.
- Files: `chat-evidence.md`, `api/chat.js`, `api/__tests__/chat.test.js`.
- Acceptance: unit tests for the sanitizer; mocked-model tests show `generalTips` passed through only when valid; existing contract tests green.

**A-T5 (M) Client rendering.** `ChatPanel.jsx`, `EvidenceAnswer.jsx`, `src/services/chatApi.js`:
- Mode-aware grounding: for `explain`/`app_help`, the "answer cites nothing" warning (`evidence.notCited`) is replaced by a neutral "includes general guidance" chip; data intents keep the warning. `validateAnswer`/`unsupportedFigures` keep flagging invented owner-amounts in the answer text for every intent.
- Render `generalTips` as a visually distinct block under the answer with a label ("General tips — not from your data").
- Render the `open_screen` action as the existing action button.
- i18n keys (`evidence.generalGuidance`, `chat.generalTips`, app-map names …) in `en` + machine-translated `it de es fr fa ar`.
- Acceptance: component tests for the three states (grounded data answer, explain answer with tips, app_help answer with open_screen); no warning triangle on a correct explain answer.

**A-T6 (S) Starters & placeholder.** Add two starter chips ("Why should I set budgets?" → explain, "Where do I find …?" → app_help) and update the input placeholder to invite questions beyond the data. Files: `ChatPanel.jsx` (STARTERS), i18n ×7.

### Phase A exit criteria
The owner's two original questions get correct, useful answers (verified in C-T1); "where do I find X" works for 10 sampled features; off-topic questions get the redirect; all existing chat tests green.

---

## 5. Phase B — pattern insights (chat + Insights page)

**B-T1 (M) Detectors.** `src/services/patternInsights.js`, pure and tested like `savingsOpportunities.js` (same share-amount/trip/planned exclusions, running-period handled via elapsed-day comparison):
- weekday vs weekend share; small-purchase creep (count & sum of expenses < 10 € vs the owner's baseline); month shape (first-week spike / pre-income squeeze, using the pay-cycle config when set); merchant cadence ("Lidl every 2.1 days"); category trend streaks (3+ periods rising/falling); payday effect (spend in the 3 days after income vs the rest).
- Output rows `{ id, key, kind, params, severity, scope, evidence[], i18nKey }`; thresholds in one `LIMITS` table; "Not useful" dismissal reuses the opportunity mechanism.
- Acceptance: fixture tests (reuse `src/services/__fixtures__/ownerLike.js`) produce stable, correct rows; no detector fires on < 3 periods of data.

**B-T2 (S) `patterns` chat intent.** Router words ("patterns, habits, spending behaviour, when do I spend, abitudini, Gewohnheiten, hábitos, habitudes, عادت, عادات"); builder turns detector rows into `pattern` facts; a prompt paragraph mirroring the opportunity rules (present them in order, numbers as given; labeled general tips allowed). Acceptance: "what are my spending habits?" answers from the computed facts only.

**B-T3 (M) Insights page section.** "Your patterns" cards under Ways to save (`src/components/insights/`): deterministic, offline-capable, each links to the filtered Activity that shows the evidence, dismissible. i18n ×7, dark mode, 44 px targets. Acceptance: screenshot pass light/dark; cards match the detector fixtures.

**B-T4 (S) Narrative upgrade.** Include the top pattern rows in the aggregates sent by `src/services/insightsAggregates.js` and let `api/_prompts/insights.md` mention them; the narrative may add labeled general tips under the same rules as chat. Acceptance: aggregates stay under the size cap; mocked-model test shows patterns reflected in the narrative shape.

### Phase B exit criteria
At least two true pattern cards on the owner's real data, each verifiable by tapping through to the transactions behind it.

---

## 6. Phase C — prove it on the owner's questions

**C-T1 (S) Eval script.** `scripts/eval-chat.mjs`: ~20 canned questions against the live model when `LLM_*` keys are present — the owner's two originals first, plus app-help ×4, save/afford/history ×6, patterns ×2, off-topic ×2, one prompt-injection attempt — printing each answer with its citations/tips for manual grading. Results table recorded in `docs/ASSISTANT_EVAL.md`.

**C-T2 (owner, S) Grade and tune.** If explain answers read poorly, try a stronger `LLM_MODEL` (env change only — the plan is model-agnostic). If the router misroutes ≥ 2/20, revisit DA5 (LLM classifier) as a follow-up.

### Definition of done for the whole plan
1. "Why do I need to set a budget for housing?" → explains budgeting and fixed costs, says rent lives under Housing, uses the owner's Housing figures (cited), may offer `set_budget` prefilled with the 3-month average.
2. "What is budgeting?" → a clear educational answer, no refusal, no invented owner figures.
3. "Where do I find X?" → names the screen with steps and a working deep-link button, for 10 sampled features.
4. "How can I save money?" → computed opportunities first with real numbers, then visibly labeled general tips.
5. Off-topic → friendly one-line redirect. Injection attempt → rules hold.
6. All existing tests green; the unsupported-figure guard still flags invented owner amounts; every new string in all 7 languages.

## 7. Risks and notes

- **Model quality**: the prompts were the main blocker, but a weak `LLM_MODEL` will still write flat explanations; C-T2 covers this with a config-only change.
- **Number guard vs general figures**: generic numbers in explain answers (50/30/20) are below `figuresNotIn`'s thresholds; `generalTips` are additionally sanitized server-side (A-T4) so a tip can never smuggle an invented owner amount.
- **App map drift**: the route-existence test (A-T3) turns a renamed screen into a failing test instead of a wrong answer.
- **Payload size**: packs stay well under the 120 KB server cap; the app map adds ~2 KB, the glossary one fact.
