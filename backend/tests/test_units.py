import pytest

from filmlog import units


@pytest.mark.parametrize("raw,label,seconds", [
    ("1/125", "1/125", 1 / 125),
    ("1/125s", "1/125", 1 / 125),
    ("125", "1/125", 1 / 125),
    (" 1/1000 ", "1/1000", 1 / 1000),
    ("2s", "2s", 2.0),
    ('2"', "2s", 2.0),
    ("2 sek", "2s", 2.0),
    ("2", "1/2", 0.5),
    ("1", "1s", 1.0),
    ("0,5", "1/2", 0.5),
    ("0.4", "1/2.5", 0.4),
    ("0.3s", "0.3s", 0.3),
    ("1.5s", "1.5s", 1.5),
    ("1m", "1min", 60.0),
    ("B", "B", None),
    ("bulb", "B", None),
    ("T", "T", None),
])
def test_parse_shutter(raw, label, seconds):
    got_label, got_seconds = units.parse_shutter(raw)
    assert got_label == label
    if seconds is None:
        assert got_seconds is None
    else:
        assert got_seconds == pytest.approx(seconds)


@pytest.mark.parametrize("raw", ["", "abc", "1/0", "0", "-5"])
def test_parse_shutter_invalid(raw):
    with pytest.raises(units.UnitError):
        units.parse_shutter(raw)


def test_shutter_sorting():
    labels = ["B", "1s", "1/60", "1/1000", "2s", "1/125", "T", "1/8"]
    parsed = [units.parse_shutter(x) for x in labels]
    ordered = [lbl for lbl, sec in sorted(parsed, key=lambda p: units.shutter_sort_key(p[1], p[0]))]
    assert ordered == ["1/1000", "1/125", "1/60", "1/8", "1s", "2s", "B", "T"]


@pytest.mark.parametrize("raw,label,f", [
    ("f/5.6", "f/5.6", 5.6), ("F5,6", "f/5.6", 5.6), ("5.6", "f/5.6", 5.6), ("f 8", "f/8", 8.0),
    ("1:2.8", "f/2.8", 2.8), ("f/22", "f/22", 22.0), ("1.4", "f/1.4", 1.4),
])
def test_parse_aperture(raw, label, f):
    assert units.parse_aperture(raw) == (label, f)


def test_aperture_invalid():
    with pytest.raises(units.UnitError):
        units.parse_aperture("offen")


def test_presets_are_parseable_and_sorted():
    for labels in units.SHUTTER_PRESETS.values():
        parsed = [units.parse_shutter(x) for x in labels]
        assert [p[0] for p in parsed] == labels
        timed = [p[1] for p in parsed if p[1] is not None]
        assert timed == sorted(timed)
    for labels in units.APERTURE_PRESETS.values():
        nums = [units.parse_aperture(x)[1] for x in labels]
        assert nums == sorted(nums)


@pytest.mark.parametrize("name,iso,typ,fmt,maker", [
    ("Kodak Tri-X 400 35mm", 400, "sw", "35mm", "Kodak"),
    ("Ilford HP5 Plus 400 35mm", 400, "sw", "35mm", "Ilford"),
    ("Kodak Portra 160 120", 160, "farbe", "120", "Kodak"),
    ("Fuji Velvia 50", 50, "dia", None, "Fujifilm"),
    ("Fomapan 100", 100, "sw", None, "Foma"),
    ("Kodak Gold 200", 200, "farbe", None, "Kodak"),
    ("CineStill 800T", 800, "farbe", None, "CineStill"),
])
def test_film_guess(name, iso, typ, fmt, maker):
    assert units.guess_iso(name) == iso
    assert units.guess_film_type(name) == typ
    assert units.guess_film_format(name) == fmt
    assert units.guess_manufacturer(name) == maker


def test_lens_guess():
    assert units.guess_lens("Helios 44-2 58mm f/2") == (58.0, 2.0)
    assert units.guess_lens("Nikkor 50/1.4") == (50.0, 1.4)
    assert units.guess_lens("Helios 44-2") == (None, None)
