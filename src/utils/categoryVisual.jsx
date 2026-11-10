import { ArrowLeftRight, Coffee, Film, Fuel, Gift, GraduationCap, HeartPulse, Home, Landmark, Plane, Receipt, Repeat, Shield, ShoppingBag, ShoppingCart, Sparkles, Train, Wallet, Zap, Tag } from 'lucide-react';

/** Icon + token classes for a category. Classes work in light and dark (tokens in index.css). */
const MINT = { bg: 'bg-mint', fg: 'text-forest-ink' };
const AMBER = { bg: 'bg-warn-soft', fg: 'text-warn' };
const BLUE = { bg: 'bg-savings-soft', fg: 'text-savings' };
const NEUTRAL = { bg: 'bg-tint', fg: 'text-ink-muted' };

const MAP = {
    Groceries: [ShoppingCart, MINT],
    Dining: [Coffee, AMBER],
    Fuel: [Fuel, NEUTRAL],
    Transport: [Train, BLUE],
    Housing: [Home, NEUTRAL],
    Utilities: [Zap, NEUTRAL],
    Subscriptions: [Repeat, BLUE],
    Shopping: [ShoppingBag, MINT],
    Health: [HeartPulse, MINT],
    'Personal care': [Sparkles, MINT],
    Entertainment: [Film, AMBER],
    Travel: [Plane, BLUE],
    Education: [GraduationCap, BLUE],
    Insurance: [Shield, NEUTRAL],
    Gifts: [Gift, AMBER],
    Fees: [Receipt, NEUTRAL],
    Other: [Receipt, NEUTRAL],
    Income: [Wallet, MINT],
    Transfer: [ArrowLeftRight, BLUE],
};

/** Custom categories ("Date", "Debt", "Gift", "Stocks") get a generic tag icon. Legacy names are read through normalizeCategoryName by the data layer. */
export function categoryVisual(category, type = 'expense') {
    if (type === 'transfer') return { Icon: Landmark, ...BLUE };
    if (type === 'income') return { Icon: Wallet, ...MINT };
    const [Icon, tone] = MAP[category] || [category ? Tag : Receipt, NEUTRAL];
    return { Icon, ...tone };
}
