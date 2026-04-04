# PMK Berlin - Events verwalten

## So funktioniert's

Events werden in einem **Google Sheet** gepflegt. Die Website lädt die Daten automatisch.

---

## Google Sheet einrichten

### 1. Neues Sheet erstellen

Gehe zu [sheets.google.com](https://sheets.google.com) und erstelle eine neue Tabelle.

### 2. Spalten anlegen

Erstelle diese Spalten in der ersten Zeile:

| Spalte | Name | Beispiel |
|--------|------|----------|
| A | id | `rekolekcje-2026` |
| B | title | `Rekolekcje Wielkopostne` |
| C | date | `2026-03-23` |
| D | time | `18:00` |
| E | shortDesc | `Nauki poprowadzi ks. Kowalski` |
| F | fullDesc | `Längere Beschreibung...` |
| G | imageUrl | (optional - Bild-URL) |
| H | location | `Johannes-Basilika` |
| I | address | `Lilienthalstr. 5, 10965 Berlin` |

### 3. Sheet öffentlich machen

1. Klicke **"Freigeben"** (oben rechts)
2. → **"Jeder mit dem Link"**
3. → **"Betrachter"**

### 4. Sheet-ID in die Website eintragen

Kopiere die ID aus der URL:
```
https://docs.google.com/spreadsheets/d/DIESE_ID/edit
                                        ↑↑↑↑↑↑↑↑
```

Öffne `js/events-manager.js` und trage sie ein:
```javascript
SHEET_ID: 'DEINE_ID_HIER',
```

---

## Event hinzufügen

1. Neue Zeile im Google Sheet
2. **id**: Eindeutiger Name ohne Leerzeichen (z.B. `boze-cialo-2026`)
3. **date**: Datum im Format `YYYY-MM-DD`
4. **time**: Uhrzeit im Format `HH:MM`
5. Speichern - fertig!

---

## Bilder (optional)

### Google Drive:
1. Bild hochladen
2. Rechtsklick → Freigeben → "Jeder mit dem Link"
3. Link in Spalte G einfügen

### Oder direkte URL:
Einfach die Bild-URL einfügen (muss öffentlich zugänglich sein).

---

## Tipps

- Events werden automatisch nach Datum sortiert
- Vergangene Events werden ausgeblendet
- Cache: Website aktualisiert alle 5 Minuten

---

## Beispiel-Event

| id | title | date | time | shortDesc |
|----|-------|------|------|-----------|
| wielkanoc-2026 | Wielkanoc | 2026-04-05 | 07:00 | Rezurekcja o 7:00 |
