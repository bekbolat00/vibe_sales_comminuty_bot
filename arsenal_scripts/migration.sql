-- Таблица arsenal_scripts: готовые скрипты ответов на возражения клиентов.
-- Источник: сборник «275 ответов на возражения клиентов» (Олег Шевелев).

create table if not exists public.arsenal_scripts (
    id           bigserial primary key,
    category     text not null,
    objection    text not null,
    script_option text not null,
    vibe_tip     text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- Уникальная пара (objection, script_option) — используется как ключ upsert.
create unique index if not exists arsenal_scripts_objection_script_uidx
    on public.arsenal_scripts (objection, script_option);

-- Индекс для быстрой фильтрации по категории.
create index if not exists arsenal_scripts_category_idx
    on public.arsenal_scripts (category);

-- Автообновление updated_at.
create or replace function public.set_arsenal_scripts_updated_at()
returns trigger as $$
begin
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_arsenal_scripts_updated_at on public.arsenal_scripts;
create trigger trg_arsenal_scripts_updated_at
    before update on public.arsenal_scripts
    for each row execute function public.set_arsenal_scripts_updated_at();
