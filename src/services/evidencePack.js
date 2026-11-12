// Evidence packs for the AI assistant (pass 2 part 2, section 6).
//
// The calculation layer (money.js, itemAnalysis.js, splits.js, budgetMath.js, period.js) computes every number; the model only
// explains them. For a question we pick a deterministic fact builder (routeQuestion), compute the relevant facts locally and send
// only those facts, plus a handful of supporting receipts/lines, to /api/chat. The answer has to cite fact ids. Nothing here
// calls the network; the outbound boundary (aiOutbound.js) scrubs the pack when it is sent.
//
//   buildEvidencePack({...}) -> { pack, refs }
//     pack  JSON sent to the model: { version, intent, question, period, comparison, currency, basis, coverage, conversion, facts[], evidence[], insufficient }
//     refs  { R1: { txId, itemId } } stays on the device and maps evidence ids back to records
import { comparablePeriods, periodProgress, toRange } from '../utils/period';
import { previousOfPeriod } from '../utils/payCycle';
import { categoryBudgets } from '../utils/budgetMath';
import { fullAmount, isPlanned, monthTotals, round2, shareAmount, spentByCategory, typeOf } from '../utils/money';
import { baseQuantityOf, allocationsInPeriod, changeBetween, comparableUnitPrices, coverage as itemCoverage, periodExpenses, productKey, spendByCategory, spendByMerchant, spendBySubcategory } from '../utils/itemAnalysis';
import { normalizeItems, reconcile } from '../utils/receiptItems';
import { iOwe, owedToMe, personBalances } from '../utils/splits';
import { accountBalances } from '../utils/money';
import { displayName, merchantKey } from '../utils/merchant';
import { isUncategorised } from '../utils/activityFilters';
import { detectSubscriptions } from './insightsEngine';
import { goalProgress } from './insightsAggregates';
import { findDuplicates } from '../import/dedupe';
import { pendingConversionCount } from '../utils/conversion';
import { collectNumbers, figuresNotIn } from '../utils/numberGuard';
import { cycleIdForDate, cycleRange, normalizeConfig } from '../utils/payCycle';
import { computeOpportunities, totalMonthlySaving } from './savingsOpportunities';
import { glossaryFor } from './categoryGlossary';
import { APP_SCREENS, matchFeatures } from './appMap';
import { computePatterns, toModelPatterns } from './patternInsights';

export const PACK_VERSION = 1;
export const INTENTS = ['history', 'top_merchant', 'grocery_breakdown', 'change', 'unit_price', 'owed', 'review', 'budgets_goals', 'save_money', 'afford', 'explain', 'app_help', 'patterns', 'general'];
/** Intents whose answers may use general knowledge (concepts, app documentation) beside the owner's cited figures. */
export const GUIDANCE_INTENTS = ['explain', 'app_help'];
const MAX_EVIDENCE = 24;

// ---------------------------------------------------------------------------
// Routing: question -> deterministic fact builder
// ---------------------------------------------------------------------------
const has = (q, re) => re.test(q);

/** Which fact builder answers the question. Chips pass their intent explicitly; free text goes through this router. */
// Questions about the whole history rather than the open period: averages, per-month figures, trends, "till now", "all my data".
const HISTORY_Q = /(average|on average|avg\b|per month|a month\b|each month|every month|monthly|per cycle|each cycle|typical(ly)?|usually|normally|trend|over time|history|historic|all (my )?(data|time|history|months|transactions)|till now|until now|up to now|so far this year|this year|last (year|\d+ months)|since (i|the|january|start)|ever\b|in total|overall|media\b|in media|al mese|ogni mese|mensil|durchschnitt|pro monat|monatlich|promedio|al mes|mensual|moyenne|par mois|mensuel|میانگین|ماهانه|متوسط|شهري)/i;

// "Can I afford X": answered from what is left of the period (pass 3, A5)
const AFFORD_Q = /(can i afford|could i afford|afford\b|posso permetter|mi posso permettere|permettermi|kann ich mir .{0,40}leisten|mir leisten|puedo permitirme|permitirme|puis-je me permettre|me permettre|از پس.{0,20}برمی|می‌توانم بخرم|هل أستطيع (شراء|تحمل|تحمّل)|أتحمل|أتحمّل)/i;
// "Where can I cut", "how to save", "spend better": answered from the savings opportunities the app computed
const SAVE_Q = /((where|how) (can|could|do|should) i (cut|save|spend less|spend better|reduce)|how to (save|cut|spend less)|ways? to save|save (more |some )?money|spend (better|less|smarter)|cut (back|down|costs|my spending|spending)|reduce (my )?(spending|expenses|costs)|dove posso (risparmiare|tagliare)|come (posso )?risparmi|risparmiare|spendere (meno|meglio)|wo kann ich sparen|wie (kann ich )?spare|weniger ausgeben|geld sparen|d[oó]nde puedo (ahorrar|recortar)|c[oó]mo ahorr|gastar menos|o[uù] (puis-je )?[ée]conomiser|comment [ée]conomiser|d[ée]penser moins|صرفه‌جویی|کمتر خرج|کجا.{0,20}(کم|پس‌انداز)|أين (يمكنني )?(أوفر|التوفير|أوفّر)|كيف أوف|أنفق أقل|توفير المال)/i;
// averages asked per pay cycle rather than per calendar month
const CYCLE_Q = /((per|each|every|a) (pay ?)?(cycle|paycheck|pay ?period)|pay ?cycle|salary to salary|(per|a|ogni) ciclo|da stipendio a stipendio|pro (gehalts)?zyklus|gehaltszyklus|por ciclo|par cycle|هر دوره|كل دورة)/i;

// "Where do I find X", "how do I scan a receipt": answered from the static app map (assistant v2, A-T1). Checked before the
// data intents. "Where can I cut/save" is not here: it stays a saving question.
const APP_HELP_Q = /(where (do|can|could|should) i (find|see|get to|change|set|turn|open|manage|edit|check)|where('s| is| are) the\b|which (screen|page|tab|menu)|how (do|can|could) i (add|scan|import|change|delete|remove|set( up)?|edit|export|turn|switch|start|create|mark|split|undo|enable|disable|connect|record|upload|categori[sz]e|rename|log|hide|share|install|back ?up)\b|how does the app|can the app|does the app|in the app\b|dove (si trova|trovo|posso (trovare|vedere|cambiare|impostare))|come (faccio|si fa) (a|ad|per)\b|come (posso )?(aggiung|scansion|importo|importare|cambi|elimin|impost|esport)|wo (finde|sehe) ich|wo kann ich .{0,30}(finden|sehen|ändern|einstellen)|wie kann ich .{0,30}(hinzufügen|scannen|importieren|ändern|löschen|einstellen|exportieren)|d[oó]nde (encuentro|veo|puedo (encontrar|ver|cambiar))|c[oó]mo (agrego|a[nñ]ado|escaneo|importo|cambio|borro|elimino|configuro|exporto)|o[uù] (trouver|se trouve|puis-je (trouver|voir|changer))|comment (ajouter|scanner|importer|changer|supprimer|modifier|régler|exporter)|کجا.{0,20}(پیدا|ببینم|می‌بینم)|چطور.{0,30}(اضافه|اسکن|وارد|تغییر|حذف)|أين (أجد|يوجد|توجد)|كيف (أضيف|أمسح|أستورد|أغير|أغيّر|أحذف))/i;
// Conceptual / normative questions: what a budget is, why budget a fixed cost, is it worth... (assistant v2, A-T1).
// "why did/was my X" is a factual question about the past and keeps routing to change; "what is my ..." is a data question.
const CONCEPTS = '(budget(ing|s)?|saving(s)? rate|savings?|inflation|interest|compound|emergency fund|net worth|cash ?flow|fixed (cost|expense)s?|variable (cost|expense)s?|sinking fund|zero[- ]based|50/30/20|apr|credit score|tax(es)?|debt|pay ?cycle|envelope)';
const EXPLAIN_Q = new RegExp(
    [
        `what('s| is| are) (a |an )?${CONCEPTS}\\b`,
        'what (does|do) .{1,40} mean',
        'what is the (point|purpose|difference|meaning|idea|benefit|rule)',
        "what's the (point|purpose|difference|meaning|idea|benefit)",
        'why (should|would|must) i',
        'why do i (need|have to|want)',
        "why (is it|it's) (important|good|useful|worth|smart)",
        'do i (really |even )?need (a |an |to )',
        'should i (set|have|use|make|create|keep|track|start|bother)',
        'is it (worth|wise|smart|a good idea)',
        'does it make sense',
        `\\bexplain (to me )?(what|how|why (i|a|you)|the (concept|idea|point|difference)|${CONCEPTS})`,
        `how (does|do) ${CONCEPTS} work`,
        'meaning of',
        "cosa significa|che cos'?è|cos'?è (un|una|il|la|l')|perch[eé] dovrei|a cosa serve|ha senso|vale la pena|ho (davvero )?bisogno di",
        'was (ist|sind|bedeutet) (ein|eine|das|der|die)?\\s?(budget|sparquote|inflation|zins|notgroschen|fixkosten)|was bedeutet|warum sollte ich|brauche ich (wirklich )?(ein|einen|eine)|lohnt es sich|ist es sinnvoll',
        'qu[eé] (es|son) (un |una |el |la )?(presupuesto|ahorro|inflaci[oó]n|inter[eé]s|tasa)|qu[eé] significa|por qu[eé] (deber[ií]a|necesito)|para qu[eé] sirve|necesito (realmente )?(un|una)|vale la pena|tiene sentido',
        "qu['’]est-ce (que|qu)|que signifie|pourquoi (devrais|dois)-je|pourquoi (ai-je|j'ai) besoin|à quoi sert|ai-je (vraiment )?besoin|ça vaut la peine|est-ce utile",
        'چرا باید|چیست|یعنی چه|آیا لازم|به چه درد',
        'لماذا (يجب|علي|أحتاج)|ما (هو|هي) (ال)?(ميزانية|الادخار|التضخم|الفائدة)|ماذا يعني|هل أحتاج',
    ].join('|'),
    'i'
);

// Habits and patterns (assistant v2, B-T2): answered from the deterministic pattern detectors
const PATTERNS_Q = /(pattern|habit|spending behaviou?r|when do i (spend|shop)|which days|weekend spending|do i spend more on|abitudin|comportament|quando spendo|gewohnheit|muster|wann gebe ich|h[aá]bito|patr[oó]n|patrones|cu[aá]ndo gasto|habitude|comportement|quand est-ce que je d[ée]pense|quand je d[ée]pense|عادت|الگو|عادات|أنماط|نمط)/i;

export function routeQuestion(question) {
    const q = String(question || '').toLowerCase();
    if (APP_HELP_Q.test(q)) return 'app_help';
    if (AFFORD_Q.test(q)) return 'afford';
    if (has(q, /\b(owe|owed|owing|settle|settlement|reimburs|debt|who pays|devo|mi devono|deve)\b/) && !EXPLAIN_Q.test(q)) return 'owed';
    if (SAVE_Q.test(q)) return 'save_money';
    if (PATTERNS_Q.test(q)) return 'patterns';
    // before history ("why should I budget every month" is a concept, not an average) and before the bare budget|goal test
    if (EXPLAIN_Q.test(q)) return 'explain';
    if (HISTORY_Q.test(q)) return 'history';
    if (has(q, /(per (kg|kilo|litre|liter|l\b|unit|piece)|unit price|price per|paying more|buying more|cost more|more expensive|prezzo al)/)) return 'unit_price';
    if (has(q, /(needs? (review|attention|checking)|to review|review queue|uncategori[sz]ed|duplicate|subscription|recurring|unclear|recategori[sz]e|re-?categori[sz]e|doppion)/)) return 'review';
    if (has(q, /\b(budget|budgets|goal|goals|on track|afford|commitment|commitments|upcoming|savings?)\b/)) return 'budgets_goals';
    if (has(q, /\b(top|most|biggest|largest|highest)\b.*\b(supermarket|merchant|shop|store|place|vendor|supermercato|negozio)\b/) || has(q, /\bwhere (do|did) i (spend|shop)\b.*\bmost\b/)) return 'top_merchant';
    if (has(q, /(grocer|supermarket|supermercato|spesa|food shop|food spending|what drove|what drives|drove)/)) return 'grocery_breakdown';
    if (has(q, /(change|changed|differ|compared|previous|last (cycle|month|period)|rispetto|vs\.?\b|more than before|increase|decrease)/)) return 'change';
    if (has(q, /\b(top|most|biggest|largest)\b/)) return 'top_merchant';
    return 'general';
}

/** Does the question narrow the merchant ranking to groceries? */
const wantsGroceries = (question) => /(supermarket|grocer|supermercato|spesa)/i.test(String(question || ''));

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
class Book {
    constructor() {
        this.facts = [];
        this.evidence = [];
        this.refs = {};
        this.seen = new Map();
    }
    fact(kind, data, refs = []) {
        const f = { id: `F${this.facts.length + 1}`, kind, ...data, refs: [...new Set(refs)] };
        this.facts.push(f);
        return f;
    }
    /** An evidence line (a receipt or one item line); returns its id or null when the cap is reached. */
    ref(e) {
        const key = `${e.txId}:${e.itemId || ''}`;
        if (this.seen.has(key)) return this.seen.get(key);
        if (this.evidence.length >= MAX_EVIDENCE) return null;
        const id = `R${this.evidence.length + 1}`;
        const { txId, itemId, ...shown } = e;
        this.evidence.push({ id, type: itemId ? 'item' : 'receipt', ...shown });
        this.refs[id] = { txId, itemId: itemId || null };
        this.seen.set(key, id);
        return id;
    }
}

const dateOf = (d) => String(d || '').slice(0, 10);
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
const basisAmount = (tx, basis) => (basis === 'full' ? fullAmount(tx) : shareAmount(tx));

const receiptRef = (book, tx, basis, extra = {}) =>
    book.ref({ txId: tx.id, date: dateOf(tx.date), merchant: displayName(tx.merchant) || tx.merchant || '', amount: round2(basisAmount(tx, basis)), category: tx.category || null, ...(tx.extraction?.pending ? { uncertain: true } : {}), ...extra });

/** Evidence lines for the allocations that back a fact (largest first). Item lines still marked uncertain are flagged. */
function lineRefs(book, rows, transactions, limit = 4) {
    const byId = new Map(transactions.map((t) => [t.id, t]));
    const out = [];
    for (const r of [...rows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, limit)) {
        const tx = byId.get(r.txId);
        if (!tx) continue;
        if (r.unallocated || !r.itemId) {
            out.push(receiptRef(book, tx, 'share', { note: r.unallocated ? 'no item detail' : undefined }));
            continue;
        }
        const item = normalizeItems(tx.lineItems, tx.category).find((it) => it.id === r.itemId);
        const uncertain = !!item && item.reviewStatus !== 'confirmed' && (item.reviewStatus === 'needs_review' || item.amount === null);
        out.push(book.ref({ txId: tx.id, itemId: r.itemId, date: r.date, merchant: r.merchant, name: r.name, amount: round2(r.amount), category: r.category, subcategory: r.subcategory || null, ...(uncertain ? { uncertain: true } : {}) }));
    }
    return out.filter(Boolean);
}

function totalSpend(txs, period, basis) {
    return round2(periodExpenses(txs, period).reduce((s, tx) => s + basisAmount(tx, basis), 0));
}

function addPeriodSummary(book, ctx) {
    const { transactions, trips, accounts, period, basis } = ctx;
    const t = monthTotals(transactions, period, { trips, accounts });
    book.fact('period_summary', { spent: basis === 'full' ? totalSpend(transactions, period, 'full') : t.spent, income: t.income, saved: t.saved, upcoming: t.upcoming });
}

function topMerchant(book, ctx) {
    const { transactions, period, basis, question } = ctx;
    const category = wantsGroceries(question) ? 'Groceries' : undefined;
    const rows = spendByMerchant(transactions, period, { basis, category });
    const total = category ? rows.reduce((s, r) => s + r.total, 0) : totalSpend(transactions, period, basis);
    if (rows.length === 0) return { insufficient: 'no_spending' };
    rows.slice(0, 3).forEach((r) => {
        const byId = new Map(transactions.map((t) => [t.id, t]));
        const refs = r.refs.slice().sort((a, b) => b.amount - a.amount).slice(0, 3).map((x) => byId.get(x.txId)).filter(Boolean).map((tx) => receiptRef(book, tx, basis));
        book.fact('merchant', { name: r.name, amount: r.total, count: r.count, sharePct: pct(r.total, total), ...(category ? { category } : {}) }, refs);
    });
    book.fact('spend_total', { amount: round2(total), ...(category ? { category } : {}) });
    return { coverage: itemCoverage(transactions, period, { category, basis }) };
}

function groceryBreakdown(book, ctx) {
    const { transactions, period, basis, comparison } = ctx;
    const category = 'Groceries';
    const cov = itemCoverage(transactions, period, { category, basis });
    if (cov.receipts === 0) return { insufficient: 'no_grocery_receipts', coverage: cov };
    const rows = allocationsInPeriod(transactions, period, { basis }).filter((r) => r.category === category);
    // `amount` is what the grocery receipts cost (as on the Breakdown page); lines on those receipts that belong to another category
    // (batteries on a supermarket receipt) are not grocery spending and are listed apart so the subcategories add up
    const lineTotal = round2(rows.reduce((s, r) => s + r.amount, 0));
    book.fact('category_total', { category, amount: cov.total, count: cov.receipts, itemisedPct: pct(cov.itemised, cov.total), unknown: cov.unknown, receiptsWithItems: cov.receiptsWithItems, groceryLines: lineTotal, otherCategoryLines: round2(cov.total - lineTotal) });
    for (const g of spendBySubcategory(transactions, period, { category, basis }).slice(0, 7)) {
        const refs = lineRefs(book, rows.filter((r) => (r.subcategory || 'unknown') === g.key), transactions, 3);
        book.fact('subcategory', { label: g.key, amount: g.total, itemised: g.itemised, unknown: g.unallocated, ...(g.key === 'unknown' ? { noItemDetail: true } : {}) }, refs);
    }
    // top individual lines (read from receipts: may contain extraction errors)
    const lines = rows.filter((r) => !r.unallocated).sort((a, b) => b.amount - a.amount).slice(0, 5);
    if (lines.length) book.fact('top_items', { items: lines.map((l) => ({ name: l.name, amount: round2(l.amount), merchant: l.merchant, date: l.date })), extracted: true }, lineRefs(book, lines, transactions, 5));
    // merchants inside the category
    for (const m of spendByMerchant(transactions, period, { basis, category }).slice(0, 3)) {
        const byId = new Map(transactions.map((t) => [t.id, t]));
        book.fact('merchant', { name: m.name, amount: m.total, count: m.count, category }, m.refs.slice(0, 2).map((x) => byId.get(x.txId)).filter(Boolean).map((tx) => receiptRef(book, tx, basis)));
    }
    // what changed against the comparable earlier period
    if (comparison) {
        const ch = changeBetween(transactions, comparison.current, comparison.previous, { by: 'subcategory', category, basis });
        book.fact('change_total', { label: category, current: ch.current, previous: ch.previous, delta: ch.delta, pct: ch.pct === null ? null : Math.round(ch.pct), comparison: comparison.basis });
        for (const r of ch.rows.filter((x) => Math.abs(x.delta) >= 0.01).slice(0, 3)) {
            const refs = lineRefs(book, allocationsInPeriod(transactions, comparison.current, { basis }).filter((x) => x.category === category && (x.subcategory || 'unknown') === r.key), transactions, 2);
            book.fact('change_row', { label: r.label, current: r.current, previous: r.previous, delta: r.delta, by: 'subcategory' }, refs);
        }
    }
    return { coverage: cov };
}

function change(book, ctx) {
    const { transactions, basis, comparison } = ctx;
    if (!comparison) return { insufficient: 'no_comparison' };
    const byCat = changeBetween(transactions, comparison.current, comparison.previous, { by: 'category', basis });
    if (byCat.current === 0 && byCat.previous === 0) return { insufficient: 'no_spending' };
    book.fact('change_total', { label: 'all', current: byCat.current, previous: byCat.previous, delta: byCat.delta, pct: byCat.pct === null ? null : Math.round(byCat.pct), comparison: comparison.basis, elapsedDays: comparison.elapsedDays, totalDays: comparison.totalDays });
    const byId = new Map(transactions.map((t) => [t.id, t]));
    for (const r of byCat.rows.filter((x) => Math.abs(x.delta) >= 0.01).slice(0, 4)) {
        const refs = r.refs.slice().sort((a, b) => b.amount - a.amount).slice(0, 2).map((x) => byId.get(x.txId)).filter(Boolean).map((tx) => receiptRef(book, tx, basis));
        book.fact('change_row', { label: r.label, current: r.current, previous: r.previous, delta: r.delta, by: 'category' }, refs);
    }
    const byMerchant = changeBetween(transactions, comparison.current, comparison.previous, { by: 'merchant', basis });
    for (const r of byMerchant.rows.filter((x) => Math.abs(x.delta) >= 0.01).slice(0, 3)) {
        const refs = r.refs.slice().sort((a, b) => b.amount - a.amount).slice(0, 2).map((x) => byId.get(x.txId)).filter(Boolean).map((tx) => receiptRef(book, tx, basis));
        book.fact('change_row', { label: r.label, current: r.current, previous: r.previous, delta: r.delta, by: 'merchant' }, refs);
    }
    return { coverage: itemCoverage(transactions, ctx.period, { basis }) };
}

/** Per product: how much was bought (base units) and what was paid per base unit, in the two comparable periods. Units must match. */
export function productComparison(transactions, comparison, { basis = 'share' } = {}) {
    const stats = (period) => {
        const m = new Map();
        for (const tx of periodExpenses(transactions, period)) {
            const total = Number(tx.total) || 0;
            const ratio = total ? (basis === 'full' ? fullAmount(tx) : shareAmount(tx)) / total : 1;
            for (const it of normalizeItems(tx.lineItems, tx.category)) {
                const q = baseQuantityOf(it);
                const key = productKey(it.name);
                if (!q || !key || it.amount === null) continue;
                const g = m.get(key) || { key, name: it.name, families: new Set(), base: q.base, qty: 0, spend: 0, lines: 0 };
                g.families.add(q.family);
                g.qty += q.qty;
                g.spend += it.amount * ratio;
                g.lines += 1;
                g.txId = tx.id;
                g.itemId = it.id;
                m.set(key, g);
            }
        }
        return m;
    };
    const cur = stats(comparison.current);
    const prev = stats(comparison.previous);
    const out = [];
    for (const [key, c] of cur) {
        const p = prev.get(key);
        if (!p) continue;
        const families = new Set([...c.families, ...p.families]);
        if (families.size !== 1) continue; // kg vs litre vs count are never compared
        const priceNow = c.qty > 0 ? c.spend / c.qty : null;
        const pricePrev = p.qty > 0 ? p.spend / p.qty : null;
        if (!priceNow || !pricePrev) continue;
        const qtyChange = p.qty > 0 ? (c.qty - p.qty) / p.qty : null;
        const priceChange = (priceNow - pricePrev) / pricePrev;
        const moreQty = qtyChange !== null && qtyChange >= 0.05;
        const morePrice = priceChange >= 0.05;
        out.push({
            key, name: c.name, base: c.base, qtyNow: round2(c.qty), qtyPrev: round2(p.qty), priceNow: round2(priceNow), pricePrev: round2(pricePrev), spendNow: round2(c.spend), spendPrev: round2(p.spend),
            qtyChangePct: qtyChange === null ? null : Math.round(qtyChange * 100), priceChangePct: Math.round(priceChange * 100),
            verdict: moreQty && morePrice ? 'both' : moreQty ? 'buying_more' : morePrice ? 'paying_more' : 'neither', txId: c.txId, itemId: c.itemId,
        });
    }
    return out.sort((a, b) => Math.abs(b.spendNow - b.spendPrev) - Math.abs(a.spendNow - a.spendPrev));
}

function unitPrice(book, ctx) {
    const { transactions, basis, comparison } = ctx;
    if (!comparison) return { insufficient: 'no_comparison' };
    const rows = productComparison(transactions, comparison, { basis }).slice(0, 6);
    if (rows.length === 0) return { insufficient: 'no_comparable_units' };
    const byId = new Map(transactions.map((t) => [t.id, t]));
    for (const r of rows) {
        const { txId, itemId, ...data } = r;
        const tx = byId.get(txId);
        const refs = tx ? [book.ref({ txId, itemId, date: dateOf(tx.date), merchant: displayName(tx.merchant) || '', name: r.name, amount: r.spendNow })] : [];
        book.fact('unit_price', { ...data, extracted: true }, refs);
    }
    const mixed = comparableUnitPrices(transactions, undefined, { minPoints: 2 }).filter((p) => !p.comparable).length;
    if (mixed) book.fact('unit_note', { skippedMixedUnits: mixed });
    return { coverage: itemCoverage(transactions, ctx.period, { basis }) };
}

function owed(book, ctx) {
    const { transactions, people } = ctx;
    const balances = personBalances(transactions, people).filter((b) => b.cents !== 0 || b.events.some((e) => !e.settled));
    if (balances.length === 0) return { insufficient: 'no_shared' };
    book.fact('owed_total', { owedToMe: round2(owedToMe(balances) / 100), iOwe: round2(iOwe(balances) / 100) });
    const byId = new Map(transactions.map((t) => [t.id, t]));
    for (const b of balances.slice(0, 6)) {
        const open = b.events.filter((e) => !e.settled && e.kind !== 'settlement');
        const refs = open.slice(0, 3).map((e) => byId.get(e.txId)).filter(Boolean).map((tx) => receiptRef(book, tx, 'full'));
        book.fact('balance', { personId: b.id, name: b.name, amount: round2(Math.abs(b.cents) / 100), direction: b.cents > 0 ? 'owes_me' : b.cents < 0 ? 'i_owe' : 'even', openItems: open.length }, refs);
    }
    return { skipPeriod: true };
}

/** Records that need a look: uncategorised, unread photos, receipts whose items do not add up, probable duplicates, subscription-like charges. */
export function reviewCandidates(transactions, { period, today } = {}) {
    const live = (transactions || []).filter((t) => t && !t.isDemo);
    const inScope = (t) => !period || periodExpenses([t], period).length === 1;
    const uncategorised = live.filter((t) => isUncategorised(t) && !isPlanned(t) && inScope(t));
    const pending = live.filter((t) => t.extraction?.pending);
    const mismatched = live.filter((t) => typeOf(t) === 'expense' && inScope(t) && reconcile(t).hasItems && reconcile(t).status !== 'complete' && !t.extraction?.pending);
    const needsReview = live.filter((t) => typeOf(t) === 'expense' && inScope(t) && normalizeItems(t.lineItems, t.category).some((it) => it.reviewStatus === 'needs_review'));
    const exp = live.filter((t) => typeOf(t) === 'expense' && !t.extraction?.pending && inScope(t));
    const dupes = [];
    const seen = new Set();
    for (const t of exp) {
        const pairs = findDuplicates([{ merchant: t.merchant, description: t.merchant, amount: Number(t.total), date: t.date, transactionType: 'expense' }], exp.filter((o) => o.id !== t.id && !seen.has(`${o.id}:${t.id}`)), { maxDays: 1 });
        for (const p of pairs.filter((x) => x.merchantMatch && x.existing)) {
            // keep the richer record (photo, items, split), then the earlier one; two photographed records are never offered
            if (t.imagePath && p.existing.imagePath) continue;
            const score = (x) => (x.imagePath ? 4 : 0) + ((x.lineItems || []).length ? 2 : 0) + (x.splitData ? 1 : 0);
            const a = score(t) !== score(p.existing) ? (score(t) > score(p.existing) ? t : p.existing) : t.createdAt <= p.existing.createdAt ? t : p.existing;
            const b = a === t ? p.existing : t;
            seen.add(`${a.id}:${b.id}`);
            seen.add(`${b.id}:${a.id}`);
            dupes.push({ keep: a, remove: b });
        }
    }
    const subs = detectSubscriptions(live, { until: today ? dateOf(today) : undefined });
    return { uncategorised, pending, mismatched, needsReview, dupes, subscriptions: subs };
}

function review(book, ctx) {
    const { transactions, period, today } = ctx;
    const c = reviewCandidates(transactions, { period, today });
    const total = c.uncategorised.length + c.pending.length + c.mismatched.length + c.needsReview.length + c.dupes.length + c.subscriptions.length;
    if (total === 0) return { insufficient: 'nothing_to_review', clean: true };
    const refsOf = (list) => list.slice(0, 3).map((tx) => receiptRef(book, tx, ctx.basis));
    if (c.uncategorised.length) book.fact('review_count', { label: 'uncategorised', count: c.uncategorised.length, amount: round2(c.uncategorised.reduce((s, t) => s + basisAmount(t, ctx.basis), 0)) }, refsOf(c.uncategorised));
    if (c.pending.length) book.fact('review_count', { label: 'photo_unread', count: c.pending.length }, refsOf(c.pending));
    if (c.mismatched.length) book.fact('review_count', { label: 'items_dont_add_up', count: c.mismatched.length, amount: round2(c.mismatched.reduce((s, t) => s + Math.abs(reconcile(t).unallocated), 0)) }, refsOf(c.mismatched));
    if (c.needsReview.length) book.fact('review_count', { label: 'lines_need_review', count: c.needsReview.length }, refsOf(c.needsReview));
    if (c.dupes.length) book.fact('review_count', { label: 'possible_duplicates', count: c.dupes.length }, c.dupes.slice(0, 3).flatMap((d) => [receiptRef(book, d.keep, ctx.basis), receiptRef(book, d.remove, ctx.basis)]));
    for (const s of c.subscriptions.slice(0, 3)) {
        const last = transactions.filter((t) => (t.merchantKey || merchantKey(t.merchant)) === s.key).sort((a, b) => dateOf(b.date).localeCompare(dateOf(a.date)))[0];
        book.fact('subscription_like', { name: s.name, amount: s.amount, months: s.count, lastDate: s.lastDate }, last ? [receiptRef(book, last, ctx.basis)] : []);
    }
    return {};
}

function budgetsGoals(book, ctx) {
    const { transactions, trips, accounts, budgets, goals, period, today, basis } = ctx;
    const rows = categoryBudgets(budgets, transactions, period, trips, { today, accounts });
    const t = monthTotals(transactions, period, { trips, accounts });
    const balances = accountBalances(accounts, transactions);
    const gs = (goals || []).filter((g) => g && !g.isArchived).map((g) => {
        const saved = goalProgress(g, transactions, balances);
        return { name: g.name, target: round2(Number(g.targetAmount) || 0), saved, remaining: Math.max(0, round2((Number(g.targetAmount) || 0) - saved)), targetDate: g.targetDate ? dateOf(g.targetDate) : null };
    });
    const named = categoryFromQuestion(ctx.question, ctx.categoryNames);
    if (rows.length === 0 && gs.length === 0 && !named) return { insufficient: 'no_budgets_goals' };
    for (const r of rows.slice(0, 6)) book.fact('budget', { category: r.category === '*' ? 'Total' : r.category, budget: r.amount, spent: r.spent, status: r.status, projected: r.projected, pacePct: Math.round(r.pacePct) });
    // a category the question names: its spend and its budget, or the fact that it has none (with a suggestion)
    if (named) addCategoryFacts(book, ctx, named, { budgetRows: rows, skipBudgetRow: rows.slice(0, 6).some((r) => r.category === named) });
    book.fact('commitments', { upcoming: t.upcoming, saved: t.saved, income: t.income });
    for (const g of gs.slice(0, 4)) book.fact('goal', g);
    void basis;
    return {};
}

function general(book, ctx) {
    const { transactions, period, basis } = ctx;
    if (periodExpenses(transactions, period).length === 0) return { insufficient: 'no_spending' };
    const cats = Object.entries(spentByCategory(transactions, period, { includeTrips: true })).sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [category, amount] of cats) book.fact('category_total', { category, amount: round2(amount) });
    for (const r of spendByMerchant(transactions, period, { basis }).slice(0, 3)) {
        const byId = new Map(transactions.map((t) => [t.id, t]));
        book.fact('merchant', { name: r.name, amount: r.total, count: r.count }, r.refs.slice(0, 2).map((x) => byId.get(x.txId)).filter(Boolean).map((tx) => receiptRef(book, tx, basis)));
    }
    // budgets, when there are any: "where can I cut" needs the limits next to the spending
    for (const r of categoryBudgets(ctx.budgets || [], transactions, period, ctx.trips || [], { today: ctx.today, accounts: ctx.accounts || [] }).slice(0, 4)) {
        book.fact('budget', { category: r.category === '*' ? 'Total' : r.category, budget: r.amount, spent: r.spent, status: r.status, projected: r.projected, pacePct: Math.round(r.pacePct) });
    }
    return { coverage: itemCoverage(transactions, period, { basis }) };
}

const CATEGORY_WORDS = [
    ['Groceries', /(grocer|supermarket|supermercato|\bspesa\b|lebensmittel|supermarkt|comestibles|supermercado|courses|épicerie|خواربار|سوپرمارکت|بقالة)/i],
    ['Dining', /(dining|restaurant|eating out|takeaway|ristorant|pizzer|\bbar\b|caf[eé]|essen gehen|restaurante|resto|رستوران|مطعم)/i],
    ['Transport', /(transport|train|bus|metro|taxi|uber|treno|trasport|zug|bahn|tren|trajet|حمل|مواصلات)/i],
    ['Fuel', /(fuel|petrol|gas station|benzin|carburant|gasolin|بنزین|وقود)/i],
    ['Housing', /(rent|housing|affitto|miete|alquiler|loyer|اجاره|إيجار)/i],
    ['Utilities', /(utilit|electric|bollett|strom|luce|gas bill|factura|facture|قبض|فواتير)/i],
    ['Subscriptions', /(subscription|abbonament|abo\b|suscripci|abonnement|اشتراک|اشتراك)/i],
    ['Shopping', /(shopping|clothes|vestiti|kleidung|ropa|vêtements|خرید|تسوق)/i],
    ['Health', /(health|pharmac|farmac|doctor|medic|apothek|salud|santé|دارو|صحة)/i],
    ['Travel', /(travel|trip|holiday|vacation|viaggi|reise|viaje|voyage|سفر)/i],
];

/** The category a question is about: an exact category name first, then common words in the app's languages. */
export function categoryFromQuestion(question, categoryNames = []) {
    const q = String(question || '');
    const names = [...(categoryNames || [])].sort((a, b) => String(b).length - String(a).length);
    for (const n of names) if (n && new RegExp(`\\b${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)) return n;
    for (const [cat, re] of CATEGORY_WORDS) if (re.test(q)) return cat;
    return null;
}

const monthOf = (d) => String(d || '').slice(0, 7);
const nextMonth = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/**
 * Whole-history answer ("average monthly groceries", "check all my data"): per calendar month from the first recorded
 * expense to today, the average over complete months (the running month is reported separately, never averaged in),
 * highest and lowest month, and the top categories by monthly average when no category is named.
 */
const todayKeyOf = (today) => (typeof today === 'string' ? today.slice(0, 10) : new Date(today).toISOString().slice(0, 10));

/**
 * Per calendar month from the first recorded expense to today (optionally one category): totals, the average and median over
 * complete months (empty months count 0, the running month is kept apart), highest and lowest month. null without expenses.
 */
export function monthlyHistory(transactions, { category = null, basis = 'share', today = new Date() } = {}) {
    const expenses = periodExpenses(transactions);
    if (!expenses.length) return null;
    const all = expenses.filter((tx) => (category ? tx.category === category : true));
    const todayKey = todayKeyOf(today);
    const current = monthOf(todayKey);
    const first = expenses.map((t) => monthOf(t.date)).filter(Boolean).sort()[0];
    const months = [];
    for (let m = first; m <= current; m = nextMonth(m)) months.push(m);
    const byMonth = new Map(months.map((m) => [m, { total: 0, count: 0 }]));
    for (const tx of all) {
        const row = byMonth.get(monthOf(tx.date));
        if (!row) continue;
        row.total += basisAmount(tx, basis);
        row.count += 1;
    }
    const complete = months.filter((m) => m < current);
    const completeTotals = complete.map((m) => round2(byMonth.get(m).total));
    const sum = completeTotals.reduce((a, b) => a + b, 0);
    const avg = complete.length ? round2(sum / complete.length) : null;
    const sorted = [...completeTotals].sort((a, b) => a - b);
    const median = sorted.length ? round2(sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
    const withData = complete.filter((m) => byMonth.get(m).count > 0);
    const hi = withData.reduce((a, m) => (!a || byMonth.get(m).total > byMonth.get(a).total ? m : a), null);
    const lo = withData.reduce((a, m) => (!a || byMonth.get(m).total < byMonth.get(a).total ? m : a), null);
    const last3 = completeTotals.slice(-3);
    const avg3 = last3.length ? round2(last3.reduce((a, b) => a + b, 0) / last3.length) : null;
    return { expenses, all, todayKey, current, first, months, byMonth, complete, sum, avg, median, withData, hi, lo, avg3, last3Months: last3.length };
}

function history(book, ctx) {
    const { transactions, basis, question, today, categoryNames } = ctx;
    const category = categoryFromQuestion(question, categoryNames);
    const h = monthlyHistory(transactions, { category, basis, today });
    if (!h) return { insufficient: 'no_history', skipPeriod: true };
    const { expenses, all, todayKey, current, first, months, byMonth, complete, sum, avg, median, withData, hi, lo } = h;
    const byId = new Map(all.map((t) => [t.id, t]));
    const biggest = all.slice().sort((a, b) => basisAmount(b, basis) - basisAmount(a, basis)).slice(0, 3).map((tx) => receiptRef(book, byId.get(tx.id), basis));
    book.fact('history_scope', { category: category || 'all spending', from: first, to: current, months: months.length, completeMonths: complete.length, monthsWithSpending: withData.length, unit: 'calendar month', runningMonth: current });
    book.fact(
        'history_average',
        { category: category || 'all spending', averagePerMonth: avg, medianPerMonth: median, totalCompleteMonths: round2(sum), highest: hi ? { month: hi, amount: round2(byMonth.get(hi).total) } : null, lowest: lo ? { month: lo, amount: round2(byMonth.get(lo).total) } : null, runningMonthSoFar: round2(byMonth.get(current)?.total || 0), note: 'average over complete calendar months, months with no spending count as 0, the running month is not included' },
        biggest
    );
    for (const m of months.slice(-24)) book.fact('history_month', { month: m, amount: round2(byMonth.get(m).total), count: byMonth.get(m).count, ...(m === current ? { running: true } : {}) });
    if (!category && complete.length) {
        const cats = new Map();
        for (const tx of expenses) {
            if (monthOf(tx.date) >= current) continue;
            const c = tx.category || 'Other';
            cats.set(c, (cats.get(c) || 0) + basisAmount(tx, basis));
        }
        [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([c, total]) => book.fact('history_category', { category: c, averagePerMonth: round2(total / complete.length), total: round2(total) }));
    }
    // Per pay cycle (salary to salary) when the owner works in cycles or asks for it: same rules, the running cycle is kept apart
    const cfg = ctx.config ? normalizeConfig(ctx.config) : null;
    const perCycle = CYCLE_Q.test(String(question || ''));
    if (cfg && (cfg.configured || perCycle)) {
        const firstDay = expenses.map((t) => dateOf(t.date)).filter(Boolean).sort()[0];
        const firstCycle = cycleIdForDate(firstDay, cfg);
        const currentCycle = cycleIdForDate(todayKey, cfg);
        const ids = [];
        for (let c = firstCycle; c <= currentCycle && ids.length < 240; c = nextMonth(c)) ids.push(c);
        const byCycle = new Map(ids.map((c) => [c, { total: 0, count: 0 }]));
        for (const tx of all) {
            const row = byCycle.get(cycleIdForDate(dateOf(tx.date), cfg));
            if (!row) continue;
            row.total += basisAmount(tx, basis);
            row.count += 1;
        }
        const done = ids.filter((c) => c < currentCycle);
        const totals = done.map((c) => round2(byCycle.get(c).total));
        const sorted2 = [...totals].sort((a, b) => a - b);
        const range = (c) => cycleRange(c, cfg);
        const pick = (cmp) => done.filter((c) => byCycle.get(c).count > 0).reduce((a, c) => (!a || cmp(byCycle.get(c).total, byCycle.get(a).total) ? c : a), null);
        const hiC = pick((x, y) => x > y);
        const loC = pick((x, y) => x < y);
        const row = (c) => (c ? { cycle: c, start: range(c).start, end: range(c).end, amount: round2(byCycle.get(c).total) } : null);
        book.fact('history_cycle_average', {
            category: category || 'all spending',
            unit: 'pay cycle',
            averagePerCycle: done.length ? round2(totals.reduce((a, b) => a + b, 0) / done.length) : null,
            medianPerCycle: sorted2.length ? round2(sorted2.length % 2 ? sorted2[(sorted2.length - 1) / 2] : (sorted2[sorted2.length / 2 - 1] + sorted2[sorted2.length / 2]) / 2) : null,
            cycles: ids.length,
            completeCycles: done.length,
            from: range(firstCycle).start,
            to: todayKey,
            highest: row(hiC),
            lowest: row(loC),
            runningCycleSoFar: round2(byCycle.get(currentCycle)?.total || 0),
            asked: perCycle,
            note: 'average over complete pay cycles (salary to salary), cycles with no spending count as 0, the running cycle is not included',
        });
        if (perCycle) for (const c of ids.slice(-12)) book.fact('history_cycle', { ...row(c), count: byCycle.get(c).count, ...(c === currentCycle ? { running: true } : {}) });
    }
    return { skipPeriod: true, history: { start: `${first}-01`, end: todayKey } };
}

/** An opportunity as a fact: its figures and names, plus the receipts behind it (largest first). */
function opportunityFact(book, ctx, o) {
    const byId = new Map(ctx.transactions.map((t) => [t.id, t]));
    const refs = o.evidence.slice(0, 3).map((id) => byId.get(id)).filter(Boolean).map((tx) => receiptRef(book, tx, 'share'));
    return book.fact('opportunity', { oppKind: o.kind, category: o.category, merchant: o.merchantName, monthlySaving: o.monthlySaving, yearlySaving: o.yearlySaving, confidence: o.level, action: o.action?.type || null, periodStart: o.scope?.start || null, periodEnd: o.scope?.end || null, ...o.params }, refs);
}

/**
 * "Where can I cut", "how can I save", "spend better": the savings opportunities the app computed for the open period (the same
 * cards as on Insights, without the ones marked "Not useful"). The model explains them; it cannot add one.
 */
function saveMoney(book, ctx) {
    const { top } = computeOpportunities({ transactions: ctx.transactions, budgets: ctx.budgets, goals: ctx.goals, accounts: ctx.accounts, trips: ctx.trips, groups: ctx.groups, period: ctx.period, today: ctx.today, dismissed: ctx.dismissed });
    if (top.length === 0) return { insufficient: 'no_opportunities' };
    for (const o of top) opportunityFact(book, ctx, o);
    const monthly = totalMonthlySaving(top);
    if (monthly > 0) book.fact('saving_total', { monthly, yearly: round2(monthly * 12), count: top.filter((o) => o.monthlySaving > 0).length });
    return {};
}

/** The amount in "can I afford 250", "posso permettermi 1.200 €": the first figure of the question, or null. */
export function amountFromQuestion(question) {
    const m = /(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/.exec(String(question || '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)));
    if (!m) return null;
    const n = Number(m[1].replace(/\s/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

/**
 * "Can I afford X": what is left of the running period after what is spent and still to pay (from the income logged for the
 * period and, when there is one, the whole-period budget: the tighter of the two decides), the amount asked about, what would be
 * left per day afterwards and the app's verdict (fits / tight / exceeds). The best savings are added as ways to make room.
 */
function afford(book, ctx) {
    const { transactions, trips, accounts, budgets, period, today, question } = ctx;
    const progress = periodProgress(period, today);
    if (progress.state !== 'current') return { insufficient: 'afford_closed' };
    const t = monthTotals(transactions, period, { trips, accounts });
    const whole = categoryBudgets(budgets, transactions, period, trips, { today, accounts }).find((r) => r.category === '*');
    if (!(t.income > 0) && !whole) return { insufficient: 'afford_unknown' };
    const incomeLeft = t.income > 0 ? round2(t.income - t.spent - t.upcoming) : null;
    const budgetLeft = whole ? round2(whole.amount - t.spent - t.upcoming) : null;
    const left = Math.min(...[incomeLeft, budgetLeft].filter((x) => x !== null));
    const perDay = round2(Math.max(0, left) / progress.daysLeft);
    if (incomeLeft !== null) book.fact('afford_room', { income: t.income, spent: t.spent, upcoming: t.upcoming, left: incomeLeft, daysLeft: progress.daysLeft, perDay: round2(Math.max(0, incomeLeft) / progress.daysLeft) });
    if (whole) book.fact('afford_budget', { budget: whole.amount, budgetLeft, spent: t.spent, upcoming: t.upcoming, daysLeft: progress.daysLeft });
    const amount = amountFromQuestion(question);
    if (amount !== null) {
        const leftAfter = round2(left - amount);
        book.fact('afford_request', { amount, left: round2(left), leftAfter, short: leftAfter < 0 ? round2(-leftAfter) : 0, perDayBefore: perDay, perDayAfter: round2(Math.max(0, leftAfter) / progress.daysLeft), daysLeft: progress.daysLeft, limitedBy: budgetLeft !== null && budgetLeft === left ? 'budget' : 'income', verdict: leftAfter < 0 ? 'exceeds' : leftAfter < left * 0.25 ? 'tight' : 'fits' });
    }
    const { top } = computeOpportunities({ transactions, budgets, goals: ctx.goals, accounts, trips, groups: ctx.groups, period, today, dismissed: ctx.dismissed });
    for (const o of top.filter((x) => x.monthlySaving > 0).slice(0, 2)) opportunityFact(book, ctx, o);
    return {};
}

const budgetFact = (book, r) => book.fact('budget', { category: r.category === '*' ? 'Total' : r.category, budget: r.amount, spent: r.spent, status: r.status, projected: r.projected, pacePct: Math.round(r.pacePct) });

/**
 * The facts about one category that a conceptual or budget question needs: what it cost in the open period (and its share of all
 * spending), its monthly history average, its budget or `budget_absent` with a suggestion (the average of the last 3 complete
 * months) and what the category contains (glossary).
 */
function addCategoryFacts(book, ctx, category, { budgetRows, skipBudgetRow = false } = {}) {
    const { transactions, period, basis, today, trips } = ctx;
    const byCat = spentByCategory(transactions, period, { includeTrips: true });
    const total = round2(Object.values(byCat).reduce((a, b) => a + b, 0));
    const amount = round2(byCat[category] || 0);
    const inPeriod = periodExpenses(transactions, period).filter((tx) => tx.category === category);
    const refs = inPeriod.sort((a, b) => basisAmount(b, basis) - basisAmount(a, basis)).slice(0, 3).map((tx) => receiptRef(book, tx, basis));
    book.fact('category_total', { category, amount, count: inPeriod.length, sharePct: pct(amount, total), periodTotal: total }, refs);
    const h = monthlyHistory(transactions, { category, basis, today });
    if (h && h.complete.length) {
        book.fact('history_average', { category, averagePerMonth: h.avg, medianPerMonth: h.median, completeMonths: h.complete.length, from: h.first, last3MonthsAverage: h.avg3, runningMonthSoFar: round2(h.byMonth.get(h.current)?.total || 0), note: 'average over complete calendar months, months with no spending count as 0' });
    }
    const rows = budgetRows || categoryBudgets(ctx.budgets || [], transactions, period, trips || [], { today, accounts: ctx.accounts || [] });
    const row = rows.find((r) => r.category === category);
    if (row && !skipBudgetRow) budgetFact(book, row);
    if (!row) book.fact('budget_absent', { category, suggestion: h?.avg3 && h.avg3 > 0 ? Math.ceil(h.avg3) : null, basedOnMonths: h?.last3Months || 0 });
    const contains = glossaryFor(category);
    if (contains) book.fact('glossary', { category, contains });
}

/**
 * A conceptual question ("why do I need a budget for housing", "what is budgeting"): the model may teach the concept from general
 * knowledge, and uses these facts for anything it says about the owner. With a named category: its spend, share, history,
 * budget-or-absent and glossary; otherwise the biggest categories of the period. Never insufficient: a concept needs no data.
 */
function explain(book, ctx) {
    const { transactions, period, question, categoryNames } = ctx;
    const category = categoryFromQuestion(question, categoryNames);
    if (category) {
        addCategoryFacts(book, ctx, category);
        return {};
    }
    const cats = Object.entries(spentByCategory(transactions, period, { includeTrips: true })).sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [c, amount] of cats) book.fact('category_total', { category: c, amount: round2(amount) });
    for (const r of categoryBudgets(ctx.budgets || [], transactions, period, ctx.trips || [], { today: ctx.today, accounts: ctx.accounts || [] }).slice(0, 4)) budgetFact(book, r);
    return {};
}

/**
 * "Where do I find X / how do I do X": the matching entries of the static app map, plus the list of screens. No user data and
 * no period: the answer names the screen and the steps and may offer open_screen.
 */
function appHelp(book, ctx) {
    for (const e of matchFeatures(ctx.question)) book.fact('app_feature', { feature: e.id, screen: e.screen, path: e.path, steps: e.steps });
    book.fact('app_screens', { screens: APP_SCREENS.map((s) => `${s.screen} (${s.path}): ${s.what}`) });
    return { skipPeriod: true };
}

/** "What are my spending habits?": the patterns the app detected (the same as the "Your patterns" cards, minus hidden ones). */
function patterns(book, ctx) {
    const { top } = computePatterns({ transactions: ctx.transactions, trips: ctx.trips, groups: ctx.groups, accounts: ctx.accounts, period: ctx.period, today: ctx.today, dismissed: ctx.dismissed });
    if (top.length === 0) return { insufficient: 'no_patterns' };
    const byId = new Map(ctx.transactions.map((t) => [t.id, t]));
    toModelPatterns(top).forEach((m, i) => book.fact('pattern', m, top[i].evidence.slice(0, 3).map((id) => byId.get(id)).filter(Boolean).map((tx) => receiptRef(book, tx, 'share'))));
    return {};
}

const BUILDERS = { history, explain, app_help: appHelp, patterns, top_merchant: topMerchant, grocery_breakdown: groceryBreakdown, change, unit_price: unitPrice, owed, review, budgets_goals: budgetsGoals, save_money: saveMoney, afford, general };

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
/**
 * buildEvidencePack({ intent?, question, transactions, trips, accounts, budgets, goals, people, period, config, today, currency, basis })
 * `period` is a period object (usePeriod().period) or a month key; `today` a Date or 'YYYY-MM-DD'.
 */
// Questions about money that physically left the user's accounts (or the whole bill including other people's part) are
// answered on the full amount paid; everything else ("what did I spend", "my groceries") on the user's own share.
const FULL_BASIS = /\b(paid|pay(?:ing)?|payed|full amount|whole (?:bill|amount)|in total including|including (?:others|their|the others)|left (?:my|the) account|out of (?:my|the) account|cash ?flow|ho pagato|pagat[oaie]|in totale|uscit[oaie]|bezahlt|gezahlt|pagu[eé]|pagado|pay[ée]|pay[ée]s|پرداخت|دفعت|المبلغ الكامل)\b/iu;
export function inferBasis(question = '') {
    return FULL_BASIS.test(String(question || '')) ? 'full' : 'share';
}

export function buildEvidencePack({ intent, question = '', transactions = [], trips = [], accounts = [], budgets = [], goals = [], people = [], groups = [], dismissed = {}, period, config, today = new Date(), currency = 'EUR', basis: basisIn, categoryNames = [] } = {}) {
    const basis = basisIn === 'full' || basisIn === 'share' ? basisIn : inferBasis(question);
    const route = INTENTS.includes(intent) ? intent : routeQuestion(question);
    const txs = (transactions || []).filter((t) => t && !t.isDemo);
    const range = toRange(period);
    const progress = periodProgress(period, today);
    const cmp = range ? comparablePeriods(period, today, previousOfPeriod(period, config)) : null;
    const comparison = cmp && cmp.basis ? cmp : null;
    const ctx = { transactions: txs, trips, accounts, budgets, goals, people, groups, dismissed, period, config, today, basis, question, comparison, categoryNames };
    const book = new Book();
    const noData = route === 'app_help'; // app documentation only: nothing about the owner goes into this pack
    if (route !== 'owed' && route !== 'history' && !noData) addPeriodSummary(book, ctx);
    const result = BUILDERS[route](book, ctx) || {};
    // Both totals when shared expenses make them differ, so the model can answer either way and say what the gap is.
    if (route !== 'owed' && route !== 'history' && !noData && range) {
        const share = totalSpend(txs, period, 'share');
        const full = totalSpend(txs, period, 'full');
        if (Math.abs(full - share) >= 0.01) book.fact('basis_totals', { share, full, difference: round2(full - share), used: basis });
    }
    const conv = noData ? { count: 0, byCurrency: {} } : pendingConversionCount(txs, period, currency);
    const pack = {
        version: PACK_VERSION,
        intent: route,
        question: String(question || '').slice(0, 300),
        period: result.history
            ? { kind: 'history', start: result.history.start, end: result.history.end, state: 'history' }
            : { kind: period?.kind || 'month', start: range?.start || null, end: range?.end || null, state: progress.state, day: progress.day, days: progress.days, daysLeft: progress.daysLeft, ...(result.skipPeriod ? { notUsed: true } : {}) },
        ...(comparison && ['change', 'grocery_breakdown', 'unit_price'].includes(route) ? { comparison: { basis: comparison.basis, elapsedDays: comparison.elapsedDays, totalDays: comparison.totalDays, current: comparison.current, previous: comparison.previous } } : {}),
        currency,
        basis,
        coverage: result.coverage ? { total: result.coverage.total, itemised: result.coverage.itemised, unknown: result.coverage.unknown, share: Math.round(result.coverage.share * 100), receipts: result.coverage.receipts, receiptsWithItems: result.coverage.receiptsWithItems } : null,
        conversion: conv,
        facts: book.facts,
        evidence: book.evidence,
        insufficient: result.insufficient || null,
    };
    return { pack, refs: book.refs };
}

/** Numbers that appear anywhere in the pack's facts (amounts, percentages, counts), rounded to 2 decimals. */
export function packNumbers(pack) {
    return collectNumbers([pack.facts, pack.coverage, pack.period], { strings: false });
}

/** Amounts in an answer text that are not in the evidence ("12.40", "1,250.00" or any number >= 100): to warn that a figure is not backed by the facts. */
export function unsupportedFigures(text, pack) {
    return figuresNotIn(text, packNumbers(pack));
}

/**
 * Validate the model's answer against the pack: keep only citations that exist, note whether anything is grounded, and
 * list figures that are not in the facts. -> { answer, citations[], uncertain[], grounded, unsupported[], proposals[] }
 */
export function validateAnswer(json, pack) {
    const ids = new Set((pack.facts || []).map((f) => f.id));
    const citations = [...new Set((Array.isArray(json?.citations) ? json.citations : []).filter((c) => typeof c === 'string' && ids.has(c)))];
    const uncertain = [...new Set((Array.isArray(json?.uncertain) ? json.uncertain : []).filter((c) => ids.has(c)))];
    const answer = typeof json?.answer === 'string' ? json.answer.trim() : '';
    return { answer, citations, uncertain, grounded: citations.length > 0, unsupported: unsupportedFigures(answer, pack), proposals: Array.isArray(json?.proposals) ? json.proposals : [] };
}
