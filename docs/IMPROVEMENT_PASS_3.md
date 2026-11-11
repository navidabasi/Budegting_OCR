# Improvement pass 3 — plan (2026-11-11)

Owner request: better AI insights, explanations and money-saving suggestions; a better category selector; an overall UI
polish; groups visible again; filters that work properly. This plan is the spec for the implementer.

Read `CLAUDE.md`, `docs/IMPROVEMENT_PASS_2.md` and `docs/PASS2_MAP.md` first. Production is `main`; work on
`claude/upbeat-darwin-zqt7sd` and never push to `main`.

## Findings from the code (why each item is on the list)

| Area | State today | Evidence |
|---|---|---|
| Groups | Management moved to `/groups`, reachable only through one unlabeled tag icon on Activity. The filter bar has no Group chip (the `groupId` filter exists but only via URL), and transaction rows do not show the group. The owner's real groups (Debts, Subscriptions, Income, Birthday gifts, Lends) are effectively hidden. | `src/pages/ActivityPage.jsx:227`, `src/components/activity/FilterBar.jsx` |
| Filters | One row of chips: period, type, category, account, Unpaid, Uncategorised. No group, merchant, amount range, tag, "has photo", "shared", "needs review", "trip" filters. No visible count of active filters, no "clear all" next to the chips, no saved views. Picker sheets have no search. | `src/components/activity/FilterBar.jsx` (80 lines), `PickerSheet.jsx` (47 lines), `DEFAULT_FILTERS` in `src/utils/activityFilters.js` |
| Category selector | A horizontal chip row of 4 names plus "More", which expands into an unsorted wrap of text chips. No icons, no colours, no search, no "recent", no subcategory, no way to add a category in place. Three copies of the same markup. | `QuickAddSheet.jsx`, `ReviewScreen.jsx`, `ReceiptDetail.jsx`, `rankCategories` in `src/utils/quickAdd.js` |
| Insights summary | One dark card: headline, summary paragraph, then wins, concerns and actions as three undifferentiated bullet lists. Actions are plain sentences: no amount saved, no link, nothing to tap. | `NarrativeCard.jsx` (70 lines), `api/_prompts/insights.md` |
| Suggestions | The prompt asks for "1–3 concrete next steps" from monthly aggregates only. Nothing computes savings opportunities, so advice is generic. | `api/_prompts/insights.md`, `src/services/insightsEngine.js` (8 rule types) |
| Findings | Rule engine has 8 types. Titles are terse ("Rent looks like a subscription" for a rent payment is wrong in tone and substance). | `insightsEngine.js`, screenshot from the owner |
| UI | Screens were built by several passes; spacing, card radii, header patterns and empty states differ between Home, Activity, Plan, Insights, Settings. | `docs/screenshots/pass2/` |

Owner data context (aggregates only): 258 transactions since Dec 2025, EUR, mostly Lidl/Conad/Eurospin groceries, Klarna and
friend debts, rent, a few subscriptions; "Other" is the largest expense category; custom categories Date, Debt, Gift, Stocks;
few receipts have line items.

## Workstream A — Insights that explain and advise

Principle (unchanged): the app computes, the model explains. Every number the model states must exist in the input.

**A1. Savings opportunities engine** — new pure module `src/services/savingsOpportunities.js` with tests. Input: transactions,
budgets, goals, accounts, rules, period, config, today. Output: ranked list of
`{ id, kind, title-key, params, monthlySaving, yearlySaving, confidence, evidence: [txIds], action }`:

- `subscription_review`: recurring charges (reuse `detectSubscriptions`) with monthly and yearly cost; flag ones with no
  activity change in 3+ months. Never classify Housing/rent/utilities/insurance or transfers as a "subscription": call
  those `fixed_cost` and only suggest marking them recurring.
- `category_above_baseline`: category spend this period vs the median of the previous 3 complete periods (same elapsed
  days when the period is running); saving = the excess.
- `merchant_frequency`: many small purchases at one merchant (e.g. bars, tobacconist): count, total, average ticket,
  "one fewer visit a week saves X".
- `cheaper_store`: when item data allows, compare comparable unit prices of the same product across stores; otherwise
  compare average basket size per supermarket visit and say which store is cheaper per visit, with honest coverage.
- `debt_cost`: instalments (Klarna, debt accounts) as a share of income and the date they end if detectable from the pattern.
- `budget_gap`: categories with no budget that are large and volatile; suggest a budget at the 3-period median.
- `goal_boost`: how much sooner a goal completes if the top opportunity's saving goes to it.
- `uncategorised_blind_spot`: share of spend in Other/uncategorised; fixing it improves every other insight.
- `price_creep`: a recurring charge whose amount rose vs its own history.

Each opportunity carries the action it enables: `set_budget`, `mark_recurring`, `open_filter`, `add_goal`,
`categorise`, `review_subscription`.

**A2. Better findings** — extend `insightsEngine.js`: fix the subscription rule as above (rent is a fixed cost), add
`fixed_vs_flexible` (share of spend that is fixed), `income_vs_spend` runway for the period, `streak` (categories under
budget N periods in a row = a win), `weekend_spike`, `end_of_cycle_squeeze`. Rewrite titles/bodies in plain language with
the number first. All texts through `INSIGHT_KEYS` in 7 languages.

**A3. Summary redesign** — replace the single dark card with a structured Insights page (phone first):

1. **Verdict strip**: one sentence headline + three figures (spent vs same point last period, saved, safe to spend per day).
2. **"Where your money went"**: top 5 categories as horizontal bars with change arrows vs the previous period; tap → Breakdown.
3. **"Ways to save"** (the new centre of the page): up to 5 opportunity cards, each with the saving per month and per
   year, one sentence of explanation from the model, a "Why?" expander with the evidence (receipts list, tappable), and
   one primary action button (Set budget of X, Mark recurring, Show these, Add to goal). Dismiss ("Not useful") is
   remembered and fed back so it is not suggested again for 60 days.
4. **Wins** and **Watch-outs** as two compact lists with icons (not three identical bullet lists).
5. **Ask** (existing chat) with suggested questions generated from the top opportunities.

**A4. Model contract** — `api/insights.js` v2: input adds `opportunities` (the A1 list, numbers only) and `findings`.
Output adds `opportunities: [{ id, explanation, howTo }]` keyed by the ids sent (the model may not invent ids or
amounts; server drops unknown ids and any explanation containing a number not present in the input), plus
`verdict`, `wins`, `watchouts`. Raise `maxTokens` accordingly; keep `thinking` disabled. Prompt rules: specific,
kind, no shaming, no investment/tax advice, name the category/merchant and the amount, prefer the user's own
history as the benchmark, never generic tips ("cook at home") unless tied to a number in the data. Cache per period
and input hash as today; label stale instead of regenerating.

**A5. Chat** — add intents `save_money` ("where can I cut", "how to save", "spend better") and `afford`
("can I afford X") to `evidencePack.js`, backed by A1; history intent learns "per cycle" averages. Answers keep citing
facts and showing evidence.

**A6. Verification** — unit tests for every opportunity kind with synthetic data; a contract test (request through
`aiOutbound` then the server schema); a live check script `scripts/live/insights-check.mjs` (not run in CI) that calls
the real model with synthetic aggregates and prints the result, to be run by the coordinator.

## Workstream B — Category selector

One shared component `src/components/ui/CategoryPicker.jsx` used by Quick Add, Scan review, Detail, Categorise sheet,
import preview, budgets and filters:

- **Inline row**: 4–5 suggested categories as icon + label chips in the category colour (suggested first, then most
  used for this merchant, then most used overall), plus a "More" chip.
- **Full picker** (bottom sheet): search field on top (matches names in any app language and merchant-style words via
  `categoryFromQuestion`), a "Suggested" row, "Recent", then all categories as a 3-column grid of icon tiles with
  colour and label, custom categories included, and "New category" (name, colour, icon) without leaving the sheet.
  Selecting closes the sheet. Keyboard and screen-reader accessible (listbox/option), 48 px tiles.
- **Subcategory step** for Groceries (and any category with subcategories) as an optional second row, never required.
- Shows *why* a category is suggested when it comes from a rule ("You filed Lidl under Groceries 42 times").
- Long-press or "Always use for <merchant>" toggle creates/updates the merchant rule (existing `categoryLearning`).
- Removes the three duplicated chip-row implementations. Tests for ranking, search, creation, rule toggle.

## Workstream C — Groups back in view

- **Activity**: a "Group" filter chip (multi-select picker with counts and totals per group) and a group badge (colour
  dot + name) on each row and in the table view. A "Group by" control switches the list between Day (default),
  Group, Category and Merchant, each section with its total and collapsible, remembered per device. This restores the
  old grouped view inside the new UI.
- **Groups page** redesigned in the new design system and linked from: the Activity header (labelled button, not a
  bare icon), the Plan page ("Groups & trips" segment or section) and Home (a compact "Groups" card when groups
  exist: name, period total, count). Each group opens a group detail page (`/groups/:id`): total for the period and
  all time, per-category split, transactions, rename/colour/pin/delete, "Add to group".
- Trips stay trips (groups with `kind='trip'`), shown in their own section so they are not confused with groups.
- Quick Add and Detail keep the group picker under More; when the last transaction for the same merchant had a group,
  suggest it.
- Verify with the owner's real group names in tests (Debts, Subscriptions, Income, Birthday gifts, Lends).

## Workstream D — Filters

- **Filter model** (`src/utils/activityFilters.js`): add `groupIds[]`, `merchants[]`, `tags[]`, `amountMin`,
  `amountMax`, `hasPhoto`, `shared`, `needsReview`, `tripId`, `accountIds[]` (multi), `text` stays `q`. Keep every old
  URL parameter working (tests exist). One `describeFilters()` helper renders active filters as removable chips.
- **Filter bar**: first chip is "Filters · N" opening a full filter sheet with sections (Period, Type, Category,
  Group, Account, Merchant, Amount range with two fields and quick ranges, Status: Unpaid / Needs review /
  Uncategorised / Shared / Has photo). Below the bar, active filters appear as removable chips with "Clear all".
  The most used quick filters stay as one-tap chips. Result count and total update live in the sheet's primary
  button ("Show 23 transactions · 412,30 €").
- **Search**: one field that matches merchant, notes, item names, category, group, tags and amounts (`12,40`, `12.4`,
  `>50`, `10-20`), with recent searches.
- **Picker sheets**: search inside, counts per option, select all/none for multi.
- **Saved views**: save the current filter set with a name ("Debts this year"), shown as chips above the list; stored
  in user prefs (synced).
- **Sort**: date, amount, merchant, category; direction toggle; remembered.
- Desktop table uses the same model with column header filters.
- Empty state explains which filter removes all results and offers to clear it.

## Workstream E — UI polish

A consistency pass, not a redesign. Keep the identity (forest green, sage ground, monospace amounts, dotted leaders).

- One page header component (eyebrow, title, right-side actions, optional period switcher) used on every screen.
- One spacing scale and card style (radius, shadow, padding) applied everywhere; remove one-off values.
- Typography scale audited: title, section, body, caption; amounts always tabular monospace.
- Every list has designed empty, loading (skeleton) and error states.
- Home: tighten the month card, add the Groups card (C) and a "Ways to save" teaser (A) linking to Insights.
- Icons for categories everywhere (rows, chips, charts, budgets) from one map.
- Settings cards restyled to the design system (they still use legacy classes).
- Contrast check in dark mode (AA), focus rings, 44 px targets, RTL check (fa/ar).
- Motion per the existing tokens; nothing new that slows entry.

## Order and acceptance

1. C (groups) and D (filters) first: they restore lost capability.
2. B (category picker).
3. A (insights and suggestions).
4. E (polish) last, so it covers the new screens.

Done means: all tests and the build pass; new behaviour covered by tests; screenshots at 390×844 (light + dark) and
1280 for every changed screen in `docs/screenshots/pass3/`; no regression of the production rules listed in
`docs/PASS2_MAP.md` and below.

Production rules that must not regress: DeepSeek `thinking` disabled; `DateField` for every date; inputs ≥ 16 px;
expanders collapse; fixed bottom bars clear the raised + button; no pinch-zoom/sideways scroll; every AI request goes
through `aiOutbound.js` and passes the server schema (contract tests); chat links open the answer's exact period;
history questions use the whole record; no share/full toggle (basis is inferred); additive schema changes only.
