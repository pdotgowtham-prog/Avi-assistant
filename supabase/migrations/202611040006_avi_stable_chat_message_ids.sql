create or replace function public.avi_chat_conversations_set_preview()
returns trigger language plpgsql set search_path = '' as $$
declare normalized_messages jsonb; last_text text;
begin
 if jsonb_typeof(new.messages)<>'array' then raise exception 'Conversation messages must be a JSON array'; end if;
 select coalesce(jsonb_agg(case when coalesce(entry.item->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then entry.item else entry.item||jsonb_build_object('id',gen_random_uuid()::text) end order by entry.ordinality),'[]'::jsonb)
 into normalized_messages from jsonb_array_elements(new.messages) with ordinality as entry(item,ordinality);
 new.messages=normalized_messages;
 select coalesce(entry.item->>'text','') into last_text from jsonb_array_elements(new.messages) with ordinality as entry(item,ordinality) order by entry.ordinality desc limit 1;
 new.last_message_preview=left(coalesce(last_text,''),180);
 return new;
end;
$$;
create or replace function public.avi_sync_json_messages_to_rows()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if jsonb_typeof(new.messages)<>'array' then raise exception 'Conversation messages must be a JSON array'; end if;
 insert into public.avi_chat_messages(id,conversation_id,user_id,sequence,role,content,created_at)
 select (entry.item->>'id')::uuid,new.id,new.user_id,(entry.ordinality-1)::integer,
  case when entry.item->>'role'='avi' then 'model' else entry.item->>'role' end,
  coalesce(entry.item->>'text',''),
  case when coalesce(entry.item->>'timestamp','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (entry.item->>'timestamp')::timestamptz else now() end
 from jsonb_array_elements(new.messages) with ordinality as entry(item,ordinality)
 where coalesce(entry.item->>'role','') in ('user','model','assistant','system','avi')
 on conflict(conversation_id,sequence) do update set id=excluded.id,user_id=excluded.user_id,role=excluded.role,content=excluded.content,created_at=excluded.created_at;
 delete from public.avi_chat_messages where conversation_id=new.id and sequence>=jsonb_array_length(new.messages);
 return new;
end;
$$;
update public.avi_chat_conversations set messages=messages;