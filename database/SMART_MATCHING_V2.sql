-- ============================================================
-- BLOOD BRIDGE: SMART MATCHING V2 + CHAT SYSTEM
-- Supabase Dashboard > SQL Editor mein paste karke RUN karein
-- ============================================================

-- ========================
-- PART A: SEARCH RADIUS COLUMN ON BLOOD_REQUESTS
-- ========================

-- Add search_radius_km column to blood_requests (default 100km for backward compat)
alter table public.blood_requests
  add column if not exists search_radius_km integer default 100;

-- ========================
-- PART B: CHAT SYSTEM TABLES
-- ========================

-- Conversations table: tracks who is chatting with whom and for what request
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.blood_requests(id) on delete set null,
  participant_1 uuid not null references auth.users(id) on delete cascade,
  participant_2 uuid not null references auth.users(id) on delete cascade,
  last_message_text text,
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique(participant_1, participant_2, request_id)
);

-- Chat messages table
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 5000),
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

-- ========================
-- PART C: RLS FOR CHAT TABLES
-- ========================

alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;

-- Conversations: participants can view their own conversations
drop policy if exists "Users view own conversations" on public.conversations;
create policy "Users view own conversations"
  on public.conversations for select to authenticated
  using (participant_1 = auth.uid() or participant_2 = auth.uid());

-- Conversations: authenticated users can create conversations they participate in
drop policy if exists "Users create own conversations" on public.conversations;
create policy "Users create own conversations"
  on public.conversations for insert to authenticated
  with check (participant_1 = auth.uid() or participant_2 = auth.uid());

-- Conversations: participants can update (for last_message tracking)
drop policy if exists "Users update own conversations" on public.conversations;
create policy "Users update own conversations"
  on public.conversations for update to authenticated
  using (participant_1 = auth.uid() or participant_2 = auth.uid());

-- Chat messages: participants can view messages in their conversations
drop policy if exists "Users view conversation messages" on public.chat_messages;
create policy "Users view conversation messages"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
  );

-- Chat messages: sender must be participant and message sender
drop policy if exists "Users send messages" on public.chat_messages;
create policy "Users send messages"
  on public.chat_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
  );

-- Chat messages: users can update their own messages (for read_at)
drop policy if exists "Users update own messages" on public.chat_messages;
create policy "Users update own messages"
  on public.chat_messages for update to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = chat_messages.conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
  );

-- Indexes for performance
create index if not exists idx_chat_messages_conversation on public.chat_messages(conversation_id, created_at);
create index if not exists idx_conversations_participants on public.conversations(participant_1, participant_2);
create index if not exists idx_conversations_request on public.conversations(request_id);

-- ========================
-- PART D: RELOAD SCHEMA
-- ========================
notify pgrst, 'reload schema';
