from tests.conftest import PASSWORD, USER


def _roll(client, basics, **extra):
    body = {"film_stock_id": basics["stock"]["id"], "camera_id": basics["camera"]["id"], "capacity": 36, **extra}
    r = client.post("/api/v2/rolls", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _frames(client, number, **body):
    body.setdefault("date", "2026-08-09")
    body.setdefault("time", "10:20")
    r = client.post(f"/api/v2/rolls/{number}/frames", json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()


# ---------- Auth ----------

def test_requires_login(anon):
    assert anon.get("/api/v2/catalog").status_code == 401
    assert anon.get("/healthz").json() == {"ok": True}


def test_login_logout(anon):
    assert anon.post("/auth/login", json={"username": USER, "password": "falsch"}).status_code == 401
    assert anon.post("/auth/login", json={"username": USER, "password": PASSWORD}).status_code == 200
    assert anon.get("/auth/me").json() == {"username": USER}
    anon.post("/auth/logout", headers={"X-Filmlog": "1"})
    assert anon.get("/auth/me").status_code == 401


def test_rate_limit(anon):
    for _ in range(5):
        anon.post("/auth/login", json={"username": USER, "password": "falsch"})
    r = anon.post("/auth/login", json={"username": USER, "password": PASSWORD})
    assert r.status_code == 429


def test_csrf_header_required(client):
    del client.headers["X-Filmlog"]
    r = client.post("/api/v2/lenses", json={"name": "X"})
    assert r.status_code == 403


def test_password_change(client):
    r = client.post("/auth/password", json={"current": "falsch", "new": "neuespasswort"})
    assert r.status_code == 400
    assert client.post("/auth/password", json={"current": PASSWORD, "new": "neuespasswort"}).json() == {"ok": True}
    assert client.get("/auth/me").status_code == 200


def test_api_token(client, basics):
    roll = _roll(client, basics)
    tok = client.post("/api/v2/tokens", json={"name": "EXIF"}).json()
    assert tok["token"].startswith("flt_")
    assert client.get("/api/v2/tokens").json()[0]["name"] == "EXIF"

    client.cookies.clear()
    del client.headers["X-Filmlog"]
    h = {"Authorization": f"Bearer {tok['token']}"}
    assert client.get(f"/api/v2/rolls/{roll['number']}", headers=h).status_code == 200
    # Bearer braucht keinen CSRF-Header
    r = client.post(f"/api/v2/rolls/{roll['number']}/status", json={"status": "abgeschlossen"}, headers=h)
    assert r.status_code == 200
    assert client.get("/api/v2/rolls", headers={"Authorization": "Bearer flt_falsch"}).status_code == 401


# ---------- Katalog ----------

def test_catalog_normalizes_and_sorts(client):
    for label in ["1/60", "B", "1/1000", "2s", "125"]:
        assert client.post("/api/v2/shutter-speeds", json={"label": label}).status_code == 201
    assert client.post("/api/v2/shutter-speeds", json={"label": "1/125s"}).status_code == 409
    assert client.post("/api/v2/shutter-speeds", json={"label": "quatsch"}).status_code == 422
    for label in ["8", "f/2.8", "F16", "5,6"]:
        client.post("/api/v2/apertures", json={"label": label})
    cat = client.get("/api/v2/catalog").json()
    assert [s["label"] for s in cat["shutter_speeds"]] == ["1/1000", "1/125", "1/60", "2s", "B"]
    assert [a["label"] for a in cat["apertures"]] == ["f/2.8", "f/5.6", "f/8", "f/16"]


def test_presets(client):
    r = client.post("/api/v2/apertures/presets", json={"preset": "voll"}).json()
    assert r[0]["label"] == "f/1" and len(r) == 13
    client.post("/api/v2/apertures/presets", json={"preset": "voll"})
    assert len(client.get("/api/v2/catalog").json()["apertures"]) == 13


def test_film_stock_guessing(client):
    s = client.post("/api/v2/film-stocks", json={"name": "Ilford HP5 Plus 400 35mm"}).json()
    assert (s["iso"], s["type"], s["format"], s["manufacturer"]) == (400, "sw", "35mm", "Ilford")
    assert client.post("/api/v2/film-stocks", json={"name": "ilford hp5 plus 400 35mm"}).status_code == 409


def test_delete_in_use_archives(client, basics):
    _roll(client, basics)
    r = client.delete(f"/api/v2/cameras/{basics['camera']['id']}").json()
    assert r == {"deleted": False, "archived": True}
    unused = client.post("/api/v2/cameras", json={"name": "Leica"}).json()
    assert client.delete(f"/api/v2/cameras/{unused['id']}").json() == {"deleted": True}


def test_catalog_sorted_by_recent_use(client, basics):
    other = client.post("/api/v2/cameras", json={"name": "Aaa Kamera"}).json()
    cat = client.get("/api/v2/catalog").json()
    assert cat["cameras"][0]["name"] == "Aaa Kamera"   # beide ungenutzt -> alphabetisch
    roll = _roll(client, basics)
    _frames(client, roll["number"])
    cat = client.get("/api/v2/catalog").json()
    assert cat["cameras"][0]["name"] == "Zenit TTL" and cat["cameras"][0]["usage_count"] == 1
    assert other["id"] == cat["cameras"][1]["id"]


# ---------- Filme & Aufnahmen ----------

def test_roll_lifecycle(client, basics):
    roll = _roll(client, basics, expiry_year=2020)
    assert roll["number"] == 1 and roll["status"] == "offen" and roll["iso"] == 400
    assert roll["expired_years"] > 0
    assert client.delete("/api/v2/rolls/1").status_code == 400

    r = client.post("/api/v2/rolls/1/status", json={"status": "entwickelt"}).json()
    assert r["status"] == "entwickelt" and r["developed_at"] and r["completed_at"] is None
    r = client.post("/api/v2/rolls/1/status", json={"status": "abgeschlossen"}).json()
    assert r["developed_at"] is None and r["completed_at"]
    r = client.post("/api/v2/rolls/1/status", json={"status": "offen"}).json()
    assert r["completed_at"] is None

    r = client.patch("/api/v2/rolls/1", json={"iso_override": 1600, "notes": "Push +2"}).json()
    assert r["iso"] == 1600
    client.post("/api/v2/rolls/1/status", json={"status": "abgeschlossen"})
    assert client.delete("/api/v2/rolls/1").json() == {"ok": True}
    # Nummern werden nicht wiederverwendet
    assert _roll(client, basics)["number"] == 2


def test_frames_count_insert_delete(client, basics):
    roll = _roll(client, basics, capacity=4)
    created = _frames(client, 1, count=3, shutter="1/125s", aperture="5,6", lens_id=basics["lens"]["id"])
    assert [f["position"] for f in created] == [1, 2, 3]
    assert created[0]["shutter"] == "1/125" and created[0]["aperture"] == "f/5.6"
    assert created[0]["lens_name"] == basics["lens"]["name"]

    ins = _frames(client, 1, position=2, motif="eingeschoben")
    assert ins[0]["position"] == 2
    detail = client.get("/api/v2/rolls/1").json()
    assert [f["position"] for f in detail["frames"]] == [1, 2, 3, 4]
    assert detail["frames"][1]["motif"] == "eingeschoben"
    assert detail["is_full"] is True

    client.delete(f"/api/v2/frames/{detail['frames'][0]['id']}")
    detail = client.get("/api/v2/rolls/1").json()
    assert [f["position"] for f in detail["frames"]] == [1, 2, 3]
    assert detail["frames"][0]["motif"] == "eingeschoben"
    assert detail["frame_count"] == 3

    r = client.patch(f"/api/v2/frames/{detail['frames'][0]['id']}", json={"shutter": "B", "motif": "neu"}).json()
    assert r["shutter"] == "B" and r["shutter_seconds"] is None and r["motif"] == "neu"
    assert roll["number"] == 1


def test_frame_rules(client, basics):
    _roll(client, basics)
    client.post("/api/v2/rolls/1/status", json={"status": "abgeschlossen"})
    r = client.post("/api/v2/rolls/1/frames", json={"date": "2026-08-09"})
    assert r.status_code == 400
    assert client.post("/api/v2/rolls/1/frames", json={"position": 1}).status_code == 201
    client.post("/api/v2/rolls/1/status", json={"status": "archiviert"})
    assert client.post("/api/v2/rolls/1/frames", json={"position": 1}).status_code == 400
    assert client.post("/api/v2/rolls/1/frames", json={"position": 1, "shutter": "x"}).status_code == 400


def test_offline_idempotency(client, basics):
    _roll(client, basics)
    a = _frames(client, 1, client_id="abc-123", count=2, recorded_at="2026-08-01T09:00:00")
    b = _frames(client, 1, client_id="abc-123", count=2, recorded_at="2026-08-01T09:00:00")
    assert [f["id"] for f in a] == [f["id"] for f in b]
    assert a[0]["recorded_at"] == "2026-08-01T09:00:00"
    assert client.get("/api/v2/rolls/1").json()["frame_count"] == 2


def test_invalid_input_message(client, basics):
    _roll(client, basics)
    r = client.post("/api/v2/rolls/1/frames", json={"date": "gestern"})
    assert r.status_code == 422 and "date" in r.json()["error"]
    r = client.post("/api/v2/rolls/1/frames", json={"shutter": "schnell"})
    assert r.status_code == 422 and "Belichtungszeit" in r.json()["error"]


def test_recent_cursor(client, basics):
    _roll(client, basics)
    for i in range(5):
        _frames(client, 1, motif=f"m{i}", recorded_at=f"2026-08-0{i + 1}T10:00:00")
    page = client.get("/api/v2/frames/recent?limit=2").json()
    assert [f["motif"] for f in page["items"]] == ["m4", "m3"]
    assert page["items"][0]["roll"]["camera_name"] == "Zenit TTL"
    page2 = client.get(f"/api/v2/frames/recent?limit=2&cursor={page['next_cursor']}").json()
    assert [f["motif"] for f in page2["items"]] == ["m2", "m1"]
    page3 = client.get(f"/api/v2/frames/recent?limit=2&cursor={page2['next_cursor']}").json()
    assert [f["motif"] for f in page3["items"]] == ["m0"] and page3["next_cursor"] is None


def test_dashboard(client, basics):
    _roll(client, basics, capacity=1)
    _roll(client, basics)
    _frames(client, 1, motif="voll")
    client.post("/api/v2/rolls/2/status", json={"status": "abgeschlossen"})
    d = client.get("/api/v2/dashboard").json()
    assert [r["number"] for r in d["open_rolls"]] == [1]
    assert d["last_frame"]["motif"] == "voll"
    assert d["to_develop"] == {"total": 1, "sw": 1, "farbe": 0, "dia": 0, "anderes": 0}
    assert d["hints"][0]["kind"] == "voll"


# ---------- Vorschlaege / Suche / Stats / Export ----------

def test_suggestions(client, basics):
    s = client.get(f"/api/v2/suggestions/roll?camera_id={basics['camera']['id']}"
                   f"&film_stock_id={basics['stock']['id']}").json()
    assert s["capacity"] == 36 and s["type"] == "sw" and s["iso"] == 400

    _roll(client, basics, capacity=24, expiry_year=2031)
    s = client.get(f"/api/v2/suggestions/roll?camera_id={basics['camera']['id']}"
                   f"&film_stock_id={basics['stock']['id']}").json()
    assert s["capacity"] == 24 and s["expiry_year"] == 2031

    f = client.get("/api/v2/suggestions/frame?roll=1").json()
    assert f["lens_ids"] == [basics["lens"]["id"]] and f["lens_id"] == basics["lens"]["id"]
    _frames(client, 1, shutter="1/250", aperture="11", motif="Teich im Park", lat=52.5, lon=13.4,
            location_text="Stadtpark")
    _frames(client, 1, motif="Teich am Abend", lat=52.5, lon=13.4, location_text="52.50000, 13.40000")
    f = client.get("/api/v2/suggestions/frame?roll=1").json()
    assert f["motif"] == "Teich am Abend"
    assert client.get("/api/v2/suggestions/motifs?q=teich").json() == ["Teich am Abend", "Teich im Park"]
    places = client.get("/api/v2/suggestions/places?lat=52.501&lon=13.401").json()
    assert places[0]["location_text"] == "Stadtpark" and places[0]["distance_m"] < 200
    assert len(places) == 1


def test_search(client, basics):
    _roll(client, basics)
    _frames(client, 1, motif="Kastanienbaum am Teich", location_text="Straße am Müggelsee")
    _frames(client, 1, motif="Hund")
    r = client.get("/api/v2/search?q=kastanie").json()
    assert [f["motif"] for f in r["frames"]] == ["Kastanienbaum am Teich"]
    assert client.get("/api/v2/search?q=muggelsee").json()["frames"]
    assert client.get("/api/v2/search?q=zenit").json()["rolls"][0]["number"] == 1
    assert client.get("/api/v2/search?q=%231").json()["rolls"][0]["number"] == 1
    # Update haelt FTS synchron
    fid = r["frames"][0]["id"]
    client.patch(f"/api/v2/frames/{fid}", json={"motif": "Eiche"})
    assert client.get("/api/v2/search?q=kastanie").json()["frames"] == []
    assert client.get("/api/v2/search?q=eiche").json()["frames"][0]["id"] == fid
    assert client.get('/api/v2/search?q="*').status_code == 200


def test_stats(client, basics):
    from datetime import date
    today = date.today().isoformat()
    _roll(client, basics)
    for sh in ["1/60", "1/1000", "1/60", "B"]:
        _frames(client, 1, date=today, shutter=sh, aperture="8", lat=1.0, lon=2.0)
    _frames(client, 1, date="2000-01-01", shutter="1/8")
    s = client.get("/api/v2/stats?range=30").json()
    assert s["frames_total"] == 4 and s["rolls_total"] == 1
    assert [x["name"] for x in s["by_shutter"]] == ["1/1000", "1/60", "B"]
    assert s["by_type"] == [{"name": "S/W", "key": "sw", "count": 4}]
    assert s["by_month"][-1]["month"] == today[:7]
    assert len(s["locations"]) == 4
    assert client.get("/api/v2/stats?range=alle").json()["frames_total"] == 5
    assert client.get("/api/v2/stats?range=7").status_code == 422


def test_exports(client, basics):
    _roll(client, basics)
    _frames(client, 1, motif="-5 Grad", lat=52.5, lon=-13.25)
    r = client.get("/api/v2/rolls/1/export.csv")
    text = r.content.decode("utf-8-sig")
    assert "attachment" in r.headers["content-disposition"]
    assert "'-5 Grad" in text and "-13,25" in text
    j = client.get("/api/v2/export.json").json()
    assert j["rolls"][0]["frames"][0]["motif"] == "-5 Grad"
    b = client.get("/api/v2/backup.sqlite")
    assert b.status_code == 200 and b.content[:15] == b"SQLite format 3"


def test_spa_fallback(client, app, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>filmlog</html>")
    (dist / "assets" / "app-abc.js").write_text("x")
    assert "filmlog" in client.get("/").text
    assert "filmlog" in client.get("/irgendwas").text
    r = client.get("/assets/app-abc.js")
    assert "immutable" in r.headers["cache-control"]
    assert client.get("/api/v2/nope").status_code == 404
    assert client.get("/../../etc/passwd").status_code in (404, 200)
    assert "root:" not in client.get("/..%2F..%2Fetc%2Fpasswd").text
