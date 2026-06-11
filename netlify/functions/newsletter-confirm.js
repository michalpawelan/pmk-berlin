// PMK Berlin — Newsletter Double-Opt-in: Bestaetigungs-Endpunkt.
// Der Aktivierungslink aus der Bestaetigungsmail zeigt hierher (?token=...).
// Wir rufen das Apps Script (action=confirm) auf und leiten dann auf die Danke-Seite um.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';

function redirect(ok, lang) {
  const l = lang === 'de' ? 'de' : 'pl';
  return {
    statusCode: 302,
    headers: { Location: '/newsletter-potwierdzony.html?ok=' + (ok ? '1' : '0') + '&lang=' + l },
    body: ''
  };
}

exports.handler = async (event) => {
  const token = (event.queryStringParameters && event.queryStringParameters.token) || '';
  const lang = (event.queryStringParameters && event.queryStringParameters.lang) || 'pl';
  if (!token) return redirect(false, lang);

  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('action', 'confirm');
    url.searchParams.set('token', token);
    const res = await fetch(url.toString(), { redirect: 'follow' });
    let data = {};
    try { data = JSON.parse(await res.text()); } catch (_) { data = {}; }
    return redirect(!!(data && data.success), (data && data.lang) || lang);
  } catch (_) {
    return redirect(false, lang);
  }
};
