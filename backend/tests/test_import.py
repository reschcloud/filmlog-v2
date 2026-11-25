import io

DB_YAML = """\
next_film_number: 5
films:
  1:
    name: Kodak Tri-X 400 35mm
    kamera: Zenit TTL
    ablaufdatum: '2027'
    status: abgeschlossen
    entwickelt: true
    entwickelt_am: '2026-09-01T12:00:00'
    archiviert: true
    filmtyp: sw
    kapazitaet: 36
    angelegt_am: '2026-08-09T10:15:00'
    abgeschlossen_am: '2026-08-20T18:00:00'
    aufnahmen:
      - datum: '2026-08-09'
        uhrzeit: '10:20'
        ort_text: 'Stadtpark'
        ort_lat: 52.5
        ort_lon: 13.4
        objektiv: Helios 44-2
        brennweite: 58mm
        belichtungszeit: 1/125s
        blende: '5,6'
        motiv: Kastanienbaum am Teich
        aufgenommen_am: '2026-08-09T10:20:11'
      - datum: 2026-08-10
        uhrzeit: 11:30
        belichtungszeit: B
        blende: f/8
        blitz: true
        motiv: Nacht
        aufgenommen_am: 2026-08-10T11:30:00
      - datum: '2026-08-11'
        belichtungszeit: irgendwie
        motiv: komisch
  "3":
    name: Kodak Portra 400
    kamera: Rolleiflex
    ablaufdatum: '2027-01-01'
    status: offen
    filmtyp: farbe
    kapazitaet: 12
    angelegt_am: '2026-10-01T09:00:00'
    aufnahmen: []
"""

OPT_YAML = """\
filme: [Kodak Tri-X 400 35mm, Ilford HP5 Plus 400 35mm]
kameras: [Zenit TTL]
objektive: [Helios 44-2]
belichtungszeiten: ['1/60', '1/125', '1/250', 'B', '30"']
blenden: ['f/2.8', 'f/5.6', '8']
"""


def _upload(client, dry_run):
    return client.post("/api/v2/import/v1", data={"dry_run": "true" if dry_run else "false"}, files={
        "db": ("db.yaml", io.BytesIO(DB_YAML.encode()), "application/x-yaml"),
        "optionen": ("optionen.yaml", io.BytesIO(OPT_YAML.encode()), "application/x-yaml"),
    })


def test_import_dry_run_changes_nothing(client):
    r = _upload(client, True)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["dry_run"] is True and rep["rolls"] == 2 and rep["frames"] == 3
    assert client.get("/api/v2/rolls").json() == []
    assert client.get("/api/v2/catalog").json()["cameras"] == []


def test_import_full(client):
    rep = _upload(client, False).json()
    assert rep["rolls"] == 2 and rep["frames"] == 3
    assert rep["cameras"] == 2 and rep["film_stocks"] == 3 and rep["lenses"] == 1
    assert any("irgendwie" in w for w in rep["warnings"])

    rolls = {r["number"]: r for r in client.get("/api/v2/rolls").json()}
    assert set(rolls) == {1, 3}
    assert rolls[1]["status"] == "archiviert" and rolls[1]["expiry_year"] == 2027
    assert rolls[1]["developed_at"] == "2026-09-01T12:00:00"
    assert rolls[3]["status"] == "offen" and rolls[3]["expiry_year"] == 2027 and rolls[3]["capacity"] == 12

    frames = client.get("/api/v2/rolls/1").json()["frames"]
    assert [f["position"] for f in frames] == [1, 2, 3]
    assert frames[0]["shutter"] == "1/125" and frames[0]["aperture"] == "f/5.6"
    assert frames[0]["lens_name"] == "Helios 44-2" and frames[0]["focal_length"] == "58mm"
    assert frames[0]["recorded_at"] == "2026-08-09T10:20:11"
    assert frames[1]["time"] == "11:30" and frames[1]["date"] == "2026-08-10" and frames[1]["flash"] is True
    assert frames[1]["shutter"] == "B"
    assert frames[2]["shutter"] == "irgendwie" and frames[2]["shutter_seconds"] is None

    cat = client.get("/api/v2/catalog").json()
    assert [s["label"] for s in cat["shutter_speeds"]] == ["1/250", "1/125", "1/60", "30s", "B"]
    assert [a["label"] for a in cat["apertures"]] == ["f/2.8", "f/5.6", "f/8"]
    stocks = {s["name"]: s for s in cat["film_stocks"]}
    assert stocks["Kodak Portra 400"]["type"] == "farbe"
    zenit = next(c for c in cat["cameras"] if c["name"] == "Zenit TTL")
    assert zenit["lens_ids"] and zenit["format"] == "35mm"

    # Nummernvergabe setzt nach next_film_number fort
    new = client.post("/api/v2/rolls", json={"film_stock_id": stocks["Kodak Portra 400"]["id"],
                                             "camera_id": zenit["id"], "capacity": 36}).json()
    assert new["number"] == 5

    hints = client.get("/api/v2/dashboard").json()["hints"]
    assert {h["kind"] for h in hints} <= {"voll", "lange_in_kamera", "entwickeln"}

    # Suche funktioniert auf importierten Daten
    assert client.get("/api/v2/search?q=kastanien").json()["frames"]


def test_import_idempotent(client):
    _upload(client, False)
    rep = _upload(client, False).json()
    assert rep["rolls"] == 0 and rep["skipped_rolls"] == 2 and rep["cameras"] == 0
    assert len(client.get("/api/v2/rolls").json()) == 2


def test_import_invalid_yaml(client):
    r = client.post("/api/v2/import/v1", data={"dry_run": "true"},
                    files={"db": ("db.yaml", io.BytesIO(b"films: [unclosed"), "application/x-yaml")})
    assert r.status_code == 422


def test_cli_import(tmp_path, app, capsys):
    from fastapi.testclient import TestClient

    from filmlog.cli import main
    (tmp_path / "db.yaml").write_text(DB_YAML)
    main(["import-v1", str(tmp_path / "db.yaml")])
    assert '"rolls": 2' in capsys.readouterr().out
    with TestClient(app) as c:
        c.post("/auth/login", json={"username": "admin", "password": "geheim1234"})
        assert len(c.get("/api/v2/rolls").json()) == 2
