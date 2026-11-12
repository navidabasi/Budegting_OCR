// What kind of spending a transaction is, for insights (pass 3, A1/A2). Pure.
//
//   fixed     rent, housing, utilities, insurance: a cost of living, never a "subscription" and never something to "cut"
//   debt      instalments (Klarna and other pay-later), loans, money paid back to friends: debt, not spending to cut
//   savings   money put aside or invested that was logged as an expense (a custom "Stocks" category)
//   flexible  everything else: the only class the savings opportunities ask the owner to look at
//
// The class is inferred from the category, the merchant, the group and the account, so the owner never has to label anything.
import { merchantKey } from './merchant';

export const FIXED_CATEGORIES = ['Housing', 'Utilities', 'Insurance'];

const FIXED_CATEGORY_RE = /^(housing|utilities|insurance|rent|affitto|casa|bollette|assicurazion[ei]|miete|wohnen|versicherung|alquiler|vivienda|seguros?|loyer|logement|assurances?|taxes?|tasse)$/i;
const FIXED_MERCHANT_RE = /\b(rent|affitto|canone|condominio|mutuo|mortgage|miete|alquiler|hipoteca|loyer|landlord|padrone di casa|bolletta|enel|eni plenitude|plenitude|a2a|iren|hera|acea|edison|sorgenia|italgas|tari|imu|allianz|generali|unipol|unipolsai|axa|zurich|assicurazion\w*|insurance|versicherung)\b/i;
const DEBT_CATEGORY_RE = /^(debts?|debit[oi]|loans?|prestit[oi]|rate|instal?lments?|schulden|kredit|deudas?|pr[eé]stamos?|dettes?|cr[eé]dits?|lends?|بدهی|قرض|دين|ديون)$/i;
const DEBT_GROUP_RE = /\b(debts?|debit[oi]|loans?|prestit[oi]|lends?|lent|schulden|deudas?|dettes?)\b/i;
const DEBT_MERCHANT_RE = /\b(klarna|scalapay|clearpay|afterpay|paypal pay in|pay in 3|paga in 3|pagolight|soisy|compass|findomestic|agos|cofidis|younited|loan|prestito|finanziamento|rata)\b/i;
const SAVINGS_CATEGORY_RE = /^(stocks?|investments?|investiment[oi]|savings?|risparmi[o]?|azioni|etf|crypto|aktien|sparen|ahorros?|inversi[oó]n(es)?|[eé]pargne|bourse|سهام|پس‌انداز|استثمار|ادخار)$/i;

const keyOf = (tx) => tx?.merchantKey || merchantKey(tx?.merchant) || '';

/**
 * spendClass(tx, { groups, accounts }) -> 'fixed' | 'debt' | 'savings' | 'flexible'
 * `groups` and `accounts` are optional lookups (arrays); the group name saved on the transaction is used when there is no list.
 */
export function spendClass(tx, { groups = [], accounts = [] } = {}) {
    if (!tx) return 'flexible';
    const category = String(tx.category || '').trim();
    const text = `${keyOf(tx)} ${String(tx.merchant || '').toLowerCase()}`;
    const groupName = (tx.groupId && (groups || []).find((g) => g && g.id === tx.groupId)?.name) || tx.groupName || '';
    const accountKind = tx.accountId ? (accounts || []).find((a) => a && a.id === tx.accountId)?.kind : null;
    if (DEBT_CATEGORY_RE.test(category) || DEBT_GROUP_RE.test(groupName) || DEBT_MERCHANT_RE.test(text) || accountKind === 'debt') return 'debt';
    if (SAVINGS_CATEGORY_RE.test(category)) return 'savings';
    if (FIXED_CATEGORIES.includes(category) || FIXED_CATEGORY_RE.test(category) || FIXED_MERCHANT_RE.test(text)) return 'fixed';
    return 'flexible';
}

export const isFlexible = (tx, lookups) => spendClass(tx, lookups) === 'flexible';
