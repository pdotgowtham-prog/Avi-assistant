alter table public.avi_chat_conversations
  add column if not exists last_message_preview text not null default '';

create or replace function public.avi_chat_conversations_set_preview()
returns trigger language plpgsql set search_path = '' as $$
declare
  last_text text;
begin
  select coalesce(entry.item->>'text','')
    into last_text
  from jsonb_array_elements(new.messages) with ordinality as entry(item,ordinality)
  order by entry.ordinality desc
  limit 1;
  new.last_message_preview=left(coalesce(last_text,''),180);
  return new;
end;
$$;
drop trigger if exists avi_chat_conversations_set_preview on public.avi_chat_conversations;
create trigger avi_chat_conversations_set_preview
before insert or update of messages on public.avi_chat_conversations
for each row execute function public.avi_chat_conversations_set_preview();

create table if not exists public.avi_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.avi_chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  role text not null check (role in ('user','model','assistant','system')),
  content text not null,
  created_at timestamptz not null default now(),
  constraint avi_chat_messages_conversation_sequence_key unique (conversation_id, sequence)
);
create index if not exists avi_chat_messages_user_conversation_idx
  on public.avi_chat_messages(user_id, conversation_id, sequence);
alter table public.avi_chat_messages enable row level security;
grant select, insert, update, delete on public.avi_chat_messages to authenticated;
drop policy if exists "Users can read their own AVI chat messages" on public.avi_chat_messages;
create policy "Users can read their own AVI chat messages" on public.avi_chat_messages
 for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own AVI chat messages" on public.avi_chat_messages;
create policy "Users can insert their own AVI chat messages" on public.avi_chat_messages
 for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own AVI chat messages" on public.avi_chat_messages;
create policy "Users can update their own AVI chat messages" on public.avi_chat_messages
 for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own AVI chat messages" on public.avi_chat_messages;
create policy "Users can delete their own AVI chat messages" on public.avi_chat_messages
 for delete to authenticated using ((select auth.uid()) = user_id);
create or replace function public.avi_sync_json_messages_to_rows()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(new.messages) <> 'array' then
    raise exception 'Conversation messages must be a JSON array';
  end if;
  insert into public.avi_chat_messages
    (conversation_id,user_id,sequence,role,content,created_at)
  select new.id,new.user_id,(entry.ordinality-1)::integer,
         case when entry.item->>'role'='avi' then 'model' else entry.item->>'role' end,
         coalesce(entry.item->>'text',''),
         case when coalesce(entry.item->>'timestamp','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              then (entry.item->>'timestamp')::timestamptz else now() end
  from jsonb_array_elements(new.messages) with ordinality as entry(item,ordinality)
  where coalesce(entry.item->>'role','') in ('user','model','assistant','system','avi')
  on conflict (conversation_id,sequence) do update
    set user_id=excluded.user_id,role=excluded.role,content=excluded.content,created_at=excluded.created_at;
  delete from public.avi_chat_messages
   where conversation_id=new.id
     and sequence >= jsonb_array_length(new.messages);
  return new;
end;
$$;
drop trigger if exists avi_sync_json_messages_to_rows on public.avi_chat_conversations;
create trigger avi_sync_json_messages_to_rows
after insert or update of messages on public.avi_chat_conversations
for each row execute function public.avi_sync_json_messages_to_rows();
update public.avi_chat_conversations set messages=messages;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='avi_chat_messages') then
  alter publication supabase_realtime add table public.avi_chat_messages;
 end if;
end $$;