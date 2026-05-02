# Arsenal Scripts — массовая загрузка возражений в Supabase

Пакет для заливки готовых скриптов ответов на возражения из сборника
«275 ответов на возражения клиентов» (Олег Шевелев) в таблицу `arsenal_scripts`
в Supabase.

## Структура

```
arsenal_scripts/
├── objections.json      # 248 записей { category, objection, script_option, vibe_tip }
├── migration.sql        # DDL таблицы + unique index для upsert
├── upload_arsenal.py    # Python-скрипт массового upsert
├── requirements.txt
└── README.md
```

## Схема данных

Каждая запись в `objections.json`:

```json
{
  "category": "Цена",
  "objection": "У Вас дорого!",
  "script_option": "ИО, «дорого» по сравнению с другими аналогичными предложениями или вообще за эту услугу?",
  "vibe_tip": "Уточняй, с чем клиент сравнивает. Без этого ты не знаешь, с чем работать."
}
```

Для одного возражения создаётся несколько записей — по числу вариантов ответа.

### Категории

| Категория | Кол-во записей |
|---|---|
| Время и готовность | наибольшая |
| Цена | |
| Конкуренты | |
| Сомнения и недоверие | |
| Отсутствие потребности | |
| Свойства продукта | |
| Полномочия принятия решения | |
| Секретарь | |

(точные числа выводит сам скрипт при запуске)

## Шаги запуска

### 1. Создать таблицу в Supabase

В Supabase SQL editor выполнить содержимое `migration.sql`. Там создаются:

- таблица `public.arsenal_scripts`
- уникальный индекс `(objection, script_option)` — нужен для `upsert`
- индекс по `category`
- триггер `updated_at`

### 2. Установить зависимости

```bash
cd arsenal_scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Указать креды Supabase

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_SERVICE_KEY="<service_role_key>"
```

> Используйте именно `service_role key` (а не `anon`), иначе RLS может заблокировать запись.

### 4. Запустить загрузку

```bash
python upload_arsenal.py
```

Скрипт выведет количество записей по категориям и будет заливать их батчами
по 100 штук через `client.table('arsenal_scripts').upsert(batch, on_conflict='objection,script_option')`.
Повторные запуски не создадут дубликатов — они обновят существующие строки.

## Как добавить новые скрипты

1. Добавить объект(ы) в `objections.json` — можно несколько вариантов `script_option`
   для одного `objection`.
2. Запустить `python upload_arsenal.py` ещё раз.

## Источник

Сборник «275 ответов на возражения клиентов», автор Олег Шевелев.
