-- ============================================================================
-- Чемпионские пояса в Лидерборде
-- ----------------------------------------------------------------------------
-- Добавляем две булевых колонки:
--   users.is_p4p_champion  — действующий Абсолютный Чемпион P4P (главный пояс).
--   users.is_vibe_champion — действующий Чемпион VIBE (второй пояс лиги).
--
-- Используется во фронте:
--   • _renderBelts(user)  — выводит иконки поясов рядом с именем
--     в TOP-1 (Главное событие), на «Пьедестале» (TOP-2/TOP-3),
--     в Ростере (строки 4+) и в нижней плашке «Ты» (sticky me).
--
-- По умолчанию оба флага выключены. Назначать победителю сезона вручную
-- (ежемесячно) или через отдельный job.
--
-- Применять в Supabase SQL Editor один раз.
-- ============================================================================

alter table public.users
    add column if not exists is_p4p_champion  boolean not null default false,
    add column if not exists is_vibe_champion boolean not null default false;

-- (опционально) — выдать пояса конкретному tg_id:
-- update public.users set is_p4p_champion  = true where tg_id = <TG_ID>;
-- update public.users set is_vibe_champion = true where tg_id = <TG_ID>;

-- ============================================================================
-- Шаблон уведомления о чемпионстве (champion_alert)
-- ----------------------------------------------------------------------------
-- Существующая таблица public.notifications используется как есть,
-- но мы расширяем её полем `body` (необязательный текст) и `belt_type`
-- (p4p|vibe) — чтобы фронт мог отрисовать «золотое» уведомление с иконкой пояса.
-- Новые уведомления этого типа имеют type = 'champion_alert'.
-- ============================================================================

alter table public.notifications
    add column if not exists body      text,
    add column if not exists belt_type text;  -- 'p4p' | 'vibe'

-- Пример вставки champion_alert (P4P):
-- insert into public.notifications (user_id, type, belt_type, from_name, body, is_read)
-- values (<TG_ID>, 'champion_alert', 'p4p', 'VIBE',
--         'Вы стали Абсолютным Чемпионом P4P этого месяца! Ваш статус обновлён.',
--         false);
