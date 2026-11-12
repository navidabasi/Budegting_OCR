# Insights pass 3 (Workstream A) — report

Branch `claude/insights-pass3` (from `claude/upbeat-darwin-zqt7sd`). Spec: `docs/IMPROVEMENT_PASS_3.md`, A1 to A6.
Nothing was pushed to `main`, nothing was deployed, no pull request was opened.

Principle kept throughout: **the app computes, the model explains.** Every number on the page is produced on the device; the
model only words the verdict and the explanations, and the server deletes any sentence that states a number it was not given.

## What was built

| Spec | What | Where |
|---|---|---|
| A1 | Savings opportunities engine: 10 kinds, ranked by monthly saving × confidence, at most 5 shown, one per subject, at most 2 of a kind | `src/services/savingsOpportunities.js`, `src/utils/spendClass.js` |
| A2 | Findings: rent is a fixed cost (never a subscription), debt is not reported as a subscription, 5 new rules (8 new keys), all texts rewritten number-first in 7 languages | `src/services/insightsEngine.js`, `scripts/i18n/pass3-insights.mjs` |
| A3 | Insights page: verdict strip, where the money went, ways to save, wins and watch-outs, all findings (collapsed), chat. Two columns from 1100 px. Home "Ways to save" teaser | `src/pages/InsightsPage.jsx`, `src/components/insights/{VerdictStrip,WhereMoneyWent,WaysToSave,OpportunityCard,WinsWatchouts}.jsx`, `src/components/home/SaveTeaser.jsx`, `src/services/{insightsView,opportunityText}.js` |
| A4 | `/api/insights` v2: opportunities, findings with ids, dismissed suggestions and verdict figures in; verdict, per-opportunity explanation + how-to, wins and watch-outs with refs out. Server-side checks. `MAX_TOKENS` 2200, `thinking` untouched (still disabled) | `api/insights.js`, `api/_prompts/insights.md`, `src/services/insightsAggregates.js`, `src/utils/numberGuard.js` |
| A5 | Chat intents `save_money` and `afford`; history learns per-pay-cycle averages; history facts got readable wording | `src/services/evidencePack.js`, `src/components/insights/factText.js`, `api/_prompts/chat-evidence.md` |
| A6 | Unit tests, contract tests, live check script | see "Tests" and "Coordinator" below |

### Rules built into the engine

- **Fixed costs** (Housing, Utilities, Insurance, or a merchant such as Affitto, Rent, Enel, Allianz whatever its category) are
  never a subscription and never "to cut". Kind `fixed_cost` only offers "Mark recurring".
- **Debt** (category Debt, groups Debts / Lends, Klarna and other pay-later merchants, debt accounts) is `debt_cost`: saving 0,
  no "spend less" wording, an end date only when the payments show one ("2/3" in the name or note, or a recurring end date).
- **Savings logged as spending** (custom category Stocks) is not flexible spending and is never suggested for cutting.
- **Splits**: every amount is the owner's share (`money.shareAmount`). Planned bills, transfers, income/refunds, demo rows,
  unconverted foreign amounts and trip spending are left out.
- **Running periods** compare the same elapsed days of earlier periods (pay cycles when a payday is set), never a full period.
  The first 3 days of a running period are too few to judge a habit.
- **History** is the owner's own earlier periods; periods before the first recorded transaction do not count as zero.
- **"Not useful"** hides a suggestion for 60 days, is synced (`user_layouts.layout.prefs.insightsDismissed`, no schema change),
  is sent to the model as dismissed, and the goal card then follows the next best saving.
- No new settings or toggles: insights appear without configuration.

## Opportunity kinds, with output on the synthetic owner-like data

Fixture: `src/services/__fixtures__/ownerLike.js` (303 synthetic transactions, Dec 2025 to 12 Nov 2026, payday 27, rent 380,
Lidl/Conad/Eurospin, Klarna and a friend debt, Netflix with a price rise, Spotify, "Other" the largest flexible category, custom
categories Date/Debt/Gift/Stocks, the five real group names, 4 receipts with line items). Cycle 27 Oct to 26 Nov, day 17.

| Kind | Example card (English) | Saving /month | Confidence | Action |
|---|---|---|---|---|
| `category_above_baseline` | "€79 more on Dining than usual" · €100.50 so far against €21.50 at the same point of earlier periods | 79.00 | high | Set budget of €35 (or "Show these" when a budget exists) |
| `goal_boost` | "Emergency fund: 32 months sooner" · €79 a month gets there in 12 months instead of 44 | 0 (never double counted) | high | Add €79 to goal (prefilled transfer) |
| `merchant_frequency` | "4 visits to Tabaccheria Centrale: €24" · about €6 each time, one fewer visit a week adds up to €24 a month | 24.00 | medium | Show these (exact dates + merchant) |
| `budget_gap` | "Shopping has no budget and swings from €25 to €120" · usual level €40 | 26.67 | medium | Set budget of €40 |
| `uncategorised_blind_spot` | "€129 has no category (16% of spending)" · 6 payments, mostly Prelievo, Mercato, Tabaccheria Centrale | 0 | high | Categorise 6 |
| `price_creep` | "Netflix went up by €3 a month" · from €12.99 to €15.99 since 6 Sep, €36 more a year | 3.00 | high | Show the charges |
| `subscription_review` | "€11.99 a month for Spotify" · €143.88 a year, same charge for 12 months | 11.99 | medium | Show the charges |
| `debt_cost` | "€39.90 went to debt repayments" · 3% of income, 1 payment (Klarna) | 0 | high | Show these (group Debts) |
| `fixed_cost` | "€380 a month for Affitto" · a fixed cost, paid 11 months in a row | 0 | high | Mark recurring (preview sheet, undoable) |
| `cheaper_store` | "Lidl is cheaper than Conad on 2 things you buy" · from the 25% of grocery spending with item detail (4 of 18 receipts) | 1.87 | medium | Show these |

`cheaper_store` falls back to the **average basket per visit** when no comparable items exist (needs 2 stores with 3+ visits in
90 days). It then says "This compares baskets, not prices", shows the coverage, is low confidence, and its saving assumes one
shop a month moved with the same basket.

Top 5 shown for this data: Dining above baseline, goal boost, Tabaccheria frequency, Shopping budget gap, uncategorised.

## New findings (A2)

`fixed_cost`, `fixed_vs_flexible` (share of spending that is fixed), `income_vs_spend` / `income_vs_spend_over` /
`income_vs_spend_done` (what is left for the period, per day), `streak` (under budget N periods in a row), `weekend_spike`,
`end_of_cycle_squeeze`. All through `INSIGHT_KEYS` in en, it, de, es, fr, fa, ar.

## What the model receives and returns

**Receives** (`aggregates`, version 2, about 10 KB on the fixture, limit 80 KB), after `aiOutbound.sanitizeBody`:

- as before: period, summary, categories by period, savings series, top merchants (display names), budgets, goals, trips, recurring;
- `verdict`: spent, spent at the same point of the previous period, change, saved, income, upcoming, safe per day, days left;
- `findings`: up to 12, each `{ id: "N1", type, severity, title, body, figures }`;
- `opportunities`: the cards shown, each `{ id: "O1", oppKind, category, merchant, monthlySaving, yearlySaving, confidence, action, periodStart, periodEnd, ...its own figures }`;
- `dismissed`: `{ oppKind, category, merchant }` only.

No transaction ids, notes, account names, raw descriptions or item lines. New protocol keys added to `PROTOCOL_KEYS`:
`oppKind`, `sourceKind`, `action`, `ref` (enums and handles the app makes up; no user data).

**Returns**: `{ v: 2, verdict, summary, opportunities: [{ id, explanation, howTo }], wins: [{ text, ref }], watchouts: [{ text, ref }], questions }`
(`headline` = verdict is still included for a client that has not updated).

**Server checks** (`finalizeNarrative` in `api/insights.js`), before anything is cached or returned:

- an explanation is kept only for an opportunity id that was sent, once;
- any sentence (verdict, summary, explanation, how-to, win, watch-out, question) with a figure that is not in the input is dropped
  (whole numbers from 10 up and every decimal figure are checked; cents may be dropped; years are ignored);
- a `ref` that is not a sent finding or opportunity id is cleared;
- if nothing usable is left the request fails with 502 and nothing is cached.

**On the device**, an explanation is shown on a card only while its figures are still the card's figures
(`trustedExplanation`), otherwise the app's own wording is shown. The page is complete with no AI at all.

**Cache**: per period + input hash as before. The hash ignores the clock (day of period, verdict figures, the day-to-day numbers
of findings and suggestions) and changes with data, with which findings/suggestions exist, and with dismissals. A changed hash
labels the summary "Out of date" with an "Update summary" button; nothing regenerates by itself. A summary cached before v2 is
not served as current. The first request now waits 600 ms for the data to settle (budgets, groups and prefs load after the
transactions; without this a fresh summary was labelled out of date at once).

## Chat (A5)

- `save_money` ("where can I cut", "how to save", "spend better", in the 7 languages): the same opportunities as the cards,
  with the receipts behind them and a total; dismissed ones are left out; "nothing to cut" is answered on the device.
- `afford` ("can I afford 200"): what is left of the running period (income − spent − still to pay, and the whole-period budget
  when there is one; the tighter decides), the amount asked about, what would be left per day, and the app's verdict
  (fits / tight / exceeds). Needs income or a budget, and a running period; otherwise answered on the device.
- History: with a payday set (or when asked "per cycle") a `history_cycle_average` fact gives the average per complete pay
  cycle, median, highest, lowest and the running cycle so far; asked per cycle, the last 12 cycles are listed.
- Chat links still open the answer's exact period; history still uses the whole record; the basis is still inferred.

## Tests

`npm test`: **92 files, 1067 tests, all passing** (962 before this work). `npm run build` passes.

| File | Tests | Covers |
|---|---|---|
| `src/services/__tests__/savingsOpportunities.test.js` | 40 | every kind; no history, one period, running period, splits, refunds/income, planned bills, trips, fixed costs never subscriptions, ranking, dismissal, model view |
| `src/services/__tests__/insightsEngine.test.js` | 49 (+13) | new findings, rent as fixed cost, debt not reported |
| `src/services/__tests__/insightsOutboundContract.test.js` | 12 (+8) | insights v2 and `save_money` / `afford` / per-cycle history through `aiOutbound` then the server schemas; every kind keeps its figures; unknown ids and invented numbers removed |
| `api/__tests__/insights.test.js` | 21 | schema, `finalizeNarrative`, cache, v1 cache not served, max tokens |
| `src/services/__tests__/evidencePack.test.js` | 44 (+11) | routing in 7 languages, packs, verdicts, per-cycle averages |
| `src/services/__tests__/opportunityText.test.js` | 6 | wording in 7 languages (no missing key or placeholder), links open the exact period |
| `src/components/insights/__tests__/WaysToSave.test.jsx` | 12 | cards, actions, Why?, Not useful, AI vs own wording, verdict strip, category bars, wins/watch-outs |
| `src/services/__tests__/insightsAggregates.test.js` | 20 (+5) | v2 aggregates, verdict figures, ref map |
| `src/utils/__tests__/numberGuard.test.js` | 4 | number collection and invented-figure detection (Latin, Persian, Arabic digits) |
| `src/data/__tests__/notifyDataChanged.test.js` | 2 | the race fix below |

## Bug found and fixed on the way

An answer saved a few milliseconds after its question (any answer computed on the device, such as "nothing to cut") did not
appear in the chat until the page was reloaded. Cause: TanStack Query ignores an invalidation for a query still on its first
fetch. `notifyDataChanged` (`src/data/queryClient.js`) now reads such queries once more after they settle, without making the
write wait. Test proves it fails without the fix.

## Screenshots (`docs/screenshots/pass3/`)

Made by `scripts/screenshots/pass3-insights.mjs` with synthetic data; the two AI endpoints are answered locally from the
request's own figures. 390×844 light and dark for all; 1280 light and dark where marked.

- `insights-*` (+1280): the page as it opens. `insights-full-*` (+1280): the whole page in one image.
- `insights-ways-to-save-*` (+1280): the cards. `insights-why-*` (+1280): an opened "Why?".
- `insights-wins-*`: the watch-outs list. `insights-offline-fallback-*`: the page with no AI.
- `home-save-teaser-*`: the Home teaser.
- `chat-save-money-*` (+1280): a `save_money` answer with its evidence open.
- `insights-fa-light.png`, `insights-why-fa-light.png`: right-to-left check (Persian).

Checked at 390 px in en, fa and de: no sideways scroll, every button and link in the cards is at least 44 px tall.

## Production rules

DeepSeek `thinking` untouched (disabled); every AI request still goes through `aiOutbound.js`; contract tests extended; chat
links open the exact period; history uses the whole record; summaries are cached and labelled stale, not regenerated; no date
inputs or text inputs were added; expanders collapse; the chat bar is unchanged; no schema change, **no migration written and
none to apply**; nothing depends on stored receipt photos; all new strings exist in the 7 languages.

## Open issues and limits

- **The real model has not been run.** There is no API key in this environment. The prompt, schema and checks were exercised
  with a local stand-in only, so the actual quality of the explanations (and how often the number check drops a sentence) is
  not yet known. Run the live check below.
- The number check is strict: a sentence that rounds "about €80" for 79 is dropped and the app's own wording shows instead.
  If the live check shows many drops, loosen the prompt before loosening the check.
- "Monthly" means per period (a pay cycle is about a month); yearly is 12 times that.
- `goal_boost` assumes the whole top saving goes to the goal every period; it is an illustration, not a forecast.
- `cheaper_store` on baskets says nothing about prices (the card says so); item comparison needs the same product name in a
  comparable unit at two stores, which few receipts have today.
- Subscription detection needs 3 equal monthly charges (2 when filed under Subscriptions); yearly subscriptions are not detected.
- Fixed-cost and debt recognition is by category, group, account kind and a list of merchant words (Italian and English mostly);
  an unusual landlord name filed under Other would be treated as flexible spending.
- Counts in strings are not pluralised ("1 payments"), as elsewhere in the app.
- The fixture has 303 transactions, not 258; the shape matches, the count is a little higher.
- Workstreams B and E were out of scope and were not touched, apart from the Home teaser.

## For the coordinator

1. **Run the live check** with the production key (not in CI, prints the request summary, the answer and what the server dropped;
   exit code 0 = usable):
   `LLM_API_KEY=... npx vite-node scripts/live/insights-check.mjs --chat` (add `--lang it` or `--raw`; `LLM_BASE_URL` and
   `LLM_MODEL` default to DeepSeek / `deepseek-chat`).
2. **No migration to apply.** Dismissals live in `user_layouts.layout.prefs.insightsDismissed`.
3. Deploy needs nothing new: no environment variable was added. After deploy, the first Insights visit per period regenerates
   the summary once (aggregate version 2 changes the hash).
4. Review and merge `claude/insights-pass3`; no pull request was opened.
