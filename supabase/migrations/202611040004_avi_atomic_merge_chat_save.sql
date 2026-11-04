create or replace function public.avi_merge_chat_message_arrays(existing_messages jsonb, incoming_messages jsonb)
returns jsonb language sql immutable set search_path = '' as $$
 select coalesce(jsonb_agg(item order by sort_time asc nulls last, first_position asc),'[]'::jsonb)
 from (
  select distinct on (coalesce(item->>'id',md5(item::text))) item,
   case when coalesce(item->>'timestamp','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (item->>'timestamp')::timestamptz else null end as sort_time,
   ord as first_position
  from jsonb_array_elements(coalesce(existing_messages,'[]'::jsonb)||coalesce(incoming_messages,'[]'::jsonb)) with ordinality as entries(item,ord)
  order by coalesce(item->>'id',md5(item::text)),ord desc
 ) merged;
$$;
create or replace function public.avi_save_chat_conversation(p_id uuid,p_title text,p_messages jsonb,p_created_at timestamptz default now())
returns setof public.avi_chat_conversations language plpgsql security invoker set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_id is null then raise exception 'Conversation ID is required'; end if;
 if jsonb_typeof(p_messages)<>'array' then raise exception 'Messages must be a JSON array'; end if;
 return query
 insert into public.avi_chat_conversations(id,user_id,title,messages,created_at)
 values(p_id,auth.uid(),left(coalesce(nullif(trim(p_title),''),'New conversation'),100),p_messages,coalesce(p_created_at,now()))
 on conflict(id) do update set title=excluded.title,
  messages=public.avi_merge_chat_message_arrays(public.avi_chat_conversations.messages,excluded.messages)
 returning *;
end;
$$;
revoke all on function public.avi_save_chat_conversation(uuid,text,jsonb,timestamptz) from public;
grant execute on function public.avi_save_chat_conversation(uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.avi_merge_chat_message_arrays(jsonb,jsonb) to authenticated;