# -*- coding: utf-8 -*-
"""Экспериментальная запись новых заметок в Samsung Notes (write-back).

Порядок (будет реализован на этапе M4):
1. убедиться, что приложение Samsung Notes ЗАКРЫТО;
2. полный zip-бэкап LocalState в %LOCALAPPDATA%\\SBNAgent\\backups;
3. собрать текстовую заметку (note.note + .page + pageIdInfo.dat +
   mediaInfo.dat + end_tag.bin) по формату docs/sbn-internals.md;
4. транзакционно вставить строки в копию Storage.sqlite и подменить;
5. вернуть результат, при ошибке — откат.

Заглушка до M4.
"""

def create_note(body: dict) -> dict:
    return {"ok": False, "error": "write-back ещё не реализован (этап M4)"}
