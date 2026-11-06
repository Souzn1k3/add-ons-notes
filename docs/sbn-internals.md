# Устройство данных Samsung Notes для Windows (исследовано на реальной машине)

Источник формата: реверс-инжиниринговая документация проекта twangodev/sdocx
(docs/reverse-engineering/file-format.md, integrity-findings.md) + собственный анализ
локальных файлов. TL;DR ниже — рабочий справочник для нашего проекта.

## Где лежит

```
%LOCALAPPDATA%\Packages\SAMSUNGELECTRONICSCoLtd.SamsungNotes_<suffix>\LocalState\
  Storage.sqlite          — корневая БД (заметки, папки, текст, статусы)
  wdoc\<note-uuid>\       — одна заметка:
     note.note            — заголовок документа + title-объект + body-объект (текст) + SHA-256
     <page-uuid>.page     — страница (336 Б для текстовой: header + 1 слой без объектов) + hash + подпись
     pageIdInfo.dat       — note_hash + порядок страниц + хэши страниц
     mediaInfo.dat        — манифест медиа (10 Б: 0000 + "EOFX"-вариант)
     end_tag.bin          — компактное резюме документа + "Document for S-Pen SDK"
     media/, attach/      — вложения/медиа
```

## Storage.sqlite — ключевые таблицы

- **NoteDB** (одна строка на заметку)
  - `UUID`, `CategoryUUID`, `Title`, `RecommendedTitle`, `DisplayTitle`
  - `DeletedStatus` (0 = обычная, 2 = в корзине), `IsLocked` (контент зашифрован)
  - `DocumentType` (0 = текст), `IsTextOnly`, `PageType`, `Size`
  - `CreatedAt`, `LastModifiedAt` (INTEGER)
  - `Content` (пустой), `DisplayContent` — **JSON с текстом заметки** (см. ниже)
  - `IsFavorite`, `ThemeMode`, `PageColor`, `Size`
- **CategoryTreeDB** — дерево папок: `UUID, ParentUUID, DisplayName, FolderState, IsDeleted`
  Спец-UUID: `uncategorized:///` (корень «Папки»), `trash:///` (`UUID_UNCATEGORIZED` с ParentUUID `old:///` — мусорная запись).
- **PageDB** — страницы (`documentUUID, UUID, index`)
- **StrokeDB** — распознанный текст рукописи (раздельно с `.page`)
- **TextSearchDB** — поисковая выжимка (строк больше, чем заметок)
- **SyncInfoDB** — метаданные облачной синхронизации (по строке на заметку)

## DisplayContent (текст заметки) — JSON

```json
{
  "$type": "SamsungNotesCommon.Domain.ParagraphData, SamsungNotesCommon",
  "Text": "полный текст заметки устройствах с \n",
  "TextIndent": 0.0, "TaskType": 0, "TaskNumber": 0, "TaskId": 0,
  "ContentType": 0, "AlignmentType": 0,
  "Spans": {
    "$type": "System.Collections.Generic.List`1...",
    "$values": [
      { "$type": "SamsungNotesCommon.Domain.SpanData,...",
        "SpanType": 0, "ForegroundColor": {A,R,G,B}, "BackgroundColor": {...},
        "Start": 0, "End": 6, "Text": "...",
        "IsBullet": false, "IsChecked": false, "BulletType": 0, "BulletNumber": 0,
        "IndentLevel": 0, "IsEmptyBulletLine": false }
    ]
  }
}
```

Список/чек-лист кодируется через `Spans` (`IsBullet`, `IsChecked`, `BulletType`,
`BulletNumber`, `IndentLevel`). Отображать текст можно просто из `Text` + интерпретация отменяющих
параллелов из `[Start,End)` (`End` — исключительная граница).

## Целостность файлов (для записи новых заметок)

```
note.note trailer = SHA256(все байты до последних 32)
<UUID>.page: EOF-58..EOF-26 = page_hash ; EOF-26..EOF = "Page for SAMSUNG S-Pen SDK"
page_hash = SHA256( layer_hash_0 || ... || identity(page_uuid, page_modified_time) )
layer_hash = SHA256( object_hash_0 || ... || identity(layer_uuid, layer_modified_time) )
identity(id, mtime) = SHA256( UTF8(id + str(signed mtime)) )
pageIdInfo.dat = note_hash(32) + u16 count + [ utf16(page_uuid) + page_hash(32) ]*
```

То есть подписи считаются обычным SHA-256, не криптографией с ключом — записать
корректную заметку возможно с полным контролем структуры (подтверждено формулами,
воспроизведёнными на corpus в twangodev/sdocx).

## Beware

- `Storage.sqlite` копировать перед чтением (SQLite-блокировки).
- Заметки с `IsLocked=1` не читаются (контент зашифрован AES, ключ в Knox) — только метаданные.
- Записывать в LocalState можно только при **закрытом** приложении Samsung Notes.
