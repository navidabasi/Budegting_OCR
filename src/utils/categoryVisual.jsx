import { ArrowLeftRight, Coffee, Film, Fuel, Gift, GraduationCap, HeartPulse, Home, Landmark, Plane, Receipt, Repeat, Shield, ShoppingBag, ShoppingCart, Sparkles, Train, Utensils, Wallet, Zap } from 'lucide-react';

/** Icon + token classes for a category (old and new category names). Classes work in light and dark. */
const MINT = { bg: 'bg-mint', fg: 'text-forest-ink' };
const AMBER = { bg: 'bg-warn-soft', fg: 'text-warn' };
const BLUE = { bg: 'bg-savings-soft', fg: 'text-savings' };
const NEUTRAL = { bg: 'bg-tint', fg: 'text-ink-muted' };

const MAP = {
    Groceries: [ShoppingCart, MINT],
    Dining: [Coffee, AMBER],
    Restaurant: [Utensils, AMBER],
    Fuel: [Fuel, NEUTRAL],
    Gas: [Fuel, NEUTRAL],
    Transport: [Train, BLUE],
    Transportation: [Train, BLUE],
    Housing: [Home, NEUTRAL],
    Utilities: [Zap, NEUTRAL],
    Subscriptions: [Repeat, BLUE],
    Shopping: [ShoppingBag, MINT],
    Health: [HeartPulse, MINT],
    Healthcare: [HeartPulse, MINT],
    'Personal care': [Sparkles, MINT],
    Entertainment: [Film, AMBER],
    Travel: [Plane, BLUE],
    Education: [GraduationCap, BLUE],
    Insurance: [Shield, NEUTRAL],
    Gifts: [Gift, AMBER],
    Fees: [Receipt, NEUTRAL],
    Income: [Wallet, MINT],
    Transfer: [ArrowLeftRight, BLUE],
};

export function categoryVisual(category, type = 'expense') {
    if (type === 'transfer') return { Icon: Landmark, ...BLUE };
    if (type === 'income') return { Icon: Wallet, ...MINT };
    const [Icon, tone] = MAP[category] || [Receipt, NEUTRAL];
    return { Icon, ...tone };
}
