#!/usr/bin/env python3
"""
Filmlog -> ExifTool

Interaktives Kommandozeilen-Skript (kein GUI, os-neutral): liest einen
abgeschlossenen Film aus Filmlog und schreibt die Daten jeder einzelnen
Aufnahme per ExifTool individuell in die passende gescannte Bilddatei.

Ablauf:
  1. Prueft, ob ExifTool verfuegbar ist.
  2. Fragt beim Filmlog-Server (API v2, Anmeldung per API-Token) alle
     entwickelten bzw. gescannten, NICHT archivierten Filme ab.
  3. Zeigt alle Aufnahmen des gewaehlten Films zur Kontrolle an.
  4. Fragt nach dem Ordner mit den gescannten Bildern und vergleicht die
     Anzahl der Dateien mit der Anzahl der Filmlog-Eintraege.
  5. Zeigt die geplante Zuordnung Dateiname -> Motiv zur Bestaetigung.
  6. Schreibt erst nach expliziter Bestaetigung die Metadaten, Datei fuer
     Datei, mit -overwrite_original (keine *_original-Backups).
  7. Protokolliert jede geschriebene Datei in filmlog-exif-log.txt im
     Zielordner.
  8. Markiert den Film auf Wunsch als gescannt oder archiviert.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

try:
    import requests
    import urllib3
except ImportError:
    print("Das Paket 'requests' fehlt. Installieren mit:\n  pip install requests")
    sys.exit(1)

# Zertifikatspruefung ist an. Nur bei selbstsigniertem Zertifikat in der
# Config-Datei "verify_ssl": false setzen (kein Schutz mehr gegen
# Man-in-the-Middle).
VERIFY_SSL = True

# ---------- Konfiguration ----------

# Pfad/Name der ExifTool-Programmdatei. Liegt ExifTool im PATH, reicht
# "exiftool" (Linux/macOS) bzw. "exiftool.exe" (Windows wird automatisch
# mitgeprueft). Sonst hier den vollen Pfad eintragen.
EXIFTOOL_PATH = "exiftool"

# Bild-Dateiendungen, die beruecksichtigt werden.
IMAGE_EXTENSIONS = {".tif", ".tiff", ".jpg", ".jpeg", ".png", ".dng", ".arw"}

CONFIG_PATH = Path(__file__).resolve().parent / "filmlog-exif-writer.config.json"


# ---------- Hilfsfunktionen: Setup ----------

def load_config():
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            print("Konfigurationsdatei ist beschaedigt, wird neu abgefragt.")
    return {}


def save_config(config):
    CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding="utf-8")


def get_config():
    """Server-URL und API-Token aus der Config, fehlende Werte werden abgefragt und gespeichert."""
    global VERIFY_SSL
    config = load_config()
    geaendert = False

    url = (config.get("filmlog_url") or "").strip().rstrip("/")
    while not url:
        url = input("Filmlog-Server-URL (z. B. https://filmlog.example.org): ").strip().rstrip("/")
        if url and not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        geaendert = True

    token = (config.get("api_token") or "").strip()
    while not token:
        print("\nEin API-Token erzeugst du in Filmlog unter Einstellungen -> API-Tokens.")
        token = input("API-Token: ").strip()
        geaendert = True

    if config.get("verify_ssl") is False:
        VERIFY_SSL = False
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    if geaendert:
        config.update({"filmlog_url": url, "api_token": token})
        save_config(config)
        print(f"Gespeichert in {CONFIG_PATH}\n")
    return url, token


def token_vergessen():
    config = load_config()
    config.pop("api_token", None)
    save_config(config)


def find_exiftool():
    for kandidat in (EXIFTOOL_PATH, "exiftool.exe", "exiftool"):
        pfad = shutil.which(kandidat)
        if pfad:
            return pfad
    return None


class Api:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {token}"
        self.session.verify = VERIFY_SSL

    def _request(self, methode, pfad, **kwargs):
        url = f"{self.base_url}{pfad}"
        antwort = self.session.request(methode, url, timeout=15, **kwargs)
        if antwort.status_code == 401:
            token_vergessen()
            print("Das API-Token ist ungueltig oder wurde widerrufen. Beim naechsten Start wird ein neues abgefragt.")
            sys.exit(1)
        antwort.raise_for_status()
        return antwort.json()

    def get(self, pfad):
        try:
            return self._request("GET", pfad)
        except requests.RequestException as err:
            print(f"Filmlog-Anfrage an {self.base_url}{pfad} fehlgeschlagen: {err}")
            sys.exit(1)

    def post(self, pfad, daten):
        try:
            return self._request("POST", pfad, json=daten)
        except requests.RequestException as err:
            print(f"Filmlog-Anfrage an {self.base_url}{pfad} fehlgeschlagen: {err}")
            return None


def exiftool_schreiben(exiftool_pfad, exif_args, zieldatei):
    """
    Fuehrt ExifTool ueber eine UTF-8-codierte Argumentdatei (-@) aus statt
    die Argumente direkt auf der Kommandozeile zu uebergeben. Das umgeht
    ein bekanntes Windows-Problem: Python liefert Kommandozeilen-Argumente
    sonst in der System-Codepage (z. B. cp1252) aus, ExifTool erwartet bei
    Unicode-Zeichen (Umlaute im Motiv etc.) aber UTF-8 - Argumentdateien
    werden von ExifTool dagegen zuverlaessig als UTF-8 gelesen.
    """
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".args", delete=False, encoding="utf-8"
    ) as argfile:
        for arg in exif_args:
            argfile.write(arg + "\n")
        argfile.write(str(zieldatei) + "\n")
        argfile_pfad = argfile.name

    try:
        return subprocess.run(
            [exiftool_pfad, "-@", argfile_pfad],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    finally:
        os.unlink(argfile_pfad)


# ---------- Hilfsfunktionen: Wertumwandlung fuer ExifTool ----------

def zu_brennweite(wert):
    if not wert:
        return None
    zahl = re.sub(r"[^0-9.,]", "", str(wert)).replace(",", ".")
    if zahl.endswith(".0"):
        zahl = zahl[:-2]
    return zahl or None


def zu_blende(wert):
    if not wert:
        return None
    zahl = re.sub(r"^[fF]/?", "", wert).replace(",", ".")
    return zahl or None


def zu_belichtungszeit(a):
    """'1/125' bleibt ein Bruch, '2s' wird zu '2'; B/T (ohne Sekundenwert) -> leer."""
    sekunden = a.get("shutter_seconds")
    if not sekunden:
        return None
    label = a.get("shutter") or ""
    if label.startswith("1/"):
        return label
    return f"{sekunden:g}"


def zu_exif_datum(datum, uhrzeit):
    if not datum:
        return None
    zeit = uhrzeit or "00:00"
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            dt = datetime.strptime(f"{datum} {zeit}", fmt)
            return dt.strftime("%Y:%m:%d %H:%M:%S")
        except ValueError:
            continue
    return None


def exif_args_fuer_aufnahme(film, a, brennweiten):
    """
    Baut die ExifTool-Argumente fuer eine Aufnahme.

    Jedes Feld, das Filmlog kennt, wird gesetzt, wenn Filmlog einen Wert
    hat - und GELEERT ("-TAG="), wenn Filmlog keinen hat. ExifTool ignoriert
    das Leeren stillschweigend, falls der Tag in der Datei gar nicht
    existiert; man muss die Datei also nicht vorher auslesen. Alle Tags, die
    Filmlog nicht verwaltet (Scanner-Software, Aufloesung etc.), bleiben
    unangetastet.
    """
    args = ["-overwrite_original", "-m"]

    def setzen(tags, wert):
        for tag in tags:
            args.append(f"-{tag}={wert}" if wert else f"-{tag}=")

    setzen(["Make"], film["camera"]["name"])
    setzen(["Model"], film["film_stock"]["name"])
    setzen(["ISO"], film.get("iso"))
    setzen(["LensModel"], a.get("lens_name"))
    setzen(["ImageDescription", "XPTitle"], a.get("motif"))
    setzen(["ExposureTime"], zu_belichtungszeit(a))
    setzen(["FNumber"], a.get("f_number") or zu_blende(a.get("aperture")))
    setzen(["Flash"], "Fired" if a.get("flash") else None)
    setzen(["DateTimeOriginal", "CreateDate"], zu_exif_datum(a.get("date"), a.get("time")))

    if a.get("lat") is not None and a.get("lon") is not None:
        lat = float(a["lat"])
        lon = float(a["lon"])
        args.append(f"-GPSLatitude={abs(lat)}")
        args.append(f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}")
        args.append(f"-GPSLongitude={abs(lon)}")
        args.append(f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}")
    else:
        setzen(["GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef"], None)

    # Brennweite aus den Objektiv-Stammdaten, sonst aus alten v1-Eintraegen.
    # Bewusst NIE leeren, falls Filmlog keinen Wert kennt.
    brennweite = zu_brennweite(brennweiten.get(a.get("lens_id")) or a.get("focal_length"))
    if brennweite:
        args.append(f"-FocalLength={brennweite}")

    return args


# ---------- Ablauf ----------

def main():
    print("=== Filmlog -> ExifTool ===\n")

    exiftool_pfad = find_exiftool()
    if not exiftool_pfad:
        print(
            "ExifTool wurde nicht gefunden. Von https://exiftool.org laden "
            "(Windows: 'exiftool(-k).exe' in 'exiftool.exe' umbenennen), "
            "und entweder in den PATH legen oder EXIFTOOL_PATH oben im "
            "Skript auf den vollen Pfad setzen."
        )
        sys.exit(1)

    filmlog_url, token = get_config()
    api = Api(filmlog_url, token)

    # --- Film auswaehlen ---
    print(f"Lade entwickelte Filme von {filmlog_url} ...\n")
    filme = [
        {**f, "nummer": f["number"], "name": f["film_stock"]["name"], "kamera": f["camera"]["name"]}
        for f in api.get("/api/v2/rolls?status=entwickelt,gescannt")
    ]

    if not filme:
        print("Keine entwickelten, nicht archivierten Filme gefunden.")
        return

    print("Verfuegbare Filme:\n")
    for i, f in enumerate(filme, start=1):
        status = " [gescannt]" if f["status"] == "gescannt" else ""
        print(f"  [{i}] #{f['nummer']} - {f['name']} ({f['kamera']}, {f['frame_count']} Aufnahmen){status}")

    auswahl = input("\nFilm auswaehlen (Klammer-Nummer oder Filmnummer, z. B. 2 oder 10): ").strip()
    gewaehlter_film = None
    if auswahl.isdigit():
        zahl = int(auswahl)
        nach_filmnummer = next((f for f in filme if f.get("nummer") == zahl), None)
        nach_index = filme[zahl - 1] if 1 <= zahl <= len(filme) else None

        if nach_filmnummer and nach_index and nach_filmnummer is not nach_index:
            print(f"\n'{zahl}' ist mehrdeutig:")
            print(f"  a) Position [{zahl}] in der Liste: #{nach_index['nummer']} - {nach_index['name']}")
            print(f"  b) Film mit der echten Nummer #{zahl}: #{nach_filmnummer['nummer']} - {nach_filmnummer['name']}")
            entscheidung = input("Welchen meinst du? (a/b): ").strip().lower()
            if entscheidung == "a":
                gewaehlter_film = nach_index
            elif entscheidung == "b":
                gewaehlter_film = nach_filmnummer
        elif nach_filmnummer:
            gewaehlter_film = nach_filmnummer
        elif nach_index:
            gewaehlter_film = nach_index

    if gewaehlter_film is None:
        print("Ungueltige Auswahl.")
        sys.exit(1)

    # --- Aufnahmen laden und zur Kontrolle anzeigen ---
    film_detail = api.get(f"/api/v2/rolls/{gewaehlter_film['nummer']}")
    aufnahmen = film_detail.get("frames", [])
    katalog = api.get("/api/v2/catalog")
    brennweiten = {o["id"]: o.get("focal_length_mm") for o in katalog.get("lenses", [])}

    print(f"\nAufnahmen zu Nr. {gewaehlter_film['nummer']} - {gewaehlter_film['name']} ({gewaehlter_film['kamera']}):\n")
    for i, a in enumerate(aufnahmen, start=1):
        titel = a.get("motif") or "(kein Motiv)"
        print(f"  {i:>3}. {titel}  |  {a.get('date') or ''} {a.get('time') or ''}  |  {a.get('lens_name') or ''}")

    weiter = input("\nPasst diese Liste? (j/n): ").strip().lower()
    if weiter != "j":
        print("Abgebrochen.")
        return

    # --- Bildordner waehlen ---
    ordner_str = input("\nPfad zum Ordner mit den gescannten Bildern: ").strip()
    ordner = Path(ordner_str)
    if not ordner.is_dir():
        print(f"Ordner nicht gefunden: {ordner}")
        sys.exit(1)

    dateien = sorted(
        (p for p in ordner.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS),
        key=lambda p: p.name,
    )

    if not dateien:
        print(f"Keine Bilddateien ({', '.join(sorted(IMAGE_EXTENSIONS))}) in {ordner} gefunden.")
        sys.exit(1)

    if len(dateien) != len(aufnahmen):
        print(f"\nWARNUNG: Anzahl passt nicht: {len(aufnahmen)} Filmlog-Eintraege, aber {len(dateien)} Bilddateien im Ordner.")
        trotzdem = input("Trotzdem fortfahren? (j/n): ").strip().lower()
        if trotzdem != "j":
            print("Abgebrochen.")
            return

    # --- Startdatei waehlen ---
    start_antwort = input(
        f"\nBei welcher Bilddatei soll der erste Filmlog-Eintrag beginnen? "
        f"(1-{len(dateien)}, Enter fuer 1): "
    ).strip()
    start_index = 1
    if start_antwort:
        if not start_antwort.isdigit() or not (1 <= int(start_antwort) <= len(dateien)):
            print("Ungueltige Eingabe.")
            sys.exit(1)
        start_index = int(start_antwort)

    dateien_ab_start = dateien[start_index - 1:]
    fuehrende_dateien = dateien[:start_index - 1]
    if fuehrende_dateien:
        uebersprungen = ", ".join(p.name for p in fuehrende_dateien)
        print(f"  ({len(fuehrende_dateien)} Bilddatei(en) am Anfang werden uebersprungen: {uebersprungen})")

    # --- Zuordnung anzeigen ---
    anzahl_paare = min(len(dateien_ab_start), len(aufnahmen))
    print("\nZuordnung (Dateiname  ->  Motiv):\n")
    for i in range(anzahl_paare):
        titel = aufnahmen[i].get("motif") or "(kein Motiv)"
        print(f"  {dateien_ab_start[i].name:<30}  ->  {titel}")
    if len(dateien_ab_start) > anzahl_paare:
        print(f"\n  ({len(dateien_ab_start) - anzahl_paare} weitere Bilddatei(en) ohne Filmlog-Eintrag werden NICHT beschrieben)")
    if len(aufnahmen) > anzahl_paare:
        print(f"\n  ({len(aufnahmen) - anzahl_paare} weitere Filmlog-Eintraege ohne Bilddatei werden ignoriert)")

    print(
        "\nHinweis: Felder, die in Filmlog fuer eine Aufnahme leer sind (Objektiv, Motiv, "
        "Belichtungszeit, Blende, Blitz, Datum/Uhrzeit, GPS), werden in der Bilddatei "
        "geleert, falls dort schon ein Wert steht. Alle anderen Metadaten bleiben unveraendert."
    )
    bestaetigung = input("\nMetadaten jetzt schreiben? (j/n): ").strip().lower()
    if bestaetigung != "j":
        print("Abgebrochen, es wurde nichts geschrieben.")
        return

    # --- Schreiben ---
    log_pfad = ordner / "filmlog-exif-log.txt"
    erfolge = 0
    fehler = 0

    for i in range(anzahl_paare):
        datei = dateien_ab_start[i]
        a = aufnahmen[i]

        exif_args = exif_args_fuer_aufnahme(film_detail, a, brennweiten)
        ergebnis = exiftool_schreiben(exiftool_pfad, exif_args, datei)

        if ergebnis.returncode == 0:
            erfolge += 1
            titel_log = a.get("motif") or "(kein Motiv)"
            zeitstempel = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with log_pfad.open("a", encoding="utf-8") as log_datei:
                log_datei.write(f"{zeitstempel}  {datei.name}  ->  {titel_log}\n")
        else:
            fehler += 1
            print(f"Fehler beim Schreiben von {datei.name}: {ergebnis.stderr.strip()}")

    print(f"\nFertig: {erfolge} Datei(en) beschrieben, {fehler} Fehler.")
    if erfolge:
        print(f"Log: {log_pfad}")

    # --- Unverpaarte Dateien (vor der Startdatei + nach dem letzten Eintrag): zumindest Kamera/Film eintragen ---
    nachfolgende_dateien = dateien_ab_start[anzahl_paare:]
    unverpaarte_dateien = fuehrende_dateien + nachfolgende_dateien
    if unverpaarte_dateien:
        print(f"\n{len(unverpaarte_dateien)} Bilddatei(en) ohne Filmlog-Eintrag:")
        for p in unverpaarte_dateien:
            print(f"  {p.name}")

        rest_antwort = input(
            "\nDiesen Dateien zumindest Kamera und Film eintragen "
            "(Make/Model, ohne Motiv/Datum/Objektiv etc.)? (j/n): "
        ).strip().lower()

        if rest_antwort == "j":
            rest_erfolge = 0
            rest_fehler = 0
            for datei in unverpaarte_dateien:
                exif_args = ["-overwrite_original", "-m"]
                if gewaehlter_film.get("kamera"):
                    exif_args.append(f"-Make={gewaehlter_film['kamera']}")
                if gewaehlter_film.get("name"):
                    exif_args.append(f"-Model={gewaehlter_film['name']}")

                ergebnis = exiftool_schreiben(exiftool_pfad, exif_args, datei)

                if ergebnis.returncode == 0:
                    rest_erfolge += 1
                    zeitstempel = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    with log_pfad.open("a", encoding="utf-8") as log_datei:
                        log_datei.write(
                            f"{zeitstempel}  {datei.name}  ->  (nur Kamera/Film, kein Filmlog-Eintrag)\n"
                        )
                else:
                    rest_fehler += 1
                    print(f"Fehler beim Schreiben von {datei.name}: {ergebnis.stderr.strip()}")

            print(f"\nZusaetzlich beschrieben (nur Kamera/Film): {rest_erfolge} Datei(en), {rest_fehler} Fehler.")
        else:
            print("Uebersprungen, diese Dateien bleiben unveraendert.")

    if erfolge:
        antwort = input(
            "\nFilm in Filmlog markieren? (a = archivieren, g = als gescannt markieren, n = nichts): "
        ).strip().lower()
        neuer_status = {"a": "archiviert", "g": "gescannt"}.get(antwort)
        if neuer_status:
            ergebnis = api.post(f"/api/v2/rolls/{gewaehlter_film['nummer']}/status", {"status": neuer_status})
            if ergebnis is not None:
                print(f"Film #{gewaehlter_film['nummer']} ist jetzt {neuer_status}.")
            else:
                print("Statuswechsel fehlgeschlagen, bitte manuell in Filmlog nachholen.")


if __name__ == "__main__":
    main()