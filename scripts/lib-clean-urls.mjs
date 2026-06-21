/**
 * lib-clean-urls.mjs — gemeinsame Transformation „.html-URL → Clean-URL".
 *
 * Regeln:
 *   - index.html  → Verzeichnis:  "/index.html"→"/",  relativ "index.html"→"/"
 *   - 404.html    → bleibt (Netlify-Fallback-Datei, nicht indexiert)
 *   - sonst       → "/foo.html"→"/foo"  (Query/Hash bleiben erhalten)
 *
 * Greift nur, wenn das .html unmittelbar nach einem Pfadsegment steht, das von
 * einem URL-Zeichen ( / " ' ` ) eingeleitet wird → Fließtext wie „siehe foo.html"
 * wird NICHT angefasst. Sicher, weil das Projekt keine externen .html-Links hat
 * (verifiziert) — sonst würde auch https://fremd.de/x.html gekürzt.
 *
 * Wird identisch verwendet von:
 *   - scripts/clean-urls.mjs   (einmaliger Lauf über die statischen Dateien)
 *   - scripts/build-de.mjs     (Endpass jeder generierten /de/-Seite)
 *   - scripts/germanize-de.mjs (Endpass)
 *   - scripts/fix-root-lang.mjs(Endpass)
 */
export function cleanUrls(text) {
  return text.replace(
    /(["'`/])([A-Za-z0-9_-]+)\.html(?=["'`?#<)\s]|$)/g,
    (full, pre, seg) => {
      if (seg === '404') return full;                      // Fehlerseite unangetastet
      if (seg === 'index') return pre === '/' ? pre : pre + '/'; // Verzeichnisform
      return pre + seg;                                    // .html strippen
    }
  );
}
