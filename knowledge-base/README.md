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

## Update-Anleitung (WICHTIG — Datei-Dokumente sind unveränderlich)

Eine hochgeladene Datei lässt sich in ElevenLabs **nicht** bearbeiten. Das Ändern einer `.md`
hier im Repo wirkt sich **nicht** auf die Agenten aus. Der Weg ist immer:
**neu hochladen → indexieren → beide Agenten umhängen → alte Dokumente entfernen.**

Es hängen **zwei** Agenten an derselben Wissensbasis. Beide müssen umgehängt werden:

| Agent | ID |
|---|---|
| Voice (Telefon) | `agent_4101kpbhjmptftzr7tscfxk639fq` |
| Text/Chat (Website) | `agent_9501kteh8ecmek7asfq0k7zvraqw` |

```bash
set -a; . ./.env; set +a

# 1. Hochladen (Endpunkt endet auf /file, nicht auf /knowledge-base)
curl -s -X POST https://api.elevenlabs.io/v1/convai/knowledge-base/file \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -F "file=@knowledge-base/02-sakramenty.md;type=text/markdown" \
  -F "name=02-sakramenty.md"
# -> liefert die neue document id

# 2. RAG-Index anstossen — OHNE diesen Schritt findet der Agent den neuen Text nicht
curl -s -X POST "https://api.elevenlabs.io/v1/convai/knowledge-base/<NEUE_ID>/rag-index" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"e5_mistral_7b_instruct"}'

# 3. Warten bis status == succeeded (eigener Endpunkt, steht NICHT im Dokument-GET)
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
  "https://api.elevenlabs.io/v1/convai/knowledge-base/<NEUE_ID>/rag-index"

# 4. BEIDE Agenten umhängen — das komplette knowledge_base-Array senden,
#    nicht nur den geänderten Eintrag (PATCH ersetzt das Array).
curl -s -X PATCH "https://api.elevenlabs.io/v1/convai/agents/<AGENT_ID>" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"conversation_config":{"agent":{"prompt":{"knowledge_base":[ ...alle 4 Einträge... ]}}}}'

# 5. Erst danach die alten Dokumente löschen (?force=true, solange sie noch referenziert waren)
```

## Agenten-Prompts — Live ist NICHT automatisch gleich dem Repo

`elevenlabs-agent-prompt.md` und `elevenlabs-agent-prompt-chat.md` sind die Repo-Fassungen,
können aber hinter dem Live-Stand liegen, wenn jemand direkt in ElevenLabs gepatcht hat.
**Vor jedem Prompt-PATCH erst den Live-Text ziehen und vergleichen**, sonst löscht man
stillschweigend Live-Abschnitte (am 02.09.2026 hätte ein blindes Hochladen den
EU-AI-Act-Art.-50-Transparenzblock und die Datums-Guardrail entfernt):

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
  "https://api.elevenlabs.io/v1/convai/agents/<AGENT_ID>" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['conversation_config']['agent']['prompt']['prompt'])"
```

## Pflege

- Quelle der Wahrheit ist die Website: https://www.pmk-berlin.de
- Bei Änderungen: Datei hier updaten → Update-Anleitung oben komplett durchlaufen.
- Wydarzenia (Events) sind **nicht** in der KB — die kommen live über das Tool `get_upcoming_events` aus dem Google Sheet.

## Schreibkonventionen für TTS

- Zeiten in Ziffern schreiben (`10:15`, `18:00`) — `text_normalisation_type: elevenlabs` expandiert automatisch beim Vorlesen.
- Keine Markdown-Tabellen im Fließtext-Bereich — TTS liest Pipes vor. Listen mit `-` sind OK, werden natürlich gelesen.
- Polnische Diakritika exakt setzen: ą ć ę ł ń ó ś ź ż.
- Eigennamen unverändert (Johannes-Basilika, Lilienthalstraße, Erzbistum Berlin).
