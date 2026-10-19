// ============================================================================
// MAERMIN v12.0 — Professional Analytics Features
// 1. Net Worth Dashboard          — Vermögen inkl. Cash, Immobilien, Schulden
// 2. Cashflow Chart               — Investiert vs. Portfoliowert über Zeit
// 3. Fee Analyzer                 — fee analysis total, per year, per asset
// ============================================================================
(function () {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

const { useState, useEffect, useMemo, useRef } = React;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function Card({ theme, children, style = {} }) {
  return React.createElement('div', { className: ['ui-card', 'ui-card--pad'].join(' '), style }, children);
}

// R3.2: a KPI is the shared Stat on an answer card; its colour becomes a tone
// (gain / loss / warning) or stays neutral.
function KpiCard({ theme, label, value, sub, color, badge }) {
  const UIC = window.MaerminComponents;
  const tone = !color ? null : color === theme.success ? 'gain' : color === theme.danger ? 'loss' : color === theme.warning ? 'warning' : color === theme.info ? 'income' : null;
  return React.createElement(UIC.Card, { variant: 'answer', className: 'ui-kpi' },
    React.createElement(UIC.Stat, {
      label: badge ? React.createElement(React.Fragment, null, label, ' ', React.createElement(UIC.Badge, { tone: badge.pos ? 'gain' : 'loss' }, badge.text)) : label,
      value, sub, tone
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. NET WORTH DASHBOARD
// Adds cash accounts, property, and liabilities to the portfolio value
// ─────────────────────────────────────────────────────────────────────────────
function NetWorthView({ portfolioStats, portfolio, prices, theme, formatPrice, getCurrencySymbol, t, usdToEur, cashEUR }) {
  t = t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
  const rate = usdToEur || (prices && prices.usdToEur) || 1;
  const [accounts, setAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_networth_accounts') || '[]'); } catch { return []; }
  });
  // Bumped when the Real Assets panel mutates its store, so net worth recomputes.
  const [raVersion, setRaVersion] = useState(0);
  const [showAdd, setShowAdd]   = useState(false);
  const [form, setForm]         = useState({ name: '', value: '', type: 'cash', currency: 'EUR',
    recurring: false, amount: '', interval: 'monthly', startDate: window.MaerminUtils.todayISO(), endDate: '',
    interestRate: '', compounding: 'daily', interestStart: window.MaerminUtils.todayISO(), maturityDate: '', interestPayout: 'maturity' });

  useEffect(() => { localStorage.setItem('maermin_networth_accounts', JSON.stringify(accounts)); }, [accounts]);
  if (window.MaerminTrash) window.MaerminTrash.useReload('maermin_networth_accounts', () => {
    try { setAccounts(JSON.parse(localStorage.getItem('maermin_networth_accounts') || '[]')); } catch (e) { /* keep */ }
  });

  const TYPES = {
    cash:      { label: __('nwCash', 'Cash / Savings'),   color: 'var(--gain)', icon: '◈' },
    time_deposit: { label: __('nwTimeDeposit', 'Time Deposit (Festgeld)'), color: 'var(--chart-5)', icon: '◷' },
    checking:  { label: __('nwChecking', 'Checking Account'), color: 'var(--chart-2)', icon: '◆' },
    property:  { label: __('nwProperty', 'Real Estate'),      color: 'var(--warning)', icon: '◉' },
    crypto_wallet: { label: __('nwCryptoWallet', 'Crypto Wallet'), color: 'var(--chart-1)', icon: '◎' },
    other_asset: { label: __('nwOtherAsset', 'Other Asset'),    color: 'var(--chart-3)', icon: '◇' },
    loan:      { label: __('nwLoan', 'Loan / Mortgage'),  color: 'var(--loss)', icon: '◐' },
    credit:    { label: __('nwCredit', 'Credit Card'),      color: 'var(--loss)', icon: '◑' },
    other_liability: { label: __('nwOtherLiability', 'Other Liability'), color: 'var(--loss)', icon: '◒' },
  };

  const LIABILITIES = new Set(['loan','credit','other_liability']);

  // Net worth comes from the shared metric (single source of truth — see metrics.js),
  // with an inline fallback if that module hasn't loaded.
  // P5-1.4: the portfolio's clearing account counts with the investments
  const portfolioValue   = portfolioStats.totalValue + (Number(cashEUR) || 0);
  // Gross EUR value of tracked real assets (WI-1) — financing stays a liability
  // account, so only the gross value flows in (no double-count). raVersion forces
  // a recompute when the panel edits the store.
  const realAssetsValue = (window.MaerminRealAssets)
    ? window.MaerminRealAssets.aggregate(window.MaerminRealAssets.load(), accounts, rate).grossValue
    : 0;
  void raVersion;
  const nw = window.MaerminMetrics
    ? window.MaerminMetrics.computeNetWorth(portfolioValue, accounts, realAssetsValue)
    : {
        manualAssets: accounts.filter(a => !LIABILITIES.has(a.type)).reduce((s,a) => s + parseFloat(a.value||0), 0) + realAssetsValue,
        liabilities:  accounts.filter(a =>  LIABILITIES.has(a.type)).reduce((s,a) => s + parseFloat(a.value||0), 0),
      };
  const totalAssets      = nw.manualAssets;
  const totalLiabilities = nw.liabilities;
  const netWorth         = portfolioValue + totalAssets - totalLiabilities;

  const isLiabilityType = (tp) => LIABILITIES.has(tp);

  const addAccount = () => {
    // A recurring liability may have no upfront balance (value), so require
    // either a value OR a recurring amount on liability rows.
    const wantsRecurring = isLiabilityType(form.type) && form.recurring && parseFloat(form.amount) > 0;
    if (!form.name || (!form.value && !wantsRecurring)) return;
    const account = {
      id: Date.now().toString(),
      name: form.name,
      type: form.type,
      currency: form.currency,
      value: parseFloat(form.value) || 0,
    };
    // Interest-bearing cash / time deposit (WI-2): persist rate + accrual anchors
    // so MaerminInterest.runCatchUp grows the balance and reports capital income.
    const INTEREST_TYPES = new Set(['cash', 'checking', 'time_deposit']);
    if (INTEREST_TYPES.has(form.type) && parseFloat(form.interestRate) > 0) {
      account.interestRate = parseFloat(form.interestRate);
      account.compounding = form.compounding || 'daily';
      account.startDate = form.interestStart || window.MaerminUtils.todayISO();
      account.lastAccrualDate = account.startDate;
      if (form.type === 'time_deposit' && form.maturityDate) account.maturityDate = form.maturityDate;
      // Festgeld interest is income when it is paid (FINDINGS M-3): at maturity by default.
      if (form.type === 'time_deposit') account.interestPayout = form.interestPayout === 'annual' ? 'annual' : 'maturity';
    }
    if (wantsRecurring) {
      account.recurring = true;
      account.amount = parseFloat(form.amount);
      account.interval = form.interval;
      account.startDate = form.startDate;
      account.endDate = form.endDate || null;
    }
    setAccounts(prev => [...prev, account]);
    setForm({ name: '', value: '', type: 'cash', currency: 'EUR',
      recurring: false, amount: '', interval: 'monthly', startDate: window.MaerminUtils.todayISO(), endDate: '',
      interestRate: '', compounding: 'daily', interestStart: window.MaerminUtils.todayISO(), maturityDate: '', interestPayout: 'maturity' });
    setShowAdd(false);
  };

  // Debt-service summary across all recurring liabilities (engine: MaerminRecurring).
  const recurringSummary = (window.MaerminRecurring && accounts.length)
    ? window.MaerminRecurring.summary(accounts.filter(a => window.MaerminRecurring.isRecurringLiability(a)))
    : null;

  const inp = (field, props = {}) => React.createElement('input', {
    value: form[field], onChange: e => setForm(p => ({ ...p, [field]: e.target.value })),
    className: 'ui-input',
    ...props
  });

  // Net worth bar: split into portfolio | cash | property | liabilities
  const barTotal = netWorth > 0 ? netWorth + totalLiabilities : 1;

  const UIC = window.MaerminComponents;
  return React.createElement('div', { className: 'ui-view' },
    // R3.2: the title is in the page header; here the lead line and the view's own action
    React.createElement('div', { className: 'ui-view__bar' },
      React.createElement('p', { className: 'ui-view__lead' }, __('nwSubtitle', 'Total wealth including investments, cash accounts, real estate and liabilities')),
      React.createElement(UIC.Button, { onClick: () => setShowAdd(!showAdd), 'aria-expanded': showAdd }, __('nwAddAccount', '+ Add Account'))
    ),

    // KPI row
    React.createElement('div', { className: 'ui-ov-tiles' },
      React.createElement(KpiCard, { theme, label: __('nwTitle', 'Net Worth'), value: `${formatPrice(netWorth)} ${getCurrencySymbol()}`, color: netWorth >= 0 ? theme.success : theme.danger }),
      React.createElement(KpiCard, { theme, label: __('nwInvestPortfolio', 'Investment Portfolio'), value: `${formatPrice(portfolioValue)} ${getCurrencySymbol()}`,
        badge: { pos: true, text: window.MaerminI18n.pct(portfolioValue / (netWorth + totalLiabilities) * 100, 0) } }),
      React.createElement(KpiCard, { theme, label: __('nwCashOther', 'Cash & Other Assets'), value: `${formatPrice(totalAssets)} ${getCurrencySymbol()}` }),
      React.createElement(KpiCard, { theme, label: __('nwTotalLiab', 'Total Liabilities'), value: `${formatPrice(totalLiabilities)} ${getCurrencySymbol()}`, color: totalLiabilities > 0 ? theme.danger : theme.text }),
      recurringSummary && recurringSummary.count > 0 && React.createElement(KpiCard, { theme,
        label: __('nwDebtService', 'Monthly Debt Service'),
        value: `${formatPrice(recurringSummary.monthlyEquivalent)} ${getCurrencySymbol()}`,
        color: theme.warning }),
    ),

    // Visual net worth bar
    // R5.4: shared Card titles, fields and rows; the bar widths stay inline (computed)
    netWorth > 0 && React.createElement(window.MaerminComponents.Card, { title: __('nwComposition', 'Wealth Composition') },
      React.createElement('div', { className: 'ui-nw-bar' },
        [
          { value: portfolioValue, color: 'var(--chart-1)', label: __('portfolio', 'Portfolio') },
          { value: totalAssets,    color: 'var(--chart-2)', label: __('nwCashAssets', 'Cash & Assets') },
        ].filter(s => s.value > 0).map((s, i) =>
          React.createElement('div', { key: i, title: `${s.label}: ${formatPrice(s.value)}`,
            className: 'ui-nw-bar__seg', style: { width: `${s.value / barTotal * 100}%`, background: s.color } })
        )
      ),
      React.createElement('ul', { className: 'ui-chart__legend' },
        [{ label: __('portfolio', 'Portfolio'), color: 'var(--chart-1)', value: portfolioValue },
         { label: __('nwCashAssets', 'Cash & Assets'), color: 'var(--chart-2)', value: totalAssets },
         { label: __('nwLiabilities', 'Liabilities'), color: 'var(--loss)', value: -totalLiabilities }].map((s, i) =>
          React.createElement('li', { key: i },
            React.createElement('span', { className: ['ui-cat-dot', 'is-round'].join(' '), 'aria-hidden': 'true', style: { background: s.color } }),
            s.label,
            React.createElement('b', { className: s.value >= 0 ? 'num' : ['num', 'tone-loss'].join(' ') }, `${s.value >= 0 ? '' : '−'}${formatPrice(Math.abs(s.value))} ${getCurrencySymbol()}`)
          )
        )
      )
    ),

    // Real Assets & Property (WI-1) — property/valuables with valuation history,
    // financing link and rental cashflows. Folds in as a Net-Worth section.
    window.MaerminRealAssets && React.createElement(window.MaerminRealAssets.Panel, {
      theme, t, accounts, prices, usdToEur: rate, formatPrice, getCurrencySymbol,
      onChange: () => setRaVersion(v => v + 1)
    }),

    // Whole-wealth projection (#6) — net worth forward under 3 scenarios,
    // composing savings plans + dividends + recurring liabilities + expenses.
    // This is the total-wealth home for the projection (the per-portfolio one
    // lives in Savings Plans). Engine: window.MaerminProjection.
    netWorth > 0 && window.MaerminProjection && React.createElement(window.MaerminProjection.Panel, {
      startValue: netWorth,
      savingsPlans: (() => { try { return JSON.parse(localStorage.getItem('maermin_savings_plans') || '[]'); } catch { return []; } })(),
      dividendYield: (window.MaerminMetrics && portfolio)
        ? ((window.MaerminMetrics.computeExpectedAnnualDividends(portfolio, prices || {}, { exchangeRate: usdToEur }).yield || 0) / 100)
        : 0,
      liabilities: window.MaerminRecurring ? window.MaerminRecurring.loadFromAccounts() : [],
      theme, formatPrice, getCurrencySymbol,
      scopeLabel: __('nwTitle', 'Net Worth')
    }),

    // Add account form
    showAdd && React.createElement(window.MaerminComponents.Card, { title: __('nwAddTitle', 'Add Account or Liability'), className: ['ui-nw-form', 'is-on'].join(' ') },
      React.createElement('div', { className: ['ui-iv-form', 'is-grid'].join(' ') },
        React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('nwName', 'Name')),
          inp('name', { placeholder: __('nwNamePh', 'e.g. ING Tagesgeld, Mortgage...') })
        ),
        React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('type', 'Type')),
          React.createElement('select', { value: form.type, onChange: e => setForm(p => ({ ...p, type: e.target.value })),
            className: ['ui-input', 'ui-select'].join(' ')
          }, Object.entries(TYPES).map(([v, t]) => React.createElement('option', { key: v, value: v }, t.label)))
        ),
        React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, isLiabilityType(form.type) ? __('nwCurrentBalance', 'Current balance ({cur})', { cur: getCurrencySymbol() }) : __('nwValueCur', 'Value ({cur})', { cur: getCurrencySymbol() })),
          inp('value', { type: 'number', placeholder: isLiabilityType(form.type) ? __('nwOutstandingPh', 'outstanding (optional)') : '10000' })
        )
      ),

      // Interest schedule (WI-2) — for cash / checking / time deposits.
      ['cash','checking','time_deposit'].includes(form.type) && React.createElement('fieldset', { className: 'ui-nw-sub' },
        React.createElement('legend', null, t.interestSection || 'Interest (optional)'),
        React.createElement('div', { className: ['ui-iv-form', 'is-grid'].join(' ') },
          React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, t.interestRate || 'Rate (% p.a.)'),
            inp('interestRate', { type: 'number', placeholder: '2.5' })
          ),
          React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, t.interestCompounding || 'Compounding'),
            React.createElement('select', { value: form.compounding, onChange: e => setForm(p => ({ ...p, compounding: e.target.value })),
              className: ['ui-input', 'ui-select'].join(' ')
            }, [['daily', t.compDaily || 'Daily'], ['monthly', t.compMonthly || 'Monthly'], ['annual', t.compAnnual || 'Annual']].map(([v, l]) => React.createElement('option', { key: v, value: v }, l)))
          ),
          React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, t.interestStartDate || 'Interest start'),
            inp('interestStart', { type: 'date' })
          ),
          form.type === 'time_deposit' && React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, t.interestMaturity || 'Maturity date'),
            inp('maturityDate', { type: 'date' })
          ),
          form.type === 'time_deposit' && React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, t.interestPayout || 'Interest paid'),
            React.createElement('select', { value: form.interestPayout || 'maturity', onChange: e => setForm(p => ({ ...p, interestPayout: e.target.value })),
              className: ['ui-input', 'ui-select'].join(' ')
            }, [['maturity', t.interestPayoutMaturity || 'At maturity'], ['annual', t.interestPayoutAnnual || 'Every year']].map(([v, l]) => React.createElement('option', { key: v, value: v }, l)))
          )
        )
      ),

      // Recurring liability schedule — only for loan/credit/other_liability types.
      isLiabilityType(form.type) && React.createElement('div', { className: 'ui-nw-sub' },
        React.createElement('label', { className: 'ui-rc-kit__check' },
          React.createElement('input', { type: 'checkbox', checked: form.recurring, onChange: e => setForm(p => ({ ...p, recurring: e.target.checked })), className: 'ui-st-check' }),
          React.createElement('span', null, __('nwRecurring', 'Recurring payment (loan / mortgage instalment)'))
        ),
        form.recurring && React.createElement('div', { className: ['ui-iv-form', 'is-grid'].join(' ') },
          React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, __('nwPaymentCur', 'Payment ({cur})', { cur: getCurrencySymbol() })),
            inp('amount', { type: 'number', placeholder: '1200' })
          ),
          React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, __('nwInterval', 'Interval')),
            React.createElement('select', { value: form.interval, onChange: e => setForm(p => ({ ...p, interval: e.target.value })),
              className: ['ui-input', 'ui-select'].join(' ')
            }, Object.entries((window.MaerminRecurring && window.MaerminRecurring.INTERVALS) || { monthly: { label: __('freqMonthly', 'Monthly') } }).map(([v]) => React.createElement('option', { key: v, value: v }, window.MaerminI18n.freq(v))))
          ),
          React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, __('nwStartDate', 'Start date')),
            inp('startDate', { type: 'date' })
          ),
          React.createElement('div', null,
            React.createElement('label', { className: 'ui-field__label' }, __('nwEndDateOpt', 'End date (optional)')),
            inp('endDate', { type: 'date' })
          )
        )
      ),
      React.createElement('div', { className: 'ui-actions' },
        React.createElement(UIC.Button, { variant: 'primary', onClick: addAccount }, __('add', 'Add')),
        React.createElement(UIC.Button, { variant: 'quiet', onClick: () => setShowAdd(false) }, __('cancel', 'Cancel'))
      )
    ),

    // Account list
    accounts.length > 0 && React.createElement(window.MaerminComponents.Card, { title: __('nwAccountsTitle', 'Accounts & Liabilities') },
      React.createElement('div', { className: 'ui-nw-list' },
        accounts.map(acc => {
          const typeInfo = TYPES[acc.type] || TYPES.other_asset;
          const isLiability = LIABILITIES.has(acc.type);
          return React.createElement('div', { key: acc.id, className: 'ui-acct' },
            React.createElement('div', { className: 'ui-acct__main' },
              React.createElement('span', { className: 'ui-acct__icon', 'aria-hidden': 'true', style: { color: typeInfo.color } }, typeInfo.icon),
              React.createElement('div', { className: 'ui-rows__main' },
                React.createElement('b', null, acc.name),
                React.createElement('span', null,
                  typeInfo.label
                  + (acc.interestRate > 0 ? `  ·  ${acc.interestRate}% ${t.interestPa || 'p.a.'}` : '')
                  + (acc.maturityDate ? `  ·  ${t.interestMatures || 'matures'} ${acc.maturityDate}` : ''))
              )
            ),
            React.createElement('div', { className: 'ui-acct__side' },
              React.createElement('span', { className: 'num ' + (isLiability ? 'tone-loss' : 'tone-gain') },
                `${isLiability ? '−' : '+'}${formatPrice(acc.value)} ${getCurrencySymbol()}`
              ),
              React.createElement('button', { onClick: () => window.MaerminUtils.confirmThen({
                  title: (t.nwRemoveTitle || 'Remove the account "{name}"?').replace('{name}', acc.name),
                  message: t.nwRemoveMessage || 'Its value leaves your net worth. It stays in the trash for 30 days.',
                  confirmLabel: t.remove || 'Remove', cancelLabel: t.cancel || 'Cancel'
                }, () => {
                  setAccounts(prev => prev.filter(a => a.id !== acc.id));
                  if (window.MaerminTrash) window.MaerminTrash.trashed('account', acc.name, acc);
                }),
                'aria-label': (t.nwRemoveAria || 'Remove account {name}').replace('{name}', acc.name),
                type: 'button', className: ['ui-icon-btn', 'ui-icon-btn--sm'].join(' ')
              }, React.createElement('span', { 'aria-hidden': 'true' }, '×'))
            )
          );
        })
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CASHFLOW CHART
// Shows two lines: cumulative invested (from transactions, in EUR at each trade
// date) vs portfolio value (the daily value path; per-refresh priceHistory only
// as the fallback). Gap between lines = unrealized P&L at any point in time.
// AUDIT BUG-034: the value line came from refresh points only, so with daily
// closes but few refreshes it read 0 € / -100 %, and USD trades were added as EUR.
// ─────────────────────────────────────────────────────────────────────────────
function CashflowChart({ transactions, priceHistory, portfolio, prices, theme, formatPrice, getCurrencySymbol, valuePath, exchangeRate, fxAt }) {
  // Build cumulative invested timeline from transactions
  const investedSeries = useMemo(() => {
    const FX = window.MaerminFxHistory, U = window.MaerminUtils;
    const eur = (amt, tx) => (FX && FX.txToEUR) ? FX.txToEUR(amt, tx.currency || 'EUR', tx.date, exchangeRate, fxAt).value
      : (U ? U.toEUR(amt, tx.currency || 'EUR', exchangeRate) : amt);
    const sorted = [...transactions]
      .filter(tx => (tx.type === 'buy' || tx.type === 'sell') && tx.category !== 'options')
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    let cumulative = 0;
    const points = [];
    sorted.forEach(tx => {
      const amount = eur((parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0), tx);
      cumulative += tx.type === 'buy' ? amount : -amount;
      points.push({ date: tx.date, value: Math.max(0, cumulative) });
    });
    return points;
  }, [transactions, exchangeRate, fxAt]);

  // Build portfolio value timeline: the daily value path when there is one
  const valueSeries = useMemo(() => {
    if (valuePath && Array.isArray(valuePath.points) && valuePath.points.length > 1) {
      return valuePath.points.filter(p => p.v > 0).map(p => ({ date: p.d, value: p.v }));
    }
    // Only datable points (ISO/epoch); sort chronologically, not as strings.
    const tsOf = (v) => (window.MaerminUtils && window.MaerminUtils.parseTimestamp) ? window.MaerminUtils.parseTimestamp(v) : new Date(v).getTime();
    const tsSet = new Set();
    Object.values(priceHistory).forEach(hist => (hist || []).forEach(h => { const n = tsOf(h.timestamp); if (isFinite(n)) tsSet.add(n); }));
    const sorted = [...tsSet].sort((a, b) => a - b);

    const positions = [];
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        positions.push({ sym: (pos.symbol || pos.name || '').toLowerCase(), amount: pos.amount || 0 });
      });
    });

    return sorted.map(ts => {
      let value = 0;
      positions.forEach(pos => {
        const hist = priceHistory[pos.sym] || [];
        const entry = [...hist].reverse().find(h => { const n = tsOf(h.timestamp); return isFinite(n) && n <= ts; });
        if (entry) value += pos.amount * entry.price;
        // A holding with no price history at all (never quoted) is carried at
        // the effective price - its cost basis - instead of dropping out of
        // the value line and reading as a loss against "Invested".
        else if (!hist.length && prices && prices[pos.sym] > 0) value += pos.amount * prices[pos.sym];
      });
      return { date: new Date(ts).toISOString().slice(0, 10), value };
    }).filter(d => d.value > 0);
  }, [priceHistory, portfolio, prices, valuePath]);

  if (investedSeries.length < 2 && valueSeries.length < 2) {
    // R5.2: the shared empty state
    return window.MaerminUtils.emptyState({ testid: 'cf-empty', text: __('cfEmpty', 'Add transactions and refresh prices a few times to see your cashflow chart') });
  }

  // Merge into single timeline for chart
  const allDates = [...new Set([
    ...investedSeries.map(p => p.date),
    ...valueSeries.map(p => p.date)
  ])].sort();

  // Forward-fill values
  const chartData = allDates.map(date => {
    const inv = [...investedSeries].reverse().find(p => p.date <= date);
    const val = [...valueSeries].reverse().find(p => p.date <= date);
    return { date, invested: inv?.value ?? 0, value: val?.value ?? 0 };
  }).filter(d => d.invested > 0 || d.value > 0);

  if (chartData.length < 2) return null;

  const W = 600, H = 200, PAD = { t: 16, r: 16, b: 32, l: 64 };
  const allVals   = chartData.flatMap(d => [d.invested, d.value]).filter(v => v > 0);
  const minV      = Math.min(...allVals) * 0.98;
  const maxV      = Math.max(...allVals) * 1.02;
  const range     = maxV - minV || 1;
  const toX       = i => PAD.l + (i / (chartData.length - 1)) * (W - PAD.l - PAD.r);
  const toY       = v => PAD.t + (1 - (v - minV) / range) * (H - PAD.t - PAD.b);

  const invPts   = chartData.map((d, i) => `${toX(i)},${toY(d.invested)}`).join(' ');
  const valPts   = chartData.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const lastInv  = chartData[chartData.length - 1].invested;
  const lastVal  = chartData[chartData.length - 1].value;
  const pnl      = lastVal - lastInv;
  const pnlPct   = lastInv > 0 ? (pnl / lastInv) * 100 : 0;
  const isUp     = pnl >= 0;

  // x-axis labels: first, mid, last
  const xIdxs = [0, Math.floor(chartData.length / 2), chartData.length - 1];
  // R4.5: the shared ChartFrame (a word legend, "Show as table"); the value on
  // the chart palette, the gap between the lines tinted by the signed result.
  const UIC = window.MaerminComponents;
  const I = window.MaerminI18n;
  const money = (v) => `${formatPrice(v)} ${getCurrencySymbol()}`;
  const step = Math.max(1, Math.ceil(chartData.length / 12));
  const tableRows = chartData.filter((d, i) => i % step === 0 || i === chartData.length - 1);

  return React.createElement(UIC.ChartFrame, {
    'data-testid': 'cashflow-chart', className: 'ui-cf',
    title: __('cfTitle', 'Cash Flow — Invested vs. Portfolio Value'),
    action: React.createElement(UIC.ToneChip, { value: pnl, text: `${isUp ? '+' : '−'}${formatPrice(Math.abs(pnl))} (${I.pct(pnlPct, 1, true)})` }),
    summary: __('cfAria', 'Invested and portfolio value over time: {inv} invested, value {val}', { inv: money(lastInv), val: money(lastVal) }),
    legend: [
      { series: 'dim', label: __('cfNetInvestedLegend', 'Net invested: {amount}', { amount: money(lastInv) }) },
      { series: '1', label: __('cfValueLegend', 'Value: {amount}', { amount: money(lastVal) }) }
    ],
    table: {
      rows: tableRows, rowKey: (r) => r.date,
      columns: [
        { key: 'date', label: __('date', 'Date'), render: (r) => I.date(r.date) },
        { key: 'invested', label: __('cfNetInvested', 'Net invested'), align: 'right', render: (r) => money(r.invested) },
        { key: 'value', label: __('cfValue', 'Value'), align: 'right', render: (r) => money(r.value) }
      ]
    }
  },
    React.createElement('svg', { viewBox: `0 0 ${W} ${H}`, className: 'ui-cf__svg', 'aria-hidden': 'true' },
      // Grid
      [minV, (minV + maxV) / 2, maxV].map((v, i) =>
        React.createElement(React.Fragment, { key: i },
          React.createElement('line', { x1: PAD.l, y1: toY(v), x2: W - PAD.r, y2: toY(v), className: 'ui-pj__grid', strokeDasharray: '4,4' }),
          React.createElement('text', { x: PAD.l - 6, y: toY(v) + 4, textAnchor: 'end', className: 'ui-pj__axis', fontSize: 10 }, formatPrice(v))
        )
      ),
      // Area between lines (P&L fill)
      React.createElement('polygon', {
        points: `${chartData.map((d,i) => `${toX(i)},${toY(d.invested)}`).join(' ')} ${chartData.map((d,i) => `${toX(chartData.length-1-i)},${toY(chartData[chartData.length-1-i].value)}`).join(' ')}`,
        className: ['ui-cf__gap', isUp ? 'is-gain' : 'is-loss'].join(' ')
      }),
      // Invested line (dashed)
      React.createElement('polyline', { points: invPts, fill: 'none', className: 'ui-cf__invested', strokeWidth: 1.5, strokeDasharray: '5,3' }),
      // Value line
      React.createElement('polyline', { points: valPts, fill: 'none', className: 'ui-cf__value', strokeWidth: 2, strokeLinejoin: 'round' }),
      // X axis labels
      xIdxs.map(i =>
        // VIS-020: the last label ends at the edge instead of being cut
        React.createElement('text', { key: i, x: toX(i), y: H - 4, textAnchor: i === chartData.length - 1 ? 'end' : i === 0 ? 'start' : 'middle', className: 'ui-pj__axis', fontSize: 10 },
          I.date(chartData[i].date)
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FEE ANALYZER
// Total fees, fee rate, by year, by category, by exchange/broker
// ─────────────────────────────────────────────────────────────────────────────
function FeeAnalyzer({ transactions, theme, formatPrice, getCurrencySymbol, exchangeRate, fxAt, extra }) {
  // Fees and trade values in EUR at the rate of the trade date: a USD trade
  // was summed and shown as if its amounts were EUR (AUDIT BUG-033).
  const eurOf = useMemo(() => {
    const FX = window.MaerminFxHistory, U = window.MaerminUtils;
    return (amount, tx) => {
      const a = parseFloat(amount) || 0;
      if (!a) return 0;
      if (FX && FX.txToEUR) return FX.txToEUR(a, tx.currency || 'EUR', tx.date, exchangeRate, fxAt).value;
      return U ? U.toEUR(a, tx.currency || 'EUR', exchangeRate) : a;
    };
  }, [exchangeRate, fxAt]);
  // P5-1.3: a stand-alone fee booking counts with its amount, a fee refund
  // against it (category "Account").
  const feeOf = (tx) => tx.type === 'fee' ? eurOf(tx.amount, tx) : tx.type === 'fee_refund' ? -eurOf(tx.amount, tx) : eurOf(tx.fees, tx);
  const tradeOf = (tx) => eurOf((parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0), tx);
  const stats = useMemo(() => {
    const feeTxs = transactions.filter(tx => (parseFloat(tx.fees) || 0) > 0 || ((tx.type === 'fee' || tx.type === 'fee_refund') && (parseFloat(tx.amount) || 0) > 0));
    const totalFees    = feeTxs.reduce((s, tx) => s + feeOf(tx), 0);
    const totalInvested = transactions.filter(tx => tx.type === 'buy')
      .reduce((s, tx) => s + tradeOf(tx), 0);
    const feeRate      = totalInvested > 0 ? (totalFees / totalInvested) * 100 : 0;

    // By year
    const byYear = {};
    feeTxs.forEach(tx => {
      const y = (tx.date || '').substring(0, 4) || 'Unknown';
      if (!byYear[y]) byYear[y] = { fees: 0, count: 0 };
      byYear[y].fees  += feeOf(tx);
      byYear[y].count += 1;
    });

    // By category
    const byCategory = {};
    feeTxs.forEach(tx => {
      const cat = tx.category || 'crypto';
      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat] += feeOf(tx);
    });

    // By exchange/broker (from tx.notes — first word)
    const byBroker = {};
    feeTxs.forEach(tx => {
      const note  = (tx.notes || '').trim();
      const broker = note.split(/[\s·]/)[0] || 'Unknown';
      if (!byBroker[broker]) byBroker[broker] = 0;
      byBroker[broker] += feeOf(tx);
    });

    // Average fee per transaction
    const avgFee = feeTxs.length > 0 ? totalFees / feeTxs.length : 0;

    return { totalFees, totalInvested, feeRate, byYear, byCategory, byBroker, avgFee, txCount: feeTxs.length };
  }, [transactions, eurOf]);

  // R4.3: the categorical chart palette; fees are costs, so no gain / loss colour without a sign
  const CAT_COLORS = { crypto: 'var(--chart-3)', stocks: 'var(--chart-1)', skins: 'var(--chart-2)', commodities: 'var(--chart-4)' };
  const UIC = window.MaerminComponents;
  const money = (v) => `${formatPrice(v)} ${getCurrencySymbol()}`;

  const maxYear = Math.max(...Object.values(stats.byYear).map(y => y.fees), 1);

  return React.createElement('div', { className: 'ui-view', 'data-testid': 'fees-view' },
    React.createElement('p', { className: 'ui-view__lead' }, __('feeSubtitle', 'Total cost of investing — transaction fees, exchange fees, and more')),

    // KPIs
    React.createElement('div', { className: 'ui-ov-tiles' },
      React.createElement(KpiCard, { theme, label: __('feeTotalPaid', 'Total Fees Paid'), value: money(stats.totalFees) }),
      React.createElement(KpiCard, { theme, label: __('feeRate', 'Fee Rate'), value: window.MaerminI18n.pct(stats.feeRate, 3), sub: __('feeRateSub', '% of total invested') }),
      React.createElement(KpiCard, { theme, label: __('feeAvgPerTrade', 'Avg Fee / Trade'), value: `${formatPrice(stats.avgFee)} ${getCurrencySymbol()}` }),
      React.createElement(KpiCard, { theme, label: __('feeTxWithFees', 'Transactions with Fees'), value: stats.txCount }),
    ),

    stats.totalFees === 0
      ? React.createElement(Card, { theme },
          React.createElement('p', { className: 'ui-muted' }, __('feeEmpty', 'No fees recorded in your transactions yet. Add fees when entering transactions.'))
        )
      : React.createElement('div', { className: 'ui-grid-2' },

          // By Year
          React.createElement(UIC.Card, { title: __('feeByYear', 'Fees by Year'), headingLevel: 'h3', 'data-testid': 'fee-by-year' },
            React.createElement('ul', { className: 'ui-meters' },
              Object.entries(stats.byYear).sort((a,b) => b[0].localeCompare(a[0])).map(([year, data]) =>
                React.createElement('li', { key: year },
                  React.createElement('span', { className: 'ui-meters__label' }, React.createElement('b', null, year), React.createElement('b', { className: 'num' }, money(data.fees))),
                  React.createElement('span', { className: 'ui-meter', 'aria-hidden': 'true' },
                    React.createElement('span', { className: 'ui-meter__fill', style: { width: `${data.fees / maxYear * 100}%` } }))
                )
              )
            )
          ),

          // By Category
          React.createElement(UIC.Card, { title: __('feeByClass', 'Fees by Asset Class'), headingLevel: 'h3', 'data-testid': 'fee-by-class' },
            React.createElement('ul', { className: 'ui-meters' },
              Object.entries(stats.byCategory).sort((a,b) => b[1]-a[1]).map(([cat, fees]) => {
                const pct = stats.totalFees > 0 ? fees / stats.totalFees * 100 : 0;
                const color = CAT_COLORS[cat] || 'var(--chart-5)';
                return React.createElement('li', { key: cat },
                  React.createElement('span', { className: 'ui-meters__label' },
                    React.createElement('b', null, window.MaerminI18n.category(cat)),
                    React.createElement('span', { className: 'num' }, window.MaerminI18n.pct(pct, 1) + ' · ', React.createElement('b', null, money(fees)))),
                  React.createElement('span', { className: 'ui-meter', 'aria-hidden': 'true' },
                    React.createElement('span', { className: 'ui-meter__fill', style: { width: `${pct}%`, background: color } }))
                );
              })
            )
          ),

          // Top cost items
          // Full row in any column count ('span 2' forced a second column on phones).
          React.createElement(UIC.Card, { title: __('feeMostExpensive', 'Most Expensive Transactions'), headingLevel: 'h3', className: ['ui-card--table', 'ui-span-all'].join(' '), 'data-testid': 'fee-top' },
            React.createElement('div', { className: 'ui-table-wrap' },
              React.createElement('table', { className: ['ui-table', 'ui-table--dense'].join(' ') },
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    [__('date', 'Date'), __('symbol', 'Symbol'), __('type', 'Type'), __('feeTradeValue', 'Trade Value'), __('feeFee', 'Fee'), __('feePct', 'Fee %')].map((h, i) =>
                      React.createElement('th', { key: i, scope: 'col', className: i > 2 ? 'is-right' : 'is-left' }, h)
                    )
                  )
                ),
                React.createElement('tbody', null,
                  [...transactions]
                    .filter(tx => (parseFloat(tx.fees) || 0) > 0)
                    .sort((a, b) => feeOf(b) - feeOf(a))
                    .slice(0, 10)
                    .map((tx, i) => {
                      const fee      = feeOf(tx);
                      const trade    = tradeOf(tx);
                      const feeRate  = trade > 0 ? window.MaerminI18n.pct(fee / trade * 100, 3) : '—';
                      // the type as the Transactions list shows it (badge in words)
                      return React.createElement('tr', { key: i },
                        React.createElement('td', { className: 'is-left' }, window.MaerminI18n.date(tx.date)),
                        React.createElement('td', { className: ['is-left', 'is-strong'].join(' ') }, tx.symbol),
                        React.createElement('td', { className: 'is-left' },
                          React.createElement('span', { className: 'ui-txtype', 'data-tone': tx.type === 'buy' ? 'in' : tx.type === 'sell' ? 'out' : undefined }, window.MaerminUtils.txTypeInfo(tx.type).label)
                        ),
                        React.createElement('td', null, money(trade)),
                        React.createElement('td', { className: 'is-strong' }, money(fee)),
                        React.createElement('td', null, feeRate)
                      );
                    })
                )
              )
            )
          )
        ),
    extra || null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
window.MaerminFeatures5 = {
  NetWorthView,
  CashflowChart,
  FeeAnalyzer,
};


})();
