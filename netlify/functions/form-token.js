// PMK Berlin — Token-Ausgabe fuer die oeffentlichen Formulare.
// Der Browser holt sich beim ersten Klick ins Formular ein kurzlebiges,
// signiertes Token und schickt es beim Absenden mit. Siehe _form-guard.js.
//
// Bewusst ohne Origin-Pruefung: ein Token allein bewirkt nichts (es ist nur ein
// signierter Zeitstempel) und die Pruefung liegt beim POST, der es einloest.
// So kann eine strengere Referrer-Policy im Browser den Ablauf nie blockieren.

const { issueToken } = require('./_form-guard.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({ token: issueToken() })
  };
};
