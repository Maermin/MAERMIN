// P5-3.4: the FinTS servers the Worker relays to (`action=fints`). Anything
// else is refused, so the relay cannot be used to reach other hosts.
//
// `host` is an exact host name, `hostPattern` a pattern for groups whose banks
// each have their own host (Sparkassen). `url` prefills the app's form; for a
// pattern the user enters the URL their bank publishes. `confirmed` says
// whether the address was checked against a public source (bank help page or
// bank notice) when the list was written (2026-10); the others come from
// open-source FinTS clients and are confirmed on first use with the product id.
// More hosts: the Worker variable FINTS_EXTRA_HOSTS (comma-separated host names).
export const FINTS_BANKS = [
  { id: 'sparkasse', name: 'Sparkasse / Landesbank (s-fints-pt)', hostPattern: '^banking-[a-z0-9]+\\.s-fints-pt-[a-z0-9]+\\.de$', url: '', urlHint: 'https://banking-xx1.s-fints-pt-xx.de/fints30', confirmed: true },
  { id: 'atruvia1', name: 'Volksbanken Raiffeisenbanken, Sparda, PSD (Atruvia fints1)', host: 'fints1.atruvia.de', url: 'https://fints1.atruvia.de/cgi-bin/hbciservlet', confirmed: true },
  { id: 'atruvia2', name: 'Volksbanken Raiffeisenbanken (Atruvia fints2)', host: 'fints2.atruvia.de', url: 'https://fints2.atruvia.de/cgi-bin/hbciservlet', confirmed: true },
  { id: 'dkb', name: 'DKB', host: 'fints.dkb.de', url: 'https://fints.dkb.de/fints', confirmed: true },
  { id: 'comdirect', name: 'comdirect', host: 'fints.comdirect.de', url: 'https://fints.comdirect.de/fints', confirmed: false },
  { id: 'ing', name: 'ING', host: 'fints.ing.de', url: 'https://fints.ing.de/fints/', confirmed: false },
  { id: 'postbank', name: 'Postbank', host: 'hbci.postbank.de', url: 'https://hbci.postbank.de/banking/hbci.do', confirmed: false },
  { id: 'consorsbank', name: 'Consorsbank', host: 'brokerage-hbci.consorsbank.de', url: 'https://brokerage-hbci.consorsbank.de/hbci', confirmed: false },
  { id: 'commerzbank', name: 'Commerzbank', host: 'fints.commerzbank.de', url: 'https://fints.commerzbank.de/fints', confirmed: false }
];

export function extraHosts(env) {
  return String((env && env.FINTS_EXTRA_HOSTS) || '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
}

// → { ok: true, url } (origin + path + query, nothing else) | { ok: false, error }
export function fintsUrlAllowed(raw, env) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return { ok: false, error: 'Invalid url' }; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return { ok: false, error: 'Bank not allowed' };
  const host = u.hostname.toLowerCase();
  const listed = FINTS_BANKS.some((b) => (b.host && b.host === host) || (b.hostPattern && new RegExp(b.hostPattern).test(host)));
  if (!listed && extraHosts(env).indexOf(host) === -1) return { ok: false, error: 'Bank not allowed' };
  return { ok: true, url: u.origin + u.pathname + u.search };
}
