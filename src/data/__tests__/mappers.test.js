import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/supabaseService', () => ({ supabase: null }));

import { mappers } from '../api';

describe('transaction mapper', () => {
    const row = {
        id: '11111111-1111-4111-8111-111111111111',
        user_id: '22222222-2222-4222-8222-222222222222',
        merchant: 'Lidl',
        date: '2026-11-08T00:00:00+00:00',
        total: '23.47',
        currency: 'EUR',
        category: 'Groceries',
        notes: null,
        line_items: [{ name: 'Latte', price: 1.19 }],
        is_demo: false,
        is_pinned: true,
        transaction_type: 'expense',
        group_id: '33333333-3333-4333-8333-333333333333',
        group_name: 'Trip',
        group_tags: ['a'],
        split_data: { method: 'equal', people: 2 },
        recurring_data: null,
        tracking_data: { isTracked: true, status: 'open', completedAt: null, sourceRecurringId: null },
        created_at: '2026-11-08T10:00:00+00:00',
        updated_at: '2026-11-08T10:00:00+00:00',
    };

    it('maps snake_case rows to camelCase app records', () => {
        const rec = mappers.transactions.fromRow(row);
        expect(rec).toMatchObject({
            id: row.id,
            userId: row.user_id,
            total: 23.47,
            lineItems: row.line_items,
            isPinned: true,
            groupId: row.group_id,
            trackingData: { isTracked: true, status: 'open', completedAt: null, sourceRecurringId: null },
            updatedAt: row.updated_at,
        });
        expect(rec).not.toHaveProperty('accountId'); // v13 columns absent on old rows
    });

    it('round-trips row -> app -> row', () => {
        const back = mappers.transactions.toRow(mappers.transactions.fromRow(row));
        expect(back).toEqual({ ...row, total: 23.47, notes: null, recurring_data: null });
    });

    it('applies defaults on insert and never sends v13 columns when empty', () => {
        const out = mappers.transactions.toRow({ id: 'x', userId: 'u', total: 5 });
        expect(out).toMatchObject({ currency: 'EUR', line_items: [], is_demo: false, transaction_type: 'expense', group_tags: [] });
        expect(out).not.toHaveProperty('account_id');
        expect(out).not.toHaveProperty('amount_base');
    });

    it('sends v13 columns when set and reads them back', () => {
        const rec = { id: 'x', userId: 'u', total: 5, accountId: 'acc', amountBase: 4.9, merchantKey: 'lidl' };
        const out = mappers.transactions.toRow(rec);
        expect(out).toMatchObject({ account_id: 'acc', amount_base: 4.9, merchant_key: 'lidl' });
        expect(mappers.transactions.fromRow({ ...row, ...out })).toMatchObject({ accountId: 'acc', amountBase: 4.9, merchantKey: 'lidl' });
    });

    it('partial updates only include provided fields and null out invalid group ids', () => {
        expect(mappers.transactions.toRow({ isPinned: true }, { partial: true })).toEqual({ is_pinned: true });
        expect(mappers.transactions.toRow({ groupId: 'group_temp_1', groupName: 'X' }, { partial: true })).toEqual({
            group_id: null,
            group_name: 'X',
        });
        expect(mappers.transactions.toRow({ groupId: null }, { partial: true })).toEqual({ group_id: null });
    });
});

describe('group / category mappers', () => {
    it('round-trips a group including trip columns', () => {
        const row = {
            id: 'g', user_id: 'u', name: 'Japan', color: '#fff', is_pinned: false, is_demo: false, parent_group_id: null,
            created_at: 'c', updated_at: 'u2', kind: 'trip', starts_on: '2026-12-01', ends_on: '2026-12-10',
            budget_amount: '1500', currency: 'JPY', is_active: true, exclude_from_budgets: true, companions: ['Ana'],
        };
        const rec = mappers.groups.fromRow(row);
        expect(rec).toMatchObject({ kind: 'trip', budgetAmount: 1500, companions: ['Ana'], parentGroupId: null });
        expect(mappers.groups.toRow(rec)).toEqual({ ...row, budget_amount: 1500 });
    });

    it('does not send trip columns for plain groups', () => {
        const out = mappers.groups.toRow({ id: 'g', userId: 'u', name: 'Home' });
        expect(Object.keys(out).sort()).toEqual(['color', 'id', 'is_demo', 'is_pinned', 'name', 'parent_group_id', 'user_id']);
    });

    it('round-trips a category', () => {
        const row = { id: 'c', user_id: 'u', name: 'Pets', color: '#123456', created_at: 'a', updated_at: 'b' };
        expect(mappers.categories.toRow(mappers.categories.fromRow(row))).toEqual(row);
    });
});

describe('settings / layout mappers', () => {
    it('maps the legacy veryfi_api_key column to ocrApiKey and back', () => {
        const row = {
            id: 's', user_id: 'u', veryfi_api_key: 'abc', default_currency: 'USD', language_code: 'it',
            notification_preferences: '{"enabled":true}', created_at: 'a', updated_at: 'b',
        };
        const rec = mappers.settings.fromRow(row);
        expect(rec).toMatchObject({ ocrApiKey: 'abc', defaultCurrency: 'USD', languageCode: 'it', notificationPreferences: { enabled: true } });
        expect(mappers.settings.toRow(rec)).toEqual({
            user_id: 'u', veryfi_api_key: 'abc', default_currency: 'USD', language_code: 'it',
            notification_preferences: { enabled: true }, updated_at: 'b',
        });
    });

    it('round-trips a layout', () => {
        const row = { id: 'l', user_id: 'u', layout: { widgets: ['a'], enabled: ['a'] }, created_at: 'c', updated_at: 'd' };
        expect(mappers.layouts.toRow(mappers.layouts.fromRow(row))).toEqual({ user_id: 'u', layout: row.layout, updated_at: 'd' });
    });
});

describe('plan-phase table mappers', () => {
    it('round-trips accounts, budgets, goals and rules', () => {
        const acc = { id: 'a', user_id: 'u', name: 'Revolut', kind: 'spending', currency: 'EUR', opening_balance: '100.5', opening_date: '2026-01-01', color: null, icon: null, is_archived: false, sort_order: 0, created_at: 'c', updated_at: 'd' };
        expect(mappers.accounts.fromRow(acc).openingBalance).toBe(100.5);
        expect(mappers.accounts.toRow(mappers.accounts.fromRow(acc))).toEqual({ ...acc, opening_balance: 100.5 });

        const rule = { id: 'r', user_id: 'u', merchant_key: 'lidl', category: 'Groceries', display_name: 'Lidl', source: 'user', hit_count: 3, updated_at: 'x' };
        expect(mappers.rules.toRow(mappers.rules.fromRow(rule))).toEqual(rule);

        const budget = { id: 'b', user_id: 'u', category: '*', amount: '800', currency: 'EUR', starts_on: '2026-11-01', ends_on: null, created_at: 'c', updated_at: 'd' };
        expect(mappers.budgets.fromRow(budget).amount).toBe(800);

        const goal = { id: 'g', user_id: 'u', name: 'Japan', target_amount: '3000', currency: 'EUR', target_date: null, account_id: null, starting_amount: '0', color: null, icon: null, is_archived: false, created_at: 'c', updated_at: 'd' };
        expect(mappers.goals.fromRow(goal).targetAmount).toBe(3000);
    });
});
