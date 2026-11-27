# ADR-0004: Single-User-Auth mit Session-Cookie und Bearer-Tokens

- **Status:** Accepted
- **Datum:** 2026-11-27

## Kontext

Filmlog hat genau einen Benutzer. Trotzdem braucht es Login-Schutz, weil die App über einen Reverse-Proxy
erreichbar ist, und einen maschinenlesbaren Zugang für den ExifTool-Client.

## Entscheidung

- **Ein Benutzer** in `users`; Daten hängen an keinem `user_id`. Der erste Benutzer wird beim Start nur
  angelegt, wenn noch keiner existiert (`FILMLOG_ADMIN_USER`/`_PASSWORD`).
- **Passwörter:** Argon2id über `argon2-cffi`; Rehash bei Bedarf; Dummy-Hash gegen User-Enumeration.
- **Browser-Session:** serverseitige Session-Tabelle, Cookie `filmlog_session` mit `HttpOnly`,
  `SameSite=Lax`, `Secure` je nach `FILMLOG_SECURE_COOKIES` (Standard `true`), 90 Tage mit
  „Angemeldet bleiben“, sonst 12 Stunden.
- **CSRF:** Bei Cookie-Auth brauchen alle Nicht-GET-Requests den Header `X-Filmlog: 1`; Bearer-Tokens
  sind davon ausgenommen.
- **API-Tokens:** Präfix `flt_`, nur der SHA-256-Hash wird gespeichert, in der UI erstellbar und
  widerrufbar; `last_used_at` wird gepflegt.
- **Rate-Limit:** Login-Fehlversuche pro IP+Benutzername, 5 Versuche in 5 Minuten, kurze Sperre.
- **Proxy:** `FORWARDED_ALLOW_IPS` bestimmt, wessen `X-Forwarded-For` für das Rate-Limit vertraut wird.

## Konsequenzen

- Keine Rollen/Rechte, keine getrennten Datenbestände; das passt zum Single-User-Modell.
- Ein Passwortwechsel beendet alle Sessions; Token können einzeln widerrufen werden.
- Im LAN ohne HTTPS muss `FILMLOG_SECURE_COOKIES=false` gesetzt werden, sonst kommt das Cookie nicht an.
- Der EXIF-Client muss ein Token besitzen und bei Verlust ein neues erzeugen.

## Alternativen

- **Mehrbenutzer-Auth:** verworfen; Datenmodell und UI würden ohne konkreten Bedarf komplexer.
- **Nur Cookie, kein Token:** verworfen; der externe Client kann keinen Browser-Login-Flow nutzen.
- **JWT/Stateless-Sessions:** verworfen; serverseitige Sessions sind einfacher widerrufbar.