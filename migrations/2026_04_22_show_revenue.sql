-- ============================================================================
-- Приватность «Кассы» в Лидерборде
-- ----------------------------------------------------------------------------
-- Добавляем в таблицу users колонку show_revenue: true для МОПов/РОПов (они
-- гордятся оборотом и растут в рейтинге), false для бизнеса/фрилансеров
-- (приватность по умолчанию). Значение по умолчанию на уровне столбца — true,
-- чтобы новые строки не падали при вставке из старого кода, но при
-- регистрации через `registerUser(role)` фронт пересчитывает корректное
-- значение исходя из роли.
--
-- Примени это в Supabase SQL Editor один раз.
-- ============================================================================

alter table public.users
    add column if not exists show_revenue boolean not null default true;

-- Бизнес и фрилансеры по умолчанию скрыты.
update public.users
   set show_revenue = false
 where role in ('Предприниматель', 'Бизнес', 'Фрилансер', 'Фриланс')
   and show_revenue is distinct from false;

-- МОПы / РОПы — показывают.
update public.users
   set show_revenue = true
 where role in ('МОП', 'РОП')
   and show_revenue is distinct from true;

-- Поле total_revenue (опционально). Если у вас уже есть sales_actual,
-- можно его и использовать — фронт умеет падать на sales_actual, если
-- total_revenue отсутствует или null. Но если хочется отдельной колонки —
-- раскомментируй строчку ниже:
-- alter table public.users add column if not exists total_revenue bigint not null default 0;
