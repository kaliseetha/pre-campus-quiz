create table public.quiz_organizers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{6}$'),
  title text not null check (char_length(title) between 1 and 100),
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'finished')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quiz_sessions (id) on delete cascade,
  question_no integer not null check (question_no > 0),
  prompt text not null check (char_length(prompt) between 1 and 1000),
  options jsonb not null check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) = 4
  ),
  correct_index smallint not null check (correct_index between 0 and 3),
  seconds integer not null check (seconds between 5 and 300),
  unique (session_id, question_no)
);

create table public.quiz_participants (
  session_id uuid not null references public.quiz_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table public.quiz_answers (
  session_id uuid not null,
  user_id uuid not null,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  selected_index smallint not null check (selected_index between 0 and 3),
  is_correct boolean not null,
  submitted_at timestamptz not null default now(),
  primary key (session_id, user_id, question_id),
  foreign key (session_id, user_id)
    references public.quiz_participants (session_id, user_id) on delete cascade
);

create index quiz_questions_session_order_idx
  on public.quiz_questions (session_id, question_no);
create index quiz_answers_session_user_idx
  on public.quiz_answers (session_id, user_id);

alter table public.quiz_organizers enable row level security;
alter table public.quiz_sessions enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_participants enable row level security;
alter table public.quiz_answers enable row level security;

revoke all on table
  public.quiz_organizers,
  public.quiz_sessions,
  public.quiz_questions,
  public.quiz_participants,
  public.quiz_answers
from anon, authenticated;

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

create or replace function public.quiz_create(p_title text, p_questions jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_code text;
  v_question jsonb;
  v_options jsonb;
  v_question_no integer := 0;
  v_seconds integer;
begin
  if v_user_id is null then
    raise exception using message = 'Sign in as an organizer to create a quiz.';
  end if;
  if not exists (
    select 1 from public.quiz_organizers where user_id = v_user_id
  ) then
    raise exception using message = 'This account is not registered as a quiz organizer.';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 100 then
    raise exception using message = 'Quiz title must be between 1 and 100 characters.';
  end if;
  if p_questions is null or jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception using message = 'Questions must be supplied as a list.';
  end if;
  if jsonb_array_length(p_questions) not between 1 and 50 then
    raise exception using message = 'A quiz must contain between 1 and 50 questions.';
  end if;

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    v_question_no := v_question_no + 1;
    if jsonb_typeof(v_question) is distinct from 'object' then
      raise exception using message = format('Question %s has invalid content.', v_question_no);
    end if;

    v_options := v_question -> 'options';
    if jsonb_typeof(v_options) is distinct from 'array' then
      raise exception using message = format('Question %s must have four answer options.', v_question_no);
    end if;
    if jsonb_array_length(v_options) <> 4 then
      raise exception using message = format('Question %s must have four answer options.', v_question_no);
    end if;
    if jsonb_typeof(v_question -> 'prompt') is distinct from 'string'
       or jsonb_typeof(v_question -> 'correctIndex') is distinct from 'number'
       or jsonb_typeof(v_question -> 'seconds') is distinct from 'number'
       or coalesce(v_question ->> 'correctIndex', '') !~ '^[0-3]$'
       or coalesce(v_question ->> 'seconds', '') !~ '^[0-9]{1,3}$'
       or char_length(btrim(v_question ->> 'prompt')) not between 1 and 1000 then
      raise exception using message = format('Question %s has invalid content.', v_question_no);
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_options) as option_item(value)
      where jsonb_typeof(option_item.value) is distinct from 'string'
        or char_length(btrim(option_item.value #>> '{}')) not between 1 and 500
    ) then
      raise exception using message = format('Question %s has invalid answer options.', v_question_no);
    end if;

    v_seconds := (v_question ->> 'seconds')::integer;
    if v_seconds not between 5 and 300 then
      raise exception using message = format('Question %s must have a timer from 5 to 300 seconds.', v_question_no);
    end if;
  end loop;

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (
      select 1 from public.quiz_sessions where code = v_code
    );
  end loop;

  insert into public.quiz_sessions (code, title, created_by)
  values (v_code, btrim(p_title), v_user_id)
  returning id into v_session_id;

  v_question_no := 0;
  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    v_question_no := v_question_no + 1;
    insert into public.quiz_questions (
      session_id, question_no, prompt, options, correct_index, seconds
    ) values (
      v_session_id,
      v_question_no,
      btrim(v_question ->> 'prompt'),
      v_question -> 'options',
      (v_question ->> 'correctIndex')::smallint,
      (v_question ->> 'seconds')::integer
    );
  end loop;

  return v_code;
end;
$$;

create or replace function public.quiz_start(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.quiz_sessions%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.quiz_organizers where user_id = auth.uid()
  ) then
    raise exception using message = 'Only a registered organizer can start a quiz.';
  end if;

  select * into v_session
  from public.quiz_sessions
  where code = upper(btrim(p_code))
    and created_by = auth.uid();
  if not found then
    raise exception using message = 'Quiz room not found for this organizer.';
  end if;
  if v_session.status <> 'waiting' then
    raise exception using message = 'This quiz has already started or finished.';
  end if;
  if not exists (
    select 1 from public.quiz_participants where session_id = v_session.id
  ) then
    raise exception using message = 'At least one player must join before the quiz starts.';
  end if;

  update public.quiz_sessions
  set status = 'active', started_at = statement_timestamp()
  where id = v_session.id;
end;
$$;

create or replace function public.quiz_join(p_code text, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.quiz_sessions%rowtype;
  v_user_id uuid := auth.uid();
  v_total_seconds integer;
begin
  if v_user_id is null then
    raise exception using message = 'Join requires a player session. Refresh and try again.';
  end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 32 then
    raise exception using message = 'Display name must be between 1 and 32 characters.';
  end if;

  select * into v_session
  from public.quiz_sessions
  where code = upper(btrim(p_code))
  for update;
  if not found then
    raise exception using message = 'That quiz room code was not found.';
  end if;

  if exists (
    select 1 from public.quiz_participants
    where session_id = v_session.id and user_id = v_user_id
  ) then
    update public.quiz_participants
    set display_name = btrim(p_display_name)
    where session_id = v_session.id and user_id = v_user_id;
    return;
  end if;

  if v_session.status = 'finished' then
    raise exception using message = 'This quiz has finished and is no longer accepting players.';
  end if;
  if v_session.started_at is not null then
    select coalesce(sum(seconds), 0)::integer into v_total_seconds
    from public.quiz_questions
    where session_id = v_session.id;
    if statement_timestamp() >= v_session.started_at + make_interval(secs => v_total_seconds) then
      raise exception using message = 'This quiz has finished and is no longer accepting players.';
    end if;
  end if;
  if (select count(*) from public.quiz_participants where session_id = v_session.id) >= 49 then
    raise exception using message = 'This room has reached its 49-player limit.';
  end if;

  insert into public.quiz_participants (session_id, user_id, display_name)
  values (v_session.id, v_user_id, btrim(p_display_name));
end;
$$;

create or replace function public.quiz_get_state(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.quiz_sessions%rowtype;
  v_user_id uuid := auth.uid();
  v_is_organizer boolean;
  v_status text;
  v_question public.quiz_questions%rowtype;
  v_current_question jsonb := null;
  v_top_three jsonb := '[]'::jsonb;
  v_question_count integer;
  v_player_count integer;
  v_elapsed numeric;
  v_offset integer := 0;
  v_seconds_remaining integer;
  v_answered boolean := false;
begin
  if v_user_id is null then
    raise exception using message = 'Your player session is missing. Refresh and rejoin.';
  end if;

  select * into v_session
  from public.quiz_sessions
  where code = upper(btrim(p_code))
  for update;
  if not found then
    raise exception using message = 'That quiz room code was not found.';
  end if;

  v_is_organizer := v_session.created_by = v_user_id and exists (
    select 1 from public.quiz_organizers where user_id = v_user_id
  );
  if not v_is_organizer and not exists (
    select 1 from public.quiz_participants
    where session_id = v_session.id and user_id = v_user_id
  ) then
    raise exception using message = 'Join this quiz with a display name to view the room.';
  end if;

  select count(*)::integer into v_question_count
  from public.quiz_questions where session_id = v_session.id;
  select count(*)::integer into v_player_count
  from public.quiz_participants where session_id = v_session.id;
  v_status := v_session.status;

  if v_status = 'active' then
    v_elapsed := extract(epoch from (statement_timestamp() - v_session.started_at));
    for v_question in
      select * from public.quiz_questions
      where session_id = v_session.id
      order by question_no
    loop
      if v_elapsed < v_offset + v_question.seconds then
        v_seconds_remaining := greatest(0, ceil(v_offset + v_question.seconds - v_elapsed)::integer);
        select exists (
          select 1 from public.quiz_answers
          where session_id = v_session.id
            and user_id = v_user_id
            and question_id = v_question.id
        ) into v_answered;
        v_current_question := jsonb_build_object(
          'question_no', v_question.question_no,
          'prompt', v_question.prompt,
          'options', v_question.options,
          'seconds', v_question.seconds,
          'ends_at', v_session.started_at + make_interval(secs => v_offset + v_question.seconds),
          'seconds_remaining', v_seconds_remaining,
          'already_answered', v_answered
        );
        exit;
      end if;
      v_offset := v_offset + v_question.seconds;
    end loop;

    if v_current_question is null then
      v_status := 'finished';
      update public.quiz_sessions
      set status = 'finished', finished_at = coalesce(finished_at, statement_timestamp())
      where id = v_session.id;
    end if;
  end if;

  if v_status = 'finished' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object('display_name', ranked.display_name, 'score', ranked.score)
        order by ranked.score desc, ranked.joined_at asc, ranked.display_name asc
      ),
      '[]'::jsonb
    ) into v_top_three
    from (
      select
        participant.display_name,
        participant.joined_at,
        coalesce(sum(case when answer.is_correct then 1 else 0 end), 0)::integer as score
      from public.quiz_participants as participant
      left join public.quiz_answers as answer
        on answer.session_id = participant.session_id
        and answer.user_id = participant.user_id
      where participant.session_id = v_session.id
      group by participant.session_id, participant.user_id, participant.display_name, participant.joined_at
      order by score desc, participant.joined_at asc, participant.display_name asc
      limit 3
    ) as ranked;
  end if;

  return jsonb_build_object(
    'code', v_session.code,
    'title', v_session.title,
    'status', v_status,
    'participant_count', v_player_count,
    'question_count', v_question_count,
    'current_question', v_current_question,
    'top_three', v_top_three
  );
end;
$$;

create or replace function public.quiz_submit_answer(
  p_code text,
  p_question_no integer,
  p_selected_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.quiz_sessions%rowtype;
  v_question public.quiz_questions%rowtype;
  v_user_id uuid := auth.uid();
  v_offset integer;
begin
  if v_user_id is null then
    raise exception using message = 'Your player session is missing. Refresh and rejoin.';
  end if;
  select * into v_session
  from public.quiz_sessions
  where code = upper(btrim(p_code));
  if not found or v_session.status <> 'active' then
    raise exception using message = 'This quiz is not accepting answers right now.';
  end if;
  if not exists (
    select 1 from public.quiz_participants
    where session_id = v_session.id and user_id = v_user_id
  ) then
    raise exception using message = 'Join this quiz before submitting an answer.';
  end if;
  select * into v_question
  from public.quiz_questions
  where session_id = v_session.id and question_no = p_question_no;
  if not found then
    raise exception using message = 'That question is not part of this quiz.';
  end if;
  if p_selected_index not between 0 and 3 then
    raise exception using message = 'Choose one of the four answer options.';
  end if;

  select coalesce(sum(seconds), 0)::integer into v_offset
  from public.quiz_questions
  where session_id = v_session.id and question_no < p_question_no;
  if statement_timestamp() < v_session.started_at + make_interval(secs => v_offset)
     or statement_timestamp() >= v_session.started_at + make_interval(secs => v_offset + v_question.seconds) then
    raise exception using message = 'Time is up for this question.';
  end if;

  insert into public.quiz_answers (
    session_id, user_id, question_id, selected_index, is_correct
  ) values (
    v_session.id,
    v_user_id,
    v_question.id,
    p_selected_index::smallint,
    p_selected_index = v_question.correct_index
  )
  on conflict (session_id, user_id, question_id) do nothing;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'already_answered');
  end if;
  return jsonb_build_object('accepted', true);
end;
$$;

create or replace function public.quiz_delete(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.quiz_sessions%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.quiz_organizers where user_id = auth.uid()
  ) then
    raise exception using message = 'Only a registered organizer can delete quiz data.';
  end if;

  select * into v_session
  from public.quiz_sessions
  where code = upper(btrim(p_code))
    and created_by = auth.uid();
  if not found then
    raise exception using message = 'Quiz room not found for this organizer.';
  end if;
  if v_session.status <> 'finished' then
    raise exception using message = 'Only a finished quiz can be deleted.';
  end if;

  delete from public.quiz_sessions where id = v_session.id;
end;
$$;

revoke all on function public.quiz_create(text, jsonb) from public, anon;
revoke all on function public.quiz_is_organizer() from public, anon;
revoke all on function public.quiz_start(text) from public, anon;
revoke all on function public.quiz_join(text, text) from public, anon;
revoke all on function public.quiz_get_state(text) from public, anon;
revoke all on function public.quiz_submit_answer(text, integer, integer) from public, anon;
revoke all on function public.quiz_delete(text) from public, anon;

grant execute on function public.quiz_create(text, jsonb) to authenticated;
grant execute on function public.quiz_is_organizer() to authenticated;
grant execute on function public.quiz_start(text) to authenticated;
grant execute on function public.quiz_join(text, text) to authenticated;
grant execute on function public.quiz_get_state(text) to authenticated;
grant execute on function public.quiz_submit_answer(text, integer, integer) to authenticated;
grant execute on function public.quiz_delete(text) to authenticated;
