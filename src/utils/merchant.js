// Merchant normalisation. merchantKey("LIDL ITALIA S.R.L. 0231 TORINO") -> "lidl".
// Works on receipt headers and on bank/card descriptions ("PAGAMENTO POS ESSELUNGA SPA",
// "Card payment to Q8 TORINO NORD"). Pure, no I/O.
import seeds from './merchantSeeds.json';

// Bank / card boilerplate at the start of a description (applied repeatedly).
const NOISE_PREFIXES = [
    /^pagamento\s+(?:tramite\s+)?(?:con\s+)?(?:pos|carta|bancomat|visa|mastercard|contactless)\b/,
    /^acquisto\s+(?:con\s+)?(?:pos|carta|bancomat|online)\b/,
    /^(?:pagamento|acquisto|addebito(?:\s+diretto)?|sdd|bonifico|prelievo)\b/,
    /^card\s+payment(?:\s+(?:to|at))?\b/,
    /^(?:payment|purchase|debit|pos|card)(?:\s+(?:to|at|from))?\b/,
    /^(?:paypal|sumup|sq|zettle_\w+|zettle|ca|tst|google|stripe|mollie)\s*\*\s*/,
    /^(?:carta|card)\s*\*?\s*(?:x+)?\d{2,}\b/,
    /^(?:visa|mastercard|maestro|vpay|v pay|bancomat|pagobancomat|contactless|nfc)\b/,
    /^(?:presso|at|a favore di|beneficiario)\b/,
    /^[*\-:\s]+/,
];

const STREET = new Set(['via', 'viale', 'vle', 'piazza', 'pzza', 'piazzale', 'corso', 'cso', 'largo', 'strada', 'str', 'strasse', 'rue', 'calle', 'avenida', 'avenue', 'lungotevere', 'vicolo', 'contrada', 'loc', 'localita']);

const LEGAL = new Set(['srl', 'srls', 'spa', 'snc', 'sas', 'sa', 'sarl', 'gmbh', 'ag', 'ltd', 'limited', 'bv', 'llc', 'inc', 'kg', 'ug', 'sl', 'scarl', 'scpa', 'societa', 'unico', 'socio']);

const COUNTRY_WORDS = new Set(['italia', 'italy', 'italiana', 'espana', 'deutschland', 'france', 'nederland', 'international', 'retail', 'holding', 'group']);

const TLDS = 'com|it|de|fr|es|nl|eu|net|org|uk|co';

const CITIES = new Set(
    (
        'torino milano roma napoli bologna firenze genova palermo bari catania venezia verona padova trieste brescia parma modena prato reggio emilia perugia livorno ravenna cagliari foggia rimini salerno ferrara sassari latina monza siracusa pescara bergamo forli trento vicenza terni bolzano novara piacenza ancona andria arezzo udine cesena lecce pesaro spezia como pisa treviso varese busto arsizio lucca pistoia brindisi caserta cosenza catanzaro potenza campobasso aosta asti alessandria cuneo biella vercelli savona imperia donato milanese sesto rho assago moncalieri nichelino rivoli collegno grugliasco settimo ' +
        'paris lyon marseille berlin munchen munich hamburg koln frankfurt madrid barcelona valencia sevilla lisboa lisbon porto amsterdam rotterdam utrecht bruxelles brussels wien vienna praha prague dublin london zurich geneva athens atene budapest warszawa'
    ).split(/\s+/)
);
const DIRECTIONS = new Set(['nord', 'sud', 'est', 'ovest', 'centro', 'north', 'south', 'east', 'west', 'city']);
const PROVINCES = new Set(
    'ag al an ao ap aq ar at av ba bg bi bl bn bo br bs bt bz ca cb ce ch cl cn co cr cs ct cz en fc fe fg fi fm fr ge go gr im is kr lc le li lo lt lu mb mc me mi mn mo ms mt na no nu or pa pc pd pe pg pi pn po pr pt pu pv pz ra rc re rg ri rm rn ro sa si so sp sr ss su sv ta te tn to tp tr ts tv ud va vb vc ve vi vr vt vv'.split(' ')
);

// Tokens that carry no merchant identity anywhere in the string.
const DROP_TOKENS = new Set(['eur', 'euro', 'ref', 'rif', 'n', 'nr', 'num', 'trn', 'tid', 'mid', 'auth', 'del', 'data', 'ora', 'importo', 'divisa']);

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Core pipeline. Returns lowercase tokens (accents kept) with the identity of the merchant. */
function tokenize(raw) {
    if (raw === null || raw === undefined) return [];
    let text = String(raw).normalize('NFC');
    // Keep the original-case view for province detection (uppercase 2-letter codes).
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return [];

    // Collapse dotted abbreviations: S.R.L. -> SRL, S.p.A. -> SpA
    text = text.replace(/\b([A-Za-z])\.(?=[A-Za-z]\b)/g, '$1');
    // Strip TLDs: amazon.it -> amazon
    text = text.replace(new RegExp(`\\.(?:${TLDS})(?=$|[^A-Za-z0-9])`, 'gi'), '');
    // Apostrophes vanish (McDonald's -> mcdonalds); & between letters joins (H&M -> hm)
    text = text.replace(/['’`]/g, '').replace(/(?<=[A-Za-z0-9])&(?=[A-Za-z0-9])/g, '');
    // Dates, times, card masks, amounts
    text = text
        .replace(/\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?\b/g, ' ')
        .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
        .replace(/[*x]{2,}\d{2,}|\*\d{3,}/gi, ' ')
        .replace(/[-+]?\d+[.,]\d{2}\b/g, ' ');

    let lower = text.toLowerCase();
    for (let i = 0; i < 6; i++) {
        let changed = false;
        for (const re of NOISE_PREFIXES) {
            const next = lower.replace(re, '').trimStart();
            if (next !== lower) {
                lower = next;
                changed = true;
            }
        }
        if (!changed) break;
    }
    // "societa a socio unico", "a socio unico"
    lower = lower.replace(/\bsocieta['`]?\s+(?:a|per|con)\s+(?:socio\s+unico|azioni|responsabilita\s+limitata)\b/g, ' ').replace(/\b(?:a|con)\s+socio\s+unico\b/g, ' ');

    // Tokenise on anything that is not a letter or digit (keeps accented letters).
    const originalUpper = new Set(
        text
            .split(/[^\p{L}\p{N}]+/u)
            .filter((t) => t.length === 2 && t === t.toUpperCase())
            .map((t) => t.toLowerCase())
    );
    let tokens = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

    // Address: drop from a street word on (not when it is the first token).
    const streetAt = tokens.findIndex((t, i) => i > 0 && STREET.has(t));
    if (streetAt > 0) tokens = tokens.slice(0, streetAt);

    tokens = tokens.filter((t) => {
        if (/^\d+$/.test(t)) return false; // store / terminal numbers
        if (/\d/.test(t) && t.length >= 6) return false; // card / reference codes
        if (/^n\d+$/.test(t) || /^[a-z]\d{4,}$/.test(t)) return false;
        if (DROP_TOKENS.has(t)) return false;
        return true;
    });

    // Trailing noise: legal forms, countries, directions, cities, province codes.
    let changed = true;
    while (changed && tokens.length > 1) {
        changed = false;
        const last = tokens[tokens.length - 1];
        const lastAscii = stripAccents(last);
        if (LEGAL.has(lastAscii) || COUNTRY_WORDS.has(lastAscii) || DIRECTIONS.has(lastAscii) || CITIES.has(lastAscii) || (PROVINCES.has(last) && originalUpper.has(last))) {
            tokens.pop();
            changed = true;
        }
    }
    // A lone leading legal word ("srl") means nothing was left.
    return tokens;
}

/** Stable lowercase, accent-free key for a merchant or bank description. */
export function merchantKey(raw) {
    return tokenize(raw)
        .map(stripAccents)
        .join(' ')
        .trim();
}

// ---- seeds ------------------------------------------------------------------------------
let compiled = null;
const compileSeeds = () => {
    compiled ||= seeds.map((s) => ({ ...s, re: new RegExp(s.pattern) }));
    return compiled;
};

/** First seed whose word-boundary regex matches the key, or null. */
export function findSeed(key) {
    if (!key) return null;
    for (const s of compileSeeds()) {
        if (s.re.test(key)) return s;
    }
    return null;
}

const SMALL_WORDS = new Set(['da', 'di', 'del', 'della', 'dei', 'de', 'la', 'il', 'lo', 'le', 'e', 'and', 'the', 'of', 'al', 'dal']);

/** Human-friendly name: the seed's display for known brands, otherwise a title-cased key. */
export function displayName(raw) {
    const tokens = tokenize(raw);
    if (tokens.length === 0) return '';
    const seed = findSeed(tokens.map(stripAccents).join(' '));
    if (seed && !seed.generic) return seed.display;
    return tokens
        .map((t, i) => (i > 0 && SMALL_WORDS.has(t) ? t : t.charAt(0).toUpperCase() + t.slice(1)))
        .join(' ');
}
