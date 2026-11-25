"""Parser und Normalisierer fuer fotografische Werte.

Alle Funktionen sind rein (ohne DB) und werden von API, Importer und Tests genutzt.
"""

import re


class UnitError(ValueError):
    pass


def _num(text: str) -> float:
    return float(text.replace(",", "."))


def _trim(x: float) -> str:
    """5.0 -> '5', 5.60 -> '5.6', 1.25 -> '1.25'."""
    text = f"{x:.2f}".rstrip("0").rstrip(".")
    return text or "0"


# ---------- Belichtungszeit ----------

_SHUTTER_SPECIAL = {"b": "B", "bulb": "B", "t": "T", "time": "T"}


def shutter_label(seconds: float) -> str:
    if seconds < 1:
        den = round(1 / seconds, 1)
        if abs(1 / den - seconds) / seconds < 0.005:
            return f"1/{_trim(den)}"
        return f"{_trim(seconds)}s"
    if seconds >= 60 and seconds % 60 == 0:
        return f"{int(seconds // 60)}min"
    return f"{_trim(seconds)}s"


def parse_shutter(value: str) -> tuple[str, float | None]:
    """Normalisiert eine Belichtungszeit -> (label, Sekunden).

    '1/125', '1/125s', '125' -> ('1/125', 0.008)
    '2s', '2"', '2 sek', '0,5' -> ('2s', 2.0) / ('1/2', 0.5)
    'B', 'Bulb', 'T' -> ('B', None)
    Eine nackte ganze Zahl >= 2 wird wie auf dem Zeitenrad als Bruch gelesen ('125' = 1/125).
    """
    raw = (value or "").strip()
    if not raw:
        raise UnitError("Belichtungszeit ist leer.")
    t = raw.lower().replace(" ", "").replace("″", '"').replace("”", '"')
    if t in _SHUTTER_SPECIAL:
        return _SHUTTER_SPECIAL[t], None

    m = re.fullmatch(r"(\d+(?:[.,]\d+)?)(min|m|')", t)
    if m:
        sec = _num(m.group(1)) * 60
        return shutter_label(sec), sec

    t = re.sub(r"(sec|sek|s|\")$", "", t)
    explicit_seconds = t != raw.lower().replace(" ", "")

    m = re.fullmatch(r"(\d+(?:[.,]\d+)?)/(\d+(?:[.,]\d+)?)", t)
    if m:
        num, den = _num(m.group(1)), _num(m.group(2))
        if num <= 0 or den <= 0:
            raise UnitError(f"Ungültige Belichtungszeit: {raw}")
        sec = num / den
    elif re.fullmatch(r"\d+(?:[.,]\d+)?", t):
        n = _num(t)
        if n <= 0:
            raise UnitError(f"Ungültige Belichtungszeit: {raw}")
        if explicit_seconds or n < 2 or not float(n).is_integer():
            sec = n
        else:
            sec = 1 / n
    else:
        raise UnitError(f"Unbekannte Belichtungszeit: {raw}")

    if sec < 1 / 64000 or sec > 24 * 3600:
        raise UnitError(f"Belichtungszeit außerhalb des sinnvollen Bereichs: {raw}")
    return shutter_label(sec), sec


def shutter_sort_key(seconds: float | None, label: str = "") -> tuple[int, float, str]:
    """Kurz -> lang, B und T ans Ende."""
    if seconds is None:
        return (1, 0.0, label)
    return (0, seconds, label)


def try_parse_shutter(value: str | None) -> tuple[str | None, float | None]:
    if not value or not value.strip():
        return None, None
    try:
        return parse_shutter(value)
    except UnitError:
        return value.strip(), None


# ---------- Blende ----------

def aperture_label(f_number: float) -> str:
    return f"f/{_trim(f_number)}"


def parse_aperture(value: str) -> tuple[str, float]:
    """'f/5.6', 'F5,6', '5.6', 'f 8', '1:2.8' -> ('f/5.6', 5.6)"""
    raw = (value or "").strip()
    if not raw:
        raise UnitError("Blende ist leer.")
    t = raw.lower().replace(" ", "")
    t = re.sub(r"^(f/?|1:)", "", t)
    if not re.fullmatch(r"\d+(?:[.,]\d+)?", t):
        raise UnitError(f"Unbekannte Blende: {raw}")
    n = _num(t)
    if n < 0.5 or n > 256:
        raise UnitError(f"Blende außerhalb des sinnvollen Bereichs: {raw}")
    return aperture_label(n), round(n, 2)


def try_parse_aperture(value: str | None) -> tuple[str | None, float | None]:
    if not value or not value.strip():
        return None, None
    try:
        return parse_aperture(value)
    except UnitError:
        return value.strip(), None


# ---------- Brennweite / ISO / Filmstock-Heuristik ----------

def parse_focal_length(value: str | None) -> float | None:
    if not value:
        return None
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*mm", value.lower())
    if m:
        return _num(m.group(1))
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*", value)
    return _num(m.group(1)) if m else None


def guess_lens(name: str) -> tuple[float | None, float | None]:
    """Brennweite und Lichtstaerke aus einem Objektivnamen, z.B. 'Helios 44-2 58mm f/2' oder 'Nikkor 50/1.4'."""
    focal = parse_focal_length(name)
    max_ap = None
    m = re.search(r"(?:f/?|1:)\s*(\d+(?:[.,]\d+)?)", name, re.I)
    if m:
        max_ap = _num(m.group(1))
    if focal is None:
        m = re.search(r"\b(\d{2,3})\s*/\s*(\d(?:[.,]\d+)?)\b", name)
        if m:
            focal, max_ap = _num(m.group(1)), max_ap or _num(m.group(2))
    return focal, max_ap


ISO_VALUES = (3, 6, 8, 12, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640,
              800, 1000, 1250, 1600, 3200, 6400)


def guess_iso(name: str) -> int | None:
    for m in re.finditer(r"(?<![\d.])(\d{1,4})(?![\d]|mm)", name):
        n = int(m.group(1))
        if n in ISO_VALUES and not re.match(r"\s*(mm|er)\b", name[m.end():], re.I):
            return n
    return None


_SW_HINTS = ("tri-x", "trix", "hp5", "fp4", "delta", "fomapan", "foma ", "t-max", "tmax", "apx", "kentmere",
             "xp2", "rpx", "retro", "ortho", "acros", "double-x", "double x", "pan ", "pan400", "pan100",
             "sw", "s/w", "b&w", "bw", "schwarz", "orwo", "superpan", "hr-", "sfx", "pancro")
_DIA_HINTS = ("velvia", "provia", "ektachrome", "e100", "chrome", "dia", "slide", "astia", "ct precisa")
_FARBE_HINTS = ("portra", "ektar", "gold", "ultramax", "colorplus", "color", "colour", "superia", "c200",
                "pro 400h", "cinestill", "800t", "50d", "vision", "farbe", "lomo", "fujicolor", "agfa vista",
                "phoenix", "kodacolor")


def guess_film_type(name: str) -> str | None:
    n = f" {name.lower()} "
    for hint in _DIA_HINTS:
        if hint in n:
            return "dia"
    for hint in _SW_HINTS:
        if re.search(rf"(?<![a-z]){re.escape(hint.strip())}(?![a-z])", n):
            return "sw"
    for hint in _FARBE_HINTS:
        if hint in n:
            return "farbe"
    return None


def guess_film_format(name: str) -> str | None:
    n = name.lower()
    if re.search(r"\b(35\s*mm|kb|135)\b", n):
        return "35mm"
    if re.search(r"\b(120|220|mittelformat|rollfilm)\b", n):
        return "120"
    if re.search(r"\b4\s*x\s*5\b", n):
        return "4x5"
    if re.search(r"instax|polaroid|instant|sx-70|i-type", n):
        return "instant"
    return None


_MANUFACTURERS = ("Kodak", "Ilford", "Fujifilm", "Fuji", "Foma", "Fomapan", "Rollei", "Agfa", "Lomography",
                  "CineStill", "Cinestill", "Kentmere", "Adox", "Harman", "Polaroid", "Ferrania", "ORWO",
                  "Bergger", "Washi", "Svema", "Ultrafine", "Arista")


def guess_manufacturer(name: str) -> str | None:
    first = name.strip().split(" ")[0] if name.strip() else ""
    for m in _MANUFACTURERS:
        if first.lower() == m.lower():
            return {"Fuji": "Fujifilm", "Fomapan": "Foma", "Cinestill": "CineStill"}.get(m, m)
    return None


# ---------- Kapazitaet ----------

CAPACITY_BY_CAMERA_FORMAT = {
    "35mm": 36, "halbformat": 72, "6x4.5": 15, "6x6": 12, "6x7": 10, "6x9": 8, "4x5": 1, "instant": 8,
}
CAPACITY_BY_FILM_FORMAT = {"35mm": 36, "120": 12, "4x5": 1, "instant": 8}


# ---------- Presets ----------

SHUTTER_PRESETS: dict[str, list[str]] = {
    "voll": ["1/4000", "1/2000", "1/1000", "1/500", "1/250", "1/125", "1/60", "1/30", "1/15", "1/8", "1/4",
             "1/2", "1s", "2s", "4s", "8s", "15s", "30s", "B"],
    "halb": ["1/4000", "1/3000", "1/2000", "1/1500", "1/1000", "1/750", "1/500", "1/350", "1/250", "1/180",
             "1/125", "1/90", "1/60", "1/45", "1/30", "1/20", "1/15", "1/10", "1/8", "1/6", "1/4", "1/3",
             "1/2", "0.7s", "1s", "1.5s", "2s", "3s", "4s", "6s", "8s", "12s", "15s", "20s", "30s", "B"],
    "drittel": ["1/4000", "1/3200", "1/2500", "1/2000", "1/1600", "1/1250", "1/1000", "1/800", "1/640",
                "1/500", "1/400", "1/320", "1/250", "1/200", "1/160", "1/125", "1/100", "1/80", "1/60",
                "1/50", "1/40", "1/30", "1/25", "1/20", "1/15", "1/13", "1/10", "1/8", "1/6", "1/5", "1/4",
                "0.3s", "1/2.5", "1/2", "0.6s", "0.8s", "1s", "1.3s", "1.6s", "2s", "2.5s", "3.2s", "4s", "5s",
                "6s", "8s", "10s", "13s", "15s", "20s", "25s", "30s", "B"],
}

APERTURE_PRESETS: dict[str, list[str]] = {
    "voll": ["1", "1.4", "2", "2.8", "4", "5.6", "8", "11", "16", "22", "32", "45", "64"],
    "halb": ["1", "1.2", "1.4", "1.7", "2", "2.4", "2.8", "3.3", "4", "4.8", "5.6", "6.7", "8", "9.5", "11",
             "13", "16", "19", "22", "27", "32", "45", "64"],
    "drittel": ["1", "1.1", "1.2", "1.4", "1.6", "1.8", "2", "2.2", "2.5", "2.8", "3.2", "3.5", "4", "4.5",
                "5", "5.6", "6.3", "7.1", "8", "9", "10", "11", "13", "14", "16", "18", "20", "22", "25",
                "29", "32", "45", "64"],
}
