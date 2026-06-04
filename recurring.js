// ============================================================================
// MAERMIN — Recurring Liabilities  (window.MaerminRecurring)
// ----------------------------------------------------------------------------
// Feature #2: loans / mortgages / any recurring charge that must be reflected
// in the Net-Worth history and in forecasts. Pure date-math scheduling engine —
// no UI, no storage of its own. A "recurring liability" is a NetWorth account
// (maermin_networth_accounts) of a liability type carrying:
//
//   { recurring: true, amount, interval, startDate, endDate? }
//     interval ∈ weekly | biweekly | monthly | quarterly | semiannual | annual
//
// The engine expands the payment schedule between any two dates, so the same
// definition drives "paid so far" (history) and "still to pay" (projection).
// Fully unit-tested in test/recurring.test.js.
// ============================================================================
(function () {
  'use strict';

  var INTERVALS = {
    weekly:     { label: 'Weekly',       perYear: 52 },
    biweekly:   { label: 'Bi-weekly',    perYear: 26 },
    monthly:    { label: 'Monthly',      perYear: 12 },
    quarterly:  { label: 'Quarterly',    perYear: 4 },
    semiannual: { label: 'Semi-annual',  perYear: 2 },
    annual:     { label: 'Annual',       perYear: 1 }
  };

  // Parse an ISO yyyy-mm-dd at UTC midnight (TZ-stable).
  function parseDate(iso) {
    if (iso instanceof Date) return new Date(Date.UTC(iso.getUTCFullYear(), iso.getUTCMonth(), iso.getUTCDate()));
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  function toISODate(d) {
    return d.getUTCFullYear() + '-' +
      ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getUTCDate()).slice(-2);
  }
  function addDays(d, n) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
  }
  // Add months, clamping the day to the target month's last day (Jan 31 +1 → Feb 28/29).
  function addMonths(d, n) {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
  }
  function nextDate(d, interval) {
    switch (interval) {
      case 'weekly':     return addDays(d, 7);
      case 'biweekly':   return addDays(d, 14);
      case 'monthly':    return addMonths(d, 1);
      case 'quarterly':  return addMonths(d, 3);
      case 'semiannual': return addMonths(d, 6);
      case 'annual':     return addMonths(d, 12);
      default:           return addMonths(d, 1);
    }
  }

  function isRecurringLiability(a) {
    return !!(a && a.recurring && a.amount && a.interval && a.startDate);
  }

  // All payment occurrences of one liability within [from, to] (inclusive).
  function expandOccurrences(liab, fromISO, toISO, cap) {
    cap = cap || 5000;
    var amount = parseFloat(liab && liab.amount) || 0;
    var start = parseDate(liab && liab.startDate);
    if (!start || amount <= 0) return [];
    var end = liab.endDate ? parseDate(liab.endDate) : null;
    var from = fromISO ? parseDate(fromISO) : start;
    var to = toISO ? parseDate(toISO) : null;
    var out = [], d = new Date(start), i = 0;
    while (i < cap) {
      if (end && d > end) break;
      if (to && d > to) break;
      if (d >= from) out.push({ date: toISODate(d), amount: amount, liabilityId: liab.id, name: liab.name });
      d = nextDate(d, liab.interval);
      i++;
    }
    return out;
  }

  function sumBetween(liab, fromISO, toISO) {
    return expandOccurrences(liab, fromISO, toISO).reduce(function (s, o) { return s + o.amount; }, 0);
  }

  // Total already paid from startDate up to (and including) asOf.
  function paidToDate(liab, asOfISO) {
    return sumBetween(liab, liab.startDate, asOfISO || toISODate(new Date()));
  }

  // Normalised monthly cost (for quick display / quick net-worth drag).
  function monthlyEquivalent(liab) {
    var amount = parseFloat(liab && liab.amount) || 0;
    var spec = INTERVALS[liab && liab.interval];
    if (!spec) return 0;
    return (amount * spec.perYear) / 12;
  }

  // Merged, date-sorted schedule across many liabilities.
  function scheduleBetween(liabs, fromISO, toISO) {
    var all = [];
    (liabs || []).forEach(function (l) {
      if (isRecurringLiability(l)) all = all.concat(expandOccurrences(l, fromISO, toISO));
    });
    all.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return all;
  }

  // Summary for the Net-Worth view: monthly debt service + what's been paid +
  // what's still scheduled. `liabs` defaults to recurring accounts in storage.
  function loadFromAccounts() {
    try {
      var accts = JSON.parse(localStorage.getItem('maermin_networth_accounts') || '[]');
      return accts.filter(isRecurringLiability);
    } catch (e) { return []; }
  }
  function summary(liabs, asOfISO) {
    liabs = liabs || loadFromAccounts();
    var asOf = asOfISO || toISODate(new Date());
    var monthly = 0, paid = 0, remaining = 0;
    liabs.forEach(function (l) {
      monthly += monthlyEquivalent(l);
      paid += paidToDate(l, asOf);
      if (l.endDate) remaining += sumBetween(l, asOf, l.endDate);
    });
    return {
      count: liabs.length,
      monthlyEquivalent: monthly,
      annualEquivalent: monthly * 12,
      paidToDate: paid,
      remainingScheduled: remaining
    };
  }

  var api = {
    INTERVALS: INTERVALS,
    isRecurringLiability: isRecurringLiability,
    nextDate: nextDate,
    expandOccurrences: expandOccurrences,
    sumBetween: sumBetween,
    paidToDate: paidToDate,
    monthlyEquivalent: monthlyEquivalent,
    scheduleBetween: scheduleBetween,
    loadFromAccounts: loadFromAccounts,
    summary: summary,
    _parseDate: parseDate, _toISODate: toISODate
  };
  if (typeof window !== 'undefined') window.MaerminRecurring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
