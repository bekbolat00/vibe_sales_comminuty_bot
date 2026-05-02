"""
Массовая загрузка (upsert) возражений и скриптов в Supabase.

Читает objections.json (массив { category, objection, script_option, vibe_tip })
и заливает в таблицу arsenal_scripts батчами, используя supabase-py.

Запуск:
    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="eyJhbGciOi..."    # service_role key
    python upload_arsenal.py

Для идемпотентности (upsert) в таблице arsenal_scripts должен быть UNIQUE
индекс по (objection, script_option). SQL — в файле migration.sql.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from supabase import Client, create_client

JSON_FILE = Path(__file__).parent / "objections.json"
TABLE_NAME = "arsenal_scripts"
BATCH_SIZE = 100
CONFLICT_COLUMNS = "objection,script_option"


def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")

    if not url or not key:
        print(
            "Не заданы переменные окружения SUPABASE_URL и SUPABASE_SERVICE_KEY.",
            file=sys.stderr,
        )
        sys.exit(1)

    return create_client(url, key)


def load_records() -> list[dict[str, Any]]:
    if not JSON_FILE.exists():
        print(f"Файл {JSON_FILE} не найден.", file=sys.stderr)
        sys.exit(1)

    with JSON_FILE.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    required = {"category", "objection", "script_option", "vibe_tip"}
    cleaned: list[dict[str, Any]] = []
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValueError(f"Запись №{i} не является объектом: {row!r}")
        missing = required - row.keys()
        if missing:
            raise ValueError(f"Запись №{i} без обязательных полей: {missing}")
        cleaned.append({k: (row[k] or "").strip() for k in required})

    return cleaned


def chunked(seq: list[dict[str, Any]], size: int):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def upsert_records(client: Client, records: list[dict[str, Any]]) -> int:
    total = 0
    for batch_idx, batch in enumerate(chunked(records, BATCH_SIZE), start=1):
        response = (
            client.table(TABLE_NAME)
            .upsert(batch, on_conflict=CONFLICT_COLUMNS)
            .execute()
        )

        affected = len(response.data or [])
        total += affected
        print(
            f"Батч {batch_idx}: загружено {affected} / {len(batch)} записей "
            f"(накоплено: {total})"
        )

    return total


def main() -> None:
    records = load_records()
    print(f"Прочитано записей из JSON: {len(records)}")

    categories: dict[str, int] = {}
    for r in records:
        categories[r["category"]] = categories.get(r["category"], 0) + 1

    print("Разбивка по категориям:")
    for cat, cnt in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  • {cat}: {cnt}")

    client = get_client()
    total = upsert_records(client, records)

    print(f"\nГотово. Всего upsert'нуто: {total} записей в таблицу {TABLE_NAME}.")


if __name__ == "__main__":
    main()
