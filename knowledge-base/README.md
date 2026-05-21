# PMK Berlin — Knowledge Base (ElevenLabs)

Wissensdatenbank für den ElevenLabs-Agenten **Marta** (Voice + Chat).

Agent-ID: `agent_4101kpbhjmptftzr7tscfxk639fq`

## Inhalt

| Datei | Zweck |
|---|---|
| `01-parafia-msze-kontakt.md` | Adresse, Bürozeiten, Messzeiten an allen 4 Kirchen, Beichte, Fastenzeit |
| `02-sakramenty.md` | Taufe, Erstkommunion, Firmung, Ehe, Beichte, Krankensalbung, Beerdigung |
| `03-wspolnoty.md` | Alle 12 Gemeindegruppen mit Treffzeiten, Ort, Leitung, Kontakt |
| `04-faq-edge-cases.md` | Häufige Fragen, Wielkanoc, WhatsApp-Kanal, Dos & Don'ts, schwierige Fälle |

Alle Dateien sind zweisprachig (Polnisch + Deutsch), da der Agent beide Sprachen bedient. Englische Anfragen werden über die polnische Quelle beantwortet.

## Upload-Anleitung

Option A — über die ElevenLabs-Oberfläche:
1. https://elevenlabs.io/app/conversational-ai → Agent *"PMK Berlin — Marta"*
2. Tab **Knowledge Base** → **Add document** (für jede Datei einmal)
3. Im Agent-Prompt ist die RAG-Nutzung bereits beschrieben; keine weiteren Änderungen nötig

Option B — per API:
```bash
for f in 01-*.md 02-*.md 03-*.md 04-*.md; do
  curl -X POST https://api.elevenlabs.io/v1/convai/knowledge-base \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    -F "file=@$f" \
    -F "name=$f"
done
```
Dann die zurückgegebenen `document_id`-Werte an den Agenten anhängen über
`PATCH /v1/convai/agents/agent_4101kpbhjmptftzr7tscfxk639fq`
mit `conversation_config.agent.prompt.knowledge_base: [{"id": "...", "type": "file"}]`.

## Pflege

- Quelle der Wahrheit ist weiterhin die Website: https://www.pmk-berlin.de (bzw. der Netlify-Deploy).
- Bei Änderungen: Datei hier updaten → erneut hochladen (alte Version in ElevenLabs ersetzen).
- Wydarzenia (Events) sind **nicht** in der KB — die kommen live über das Tool `get_upcoming_events` aus dem Google Sheet.

## Schreibkonventionen für TTS

- Zeiten in Ziffern schreiben (`10:15`, `18:00`) — `text_normalisation_type: elevenlabs` expandiert automatisch beim Vorlesen.
- Keine Markdown-Tabellen im Fließtext-Bereich — TTS liest Pipes vor. Listen mit `-` sind OK, werden natürlich gelesen.
- Polnische Diakritika exakt setzen: ą ć ę ł ń ó ś ź ż.
- Eigennamen unverändert (Johannes-Basilika, Lilienthalstraße, Erzbistum Berlin).
