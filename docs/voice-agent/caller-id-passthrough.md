# Rückrufnummer zuverlässig erfassen — Original-Anrufer-ID bei Weiterleitung durchreichen

**Status:** offen — Aufgabe für die Pfarrei + ihren Telefon-Anbieter (Stand 17.06.2026)

## Das Problem in einem Satz

Die KI-Sekretärin („Marta") sieht **nie die echte Telefonnummer des Anrufers** — deshalb muss sie
jede Rückrufnummer mündlich diktieren lassen, was fehleranfällig ist (unvollständige Nummern, im
schlimmsten Fall gar keine).

## Warum

Anrufe erreichen die KI nicht direkt, sondern über eine **Weiterleitung**:

```
Anrufer (z. B. 0176 …)  ──►  Pfarrbüro +49 30 7524 080  ──(Weiterleitung)──►  KI-Leitung +49 30 7593 8358
```

Bei dieser Weiterleitung ersetzt die Telefonanlage die Rufnummer des **Anrufers** durch die **eigene**
Nummer (`+49 30 7524 080`). Die KI bekommt also als „Anrufer-ID" immer die Pfarrbüro-Nummer zu sehen —
nie den echten Anrufer. (In allen bisherigen Anrufen bestätigt: `external_number = +49 30 7524 080`.)

## Was zu tun ist

Beim Telefon-Anbieter der weiterleitenden Nummer **`+49 30 7524 080`** veranlassen, dass bei der
Weiterleitung die **ursprüngliche Anrufer-Rufnummer** mitübertragen wird.

**Wortlaut für den Anbieter-Support:**

> „Bei der Anrufweiterschaltung von **+49 30 7524 080** auf **+49 30 7593 8358** soll die
> **ursprüngliche Rufnummer des Anrufers** übermittelt werden — nicht die der weiterleitenden
> Stelle. (Original-CLIP / ‚Anrufer-Rufnummer bei Umleitung mitsenden'; bei SIP: A-Teilnehmer-Nummer
> als Diversion-Header / korrektes P-Asserted-Identity-Handling.)"

Übliche Bezeichnungen: **„CLIP no screening"**, **„Rufnummernübermittlung bei Weiterleitung"**,
**„Original Caller ID forwarding"**.

## Wenn der Anbieter das nicht kann

Manche Festnetz-Rufumleitungen unterstützen das nicht. Dann Alternative:
die **KI-Nummer `+49 30 7593 8358` direkt veröffentlichen** (Website / Google-Profil / Aushang) —
ohne Weiterleitung sieht die KI die echte Anrufer-Nummer sofort. Nachteil: neue Nummer kommunizieren.

## Danach (wichtig)

Aktuell ist in der KI das Verwenden der Anrufer-ID **bewusst deaktiviert** (sie war ja die
Büro-Nummer). Sobald die Original-Nummer zuverlässig durchgereicht wird:

1. **Probeanruf** von einem Handy machen. Im ElevenLabs-Dashboard prüfen, ob bei der Conversation
   `external_number` die **echte Handynummer** zeigt (nicht `+49 30 7524 080`).
2. Erst **wenn das zuverlässig klappt**, in der Agent-/Tool-Konfiguration wieder erlauben, die
   Anrufer-ID als Rückruf-Vorschlag zu nutzen (digit-by-digit beim Anrufer bestätigen lassen).

## PL — krótko dla Kingi

Asystent AI nigdy nie widzi prawdziwego numeru dzwoniącego, bo połączenia idą przez przekierowanie
(`+49 30 7524 080` → `+49 30 7593 8358`), które podmienia numer dzwoniącego na numer biura. Trzeba
poprosić operatora telefonicznego, żeby przy przekierowaniu przekazywał **oryginalny numer
dzwoniącego** („CLIP no screening"). Wtedy asystent będzie mógł sam potwierdzić numer, zamiast prosić
o dyktowanie.
