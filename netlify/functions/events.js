// NICHT MEHR IN VERWENDUNG - Events werden direkt aus Google Sheets geladen.
// Diese Datei kann geloescht werden.
exports.handler = async () => ({
  statusCode: 301,
  headers: { Location: '/' },
  body: 'Events werden jetzt direkt aus Google Sheets geladen.'
});
