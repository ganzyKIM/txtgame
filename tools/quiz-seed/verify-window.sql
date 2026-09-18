-- 034 검증: "최근 10문제 안에 같은 정답이 다시 나오지 않는다"를 실제 픽으로 확인.
-- 한 유저로 30연속 픽을 돌려, 모든 길이-10 슬라이딩 창에 중복이 있는지 센다.
-- 대시보드는 raise notice를 보여주지 않으므로 결과를 임시 테이블에 담아 마지막에 select한다.
-- 창 기록을 건드리므로, 빌려 쓴 유저의 원래 상태는 끝에서 그대로 복원한다.

create temp table if not exists _win_check(k text, v text) on commit drop;
truncate _win_check;

do $$
declare
  v_uid     uuid;
  v_backup  text[];
  v_had_row boolean;
  v_cat     text;
  v_diff    text := 'normal';
  v_key     text;
  v_seq     text[] := '{}';
  i         int;
  v_dupe    int := 0;
  v_win     text[];
begin
  -- quiz_serve_history.user_id는 auth.users FK라 가짜 uuid를 못 쓴다.
  select id into v_uid from auth.users order by created_at limit 1;
  if v_uid is null then
    insert into _win_check values ('결과', '⚠ auth.users가 비어 검증 불가');
    return;
  end if;

  select recent_keys into v_backup from public.quiz_serve_history where user_id = v_uid;
  v_had_row := found;

  select category_key into v_cat
  from public.quiz_bank
  where status = 'active' and jsonb_array_length(hint_sets) > 0
    and coalesce(difficulty_actual, difficulty_labeled) = v_diff
  group by category_key order by count(*) desc limit 1;

  insert into _win_check values ('테스트 카테고리', v_cat || ' / 난이도 ' || v_diff);

  delete from public.quiz_serve_history where user_id = v_uid;

  for i in 1..30 loop
    v_key := null;
    select answer_key into v_key from public.quiz_pick_internal(v_uid, v_cat, v_diff, '{}');
    if v_key is null then
      insert into _win_check values ('재고 소진', i || '번째 픽에서 후보 없음');
      exit;
    end if;
    v_seq := v_seq || v_key;
  end loop;

  insert into _win_check values ('총 픽 횟수', coalesce(array_length(v_seq, 1), 0)::text);
  insert into _win_check values ('서로 다른 정답 수', (select count(distinct k)::text from unnest(v_seq) k));

  for i in 1..greatest(coalesce(array_length(v_seq, 1), 0) - 9, 0) loop
    v_win := v_seq[i : i + 9];
    if (select count(*) from unnest(v_win) k) <> (select count(distinct k) from unnest(v_win) k) then
      v_dupe := v_dupe + 1;
      insert into _win_check values ('✗ 중복 창 ' || i || '~' || (i + 9), array_to_string(v_win, ', '));
    end if;
  end loop;

  insert into _win_check values ('검사한 창 개수', greatest(coalesce(array_length(v_seq, 1), 0) - 9, 0)::text);
  insert into _win_check values ('결과', case when v_dupe = 0 then '✅ 통과 — 10회 창 중복 0건' else '❌ 실패 — 중복 창 ' || v_dupe || '개' end);

  -- 원래 상태로 복원
  delete from public.quiz_serve_history where user_id = v_uid;
  if v_had_row then
    insert into public.quiz_serve_history (user_id, recent_keys) values (v_uid, v_backup);
  end if;
end;
$$;

select k as 항목, v as 값 from _win_check;
