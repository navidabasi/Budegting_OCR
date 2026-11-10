-- v13: accounts, budgets, savings goals, merchant rules, insights cache, AI usage,
-- trip columns on groups and new receipts columns. See docs/IMPROVEMENT_PLAN.md section 4.
-- Applied to production on 2026-11-10.

-- Accounts: where money sits. Savings = a transfer INTO an account of kind savings/investment.
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,                     -- Revolut, PostePay, Cash, Savings account, Investments
  kind text not null,                     -- spending | cash | savings | investment | debt (liability: Klarna, owed to a friend) | receivable (money lent out)
  counterparty text,                      -- for debt/receivable: person or provider name
  currency text not null default 'EUR',
  opening_balance numeric(12,2) default 0,
  opening_date date default current_date,
  color text, icon text,
  is_archived boolean default false,
  sort_order int default 0,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, name)
);

-- receipts: new columns (table name stays; UI calls them "transactions")
alter table receipts
  add column if not exists account_id uuid,            -- money left this account (expense/transfer) or arrived here (income)
  add column if not exists to_account_id uuid,         -- transfers only
  add column if not exists image_path text,
  add column if not exists amount_base numeric(12,2),
  add column if not exists base_currency text,
  add column if not exists exchange_rate numeric(14,6),
  add column if not exists merchant_key text,
  add column if not exists goal_id uuid,               -- transfers only: which goal this contributes to
  add column if not exists import_ref text,            -- 'revolut:<hash of row>' for CSV dedupe
  add column if not exists extraction jsonb;           -- {provider, model, confidence:{merchant,date,total,items}, rawText, durationMs}
-- transaction_type allowed values: expense | income | transfer   (document; add check constraint after backfill)
create index if not exists idx_receipts_user_date on receipts(user_id, date desc);
create index if not exists idx_receipts_merchant_key on receipts(user_id, merchant_key);
create unique index if not exists idx_receipts_import_ref on receipts(user_id, import_ref) where import_ref is not null;

-- Trips (travel sessions). The existing groups table is extended rather than replaced:
-- a trip is a group with kind='trip' and dates. Receipts keep using group_id.
alter table groups
  add column if not exists kind text not null default 'group',      -- group | trip | project
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists budget_amount numeric(12,2),
  add column if not exists currency text,
  add column if not exists is_active boolean default false,          -- manual start/stop; dates are the default
  add column if not exists exclude_from_budgets boolean default true,-- trip spend counts under one "Travel" line, not per category
  add column if not exists companions text[];                        -- names for splits
create index if not exists idx_groups_active on groups(user_id, is_active) where kind = 'trip';

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null,                 -- '*' = whole-month budget
  amount numeric(12,2) not null,
  currency text not null default 'EUR',
  starts_on date not null,                -- first day of the month it applies from
  ends_on date,                           -- null = open ended (copied forward)
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, category, starts_on)
);

create table if not exists savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  target_amount numeric(12,2) not null,
  currency text not null default 'EUR',
  target_date date,
  account_id uuid,                        -- optional: the account that holds this goal's money
  starting_amount numeric(12,2) default 0,
  color text, icon text,
  is_archived boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  merchant_key text not null,
  category text not null,
  display_name text,                      -- "Lidl" for key "lidl"
  source text not null default 'user',    -- user | llm | seed
  hit_count int default 1,
  updated_at timestamptz default now(),
  unique (user_id, merchant_key)
);

create table if not exists insights_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  period text not null,                   -- 'YYYY-MM'
  input_hash text not null,
  payload jsonb not null,
  model text,
  created_at timestamptz default now(),
  unique (user_id, period)
);

create table if not exists ai_usage (
  user_id uuid not null,
  day date not null,
  kind text not null,                     -- extract | categorize | insights | chat
  calls int default 0,
  tokens_in bigint default 0, tokens_out bigint default 0,
  primary key (user_id, day, kind)
);

-- RLS on every new table: select/insert/update/delete where auth.uid() = user_id (same pattern as receipts).
alter table accounts       enable row level security;
alter table budgets        enable row level security;
alter table savings_goals  enable row level security;
alter table merchant_rules enable row level security;
alter table insights_cache enable row level security;
alter table ai_usage       enable row level security;

drop policy if exists "accounts_all" on accounts;
create policy "accounts_all" on accounts for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "budgets_all" on budgets;
create policy "budgets_all" on budgets for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "savings_goals_all" on savings_goals;
create policy "savings_goals_all" on savings_goals for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "merchant_rules_all" on merchant_rules;
create policy "merchant_rules_all" on merchant_rules for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "insights_cache_all" on insights_cache;
create policy "insights_cache_all" on insights_cache for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ai_usage_all" on ai_usage;
create policy "ai_usage_all" on ai_usage for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at triggers: reuse update_updated_at_column() (defined in 20260203000001_supabase_setup.sql).
drop trigger if exists update_accounts_updated_at on accounts;
create trigger update_accounts_updated_at before update on accounts
  for each row execute function update_updated_at_column();
drop trigger if exists update_budgets_updated_at on budgets;
create trigger update_budgets_updated_at before update on budgets
  for each row execute function update_updated_at_column();
drop trigger if exists update_savings_goals_updated_at on savings_goals;
create trigger update_savings_goals_updated_at before update on savings_goals
  for each row execute function update_updated_at_column();
drop trigger if exists update_merchant_rules_updated_at on merchant_rules;
create trigger update_merchant_rules_updated_at before update on merchant_rules
  for each row execute function update_updated_at_column();

-- No account backfill: historical transactions keep account_id = null ("unassigned").
-- Accounts are created by the user in onboarding / Settings › Accounts; balances count from each account's opening_date.

-- Columns from older migrations (v7, v8) that were never applied to production.
alter table groups   add column if not exists is_demo boolean default false;
alter table receipts add column if not exists field_timestamps jsonb;

-- Receipt images: private bucket, one folder per user.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;
drop policy if exists "receipts_objects_own" on storage.objects;
create policy "receipts_objects_own" on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
