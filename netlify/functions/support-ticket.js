/**
 * Netlify Serverless Function - Support Ticket Creator
 * Nimmt Webhooks von Vapi (Voice Agent) und Chatbot entgegen
 * und erstellt Support-Tickets in Airtable.
 *
 * POST Body:
 * {
 *   "channel": "Voice Agent" | "Chatbot",
 *   "summary": "Kurze Zusammenfassung der Anfrage",
 *   "transcript": "Volles Gespraechs-Transkript",
 *   "resolved": true | false,
 *   "contactEmail": "user@example.com" (optional),
 *   "contactPhone": "+49..." (optional),
 *   "callDuration": 120 (Sekunden, optional - nur Voice Agent)
 * }
 *
 * Environment Variables:
 *   AIRTABLE_PAT            - Personal Access Token
 *   AIRTABLE_BASE_ID        - appoYEIpuPKCtRjm5
 *   AIRTABLE_SUPPORT_TABLE  - tblAQF9MxADmATMdg
 *   WEBHOOK_SECRET           - Optionaler Secret Key fuer Authentifizierung
 */

const AIRTABLE_API = 'https://api.airtable.com/v0';

exports.handler = async (event) => {
  // Nur POST erlauben
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Optional: Webhook Secret pruefen
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const authHeader = event.headers['x-webhook-secret'] || event.headers['authorization'];
    if (authHeader !== secret && authHeader !== `Bearer ${secret}`) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  const PAT = process.env.AIRTABLE_PAT;
  const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appoYEIpuPKCtRjm5';
  const TABLE_ID = process.env.AIRTABLE_SUPPORT_TABLE || 'tblAQF9MxADmATMdg';

  if (!PAT) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'AIRTABLE_PAT nicht konfiguriert' })
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Felder fuer Airtable vorbereiten
    // Field IDs aus der Support-Tickets Tabelle:
    const fields = {
      'fldr25eRsbZBdMhBC': body.summary || 'Neue Anfrage',                    // Zusammenfassung
      'fldglfN5JyExgbgpL': body.channel || 'Chatbot',                         // Kanal
      'fldzeUioxXlztmf5p': body.resolved ? 'Beantwortet' : 'Nicht beantwortet', // Status
      'fld9CUc5viC1nrGmx': body.resolved ? 'Erfolgreich' : 'Nicht geloest',   // Ergebnis
      'fldBtmuqAXGsrz6rR': new Date().toISOString(),                          // Datum
      'fldPdaKb4oAYWRb1n': body.transcript || '',                             // Transkript
      'fldnw5Ptg4VsEPtFS': !body.resolved                                     // Rueckruf noetig
    };

    // Optionale Felder
    if (body.contactEmail) {
      fields['fldQkLAe4LK3hPtNr'] = body.contactEmail;                        // Kontakt-Email
    }
    if (body.contactPhone) {
      fields['fldOelZ3onCW8x7r8'] = body.contactPhone;                        // Kontakt-Telefon
    }
    if (body.callDuration) {
      fields['fldAZih1sA9Xss2iH'] = body.callDuration;                        // Anruf-Dauer (Sekunden)
    }

    // Record in Airtable erstellen
    const response = await fetch(`${AIRTABLE_API}/${BASE_ID}/${TABLE_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: [{ fields }],
        typecast: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Airtable Error:', response.status, errorText);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Airtable Fehler', details: errorText })
      };
    }

    const data = await response.json();
    const recordId = data.records[0].id;

    console.log(`Support-Ticket erstellt: ${recordId} (${body.channel}, resolved: ${body.resolved})`);

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        ticketId: recordId,
        message: body.resolved
          ? 'Anfrage wurde beantwortet'
          : 'Ticket erstellt - Rueckruf noetig'
      })
    };

  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Interner Fehler', message: error.message })
    };
  }
};
