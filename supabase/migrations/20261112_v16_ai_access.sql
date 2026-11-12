-- v16: AI features need the owner's approval, and AI usage can no longer be reset by the user.
--
-- ai_access: one row per account. New sign-ups land as 'pending' (trigger on auth.users); only an admin can approve or deny,
-- through ai_access_decide(). Nobody writes the table directly through the API (no insert/update/delete policies).
-- ai_consume(): the server's only way to count an AI call. It checks approval and the per-day cap in one transaction.
-- ai_usage becomes read-only for users (before, a user could delete or lower their own counter and skip the daily cap).
--
-- Make yourself admin once (SQL editor, as the project owner):
--   update ai_access set is_admin = true, status = 'approved' where email = '<your sign-in email>';

create table if not exists ai_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  is_admin boolean not null default false,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
alter table ai_access enable row level security;

create or replace function public.is_ai_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ai_access where user_id = auth.uid() and is_admin);
$$;

drop policy if exists "ai_access_select" on ai_access;
create policy "ai_access_select" on ai_access for select to authenticated
  using (user_id = auth.uid() or public.is_ai_admin());

-- every new account waits for approval
create or replace function public.ai_access_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into ai_access (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_ai_access on auth.users;
create trigger on_auth_user_created_ai_access after insert on auth.users
  for each row execute function public.ai_access_on_signup();

-- existing accounts: pending until the owner approves them
insert into ai_access (user_id, email) select id, email from auth.users on conflict (user_id) do nothing;

-- the admin approves, denies or resets an account (never another admin)
create or replace function public.ai_access_decide(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ai_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('pending', 'approved', 'denied') then raise exception 'bad status' using errcode = '22023'; end if;
  update ai_access set status = p_status, decided_at = now(), decided_by = auth.uid()
   where user_id = p_user and not is_admin;
end;
$$;

-- one AI call: approved (or admin) and under today's cap -> counted; otherwise refused with the reason
create or replace function public.ai_consume(p_kind text, p_limit int) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_admin boolean;
  v_total int;
  v_day date := (now() at time zone 'utc')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_kind not in ('extract', 'categorize', 'insights', 'chat') then raise exception 'bad kind' using errcode = '22023'; end if;
  select status, is_admin into v_status, v_admin from ai_access where user_id = v_uid;
  if not coalesce(v_admin, false) and coalesce(v_status, 'pending') <> 'approved' then
    return json_build_object('allowed', false, 'reason', 'not_approved', 'status', coalesce(v_status, 'pending'));
  end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text));
  select coalesce(sum(calls), 0) into v_total from ai_usage where user_id = v_uid and day = v_day;
  if v_total >= greatest(coalesce(p_limit, 1), 1) then
    return json_build_object('allowed', false, 'reason', 'limit', 'used', v_total, 'limit', p_limit);
  end if;
  insert into ai_usage (user_id, day, kind, calls) values (v_uid, v_day, p_kind, 1)
    on conflict (user_id, day, kind) do update set calls = ai_usage.calls + 1;
  return json_build_object('allowed', true, 'used', v_total + 1, 'limit', p_limit);
end;
$$;

-- token accounting after a successful call (adds only; the row exists because ai_consume made it)
create or replace function public.ai_record_tokens(p_kind text, p_in bigint, p_out bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update ai_usage
     set tokens_in = coalesce(tokens_in, 0) + greatest(coalesce(p_in, 0), 0),
         tokens_out = coalesce(tokens_out, 0) + greatest(coalesce(p_out, 0), 0)
   where user_id = auth.uid() and day = (now() at time zone 'utc')::date and kind = p_kind;
end;
$$;

-- ai_usage: users read their own rows (the admin reads all), nobody writes them directly any more
drop policy if exists "ai_usage_all" on ai_usage;
drop policy if exists "ai_usage_select" on ai_usage;
create policy "ai_usage_select" on ai_usage for select to authenticated
  using (user_id = auth.uid() or public.is_ai_admin());

revoke all on function public.ai_access_on_signup() from public, anon, authenticated;
revoke all on function public.ai_access_decide(uuid, text) from public, anon;
revoke all on function public.ai_consume(text, int) from public, anon;
revoke all on function public.ai_record_tokens(text, bigint, bigint) from public, anon;
revoke all on function public.is_ai_admin() from public, anon;
grant execute on function public.ai_access_decide(uuid, text) to authenticated;
grant execute on function public.ai_consume(text, int) to authenticated;
grant execute on function public.ai_record_tokens(text, bigint, bigint) to authenticated;
grant execute on function public.is_ai_admin() to authenticated;
