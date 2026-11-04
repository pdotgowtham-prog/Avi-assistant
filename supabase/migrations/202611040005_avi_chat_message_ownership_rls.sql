drop policy if exists "Users can read their own AVI chat messages" on public.avi_chat_messages;
create policy "Users can read their own AVI chat messages" on public.avi_chat_messages for select to authenticated
using ((select auth.uid())=user_id and exists(select 1 from public.avi_chat_conversations c where c.id=conversation_id and c.user_id=(select auth.uid())));
drop policy if exists "Users can insert their own AVI chat messages" on public.avi_chat_messages;
create policy "Users can insert their own AVI chat messages" on public.avi_chat_messages for insert to authenticated
with check ((select auth.uid())=user_id and exists(select 1 from public.avi_chat_conversations c where c.id=conversation_id and c.user_id=(select auth.uid())));
drop policy if exists "Users can update their own AVI chat messages" on public.avi_chat_messages;
create policy "Users can update their own AVI chat messages" on public.avi_chat_messages for update to authenticated
using ((select auth.uid())=user_id and exists(select 1 from public.avi_chat_conversations c where c.id=conversation_id and c.user_id=(select auth.uid())))
with check ((select auth.uid())=user_id and exists(select 1 from public.avi_chat_conversations c where c.id=conversation_id and c.user_id=(select auth.uid())));
drop policy if exists "Users can delete their own AVI chat messages" on public.avi_chat_messages;
create policy "Users can delete their own AVI chat messages" on public.avi_chat_messages for delete to authenticated
using ((select auth.uid())=user_id and exists(select 1 from public.avi_chat_conversations c where c.id=conversation_id and c.user_id=(select auth.uid())));