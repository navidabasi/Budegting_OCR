// Rule-based category suggestion (plan P3-T2). Pure: user rules and items are passed in.
// Resolution order: user rule (exact key) -> user rule (token prefix, then first word)
//                   -> seed rules (word-boundary regex) -> item keywords -> none.
import { merchantKey, findSeed } from '../utils/merchant';

const clean = (s) =>
    String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

// Item keywords, Italian + English (+ a few DE/FR/ES). Word-boundary only, matched per item.
const ITEM_KEYWORDS = [
    ['Groceries', 'latte|pane|pasta|spaghetti|penne|riso|uova|formaggio|mozzarella|parmigiano|prosciutto|salame|pollo|manzo|maiale|salmone|tonno|pesce|frutta|verdura|insalata|pomodor[oi]|patate|cipolle?|banane?|mele|mela|arance|limoni|yogurt|burro|olio|zucchero|farina|biscotti|cereali|passata|ragu|sugo|affettato|wurstel|carne|pancetta|ricotta|gelato|surgelati|detersivo|ammorbidente|carta igienica|scottex|sacchetto|milk|bread|eggs?|cheese|chicken|beef|pork|rice|flour|sugar|butter|vegetables?|fruit|cereal|yoghurt|brot|milch|kase|lait|pain|fromage|leche|pan|queso'],
    ['Dining', 'coperto|cover charge|service charge|antipasto|primo piatto|secondo piatto|contorno|tiramisu|cappuccino|spritz|aperitivo|cocktail|birra alla spina|calice|menu|piatto del giorno|margherita|diavola|marinara|carbonara|bruschetta|burger|panino|toast|brioche|cornetto'],
    ['Fuel', 'benzina|gasolio|diesel|gpl|metano|unleaded|petrol|fuel|carburante|super 95|self service|rifornimento|adblue'],
    ['Health', 'paracetamolo|tachipirina|ibuprofene|aspirina|farmaco|medicinale|cerotti?|integratore|vitamine?|vitamin|sciroppo|garze|termometro|mascherine|visita|ticket sanitario|collirio|antibiotico'],
    ['Personal care', 'shampoo|balsamo|bagnoschiuma|dentifricio|spazzolino|deodorante|rasoio|crema viso|crema mani|sapone|lozione|assorbenti|struccante|profumo|tinta capelli|conditioner|toothpaste|razor|soap|lotion'],
    ['Transport', 'biglietto bus|biglietto metro|biglietto treno|biglietto urbano|abbonamento mensile|parcheggio|pedaggio|taxi|ticket bus|train ticket|parking|toll'],
    ['Entertainment', 'cinema|film|concerto|teatro|videogioco|videogame|ingresso museo|bowling'],
    ['Shopping', 'batterie|pile|caricatore|cavo usb|auricolari|cuffie|maglietta|t shirt|felpa|pantaloni|scarpe|calze|lampadina|prolunga|zaino|borsa|giocattolo|puzzle'],
    ['Education', 'quaderno|quaderni|penna|penne biro|matita|evidenziatore|cancelleria|libro di testo|textbook|notebook scolastico'],
    ['Gifts', 'biglietto auguri|gift card|carta regalo|confezione regalo|bouquet'],
].map(([category, words]) => ({ category, re: new RegExp(`\\b(?:${words})\\b`) }));

// Tie-break order when two categories have the same number of matching items.
const ITEM_PRIORITY = ['Fuel', 'Health', 'Groceries', 'Dining', 'Personal care', 'Shopping', 'Transport', 'Entertainment', 'Education', 'Gifts'];

function fromItems(items) {
    const names = (items || []).map((it) => (typeof it === 'string' ? it : it?.name)).map(clean).filter(Boolean);
    if (names.length === 0) return null;
    const counts = new Map();
    for (const name of names) {
        for (const { category, re } of ITEM_KEYWORDS) {
            if (re.test(name)) {
                counts.set(category, (counts.get(category) || 0) + 1);
                break; // an item votes once, first matching category wins
            }
        }
    }
    if (counts.size === 0) return null;
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || ITEM_PRIORITY.indexOf(a[0]) - ITEM_PRIORITY.indexOf(b[0]))[0];
    const share = best[1] / names.length;
    return { category: best[0], confidence: Math.round(Math.min(0.6, 0.3 + 0.3 * share) * 100) / 100 };
}

function fromUserRules(key, rules) {
    if (!key || !Array.isArray(rules) || rules.length === 0) return null;
    const usable = rules.filter((r) => r && r.merchantKey && r.category);
    const exact = usable.find((r) => r.merchantKey === key);
    if (exact) return { category: exact.category, confidence: 1 };

    const tokens = key.split(' ');
    // Rule key is a token prefix of the description key (longest rule wins).
    let best = null;
    for (const r of usable) {
        const rt = r.merchantKey.split(' ');
        if (rt.length < tokens.length && rt.every((t, i) => t === tokens[i]) && (!best || rt.length > best.tokens)) {
            best = { rule: r, tokens: rt.length };
        }
    }
    if (best) return { category: best.rule.category, confidence: 0.9 };

    // Same first word (>= 4 letters); the most used rule wins.
    const first = tokens[0];
    if (first.length >= 4) {
        const same = usable.filter((r) => r.merchantKey.split(' ')[0] === first).sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0));
        if (same.length) return { category: same[0].category, confidence: 0.7 };
    }
    return null;
}

/**
 * suggestCategory({ merchant, items, rules })
 *  merchant  receipt merchant or raw bank description
 *  items     [{ name }] or [string] (receipt line items)
 *  rules     user merchant_rules [{ merchantKey, category, hitCount }]
 * -> { category: string|null, source: 'user'|'seed'|'items'|'none', confidence: 0..1, merchantKey }
 */
export function suggestCategory({ merchant, items = [], rules = [] } = {}) {
    const key = merchantKey(merchant);

    const user = fromUserRules(key, rules);
    if (user) return { ...user, source: 'user', merchantKey: key };

    const seed = findSeed(key);
    if (seed) return { category: seed.category, source: 'seed', confidence: seed.generic ? 0.7 : 0.85, merchantKey: key };

    const byItems = fromItems(items);
    if (byItems) return { ...byItems, source: 'items', merchantKey: key };

    return { category: null, source: 'none', confidence: 0, merchantKey: key };
}
