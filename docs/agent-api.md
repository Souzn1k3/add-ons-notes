# API локального агента (Notes Bridge agent)

Агент слушает `http://127.0.0.1:<порт, 8712-8719>` и требует токен:
`Authorization: Bearer <token>` (или `?token=`). Порт хранится в
`%LOCALAPPDATA%\SBNAgent\port.txt`, токен — в `token.txt`.

## GET /health

```json
{ "ok": true, "version": "1.0.0", "notes": 67, "last_indexed": 1793969425007,
  "app_running": true, "writeback_enabled": false }
```

## GET /notes?query=&folder=&limit=

Список заметок (только не удалённые). Элемент:

```json
{ "uuid": "...", "title": "...", "folder_uuid": "...", "folder_name": "...",
  "is_locked": false, "deleted": false, "text_only": true, "favorite": false,
  "document_type": 0, "created_at": 0, "modified_at": 0, "size": 0,
  "text": "полный текст", "preview": "первые 160 символов",
  "has_bullets": false, "has_checkbox": true, "media_count": 0 }
```

## GET /note/<uuid>

Полная заметка (+ массив `media`).

## GET /media/<uuid>/<file>

Файл из `wdoc/<uuid>/media` (только в пределах этой папки).

## GET /folders

Дерево папок из CategoryTreeDB.

## GET /settings | POST /settings {writeback: bool}

Флаг experimental write-back (синхронизируется с расширением, персистится в state.json).

## POST /notes/create {title, body}

Создание заметки через слой UI приложения Samsung Notes (см. docs/writeback.md).
Работает только если `writeback_enabled = true`. Ответ `{ok: true}`.
