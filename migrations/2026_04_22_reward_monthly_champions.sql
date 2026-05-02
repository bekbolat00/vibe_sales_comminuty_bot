-- ============================================================================
-- Ежемесячное автоматическое награждение чемпионов
-- ----------------------------------------------------------------------------
-- Что делает миграция:
--   1. Создаёт таблицу public.history_coins — архив vibe_coins по сезонам
--      (нужно, чтобы после обнуления у нас осталась история рейтинга).
--   2. Создаёт таблицу public.inventory — инвентарь пользователя: трофеи,
--      пояса, будущие кастом-скины, награды за эвенты и т.п.
--   3. Создаёт функцию public.reward_monthly_champions() — определяет
--      абсолютного чемпиона P4P и чемпионов в каждой лиге (МОП, РОП,
--      БИЗНЕС, ФРИЛАНС), выдаёт пояса, пушит уведомления, кладёт трофеи
--      в инвентарь и обнуляет рейтинг.
--   4. В конце файла — инструкция по запуску функции через pg_cron
--      (строго 00:00 1-го числа каждого месяца).
--
-- Применять в Supabase SQL Editor один раз.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. АРХИВ РЕЙТИНГА  (public.history_coins)
-- ────────────────────────────────────────────────────────────────────────────
-- Перед обнулением vibe_coins мы копируем снэпшот всех пользователей сюда.
-- Одна строка = один пользователь за один сезон (year, month).
create table if not exists public.history_coins (
    id            bigserial primary key,
    user_id       bigint        not null,             -- = users.tg_id
    first_name    text,
    role          text,
    vibe_coins    integer       not null default 0,
    score         integer,
    season_year   smallint      not null,
    season_month  smallint      not null,             -- 1..12
    archived_at   timestamptz   not null default now()
);

create index if not exists idx_history_coins_user
    on public.history_coins (user_id);
create index if not exists idx_history_coins_season
    on public.history_coins (season_year, season_month);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. ИНВЕНТАРЬ  (public.inventory)
-- ────────────────────────────────────────────────────────────────────────────
-- Универсальная таблица для любых наград/предметов пользователя.
-- type:
--   'trophy'   — чемпионские пояса (вечные).
--   'belt'     — синоним trophy (на будущее).
--   'skin'     — кастомные скины/рамки из лутбоксов.
--   'consumable' — расходники.
-- meta хранит любые дополнительные данные (belt_type, league, season_* и т.д.).
create table if not exists public.inventory (
    id           bigserial primary key,
    user_id      bigint         not null,              -- = users.tg_id
    title        text           not null,
    image_url    text,
    type         text           not null default 'trophy',
    meta         jsonb          not null default '{}'::jsonb,
    awarded_at   timestamptz    not null default now()
);

create index if not exists idx_inventory_user        on public.inventory (user_id);
create index if not exists idx_inventory_type        on public.inventory (type);
create index if not exists idx_inventory_user_type   on public.inventory (user_id, type);

-- Уникальный ключ, чтобы один и тот же сезонный трофей не выдался дважды
-- (например, при повторном вызове функции вручную).
create unique index if not exists uq_inventory_trophy_season
    on public.inventory (user_id, type, (meta->>'belt_type'), (meta->>'season_year'), (meta->>'season_month'))
    where type = 'trophy';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. ФУНКЦИЯ  public.reward_monthly_champions()
-- ────────────────────────────────────────────────────────────────────────────
-- Логика:
--   • Считаем закрываемый сезон = (now - 1 day)  — когда cron вызовет
--     функцию 1-го числа в 00:00, мы награждаем за прошлый месяц.
--   • Архивируем текущие vibe_coins в history_coins.
--   • Сбрасываем флаги is_p4p_champion и is_vibe_champion у всех.
--   • Находим глобального лидера (P4P) и ставим ему is_p4p_champion = true,
--     has_champion_belt = true (привилегия «увидеть скрытую кассу»).
--   • В каждой из лиг МОП / РОП / БИЗНЕС / ФРИЛАНС находим лидера
--     (исключая P4P-чемпиона, чтобы пояса не дублировались) и ставим
--     ему is_vibe_champion = true.
--   • Пушим в public.notifications записи с типом 'champion_alert'.
--   • Записываем пояс в public.inventory как вечный трофей.
--   • Обнуляем vibe_coins у всех.
--
-- Возвращает jsonb со сводкой ({season, список наград, время вызова}) —
-- удобно для логов cron.
create or replace function public.reward_monthly_champions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    _now             timestamptz := now();
    _season_date     date        := (_now - interval '1 day')::date;
    _year            smallint    := extract(year  from _season_date)::smallint;
    _month           smallint    := extract(month from _season_date)::smallint;
    _ru_month        text        := (array[
                                        'Январь','Февраль','Март','Апрель','Май','Июнь',
                                        'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
                                     ])[_month];
    _season_label    text        := _ru_month || ' ' || _year;

    _p4p_champion_id bigint;
    _vibe_user_id    bigint;
    _vibe_cat        text;
    _roles           text[];
    _rewarded        jsonb := '{}'::jsonb;
    _cats            text[] := array['МОП','РОП','БИЗНЕС','ФРИЛАНС'];

    _body_text       text := 'Твои результаты в этом месяце взорвали рейтинг. Пояс твой!';
begin
    ------------------------------------------------------------------
    -- 1) Архив сезона
    ------------------------------------------------------------------
    insert into public.history_coins (user_id, first_name, role, vibe_coins, score, season_year, season_month)
    select  u.tg_id,
            u.first_name,
            u.role,
            coalesce(u.vibe_coins, 0),
            u.score,
            _year,
            _month
      from  public.users u;

    ------------------------------------------------------------------
    -- 2) Сброс флагов чемпионов у ВСЕХ
    ------------------------------------------------------------------
    update public.users
       set is_p4p_champion  = false,
           is_vibe_champion = false;

    ------------------------------------------------------------------
    -- 3) Абсолютный Чемпион P4P (глобальный лидер vibe_coins > 0)
    ------------------------------------------------------------------
    select u.tg_id
      into _p4p_champion_id
      from public.users u
     where coalesce(u.vibe_coins, 0) > 0
     order by u.vibe_coins desc, u.tg_id asc
     limit 1;

    if _p4p_champion_id is not null then
        update public.users
           set is_p4p_champion   = true,
               has_champion_belt = true         -- привилегия «видеть скрытую кассу»
         where tg_id = _p4p_champion_id;

        -- Уведомление.
        insert into public.notifications
                 (user_id,           type,             belt_type, from_name, body,       is_read)
          values (_p4p_champion_id, 'champion_alert', 'p4p',     'VIBE',    _body_text, false);

        -- Трофей в инвентарь (вечный).
        insert into public.inventory (user_id, title, image_url, type, meta)
          values (_p4p_champion_id,
                  'Чемпион P4P — ' || _season_label,
                  'assets/img/p4p_belt.png',
                  'trophy',
                  jsonb_build_object(
                      'belt_type',    'p4p',
                      'league',       'P4P',
                      'season_year',  _year,
                      'season_month', _month,
                      'season_label', _season_label
                  ))
        on conflict do nothing;

        _rewarded := _rewarded || jsonb_build_object('p4p', _p4p_champion_id);
    end if;

    ------------------------------------------------------------------
    -- 4) Чемпион VIBE в каждой лиге
    ------------------------------------------------------------------
    foreach _vibe_cat in array _cats loop
        _roles := case _vibe_cat
                      when 'МОП'     then array['МОП']
                      when 'РОП'     then array['РОП']
                      when 'БИЗНЕС'  then array['Предприниматель','Бизнес']
                      when 'ФРИЛАНС' then array['Фрилансер','Фриланс']
                  end;

        select u.tg_id
          into _vibe_user_id
          from public.users u
         where u.role = any(_roles)
           and coalesce(u.vibe_coins, 0) > 0
           and (_p4p_champion_id is null or u.tg_id <> _p4p_champion_id)
         order by u.vibe_coins desc, u.tg_id asc
         limit 1;

        if _vibe_user_id is not null then
            update public.users
               set is_vibe_champion = true
             where tg_id = _vibe_user_id;

            insert into public.notifications
                     (user_id,         type,             belt_type, from_name, body,       is_read)
              values (_vibe_user_id,  'champion_alert', 'vibe',    'VIBE',    _body_text, false);

            insert into public.inventory (user_id, title, image_url, type, meta)
              values (_vibe_user_id,
                      'Чемпион VIBE ' || _vibe_cat || ' — ' || _season_label,
                      'assets/img/vibe_belt.png',
                      'trophy',
                      jsonb_build_object(
                          'belt_type',    'vibe',
                          'league',       _vibe_cat,
                          'season_year',  _year,
                          'season_month', _month,
                          'season_label', _season_label
                      ))
            on conflict do nothing;

            _rewarded := _rewarded || jsonb_build_object(_vibe_cat, _vibe_user_id);
        end if;
    end loop;

    ------------------------------------------------------------------
    -- 5) Обнуляем vibe_coins — стартует новый сезон
    ------------------------------------------------------------------
    update public.users set vibe_coins = 0;

    ------------------------------------------------------------------
    -- Возврат сводки
    ------------------------------------------------------------------
    return jsonb_build_object(
        'season_year',  _year,
        'season_month', _month,
        'season_label', _season_label,
        'rewarded',     _rewarded,
        'ran_at',       _now
    );
end;
$$;

-- Права: функцию может вызывать только сервис/планировщик.
revoke all on function public.reward_monthly_champions() from public;
revoke all on function public.reward_monthly_champions() from anon, authenticated;
grant  execute on function public.reward_monthly_champions() to postgres, service_role;


-- ============================================================================
-- 4. ПЛАНИРОВЩИК  (pg_cron, Supabase)
-- ----------------------------------------------------------------------------
-- Выполнить ЭТО отдельно (или прямо после миграции) в Supabase SQL Editor.
-- Расширение pg_cron в Supabase уже доступно, но по умолчанию неактивно —
-- нужно включить.
--
-- 1) Включаем расширение pg_cron:
--
--      create extension if not exists pg_cron;
--
-- 2) Регистрируем задание. Cron-строка '0 0 1 * *' = «в 00:00 1-го числа
--    каждого месяца» (в Supabase cron работает в UTC!).
--    Для МСК / Алматы учтите смещение — либо задайте 00:00 UTC, либо
--    подберите UTC-час, который совпадает с локальными 00:00:
--      • МСК  (UTC+3)     → '0 21 last * *' (например, через cron expressions)
--      • Алматы (UTC+5)   → '0 19 last * *'
--    Самый надёжный вариант — оставить 00:00 UTC:
--
--      select cron.schedule(
--          'reward_monthly_champions',        -- имя задания
--          '0 0 1 * *',                        -- строго 00:00 1-го числа (UTC)
--          $$ select public.reward_monthly_champions(); $$
--      );
--
-- 3) Проверка расписания:
--
--      select * from cron.job;
--      select * from cron.job_run_details order by start_time desc limit 20;
--
-- 4) Удаление задания (если нужно пересоздать):
--
--      select cron.unschedule('reward_monthly_champions');
--
-- 5) Ручной вызов (для теста):
--
--      select public.reward_monthly_champions();
--
-- ============================================================================
