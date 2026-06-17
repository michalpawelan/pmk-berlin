# PMK Voice-Agent — Anruf-Protokoll & Review

Laufendes Protokoll der eingehenden Telefonate auf der ElevenLabs-„Marta". Neuester Tag oben.
**Live seit:** 05.06.2026.

> **Datenschutz-Hinweis:** Namen, Patientendaten und Rückrufnummern sind in diesem
> git-getrackten Dokument **pseudonymisiert/maskiert** (DSGVO). Die vollständigen Daten
> liegen im ElevenLabs-Dashboard unter der jeweils genannten `conv_…`-ID.

---

## Setup (Stand 05.06.2026)

| | |
|---|---|
| Agent | PMK Berlin — Marta (Voice + Chat) · `agent_4101kpbhjmptftzr7tscfxk639fq` |
| Telefon | **+49 30 7593 8358** (Twilio) — korrekt dem Agenten zugewiesen ✅ |
| Sprachen | PL primär, DE/EN per Auto-Detect |
| Voice | Marta (PL), `eleven_flash_v2_5`, LLM gpt-4o-mini |

---

## ⚠️ Offene Punkte (Launch-relevant)

1. **🔴 Kein Post-Call-Webhook für PMK aktiv** — der PMK-Agent setzt
   `post_call_webhook_id = null`. Heißt: **Anrufe werden NICHT automatisch an die Pfarrei
   weitergeleitet** — keine E-Mail an pmk@pmk-berlin.de, kein Google-Sheet-Eintrag, keine
   Anliegen-Inbox. Der **einzige** Datenort ist das ElevenLabs-Dashboard. Die im
   Betriebsmodell geplante async-Eskalation (E-Mail + Inbox-Tab) ist **noch nicht gebaut**.
   → Solange das fehlt, muss jemand das Dashboard aktiv beobachten.

2. **🟡 Init-Webhook zeigt auf Fremdprojekt** — auf Workspace-Ebene ist der
   `conversation_initiation_client_data_webhook` auf `redo-catering-crm.vercel.app` gesetzt
   (ein anderes Projekt im selben ElevenLabs-Account). Der PMK-Agent *nullt* zwar den
   Post-Call-Webhook (gut → **kein** Transcript-/Audio-Abfluss an das Catering-CRM), aber
   der **Init**-Webhook ist Workspace-weit. → Prüfen, ob bei PMK-Calls Init-Metadaten
   (z. B. Anrufer-Nr.) an das Catering-Projekt gepostet werden, und ggf. bereinigen.

3. **🟡 Keine `data_collection`-Felder konfiguriert** — der Agent extrahiert
   Name/Rückrufnummer/Anliegen nicht strukturiert, nur als Freitext-Summary. Für eine
   spätere Anliegen-Inbox müssten diese Felder am Agenten definiert werden.

---

## Gesamt-Statistik (16.04. – 05.06.2026)

- **39 Telefonanrufe** (alle eingehend, alle mit PL-Begrüßung)
- ✅ **38 erfolgreich**, ❌ **1 Fehler** (17.04. 14:59 — „LLM-Antwort zu langsam", Testphase, seitdem 0 Fehler)
- Ø-Dauer **67 s**, längstes 466 s (≈ 7,8 min), kürzestes 4 s
- Zusätzlich **21 Web-Chat-Gespräche** (Widget/SDK — keine Anrufe)
- Hinweis: Mehrere frühe Cluster (16.04., 11.05., 21.05.) sind erkennbar **interne Tests**.

---

## Tagesprotokoll

### 📅 17.06.2026 — Root-Cause Rückrufnummer + Fix

Rückmeldung der Sekretärin: „manchmal keine Telefonnummer, neulich war **meine eigene** Nummer
angegeben". In den echten Calls reproduziert:
- **08.06. (Grzegorz):** Rückrufnummer = `+49 30 7593 8358` = die **KI-Leitung selbst** → „eigene Nummer".
- **12.06. (Adela):** Rückrufnummer = `„dwadzieścia trzy"` (Wort statt Ziffern) → „keine Nummer".

**Root Cause:** Die `phone`-Parameter-Beschreibung des `create_zgloszenie`-Tools enthielt
„*If the caller number is already known via caller-ID, confirm it and pass it here*" — das **Gegenteil**
des System-Prompts. Der 12.06.-Fix hatte nur den Prompt + einen Code-Backstop angefasst, nicht die
Tool-Beschreibung. Da jede weitergeleitete Anrufe als Caller-ID die Pfarrbüro-Nummer `+49 30 7524 080`
zeigt (auf allen Calls bestätigt), trug der Agent die eigene Nummer ein.

**Fix (17.06.):**
1. Tool-Beschreibung `phone` live umgeschrieben (eigenständiges Tool `tool_5501…`): nur diktierte,
   Ziffer-für-Ziffer rückbestätigte Nummern; **niemals** Caller-ID / eigene Nummern; `""` wenn keine.
2. Code-Backstop `normalizePhone` (eigene Nummern → `""`) mit Regression-Test abgesichert
   (`scripts/test-normalize-phone.cjs`, 9/9) + deployed.
3. Eigentliche Wurzel = Weiterleitung versteckt echte Anrufer-Nr. → Anbieter-Anleitung
   `caller-id-passthrough.md` (Original-CLIP durchreichen) erstellt.

---

### 📅 05.06.2026 — Launch-Tag

**2 Anrufe**, beide von **derselben Nummer** (`+49 30 7524•••`) → ein einziger realer
Anrufer, beide als „success" gewertet. Gesamtkosten ≈ 1.056 Credits.

#### Call 1 — 11:46 · 8 s · Abbruch
`conv_0001ktbjt8jwehst108x5sxmj87r`
Agent begrüßt („Polska Misja Katolicka, tu Marta. W czym mogę pomóc?"), Anrufer legt
**sofort auf** (beendet durch Anrufer). Vermutlich überrascht / Fehlversuch — meldet sich
~2,5 h später erneut (Call 2).

#### Call 2 — 14:17 · 139 s · ✅ ECHTE ANFRAGE — 🔴 ACTION
`conv_9001ktbvg0cjea5rgr8ejvpktgs4`

- **Anrufer:** Schwester *M. M.*, Krankenpflegerin, **Martin-Luther-Krankenhaus, Palliative Care**
- **Anliegen:** **Polnische Seelsorge** für eine hochbetagte, immobile, kranke Patientin
  (*Frau A.*), die den Kontakt zur polnischen Gemeinde verloren hat.
- **Rückruf:** Caller-ID `+49 30 7524•••` · mündlich genannte Nr. `8955•••59`
  (vollständig im Dashboard)
- **Verlauf:** Agent öffnet auf PL → Anruferin bittet um DE/EN → Agent **wechselt sauber
  auf Deutsch** → nimmt Name + Anliegen auf → „ich leite Ihre Anfrage an unser Team weiter,
  bitte zusätzlich eine E-Mail senden" → Verabschiedung.

**Bewertung:**
- ✅ Mehrsprachigkeit funktioniert (PL → DE Wechsel mitten im Gespräch)
- ✅ Betriebsmodell eingehalten: **keine** Nummer/Daten herausgegeben, Anliegen aufgenommen,
  „wir melden uns" — genau wie vorgesehen (Tier-2-Eskalation)
- ⚠️ **Latenz-/Funkloch-Moment:** Agent sagt „Chwileczkę…" und eine überlappende
  Halbsatz-Antwort; Anruferin reagiert mit „Hallo? Bitte? … Ich hör Sie nicht." — kurz tote
  Leitung, Eindruck eines Verbindungsabbruchs. → Antwort-Latenz / Füllwörter prüfen.
- ⚠️ Mündlich genannte Rückrufnummer wirkt **unvollständig** — Agent muss sie Ziffer-für-Ziffer
  rückbestätigen. **Niemals die Caller-ID als Rückrufnummer verwenden:** bei Weiterleitung ist sie
  immer die Pfarrbüro-Nummer (`+49 30 7524 080`), nie der echte Anrufer (siehe Eintrag 17.06.2026).
- 🔴 **ACTION (zeitkritisch):** Diese Seelsorge-Anfrage wurde **NICHT automatisch eskaliert**
  (kein Post-Call-Webhook, siehe Offene Punkte #1). Sie liegt **nur** im ElevenLabs-Dashboard.
  Palliativ-Kontext → jemand muss das Anliegen von *Frau A.* **manuell und heute** an die
  Pfarrei / den Priester weitergeben.

---

## Daten aktualisieren (curl)

API-Key etc. liegen in `./.env` (`ELEVENLABS_API_KEY`, `ELEVENLABS_PMK_AGENT_ID`).

```bash
set -a && . ./.env && set +a

# Alle Gespräche des PMK-Agenten auflisten
curl -s -G "https://api.elevenlabs.io/v1/convai/conversations" \
  --data-urlencode "agent_id=${ELEVENLABS_PMK_AGENT_ID}" \
  --data-urlencode "page_size=100" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY}" > convs.json

# Nur Telefonanrufe (twilio), Erfolg zählen
jq -r '.conversations[] | select(.conversation_initiation_source=="twilio") | .call_successful' convs.json | sort | uniq -c

# Volltext-Transkript + Anrufer-Nr. einer Conversation
curl -s "https://api.elevenlabs.io/v1/convai/conversations/<CONV_ID>" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
  | jq -r '.metadata.phone_call, .analysis.transcript_summary,
           (.transcript[] | select(.message!=null) | "\(.role): \(.message)")'
```

Wichtige Felder pro Listen-Eintrag: `conversation_initiation_source` (`twilio` = Anruf,
sonst Chat), `direction`, `call_successful`, `call_duration_secs`, `start_time_unix_secs`,
`call_summary_title`, `main_language`.
