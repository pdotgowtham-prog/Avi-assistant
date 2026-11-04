-- Phase 4C: metadata, history, and authenticated automatic-memory upsert.
-- Existing memory text, IDs, revisions, and tombstones are preserved.

alter table public.avi_personal_memories
  add column if not exists category text not null default 'personal'
    check (category in ('work','family','preferences','finance','travel','personal','hobbies','goals')),
  add column if not exists memory_type text not null default 'long_term'
    check (memory_type in ('long_term','temporary')),
  add column if not exists confidence numeric(4,3) not null default 0.900
    check (confidence >= 0 and confidence <= 1),
  add column if not exists importance smallint not null default 3
    check (importance between 1 and 5),
  add column if not exists source text not null default 'manual'
    check (source in ('manual','conversation')),
  add column if not exists last_confirmed_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz;

create index if not exists avi_personal_memories_user_category_idx
  on public.avi_personal_memories(user_id, category, updated_at desc)
  where deleted_at is null;

create table if not exists public.avi_memory_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id uuid not null,
  revision bigint not null,
  action text not null check (action in ('created','updated','deleted')),
  memory text not null,
  category text not null,
  memory_type text not null,
  confidence numeric(4,3) not null,
  importance smallint not null,
  source text not null,
  recorded_at timestamptz not null default now()
);

create index if not exists avi_memory_history_user_memory_idx
  on public.avi_memory_history(user_id, memory_id, recorded_at desc);

alter table public.avi_memory_history enable row level security;
revoke all on public.avi_memory_history from public, anon;
grant select on public.avi_memory_history to authenticated;
drop policy if exists "Users can read their own AVI memory history" on public.avi_memory_history;
create policy "Users can read their own AVI memory history"
  on public.avi_memory_history for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.avi_record_memory_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.avi_memory_history(user_id,memory_id,revision,action,memory,category,memory_type,confidence,importance,source)
    values(new.user_id,new.id,new.revision,'created',new.memory,new.category,new.memory_type,new.confidence,new.importance,new.source);
    return new;
  end if;

  if tg_op = 'UPDATE' and (
    old.memory is distinct from new.memory or
    old.category is distinct from new.category or
    old.memory_type is distinct from new.memory_type or
    old.deleted_at is distinct from new.deleted_at
  ) then
    insert into public.avi_memory_history(user_id,memory_id,revision,action,memory,category,memory_type,confidence,importance,source)
    values(new.user_id,new.id,new.revision,
      case when old.deleted_at is null and new.deleted_at is not null then 'deleted' else 'updated' end,
      new.memory,new.category,new.memory_type,new.confidence,new.importance,new.source);
  end if;
  return new;
end;
$$;

drop trigger if exists avi_personal_memories_history on public.avi_personal_memories;
create trigger avi_personal_memories_history
  after insert or update on public.avi_personal_memories
  for each row execute function public.avi_record_memory_history();

-- Authenticated callers may save only to their own account. The caller's
-- identity comes exclusively from auth.uid(), never from request parameters.
create or replace function public.avi_upsert_extracted_memory(
  p_memory text,
  p_category text,
  p_confidence numeric,
  p_importance smallint,
  p_memory_type text default 'long_term'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_text text := btrim(coalesce(p_memory,''));
  v_category text := coalesce(p_category,'personal');
  v_type text := coalesce(p_memory_type,'long_term');
  v_existing public.avi_personal_memories%rowtype;
  v_normalized text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if char_length(v_text)<8 or char_length(v_text)>500 then raise exception 'Memory length must be 8 to 500 characters' using errcode='22023'; end if;
  if v_category not in ('work','family','preferences','finance','travel','personal','hobbies','goals') then
    raise exception 'Unsupported memory category' using errcode='22023';
  end if;
  if v_type not in ('long_term','temporary') then raise exception 'Unsupported memory type' using errcode='22023'; end if;
  if p_confidence is null or p_confidence<0.85 or p_confidence>1 then
    raise exception 'Automatic memories require confidence between 0.85 and 1' using errcode='22023';
  end if;
  if p_importance is null or p_importance<1 or p_importance>5 then raise exception 'Importance must be 1 to 5' using errcode='22023'; end if;

  v_normalized := lower(regexp_replace(v_text,'[^[:alnum:]]+','','g'));
  select * into v_existing
  from public.avi_personal_memories m
  where m.user_id=v_user_id and m.deleted_at is null
    and lower(regexp_replace(m.memory,'[^[:alnum:]]+','','g'))=v_normalized
  order by m.created_at asc limit 1
  for update;

  if found then
    update public.avi_personal_memories
    set category=v_category, confidence=greatest(confidence,p_confidence),
        importance=greatest(importance,p_importance), memory_type=v_type,
        source='conversation', last_confirmed_at=now(),
        expires_at=case when v_type='temporary' then now()+interval '30 days' else null end
    where id=v_existing.id and user_id=v_user_id;
    return jsonb_build_object('status','refreshed','memory_id',v_existing.id);
  end if;

  -- A deleted exact match is deliberately not recreated automatically.
  if exists (
    select 1 from public.avi_personal_memories m
    where m.user_id=v_user_id and m.deleted_at is not null
      and lower(regexp_replace(m.memory,'[^[:alnum:]]+','','g'))=v_normalized
  ) then
    return jsonb_build_object('status','suppressed_deleted');
  end if;

  insert into public.avi_personal_memories(
    user_id,memory,category,memory_type,confidence,importance,source,last_confirmed_at,expires_at
  ) values (
    v_user_id,v_text,v_category,v_type,p_confidence,p_importance,'conversation',now(),
    case when v_type='temporary' then now()+interval '30 days' else null end
  ) returning id into v_existing.id;
  return jsonb_build_object('status','created','memory_id',v_existing.id);
end;
$$;

revoke all on function public.avi_upsert_extracted_memory(text,text,numeric,smallint,text) from public, anon;
grant execute on function public.avi_upsert_extracted_memory(text,text,numeric,smallint,text) to authenticated;
