// ========== CUSTOMIZABLE DASHBOARD VIEW ==========
// Replace the activeView === 'overview' section with this

activeView === 'overview' && React.createElement('div', {},
  // Dashboard Header with Edit Button
  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' } },
    React.createElement('h2', { style: { color: currentTheme.text, fontSize: '2rem', fontWeight: '700' } }, 'Mein Dashboard'),
    React.createElement('button', {
      onClick: () => setEditingDashboard(!editingDashboard),
      style: { 
        padding: '0.75rem 1.5rem', 
        background: editingDashboard ? '#ef4444' : '#3b82f6', 
        color: 'white', 
        border: 'none', 
        borderRadius: '0.5rem', 
        cursor: 'pointer', 
        fontWeight: '600',
        transition: 'all 0.2s'
      }
    }, editingDashboard ? 'Fertig' : 'Dashboard anpassen')
  ),
  
  // Edit Mode Info
  editingDashboard && React.createElement('div', { 
    style: { 
      background: '#dbeafe', 
      border: '1px solid #3b82f6', 
      borderRadius: '0.5rem', 
      padding: '1rem', 
      marginBottom: '2rem',
      color: '#1e40af'
    } 
  },
    React.createElement('strong', {}, '[INFO] Dashboard anpassen:'),
    ' Klicke auf ein Widget um es zu entfernen. Nutze die Buttons unten um Widgets hinzuzufügen.'
  ),
  
  // Dashboard Widgets Grid
  React.createElement('div', { 
    style: { 
      display: 'grid', 
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
      gap: '1.5rem', 
      marginBottom: '2rem' 
    } 
  },
    dashboardWidgets.map(widget => {
      const widgetData = {
        networth: {
          title: t.netWorth,
          value: getCurrencySymbol() + formatPrice(metrics.netWorth),
          subtitle: getCurrencySymbol() + formatPrice(total + metrics.totalCash) + ' - ' + getCurrencySymbol() + formatPrice(metrics.totalDebt),
          gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)',
          icon: '[NW]'
        },
        savingsrate: {
          title: t.savingsRate,
          value: metrics.savingsRate.toFixed(1) + '%',
          subtitle: getCurrencySymbol() + formatPrice(metrics.monthlyIncome - metrics.monthlyExpenses - metrics.monthlyDebtPayments) + '/mo',
          gradient: 'linear-gradient(135deg, #10b981, #059669)',
          icon: '[SR]'
        },
        cashrunway: {
          title: t.cashRunway,
          value: metrics.cashRunway > 999 ? '∞' : metrics.cashRunway.toFixed(1),
          subtitle: t.months,
          gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
          icon: '[CR]'
        },
        health: {
          title: t.financialHealth,
          value: healthScore.score + '/100',
          subtitle: healthScore.rating,
          gradient: 'linear-gradient(135deg, ' + healthScore.color + ', ' + healthScore.color + 'dd)',
          icon: '[HS]'
        },
        portfolio: {
          title: 'Portfolio Wert',
          value: getCurrencySymbol() + formatPrice(total),
          subtitle: 'Profit: ' + (profit >= 0 ? '+' : '') + getCurrencySymbol() + formatPrice(profit),
          gradient: profit >= 0 ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #ef4444, #dc2626)',
          icon: '[PF]'
        },
        income: {
          title: 'Monatl. Einkommen',
          value: getCurrencySymbol() + formatPrice(metrics.monthlyIncome),
          subtitle: (financialData.income || []).length + ' Quellen',
          gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
          icon: '[IN]'
        },
        expenses: {
          title: 'Monatl. Ausgaben',
          value: getCurrencySymbol() + formatPrice(metrics.monthlyExpenses + metrics.monthlyDebtPayments),
          subtitle: 'Fixkosten + Variable',
          gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
          icon: '[EX]'
        },
        };
      
      const data = widgetData[widget];
      if (!data) return null;
      
      return React.createElement('div', {
        key: widget,
        onClick: editingDashboard ? () => {
          if (confirm('Widget "' + data.title + '" vom Dashboard entfernen?')) {
            setDashboardWidgets(prev => prev.filter(w => w !== widget));
          }
        } : null,
        style: {
          background: data.gradient,
          borderRadius: '1rem',
          padding: '1.5rem',
          color: 'white',
          cursor: editingDashboard ? 'pointer' : 'default',
          transition: 'all 0.2s',
          border: editingDashboard ? '3px dashed rgba(255,255,255,0.5)' : 'none',
          transform: editingDashboard ? 'scale(0.98)' : 'scale(1)',
          position: 'relative'
        }
      },
        editingDashboard && React.createElement('div', {
          style: {
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px'
          }
        }, '[X]'),
        React.createElement('div', { style: { fontSize: '1.5rem', marginBottom: '0.5rem' } }, data.icon),
        React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.9 } }, data.title),
        React.createElement('div', { style: { fontSize: '2.5rem', fontWeight: 'bold', margin: '0.5rem 0' } }, data.value),
        React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.8 } }, data.subtitle)
      );
    })
  ),
  
  // Add Widget Buttons (only in edit mode)
  editingDashboard && React.createElement('div', { 
    style: { 
      background: currentTheme.card, 
      borderRadius: '1rem', 
      padding: '1.5rem',
      border: `1px solid ${currentTheme.cardBorder}`
    } 
  },
    React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.25rem' } }, '[+] Widgets hinzufuegen'),
    React.createElement('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' } },
      ['networth', 'savingsrate', 'cashrunway', 'health', 'portfolio', 'income', 'expenses'].map(widgetId => {
        const isAdded = dashboardWidgets.includes(widgetId);
        const labels = {
          networth: '[NW] Nettovermoegen',
          savingsrate: '[SR] Sparquote',
          cashrunway: '[CR] Cash Runway',
          health: '[HS] Health Score',
          portfolio: '[PF] Portfolio',
          income: '[IN] Einkommen',
          expenses: '[EX] Ausgaben',
          };
        
        return React.createElement('button', {
          key: widgetId,
          onClick: () => {
            if (!isAdded) {
              setDashboardWidgets(prev => [...prev, widgetId]);
            }
          },
          disabled: isAdded,
          style: {
            padding: '0.75rem 1.25rem',
            background: isAdded ? currentTheme.inputBg : '#3b82f6',
            color: isAdded ? currentTheme.textSecondary : 'white',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: isAdded ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            opacity: isAdded ? 0.5 : 1
          }
        }, labels[widgetId] + (isAdded ? ''' : ''));
      })
    )
  )
),
