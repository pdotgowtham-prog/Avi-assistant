do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='avi_personal_memories') then
  alter publication supabase_realtime add table public.avi_personal_memories;
 end if;
end $$;