-- Phase 4A: revisioned, idempotent memory operations with durable tombstones.
-- Backward-compatible: existing memory rows and the legacy memory text column are preserved.

alter table public.avi_personal_memories
  add column if not exists revision bigint not null default 1,
  add column if not exists deleted_at timestamptz;

create index if not exists avi_personal_memories_user_updated_idx
  on public.avi_personal_memories (user_id, updated_at desc);

create table if not exists public.avi_memory_operations (
  operation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id uuid not null,
  action text not null check (action in ('create','update','delete')),
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists avi_memory_operations_user_id_idx
  on public.avi_memory_operations (user_id);

alter table public.avi_memory_operations enable row level security;
revoke all on public.avi_memory_operations from public, anon, authenticated;

create or replace function public.avi_apply_memory_operation(
  p_operation_id uuid,
  p_action text,
  p_memory_id uuid,
  p_memory text default null,
  p_base_revision bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_record public.avi_personal_memories%rowtype;
  v_response jsonb;
  v_inserted integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_operation_id is null or p_memory_id is null then
    raise exception 'Operation ID and memory ID are required' using errcode = '22023';
  end if;
  if p_action not in ('create','update','delete') then
    raise exception 'Unsupported memory operation' using errcode = '22023';
  end if;
  if p_action in ('create','update') and
     (p_memory is null or char_length(btrim(p_memory)) < 1 or char_length(p_memory) > 2000) then
    raise exception 'Memory must contain between 1 and 2000 characters' using errcode = '22023';
  end if;

  select op.response into v_response
  from public.avi_memory_operations op
  where op.operation_id = p_operation_id and op.user_id = v_user_id;
  if found and v_response <> '{}'::jsonb then
    return v_response;
  end if;

  insert into public.avi_memory_operations(operation_id,user_id,memory_id,action)
  values(p_operation_id,v_user_id,p_memory_id,p_action)
  on conflict (operation_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select op.response into v_response
    from public.avi_memory_operations op
    where op.operation_id = p_operation_id and op.user_id = v_user_id
    for update;
    if not found then
      raise exception 'Operation ID is already used' using errcode = '23505';
    end if;
    if v_response <> '{}'::jsonb then return v_response; end if;
  end if;

  if p_action = 'create' then
    select * into v_record
    from public.avi_personal_memories
    where user_id = v_user_id and memory = btrim(p_memory) and deleted_at is null
    order by created_at asc limit 1;
    if found then
      v_response := jsonb_build_object('status','duplicate','record',to_jsonb(v_record));
    else
      if exists (
        select 1 from public.avi_personal_memories
        where user_id = v_user_id and memory = btrim(p_memory) and deleted_at is not null
      ) then
        v_response := jsonb_build_object('status','deleted');
      else
        insert into public.avi_personal_memories(id,user_id,memory,revision,created_at,updated_at)
        values(p_memory_id,v_user_id,btrim(p_memory),1,now(),now())
        on conflict (user_id,memory) do nothing
        returning * into v_record;
        if found then
          v_response := jsonb_build_object('status','applied','record',to_jsonb(v_record));
        else
          select * into v_record from public.avi_personal_memories
          where user_id = v_user_id and memory = btrim(p_memory) and deleted_at is null
          order by created_at asc limit 1;
          if found then
            v_response := jsonb_build_object('status','duplicate','record',to_jsonb(v_record));
          else
            v_response := jsonb_build_object('status','deleted');
          end if;
        end if;
      end if;
    end if;

  elsif p_action = 'update' then
    select * into v_record
    from public.avi_personal_memories
    where id = p_memory_id and user_id = v_user_id
    for update;
    if not found then
      v_response := jsonb_build_object('status','not_found');
    elsif v_record.deleted_at is not null then
      v_response := jsonb_build_object('status','deleted','record',to_jsonb(v_record));
    elsif v_record.revision <> coalesce(p_base_revision,0) then
      v_response := jsonb_build_object('status','conflict','record',to_jsonb(v_record));
    elsif exists (
      select 1 from public.avi_personal_memories other
      where other.user_id = v_user_id and other.id <> p_memory_id
        and other.memory = btrim(p_memory) and other.deleted_at is null
    ) then
      v_response := jsonb_build_object('status','duplicate_conflict','record',to_jsonb(v_record));
    else
      update public.avi_personal_memories
      set memory = btrim(p_memory), revision = revision + 1, updated_at = now()
      where id = p_memory_id and user_id = v_user_id
      returning * into v_record;
      v_response := jsonb_build_object('status','applied','record',to_jsonb(v_record));
    end if;

  else
    select * into v_record
    from public.avi_personal_memories
    where id = p_memory_id and user_id = v_user_id
    for update;
    if not found then
      v_response := jsonb_build_object('status','not_found');
    elsif v_record.deleted_at is not null then
      v_response := jsonb_build_object('status','already_deleted','record',to_jsonb(v_record));
    elsif v_record.revision <> coalesce(p_base_revision,0) then
      v_response := jsonb_build_object('status','conflict','record',to_jsonb(v_record));
    else
      update public.avi_personal_memories
      set deleted_at = now(), revision = revision + 1, updated_at = now()
      where id = p_memory_id and user_id = v_user_id
      returning * into v_record;
      v_response := jsonb_build_object('status','applied','record',to_jsonb(v_record));
    end if;
  end if;

  update public.avi_memory_operations
  set response = v_response
  where operation_id = p_operation_id and user_id = v_user_id;
  return v_response;
end;
$$;

revoke all on function public.avi_apply_memory_operation(uuid,text,uuid,text,bigint) from public, anon;
grant execute on function public.avi_apply_memory_operation(uuid,text,uuid,text,bigint) to authenticated;
