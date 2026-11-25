from datetime import timedelta

from filmlog.models import Roll, now


def test_develop_hints_are_aggregated(client, basics, db_session):
    for _ in range(5):
        client.post("/api/v2/rolls", json={"film_stock_id": basics["stock"]["id"],
                                           "camera_id": basics["camera"]["id"], "capacity": 36})
    for r in db_session.query(Roll):
        r.status = "abgeschlossen"
        r.completed_at = now() - timedelta(days=30 + r.number)
    db_session.commit()

    hints = [h for h in client.get("/api/v2/dashboard").json()["hints"] if h["kind"] == "entwickeln"]
    assert len(hints) == 1
    assert hints[0]["roll_number"] == 5 and hints[0]["text"].startswith("5 Filme warten")
