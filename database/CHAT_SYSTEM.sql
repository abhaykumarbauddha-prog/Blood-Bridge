-- ============================================================
-- BLOOD BRIDGE: IN-APP CHAT & REAL-TIME MESSAGING SYSTEM
-- Run this in your Supabase Dashboard > SQL Editor
-- Enables live chats between Requester <-> Donor,
-- Hospital <-> Donor, Blood Bank <-> Donor, Blood Bank <-> Hospital
-- ============================================================

-- 1. Create Conversations Table
create table if not exists public.conversations (
    id uuid primary key default gen_random_uuid(),
    request_id uuid references public.blood_requests(id) on delete set null,
    participant_1 uuid not null references auth.users(id) on delete cascade,
    participant_2 uuid not null references auth.users(id) on delete cascade,
    last_message_text text,
    last_message_at timestamptz default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now()),
    constraint chk_different_participants check (participant_1 <> participant_2)
);

-- Ensure unique pair per optional request
create unique index if not exists idx_unique_conversation_with_request
    on public.conversations(participant_1, participant_2, request_id)
    where request_id is not null;

create unique index if not exists idx_unique_conversation_direct
    on public.conversations(participant_1, participant_2)
    where request_id is null;

-- 2. Create Chat Messages Table
create table if not exists public.chat_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    sender_id uuid not null references auth.users(id) on delete cascade,
    message text not null check (char_length(trim(message)) between 1 and 5000),
    read_at timestamptz,
    created_at timestamptz not null default timezone('utc', now())
);

-- 3. Indexes for Speed
create index if not exists idx_chat_messages_conv_created 
    on public.chat_messages(conversation_id, created_at asc);

create index if not exists idx_conversations_p1 
    on public.conversations(participant_1);

create index if not exists idx_conversations_p2 
    on public.conversations(participant_2);

create index if not exists idx_conversations_last_msg 
    on public.conversations(last_message_at desc);

-- 4. Enable Row Level Security (RLS)
alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;

-- 5. RLS Policies for Conversations
drop policy if exists "Users view own conversations" on public.conversations;
create policy "Users view own conversations"
    on public.conversations for select to authenticated
    using (participant_1 = auth.uid() or participant_2 = auth.uid());

drop policy if exists "Users create own conversations" on public.conversations;
create policy "Users create own conversations"
    on public.conversations for insert to authenticated
    with check (participant_1 = auth.uid() or participant_2 = auth.uid());

drop policy if exists "Users update own conversations" on public.conversations;
create policy "Users update own conversations"
    on public.conversations for update to authenticated
    using (participant_1 = auth.uid() or participant_2 = auth.uid());

-- 6. RLS Policies for Chat Messages
drop policy if exists "Participants view chat messages" on public.chat_messages;
create policy "Participants view chat messages"
    on public.chat_messages for select to authenticated
    using (
        exists (
            select 1 from public.conversations c
            where c.id = chat_messages.conversation_id
              and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
        )
    );

drop policy if exists "Participants send chat messages" on public.chat_messages;
create policy "Participants send chat messages"
    on public.chat_messages for insert to authenticated
    with check (
        sender_id = auth.uid()
        and exists (
            select 1 from public.conversations c
            where c.id = chat_messages.conversation_id
              and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
        )
    );

drop policy if exists "Recipients mark messages read" on public.chat_messages;
create policy "Recipients mark messages read"
    on public.chat_messages for update to authenticated
    using (
        exists (
            select 1 from public.conversations c
            where c.id = chat_messages.conversation_id
              and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
        )
    );

-- 7. Trigger to auto-update conversation last_message
create or replace function public.update_conversation_last_message()
returns trigger as $$
begin
    update public.conversations
    set last_message_text = substring(new.message from 1 for 200),
        last_message_at = new.created_at
    where id = new.conversation_id;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_update_last_message on public.chat_messages;
create trigger trg_update_last_message
    after insert on public.chat_messages
    for each row execute function public.update_conversation_last_message();

-- 8. Add chat_messages to Supabase Realtime publication
do $$
begin
    if not exists (
        select 1 from pg_publication_tables 
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
    ) then
        alter publication supabase_realtime add table public.chat_messages;
    end if;
    if not exists (
        select 1 from pg_publication_tables 
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
    ) then
        alter publication supabase_realtime add table public.conversations;
    end if;
exception
    when others then
        raise notice 'Realtime publication setup skipped or handled by dashboard: %', SQLERRM;
end $$;

-- 9. Refresh API Cache
notify pgrst, 'reload schema';
