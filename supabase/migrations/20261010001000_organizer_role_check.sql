create or replace function public.quiz_is_organizer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.quiz_organizers where user_id = auth.uid()
  );
$$;

revoke all on function public.quiz_is_organizer() from public, anon;
grant execute on function public.quiz_is_organizer() to authenticated;
