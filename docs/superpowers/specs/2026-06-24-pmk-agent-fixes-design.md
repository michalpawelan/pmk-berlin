# PMK KI-Agenten — Fehlerbehebung & Härtung (Voice + Chat)

- **Datum:** 2026-06-24
- **Status:** Design freigegeben (User), bereit für writing-plans
- **Betrifft:** Voice-Agent „Marta" (`agent_4101kpbhjmptftzr7tscfxk639fq`, Telefon +493075938358) + Website-Chat-Bot (`agent_9501kteh8ecmek7asfq0k7zvraqw`). Beide teilen die Wissensbasis.

## 1. Kontext & Anlass

Datengestützter 30-Tage-Review (`scripts/voice-review.py` + Multi-Agent-Tiefenlesen, 88 echte Transkripte: 60 Voice / 28 Chat). Ergebnis: beide Agenten **AMBER**. Inhaltlich solide, aber die kritischen Fälle scheitern. Belegte Kennzahlen (Baseline):

- Voice: 60 Calls (~2/Tag), 57 % mit Unterbrechung, 25 % Frust-Signale, 12 Eskalationen, 4 Eval-Fails.
- Chat: 28 Gespräche (~1/Tag), 0 Eskalationen (= Symptom, nicht Erfolg), ~11 % Totalausfall durch Quota.
- „przerywa"-Ursache **bewiesen** = Telefonie/Turn-Taking, NICHT LLM (LLM-TTFB Median 0,9 s auf allen Stotter-Turns mit 30–156 s Pause). Bereits teilbehoben (siehe §3a).

Vollständige Befundlage: Memory `project_agent_perf_review_2026-06-24`.

## 2. Ziele / Nicht-Ziele

**Ziele:** (1) Kein versprochener Rückruf geht mehr verloren. (2) Keine falschen Live-Daten (PLZ/Links) mehr. (3) Chat halluziniert nicht mehr, sondern eskaliert ehrlich. (4) Voice-Notfälle (Sterbefall) werden zuverlässig + zuerst eskaliert. (5) Messbare Verbesserung der Baseline-Kennzahlen.

**Nicht-Ziele:** Kein Agenten-Redesign, keine neue Persona/Stimme, kein WhatsApp, keine neuen Features. Twilio-Transport-Diagnose (harte Disconnects) ist ein **separater** Ops-Punkt für den Kontoinhaber, nicht Teil dieses Plans.

## 3. Befund-Inventar

| # | Befund | Ebene | Schwere |
|---|---|---|---|
| **A** | Verlorener Handoff — `create_zgloszenie` feuert nicht, Lead weg (3 namentlich belegt) | Code (neu) | 🔴 kritisch |
| **D1** | Event-Feed: PLZ 12049→10965, `/events.html`→`/events` | Daten + Code | 🔴 |
| **E1** | Chat-Quota: ~11 % Totalausfälle — Limit + Alert | Config ($) | 🔴 |
| B1 | Voice Notfall-Fast-Path: Sterbe-Keywords → Tool zuerst | Prompt | 🟠 |
| B2 | Voice: kein Perfekt „Przekazałam" vor Tool-Erfolg | Prompt | 🟠 |
| B3 | Voice: `phone_usable:false` koppeln (kein falsches „rufen zurück") | Prompt | 🟠 |
| B4 | Voice: Readback Pflicht auch bei flüssiger Nummer, vor Tool-Call | Prompt | 🟠 |
| B5/B6 | Voice: Intentionen nicht übers Event-Tool; Vertrieb nicht eskalieren | Prompt | 🟡 |
| C1 | Chat: KB-Grounding-Stopp — nicht erfinden → eskalieren | Prompt | 🟠 |
| C2 | Chat: Anmelde-Absicht → eskalieren | Prompt | 🟠 |
| H1 | `[Warmly]`-Klammern verbieten, lange Listen chunken (Prompt-Ebene) | Prompt | 🟢 |
| F1 | KB-Widersprüche (Mittwoch-Messe, Büro 17:30, Neukölln) + Reindex | KB | 🟡 |
| G1 | Eval-Kriterien schärfen + Regressions-Suite | Eval | 🟡 |

### 3a. Bereits erledigt (Welle 0, 2026-06-24)

Voice-Turn-Taking-Config gegen „przerywa": `turn.turn_eagerness` `patient→normal`, `turn.interruption_ignore_terms` `[]→["halo","halo halo","halo?","słychać","nie słychać"]`. Nur diese 2 Felder; Prompt/KB/Voice/Timeouts verifiziert intakt. **Rollback:** `turn_eagerness→patient`, `interruption_ignore_terms→[]`. Wird am Ende von Welle 1 mitgemessen; falls Totstille bleibt, nächste Stufe `eager`.

## 4. Wellen-Plan

Jede Welle endet mit **manuellem Deploy** (`netlify deploy --prod --dir=.` — kein CI-Auto-Deploy) bzw. API-Push + **Verify gegen Baseline**, erst dann die nächste.

- **Welle 1 (P0):** A (Safety-Net) · D1 (Event-Feed) · E1 (Quota-Alert).
- **Welle 2 (Prompt):** B1–B6 (Voice) · C1–C2 (Chat) · H1 (beide).
- **Welle 3 (KB+Eval):** F1 (KB-Reindex) · G1 (Eval + Regressions-Suite).

**Logik:** Safety-Net zuerst → nichts geht verloren, während wir den Rest iterieren. Welle 2 senkt die Fehlerrate, die das Netz auffängt. Welle 3 = Konsistenz/Qualität.

## 5. Detail-Design: Safety-Net (Baustein A)

**Mechanismus:** ElevenLabs **Post-Call-Webhook** → neue Netlify-Function `netlify/functions/zgloszenie-watchdog.js`. Feuert nach *jedem* beendeten Gespräch (auch bei Drop/Auflegen — fängt genau die Drop-Verluste).

```
ElevenLabs (Voice 4101 + Chat 9501)
  └─ post_call_webhook ─▶ zgloszenie-watchdog.js
        1. Detektion (3 Bedingungen, s.u.)
        2. Extraktion: data-collection-Felder (name/phone/concern/handoff_promised)
           + Recording-Link & transcript_summary als Fallback
        3. POST ─▶ zgloszenie.js  { recovered:true, conversation_id, ... }
                     └─▶ IONOS-Mail + Sheet-Zeile an Pfarrei
                         Betreff: "⚠️ AUTO-WIEDERHERGESTELLT — Nummer/Name
                                   gegen Aufnahme prüfen" + Call-Link
```

**Detektion** — Ticket nur wenn **alle drei** zutreffen (Logik heute per Grep über die 60 Transkripte verifiziert):
1. Transkript enthält Handoff-Marker: `przekaż*` / `przekazał*` / `zanotuj*` / `odezwie` / `oddzwoni*` / `weitergeleitet` / `leite … weiter` / `melden sich` / `pass(ed)? (it )?on` / `notiert`.
2. **Kein** erfolgreicher `create_zgloszenie`-Tool-Call im Gespräch (Tool fehlt ODER Tool-Result ≠ success).
3. **Kein** Vertriebs-/Werbe-Call — Ausschluss via Vertriebs-Marker (`ChurchDesk`, „oferta", „współpraca", „reklama", „w imieniu firmy") + agentseitige Ablehnungsphrase. Verhindert Müll-Tickets.

**Extraktion:** Am Agenten **data-collection-Felder** konfigurieren (`caller_name`, `callback_phone`, `concern`, `handoff_promised:boolean`). ElevenLabs liefert sie strukturiert im Webhook-Payload — **kein** zusätzlicher LLM-Call. Prüf-Flag + Recording-Link decken Hör-Fehler ab.

**Auto-Ticket + Prüf-Flag:** POST an bestehendes `zgloszenie.js` mit neuem optionalem Flag `recovered:true`. `zgloszenie.js` erhält eine **minimale** Ergänzung: bei `recovered` wird ein Warn-Präfix (Betreff + Body) und der Call-Link vorangestellt; sonst unverändert. `urgent` wird gesetzt, wenn Sterbe-/Notfall-Keywords im Transkript.

**Idempotenz:** Function persistiert verarbeitete `conversation_id` (kleine Dedup-Ablage), damit Webhook-Retries kein Doppel-Ticket erzeugen. Ablageort wird im Implementierungsplan festgelegt (z. B. Netlify Blobs oder Sheet-Spalte).

**Sicherheit:** Webhook-Signatur/Secret von ElevenLabs prüfen, damit nur echte ElevenLabs-Calls Tickets auslösen.

**Geltungsbereich:** beide Agenten (Voice + Chat). `source` im Ticket entsprechend `voice-recovered` / `chat-recovered`.

## 6. Per-Item-Spezifikation (übrige Befunde)

**D1 — Event-Feed.** Ursache: `agent-events.js` Default ist bereits korrekt (10965, `/events`); das `12049` + `/events.html` stecken in den **Sheet-Event-Beschreibungen** (Admin-Eingabe, Spalte c[3]/c[6]). Fix zweistufig: (a) Sheet-Daten korrigieren; (b) **defensive Normalisierung** in `agent-events.js`: `12049→10965` und `/events.html→/events` in `description`/`address` per Regex erzwingen, damit künftige Fehleingaben nicht durchschlagen. Akzeptanz: Feed liefert nirgends mehr `12049`/`.html`.

**E1 — Quota.** Alert auf `termination_reason == "exceeds quota limit"` (und LLM-Quota-Fehler) einrichten. **Limit-Anhebung erfordert Konto-/Billing-Freigabe des Users** (Kosten) — wird als offener Punkt geführt. Akzeptanz: keine stillen 0-Antwort-Gespräche mehr bzw. Alert bei Auftreten.

**B1–B6 / C1–C2 / H1 — Prompt-Härtung.** Quelle-of-Truth ist das Repo-`.md` (Voice exakt in Sync mit Live, 23.531 Z.). Prozess je Änderung: Repo-`.md` editieren → per ElevenLabs-API pushen → Live-Zeichenzahl gegen Repo prüfen. Polnische Diakritika korrekt im Prompt/KB (Website-Regel), ASCII nur in an den User gerichteten PL-Nachrichten.
- B1: Sterbe-Keywords (`umierający/intensywna/zagrożenie życia/Krankensalbung`) → `create_zgloszenie` ZUERST mit vorhandener Info (auch ohne bestätigte Nummer), dann nachfassen.
- B2: „Przekazałam/weitergeleitet" (Perfekt) NUR nach Tool-Success; davor Futur/Konjunktiv.
- B3: Nach jedem `create_zgloszenie`-Return `phone_usable` lesen; bei `false` kein „oddzwonimy", sondern Nummer neu diktieren lassen. Verbotene Phrase: „potwierdzam, że to numer z którego dzwonię".
- B4: Readback Pflicht für JEDE Nummer/JEDES Format, vor dem Tool-Call.
- B5: `get_upcoming_events` NICHT für Mess-Intentionen; Standardsatz „wolne intencje ustala wyłącznie biuro" + Eskalation.
- B6: Vertrieb/Werbung priorisiert erkennen (ChurchDesk als Stop-Beispiel) → kein Ticket; Eskalations-Trigger „außerhalb dessen was ich weiß" einschränken.
- C1: Chat — wird nach Gruppe/Kurs/Person/Zeit gefragt, die nicht wörtlich im abgerufenen KB steht → NICHTS erfinden, ehrlich sagen + `create_zgloszenie`/Büro-Mail anbieten. Negativ-Beispiel „katecheza dla maluszków → existiert nicht → Handoff".
- C2: Anmelde-Absicht (Ministrant/Schola/Kurs) → sofort eskalieren statt generisch weiterreden.
- H1: `[Warmly]`-artige Regie-Klammern verbieten (Defense-in-depth, Server-Regex vor TTS ist in ElevenLabs nicht möglich); lange Listen (Adresse/Dokumente) max. 2 Items/Turn.

**F1 — KB.** 4 geteilte MDs editieren: Mittwoch-Messe-Widerspruch (`04-faq` „oprócz środy" vs. `01-parafia` „Mo–Sa 18:00") auflösen, Büro 17:30 als Festwert, Bezirk sitewide **Berlin-Neukölln** (nie Kreuzberg). Danach **voller Reindex** (create→reindex→repoint beider Agenten→force-delete alt — KB-Docs sind immutable). Akzeptanz: beide Agenten geben konsistente, widerspruchsfreie Zeiten/Bezirk aus.

**G1 — Eval + Regression.** Eval-Kriterien schärfen: `eskalation_real` für Sterbefälle kritisch (kein success-by-default), `readback_done`, `kein_vertriebs_zgloszenie`. Regressions-Suite: die bekannten Negativ-Transkripte (Marriage Document Inquiry, Pax-Bank, Telefon-od-Kingi, Sterbefall-ohne-Tool) als Prüf-Set, gegen das nach jedem Prompt-Edit getestet wird (`voice-review.py` erweitern oder ElevenLabs-Eval). Akzeptanz: bekannte Negativfälle würden jetzt als Fail erkannt.

## 7. Querschnitt / Prozess

- **Deploy:** immer manuell `netlify deploy --prod --dir=.` (kein Git-Auto-Deploy).
- **Prompt-Push:** Repo-`.md` → API-PATCH `conversation_config.agent.prompt.prompt` → Live-Zeichenzahl gegenprüfen. Nur das Prompt-Feld ändern, Rest des Configs unangetastet (wie beim Turn-Taking-Patch verifiziert).
- **KB-Reindex:** vollständige Prozedur (Memory `reference_knowledge_base`), beide Agenten teilen die KB.
- **Messung:** nach Welle 1 + am Ende `python3 scripts/voice-review.py --days 14` + Gap-/Stall-Logik (Totstille-Quote, Frust, verlorene Handoffs=0).

## 8. Offene Punkte / braucht User-Freigabe

1. **E1 Quota-Limit-Anhebung** — Kosten, Konto-/Billing-Entscheidung des Users.
2. **Sheet-Daten-Korrektur (D1)** — Zugriff/Abstimmung auf die Event-Quelle.
3. **Twilio-Transport** (harte Disconnects) — separater Ops-Punkt, Twilio-Konsole, nicht in diesem Plan.

## 9. Verifikation / Erfolgskriterien

| Metrik | Baseline (30 T.) | Ziel |
|---|---|---|
| Verlorene Handoffs | ≥3 belegt (~20 %) | **0** (Safety-Net fängt 100 %) |
| Falsche PLZ/Links im Feed | 3 Chats | 0 |
| Chat-Totalausfälle (Quota) | ~11 % | 0 / Alert |
| Chat-Halluzinationen | mehrere belegt | 0 in Stichprobe; stattdessen Eskalation |
| Voice Totstille ≥20 s | 41 % der Calls | sinkend (Turn-Taking-Messung) |
| Bekannte Negativ-Transkripte | als „success" gewertet | als Fail erkannt (Regression) |

Re-Messung 4–6 Wochen nach Welle 1 (kleine Stichprobe → breite Konfidenz).
