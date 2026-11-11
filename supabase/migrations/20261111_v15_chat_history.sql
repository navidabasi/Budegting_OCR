-- v15: persistent assistant chat history (owner request 2026-11-11). Additive only.
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text,                                  -- first question, trimmed
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz                       -- soft delete so other devices learn about it on pull
);
create index if not exists idx_chat_conversations_user on public.chat_conversations(user_id, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  meta jsonb,                                  -- evidence (period, facts, refs, citations, coverage), suggested action, proposals, error state
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);
create index if not exists idx_chat_messages_conv on public.chat_messages(conversation_id, created_at);
create index if not exists idx_chat_messages_user on public.chat_messages(user_id, updated_at);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
create policy "chat_conversations_all" on public.chat_conversations for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chat_messages_all" on public.chat_messages for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger update_chat_conversations_updated_at before update on public.chat_conversations
  for each row execute function update_updated_at_column();
create trigger update_chat_messages_updated_at before update on public.chat_messages
  for each row execute function update_updated_at_column();
