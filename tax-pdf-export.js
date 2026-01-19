// ============================================================================
// MAERMIN v6.0 - Tax Report PDF Export
// Generate professional PDF tax reports
// ============================================================================

/**
 * Export tax report to PDF
 */
function exportTaxPDF(transactions, jurisdiction, year, language) {
  language = language || 'de';
  year = year || new Date().getFullYear();
  
  // Check if jsPDF is available
  if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined') {
    console.error('[TAX PDF] jsPDF library not available');
    alert('PDF export not available. Please ensure jsPDF is loaded.');
    return;
  }
  
  var jsPDFLib = typeof jsPDF !== 'undefined' ? jsPDF : jspdf.jsPDF;
  var doc = new jsPDFLib();
  
  // Get tax calculations
  var taxReport;
  if (typeof generateTaxReportAdvanced !== 'undefined') {
    taxReport = generateTaxReportAdvanced(transactions, year, jurisdiction);
  } else if (typeof calculateGermanTax !== 'undefined' && jurisdiction === 'de') {
    taxReport = calculateGermanTax(transactions, year);
  } else if (typeof calculateUSTax !== 'undefined' && jurisdiction === 'us') {
    taxReport = calculateUSTax(transactions, year);
  } else {
    taxReport = {
      year: year,
      jurisdiction: jurisdiction,
      totalCapitalIncome: 0,
      taxableIncome: 0,
      totalTax: 0,
      transactions: []
    };
  }
  
  // Translations
  var t = {
    de: {
      title: 'Steuerbericht',
      subtitle: 'MAERMIN Portfolio Tracker',
      year: 'Steuerjahr',
      jurisdiction: 'Steuergebiet',
      germany: 'Deutschland',
      usa: 'USA',
      summary: 'Zusammenfassung',
      totalCapitalIncome: 'Gesamte Kapitaleinkuenfte',
      freistellungsauftrag: 'Freistellungsauftrag',
      taxableIncome: 'Zu versteuerndes Einkommen',
      abgeltungssteuer: 'Abgeltungssteuer (25%)',
      solidarityTax: 'Solidaritaetszuschlag (5.5%)',
      totalTax: 'Gesamte Steuerschuld',
      effectiveRate: 'Effektiver Steuersatz',
      cryptoGains: 'Krypto-Gewinne',
      shortTerm: 'Kurzfristig (< 1 Jahr)',
      longTerm: 'Langfristig (> 1 Jahr)',
      taxFree: 'Steuerfrei',
      stockGains: 'Aktien-Gewinne',
      transactions: 'Transaktionen',
      date: 'Datum',
      type: 'Typ',
      symbol: 'Symbol',
      quantity: 'Menge',
      proceeds: 'Erloese',
      costBasis: 'Anschaffungskosten',
      gain: 'Gewinn/Verlust',
      holdingPeriod: 'Haltedauer (Tage)',
      generated: 'Erstellt am',
      page: 'Seite',
      disclaimer: 'Dieser Bericht dient nur zu Informationszwecken. Konsultieren Sie einen Steuerberater.'
    },
    en: {
      title: 'Tax Report',
      subtitle: 'MAERMIN Portfolio Tracker',
      year: 'Tax Year',
      jurisdiction: 'Jurisdiction',
      germany: 'Germany',
      usa: 'USA',
      summary: 'Summary',
      totalCapitalIncome: 'Total Capital Income',
      freistellungsauftrag: 'Tax-Free Allowance',
      taxableIncome: 'Taxable Income',
      abgeltungssteuer: 'Withholding Tax (25%)',
      solidarityTax: 'Solidarity Surcharge (5.5%)',
      totalTax: 'Total Tax Liability',
      effectiveRate: 'Effective Tax Rate',
      cryptoGains: 'Crypto Gains',
      shortTerm: 'Short-term (< 1 year)',
      longTerm: 'Long-term (> 1 year)',
      taxFree: 'Tax-free',
      stockGains: 'Stock Gains',
      transactions: 'Transactions',
      date: 'Date',
      type: 'Type',
      symbol: 'Symbol',
      quantity: 'Quantity',
      proceeds: 'Proceeds',
      costBasis: 'Cost Basis',
      gain: 'Gain/Loss',
      holdingPeriod: 'Holding Period (Days)',
      generated: 'Generated on',
      page: 'Page',
      disclaimer: 'This report is for informational purposes only. Please consult a tax advisor.'
    }
  };
  
  var labels = t[language] || t.de;
  
  // Format currency
  var formatCurrency = function(value) {
    if (value === undefined || value === null || isNaN(value)) return '0.00 EUR';
    return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';
  };
  
  // Format date
  var formatDate = function(dateStr) {
    if (!dateStr) return '';
    var date = new Date(dateStr);
    return date.toLocaleDateString(language === 'de' ? 'de-DE' : 'en-US');
  };
  
  // Colors
  var colors = {
    primary: [126, 34, 206], // Purple
    text: [30, 41, 59],
    textLight: [100, 116, 139],
    success: [34, 197, 94],
    danger: [239, 68, 68]
  };
  
  // Header
  doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
  doc.rect(0, 0, 210, 40, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(labels.title, 20, 25);
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(labels.subtitle, 20, 33);
  
  // Year and jurisdiction
  doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
  doc.setFontSize(12);
  var y = 55;
  doc.text(labels.year + ': ' + year, 20, y);
  doc.text(labels.jurisdiction + ': ' + (jurisdiction === 'de' ? labels.germany : labels.usa), 100, y);
  
  // Summary section
  y = 75;
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(15, y - 5, 180, jurisdiction === 'de' ? 55 : 45, 3, 3, 'F');
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(labels.summary, 20, y + 5);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  y += 15;
  
  if (jurisdiction === 'de') {
    doc.text(labels.totalCapitalIncome + ':', 20, y);
    doc.text(formatCurrency(taxReport.totalCapitalIncome), 150, y, { align: 'right' });
    y += 8;
    
    doc.text(labels.freistellungsauftrag + ':', 20, y);
    doc.text('-' + formatCurrency(taxReport.freistellungsauftrag || 1000), 150, y, { align: 'right' });
    y += 8;
    
    doc.text(labels.taxableIncome + ':', 20, y);
    doc.text(formatCurrency(taxReport.taxableIncome), 150, y, { align: 'right' });
    y += 8;
    
    doc.text(labels.abgeltungssteuer + ':', 20, y);
    doc.text(formatCurrency(taxReport.abgeltungssteuer), 150, y, { align: 'right' });
    y += 8;
    
    doc.text(labels.solidarityTax + ':', 20, y);
    doc.text(formatCurrency(taxReport.solidarityTax), 150, y, { align: 'right' });
    y += 10;
  } else {
    doc.text(labels.shortTerm + ':', 20, y);
    doc.text(formatCurrency(taxReport.shortTermGains), 150, y, { align: 'right' });
    y += 8;
    
    doc.text(labels.longTerm + ':', 20, y);
    doc.text(formatCurrency(taxReport.longTermGains), 150, y, { align: 'right' });
    y += 10;
  }
  
  // Total tax
  doc.setFont('helvetica', 'bold');
  doc.text(labels.totalTax + ':', 20, y);
  doc.setTextColor(colors.danger[0], colors.danger[1], colors.danger[2]);
  doc.text(formatCurrency(taxReport.totalTax), 150, y, { align: 'right' });
  
  doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.text(labels.effectiveRate + ':', 20, y);
  doc.text((taxReport.effectiveTaxRate || 0).toFixed(2) + '%', 150, y, { align: 'right' });
  
  // Crypto section (German only - 1 year rule)
  if (jurisdiction === 'de') {
    y += 25;
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(15, y - 5, 180, 35, 3, 3, 'F');
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(labels.cryptoGains, 20, y + 5);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    y += 15;
    
    doc.text(labels.shortTerm + ':', 20, y);
    doc.text(formatCurrency(taxReport.cryptoShortTermGains || taxReport.cryptoTaxableGains || 0), 150, y, { align: 'right' });
    y += 8;
    
    doc.text(labels.longTerm + ' (' + labels.taxFree + '):', 20, y);
    doc.setTextColor(colors.success[0], colors.success[1], colors.success[2]);
    doc.text(formatCurrency(taxReport.cryptoLongTermGains || taxReport.cryptoTaxFreeGains || 0), 150, y, { align: 'right' });
    doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
  }
  
  // Transactions table
  y += 25;
  
  if (taxReport.transactions && taxReport.transactions.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(labels.transactions, 20, y);
    y += 10;
    
    // Table header
    doc.setFillColor(colors.primary[0], colors.primary[1], colors.primary[2]);
    doc.rect(15, y - 5, 180, 8, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(labels.date, 18, y);
    doc.text(labels.symbol, 45, y);
    doc.text(labels.proceeds, 80, y);
    doc.text(labels.costBasis, 110, y);
    doc.text(labels.gain, 145, y);
    doc.text(labels.holdingPeriod, 175, y);
    
    y += 8;
    doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
    doc.setFont('helvetica', 'normal');
    
    // Table rows (max 15 per page)
    var maxRows = Math.min(15, taxReport.transactions.length);
    
    for (var i = 0; i < maxRows; i++) {
      var tx = taxReport.transactions[i];
      var txDate = tx.transactionDate || tx.timestamp || tx.date || '';
      var symbol = tx.asset ? tx.asset.symbol : (tx.symbol || '');
      var proceeds = tx.realizedGain ? tx.realizedGain.proceeds : (tx.proceeds || 0);
      var costBasis = tx.realizedGain ? tx.realizedGain.costBasis : (tx.costBasis || 0);
      var gain = tx.realizedGain ? tx.realizedGain.gain : (tx.gain || 0);
      var holdingPeriod = tx.realizedGain ? tx.realizedGain.holdingPeriod : (tx.holdingPeriod || 0);
      
      if (i % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(15, y - 4, 180, 7, 'F');
      }
      
      doc.text(formatDate(txDate), 18, y);
      doc.text(String(symbol).substring(0, 10), 45, y);
      doc.text(formatCurrency(proceeds).replace(' EUR', ''), 80, y);
      doc.text(formatCurrency(costBasis).replace(' EUR', ''), 110, y);
      
      if (gain >= 0) {
        doc.setTextColor(colors.success[0], colors.success[1], colors.success[2]);
      } else {
        doc.setTextColor(colors.danger[0], colors.danger[1], colors.danger[2]);
      }
      doc.text(formatCurrency(gain).replace(' EUR', ''), 145, y);
      doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
      
      doc.text(String(holdingPeriod), 180, y);
      
      y += 7;
    }
    
    if (taxReport.transactions.length > maxRows) {
      y += 5;
      doc.setTextColor(colors.textLight[0], colors.textLight[1], colors.textLight[2]);
      doc.text('... und ' + (taxReport.transactions.length - maxRows) + ' weitere Transaktionen', 20, y);
    }
  }
  
  // Footer
  var pageHeight = doc.internal.pageSize.height;
  doc.setTextColor(colors.textLight[0], colors.textLight[1], colors.textLight[2]);
  doc.setFontSize(8);
  doc.text(labels.disclaimer, 20, pageHeight - 20);
  doc.text(labels.generated + ': ' + new Date().toLocaleDateString(language === 'de' ? 'de-DE' : 'en-US'), 20, pageHeight - 12);
  doc.text(labels.page + ' 1', 180, pageHeight - 12);
  
  // Save PDF
  var filename = 'MAERMIN-Tax-Report-' + year + '-' + jurisdiction.toUpperCase() + '.pdf';
  doc.save(filename);
  
  console.log('[TAX PDF] Report exported: ' + filename);
}

// Export
if (typeof window !== 'undefined') {
  window.exportTaxPDF = exportTaxPDF;
  console.log('[TAX PDF] Export module loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportTaxPDF: exportTaxPDF };
}
