-- AVI multi-conversation storage. Legacy avi_conversations is intentionally retained.
create table if not exists public.avi_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint avi_chat_conversations_messages_array check (jsonb_typeof(messages) = 'array')
);
create index if not exists avi_chat_conversations_user_updated_idx on public.avi_chat_conversations (user_id, updated_at desc);
alter table public.avi_chat_conversations enable row level security;
grant select, insert, update, delete on public.avi_chat_conversations to authenticated;
create policy "Users can view their own AVI chat conversations" on public.avi_chat_conversations for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own AVI chat conversations" on public.avi_chat_conversations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own AVI chat conversations" on public.avi_chat_conversations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own AVI chat conversations" on public.avi_chat_conversations for delete to authenticated using ((select auth.uid()) = user_id);
create or replace function public.avi_chat_conversations_touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger avi_chat_conversations_touch_updated_at before update on public.avi_chat_conversations for each row execute function public.avi_chat_conversations_touch_updated_at();
insert into public.avi_chat_conversations (user_id,title,messages,created_at,updated_at)
select l.user_id,
coalesce(nullif(left((select m->>'text' from jsonb_array_elements(l.messages) with ordinality as x(m,n) where m->>'role'='user' order by n limit 1),72),''),'Imported conversation'),
l.messages,l.updated_at,l.updated_at
from public.avi_conversations l
where jsonb_array_length(l.messages)>0
and not exists(select 1 from public.avi_chat_conversations c where c.user_id=l.user_id and c.messages=l.messages);
do $$ begin
if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='avi_chat_conversations') then
alter publication supabase_realtime add table public.avi_chat_conversations;
end if; end $$;