# Filmlog v2 – API-Vertrag

Basis: alle JSON-Endpunkte unter `/api/v2`, Auth unter `/auth`. Zeitstempel ISO-8601 lokal ohne TZ
(`2026-08-09T10:20:11`), Datum `YYYY-MM-DD`, Uhrzeit `HH:MM`.

## Allgemein

- **Auth:** Session-Cookie `filmlog_session` (HttpOnly) **oder** `Authorization: Bearer <token>` (API-Token).
- **CSRF:** Jeder nicht-GET-Request mit Cookie-Auth muss den Header `X-Filmlog: 1` tragen, sonst `403`.
- **Fehler:** `{"error": "Meldung auf Deutsch"}` mit Status 400/401/403/404/409/422.
  `401` → Frontend zeigt Login.
- IDs: Filme (Rolls) werden über ihre **Nummer** (`number`, „#42“) adressiert, alles andere über `id`.

## Auth

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | `/auth/me` | – | `{"username": "max"}` oder 401 |
| POST | `/auth/login` | `{"username","password","remember": true}` | `{"username"}` + Cookie; 401 bei falschen Daten, 429 bei zu vielen Versuchen |
| POST | `/auth/logout` | – | `{"ok": true}` |
| POST | `/auth/password` | `{"current","new"}` | `{"ok": true}` (neues Passwort min. 8 Zeichen) |

### API-Tokens (für den EXIF-Client)
| GET | `/api/v2/tokens` | – | `[{"id","name","created_at","last_used_at"}]` |
| POST | `/api/v2/tokens` | `{"name"}` | `{"id","name","token","created_at"}` – `token` nur hier einmalig im Klartext |
| DELETE | `/api/v2/tokens/{id}` | – | `{"ok": true}` |

## Objekte

```jsonc
// Camera
{"id":1,"name":"Zenit TTL","format":"35mm","default_capacity":36,"notes":null,"archived":false,
 "lens_ids":[1,3],"usage_count":120,"last_used_at":"2026-08-09T10:20:11"}
// Lens
{"id":1,"name":"Helios 44-2","focal_length_mm":58,"max_aperture":2.0,"archived":false,
 "usage_count":80,"last_used_at":"..."}
// FilmStock
{"id":1,"name":"Kodak Tri-X 400 35mm","manufacturer":"Kodak","iso":400,"type":"sw","format":"35mm",
 "default_capacity":36,"archived":false,"usage_count":4,"last_used_at":"..."}
// ShutterSpeed  (seconds = null bei "B"/"T")
{"id":1,"label":"1/125","seconds":0.008}
// Aperture
{"id":1,"label":"f/5.6","f_number":5.6}
```

Kamera-Formate (`format`): `35mm`, `halbformat`, `6x4.5`, `6x6`, `6x7`, `6x9`, `4x5`, `instant`, `anderes`.
Film-Formate: `35mm`, `120`, `4x5`, `instant`, `anderes`. Filmtypen (`type`): `sw`, `farbe`, `dia`, `anderes`.

```jsonc
// Roll (Film)
{"number":42,"film_stock":{"id":1,"name":"Kodak Tri-X 400 35mm","type":"sw","iso":400},
 "camera":{"id":1,"name":"Zenit TTL"},
 "expiry_year":2027,"capacity":36,"iso":400,"iso_override":null,"notes":null,
 "status":"offen",            // offen | abgeschlossen | entwickelt | gescannt | archiviert
 "created_at":"...","completed_at":null,"developed_at":null,"scanned_at":null,"archived_at":null,
 "frame_count":12,"last_frame_at":"...","is_full":false,"expired_years":0}
// Frame (Aufnahme)
{"id":17,"roll_number":42,"position":3,"date":"2026-08-09","time":"10:20",
 "location_text":"Stadtpark","lat":52.5,"lon":13.4,
 "lens_id":1,"lens_name":"Helios 44-2",
 "shutter":"1/125","shutter_seconds":0.008,"aperture":"f/5.6","f_number":5.6,
 "focal_length":null,"flash":false,"motif":"Kastanienbaum","recorded_at":"...","updated_at":"..."}
// FrameWithRoll = Frame + {"roll":{"number","camera_name","film_stock_name","type","status"}}
```

Shutter/Blende werden serverseitig normalisiert: `"125"`, `"1/125s"` → `"1/125"`; `"2\""`, `"2s"` → `"2s"`
(eine nackte Zahl ≥ 2 gilt wie auf dem Zeitenrad als Bruch: `"2"` → `"1/2"`);
`"5,6"`, `"F5.6"` → `"f/5.6"`. Ungültig → 422.

## Katalog (Auswahllisten)

| GET | `/api/v2/catalog` | – | `{"cameras":[],"lenses":[],"film_stocks":[],"shutter_speeds":[],"apertures":[]}` |

Sortierung: Kameras/Objektive/Filme nach `last_used_at` absteigend (ungenutzte alphabetisch dahinter), archivierte ans
Ende. Belichtungszeiten kurz→lang (B/T am Ende), Blenden aufsteigend.

CRUD je Typ – `cameras`, `lenses`, `film-stocks`, `shutter-speeds`, `apertures`:

| POST | `/api/v2/{typ}` | Felder des Objekts (ohne id/usage) | Objekt, 201; 409 bei Duplikat |
| PATCH | `/api/v2/{typ}/{id}` | Teilfelder | Objekt |
| DELETE | `/api/v2/{typ}/{id}` | – | `{"deleted":true}` oder, wenn noch verwendet, `{"deleted":false,"archived":true}` |

Für Kameras zusätzlich `lens_ids` im Body (passende Objektive).
Bei Belichtungszeit/Blende genügt `{"label":"125"}`.

| POST | `/api/v2/shutter-speeds/presets` | `{"preset":"voll"\|"halb"\|"drittel"}` | volle Liste |
| POST | `/api/v2/apertures/presets` | `{"preset":"voll"\|"halb"\|"drittel"}` | volle Liste |

## Dashboard

| GET | `/api/v2/dashboard` | – | siehe unten |

```jsonc
{"open_rolls":[Roll],                 // sortiert nach zuletzt genutzt
 "last_frame": FrameWithRoll | null,
 "to_develop":{"total":3,"sw":2,"farbe":1,"dia":0,"anderes":0},
 "hints":[{"kind":"voll|lange_in_kamera|entwickeln|abgelaufen","roll_number":41,"text":"…"}]}
```

## Filme (Rolls)

| GET | `/api/v2/rolls?status=offen,abgeschlossen&sort=recent\|number` | – | `[Roll]` (Default: alle, sort=number desc) |
| POST | `/api/v2/rolls` | `{"film_stock_id","camera_id","capacity","expiry_year?","iso_override?","notes?"}` | Roll, 201 |
| GET | `/api/v2/rolls/{number}` | – | Roll + `"frames":[Frame]` |
| PATCH | `/api/v2/rolls/{number}` | Teilfelder wie POST | Roll |
| DELETE | `/api/v2/rolls/{number}` | – | `{"ok":true}` (nur wenn status ≠ offen, sonst 400) |
| POST | `/api/v2/rolls/{number}/status` | `{"status":"abgeschlossen"}` | Roll – jeder Status erlaubt (vor/zurück); Datumsfelder werden gesetzt bzw. beim Zurückgehen geleert |
| GET | `/api/v2/rolls/{number}/export.csv` | – | CSV (Excel-DE, `;`, BOM) |

## Aufnahmen (Frames)

| POST | `/api/v2/rolls/{number}/frames` | `{"position?":3,"count?":1,"client_id?":"uuid","recorded_at?":"…","date","time","location_text?","lat?","lon?","lens_id?","shutter?","aperture?","flash?","motif?"}` | `[Frame]`, 201 |
| PATCH | `/api/v2/frames/{id}` | Teilfelder (date,time,location_text,lens_id,shutter,aperture,flash,motif) | Frame |
| DELETE | `/api/v2/frames/{id}` | – | `{"ok":true}` (Nachfolger rücken nach) |
| GET | `/api/v2/frames/recent?roll={number}&limit=25&cursor=…` | – | `{"items":[FrameWithRoll],"next_cursor":"…"\|null}` |

- `position` fehlt → ans Ende (nur bei offenem Film; mit `position` auch bei abgeschlossenen, nicht bei archivierten).
- `client_id`: Idempotenz für die Offline-Queue. Gleiche `client_id` nochmal → 200 mit den bereits angelegten Frames.
- `recorded_at`: vom Client (Offline-Zeitpunkt). Fehlt → Serverzeit.

## Vorschläge

| GET | `/api/v2/suggestions/frame?roll={number}` | `{"lens_id","shutter","aperture","motif","lens_ids":[…]}` – letzte Werte dieses Films; `lens_ids` = zur Kamera passende Objektive (zuletzt genutzt zuerst; leer = alle) |
| GET | `/api/v2/suggestions/roll?camera_id=&film_stock_id=` | `{"capacity":36,"expiry_year":2027,"type":"sw","iso":400}` |
| GET | `/api/v2/suggestions/motifs?q=bau` | `["Baum am Teich", …]` (max 10, häufigste zuerst) |
| GET | `/api/v2/suggestions/places?lat=&lon=` | `[{"location_text":"Stadtpark","distance_m":120}]` (≤ 1 km, max 5) |

## Suche

| GET | `/api/v2/search?q=teich` | `{"frames":[FrameWithRoll],"rolls":[Roll]}` (FTS5 über Motiv/Ort/Objektiv, Rolls über Kamera/Film/Notizen) |

## Statistik

| GET | `/api/v2/stats?range=30\|365\|alle` |

```jsonc
{"range":"30","frames_total":120,"rolls_total":5,
 "by_type":[{"name":"S/W","key":"sw","count":80}],
 "by_camera":[{"name","count"}], "by_film_stock":[{"name","count","type"}],
 "rolls_by_film_stock":[{"name","count","type"}], "by_lens":[{"name","count"}],
 "by_shutter":[{"name":"1/125","count":30}],   // nach Zeit sortiert, nicht nach Anzahl
 "by_aperture":[{"name":"f/8","count":20}],    // nach Blende sortiert
 "by_month":[{"month":"2026-08","frames":40,"rolls":2}],
 "locations":[{"lat","lon","motif","roll_number","position","date"}]}
```

## Export / Backup / Import

| GET | `/api/v2/export.json` | kompletter Datenbestand als JSON |
| GET | `/api/v2/backup.sqlite` | konsistente Kopie der DB (`VACUUM INTO`) |
| POST | `/api/v2/import/v1` | multipart: `db` (db.yaml), `optionen` (optional), `dry_run` ("true"/"false") → Bericht |

```jsonc
{"dry_run":true,"rolls":12,"frames":340,"cameras":3,"lenses":4,"film_stocks":6,
 "shutter_speeds":11,"apertures":8,"skipped_rolls":0,"warnings":["…"]}
```

## Sonstiges

| GET | `/healthz` | `{"ok":true}` (ohne Auth) |
| GET | `/client/download` | ZIP mit EXIF-Writer (Auth nötig) |
