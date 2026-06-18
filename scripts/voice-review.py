#!/usr/bin/env python3
"""
PMK Agenten-Review — wiederkehrender Überblick über Voice (Marta am Telefon)
und Chat (Website-Bot). Zieht die ElevenLabs-Konversationen, rechnet harte
Kennzahlen und flaggt Probleme.

Nutzung:
    python3 scripts/voice-review.py            # letzte 7 Tage
    python3 scripts/voice-review.py --days 14  # letzte 14 Tage

Braucht ELEVENLABS_API_KEY (aus .env oder Umgebung). Nur Lesezugriff,
verändert nichts.
"""
import json, os, sys, re, argparse, urllib.request, statistics as st
from datetime import datetime, timezone

AGENTS = {
    "VOICE (Marta, Telefon)": "agent_4101kpbhjmptftzr7tscfxk639fq",
    "CHAT (Website-Bot)":      "agent_9501kteh8ecmek7asfq0k7zvraqw",
}

def load_key():
    k = os.environ.get("ELEVENLABS_API_KEY")
    if k:
        return k
    for line in open(os.path.join(os.path.dirname(__file__), "..", ".env"), encoding="utf-8"):
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("ELEVENLABS_API_KEY fehlt (.env oder Umgebung).")

KEY = load_key()

def api(url):
    req = urllib.request.Request(url, headers={"xi-api-key": KEY})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def list_convos(agent_id, since_ts):
    out, cursor = [], ""
    while True:
        url = f"https://api.elevenlabs.io/v1/convai/conversations?agent_id={agent_id}&page_size=100"
        if cursor:
            url += f"&cursor={cursor}"
        d = api(url)
        for c in d.get("conversations", []):
            if (c.get("start_time_unix_secs") or 0) >= since_ts:
                out.append(c)
        # Liste ist neueste-zuerst; sobald wir vor dem Fenster sind, Stopp
        if d.get("has_more") and d.get("next_cursor") and \
           any((c.get("start_time_unix_secs") or 0) >= since_ts for c in d.get("conversations", [])):
            cursor = d["next_cursor"]
        else:
            break
    return out

def metricval(turn, key):
    m = (turn.get("conversation_turn_metrics") or {}).get("metrics", {}) if isinstance(turn.get("conversation_turn_metrics"), dict) else {}
    v = m.get(key)
    return v.get("elapsed_time") if isinstance(v, dict) else None

FRUST = re.compile(r"\bhalo\W+halo|przerywa|nie sł|rozłącz|urywa|denerwuj|bez sensu|automat|robot", re.I)

def review(label, agent_id, since_ts):
    convos = list_convos(agent_id, since_ts)
    rows = []
    for c in convos:
        cid = c["conversation_id"]
        full = api(f"https://api.elevenlabs.io/v1/convai/conversations/{cid}")
        meta = full.get("metadata", {}) or {}
        ana = full.get("analysis", {}) or {}
        t = full.get("transcript", []) or []
        users = [x for x in t if x.get("role") == "user" and (x.get("message") or "").strip()]
        ag = [x for x in t if x.get("role") == "agent"]
        lat = [(metricval(x, "convai_llm_service_ttfb") or 0) + (metricval(x, "convai_tts_service_ttfb") or 0)
               for x in ag if metricval(x, "convai_llm_service_ttfb") is not None]
        interr = sum(1 for x in ag if x.get("interrupted"))
        tools = [tc.get("tool_name") if isinstance(tc, dict) else tc
                 for x in t for tc in (x.get("tool_calls") or [])]
        usertxt = " ".join((x.get("message") or "") for x in users)
        ev = ana.get("evaluation_criteria_results") or {}
        ev_fail = [k for k, v in ev.items() if isinstance(v, dict) and v.get("result") == "failure"]
        rows.append(dict(
            id=cid, ts=meta.get("start_time_unix_secs"), dur=meta.get("call_duration_secs") or 0,
            n_user=len(users), n_ag=len(ag),
            lat=st.median(lat) if lat else None, interr=interr,
            esc="create_zgloszenie" in tools,
            term=meta.get("termination_reason"), success=ana.get("call_successful"),
            title=ana.get("call_summary_title") or "", frust=bool(FRUST.search(usertxt)),
            ev_fail=ev_fail,
        ))
    real = [r for r in rows if r["n_user"] >= 1]
    print(f"\n{'='*70}\n{label}  —  {len(rows)} Konversationen, davon {len(real)} echt "
          f"(Rest leer/Test/Abbruch)")
    if not real:
        print("  (keine echten Gespräche im Zeitraum)")
        return
    durs = [r["dur"] for r in real]
    lats = [r["lat"] for r in real if r["lat"] is not None]
    interr_calls = [r for r in real if r["interr"] > 0]
    esc = [r for r in real if r["esc"]]
    frust = [r for r in real if r["frust"]]
    fails = [r for r in real if r["ev_fail"]]
    print(f"  Dauer (s):        Median {st.median(durs):.0f} · Max {max(durs)}")
    if lats:
        print(f"  Antwortlatenz:    Median {st.median(lats):.2f}s · p90 {sorted(lats)[max(0,int(len(lats)*0.9)-1)]:.2f}s")
    print(f"  Unterbrechungen:  {len(interr_calls)}/{len(real)} Calls (≥1) · {sum(r['interr'] for r in real)} Turns gesamt")
    print(f"  Eskalationen:     {len(esc)} (create_zgloszenie)")
    print(f"  Frust-Signale:    {len(frust)} Calls (halo/przerywa/automat …)")
    if fails:
        print(f"  Eval-FAILS:       {len(fails)} Calls mit mind. 1 nicht erfülltem Kriterium")
        for r in fails[:8]:
            print(f"      · {r['title'][:48]:48s} → {', '.join(r['ev_fail'])}")
    print("  Letzte Gespräche:")
    for r in sorted(real, key=lambda x: x["ts"] or 0, reverse=True)[:10]:
        when = datetime.fromtimestamp(r["ts"], tz=timezone.utc).strftime("%m-%d %H:%M") if r["ts"] else "?"
        flags = "".join(["E" if r["esc"] else "", "!" if r["frust"] else "", "✗" if r["ev_fail"] else ""])
        print(f"      {when}  {flags:3s} {r['title'][:52]}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()
    import time
    # kein time.time() Verbot hier (normales Skript), aber wir nehmen die neueste
    # Konversation als Anker, falls die Systemuhr abweicht:
    now = int(__import__("time").time())
    since = now - args.days * 86400
    print(f"PMK-Agenten-Review · letzte {args.days} Tage · "
          f"ab {datetime.fromtimestamp(since, tz=timezone.utc).strftime('%Y-%m-%d')}")
    for label, aid in AGENTS.items():
        try:
            review(label, aid, since)
        except Exception as e:
            print(f"\n{label}: Fehler — {e}")
    print(f"\n{'='*70}\nLegende: E=eskaliert · !=Frust-Signal · ✗=Eval-Fail")
    print("Tieferer Blick pro Anruf: ElevenLabs → Conversations / Analysis-Tab.")

if __name__ == "__main__":
    main()
