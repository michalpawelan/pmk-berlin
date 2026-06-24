// PMK Berlin — Zgłoszenie-Watchdog
// Geplante Function: pollt die zwei PMK-Agenten, erkennt versprochene Handoffs
// ohne erfolgreichen create_zgloszenie-Tool-Call und erstellt ein als
// "recovered" markiertes Ticket. Reine Detektions-Helfer unten sind für
// scripts/test-watchdog.cjs exportiert.

const HANDOFF_RE = /przekaż|przekaza[łl]|przekazu|zanotuj|notuj[ęe]|odezwie|oddzwoni|weitergeleitet|weitergegeben|leite[^.]{0,25}weiter|melden sich|notiert|i'?ll pass|pass(?:ed)? (?:it|this) on/i;
const SALES_RE = /churchdesk|ofert\w*\s+handlow|współprac|wspolprac|reklam|w imieniu firmy|przedstawiciel handlow|sprzedaż|kooperation|werbung|vertrieb|im auftrag (?:der |des )?firma?/i;
const URGENT_RE = /umieraj|kona\b|intensywn|zagrożenie życia|zagrozenie zycia|namaszcz|ostatnie namaszczenie|reanimacj|sterbe|sterbend|krankensalbung|letzte ölung|nie żyje|zmar[łl]/i;

function agentText(transcript) {
  return (transcript || []).filter(t => t && t.role === 'agent').map(t => t.message || '').join('\n');
}
function allText(transcript) {
  return (transcript || []).map(t => (t && t.message) || '').join('\n');
}
function hasHandoffPromise(transcript) { return HANDOFF_RE.test(agentText(transcript)); }
function isSalesCall(transcript) { return SALES_RE.test(allText(transcript)); }
function isUrgent(transcript) { return URGENT_RE.test(allText(transcript)); }

function hasSuccessfulZgloszenie(transcript) {
  for (const turn of (transcript || [])) {
    for (const r of ((turn && turn.tool_results) || [])) {
      if (r && r.tool_name === 'create_zgloszenie' && r.is_error === false && r.tool_has_been_called === true) {
        return true;
      }
    }
  }
  return false;
}

function detectLostHandoff(convo) {
  const t = (convo && convo.transcript) || [];
  if (!hasHandoffPromise(t)) return { lost: false, reason: 'no_promise' };
  if (hasSuccessfulZgloszenie(t)) return { lost: false, reason: 'tool_succeeded' };
  if (isSalesCall(t)) return { lost: false, reason: 'sales_excluded' };
  return { lost: true, reason: 'promise_without_tool' };
}

function isQuotaFailure(convo) {
  const term = (convo && convo.metadata && convo.metadata.termination_reason) || '';
  return /quota|exceeded\s+quota|rate.?limit/i.test(term);
}

module.exports = {
  detectLostHandoff, hasHandoffPromise, hasSuccessfulZgloszenie,
  isSalesCall, isUrgent, isQuotaFailure,
};
