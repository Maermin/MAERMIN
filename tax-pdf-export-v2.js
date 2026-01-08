// ============================================================================
// MAERMIN v4.1 - Tax Report PDF Generator (Updated for accurate tax law)
// Shows clear differences between German and US tax treatment
// ============================================================================

function formatCurrency(amount, currency) {
  currency = currency || 'EUR';
  const symbol = currency === 'EUR' ? '€' : '$';
  const formatted = Math.abs(amount).toLocaleString('de-DE', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
  return symbol + formatted;
}

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE');
  } catch (e) {
    return dateStr;
  }
}

function generateGermanTaxReportPDF(taxReport, currency, year) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  let yPos = 20;
  
  // Title
  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59);
  doc.text(`STEUERBERICHT ${year}`, pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 8;
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('🇩🇪 Deutschland', pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 5;
  doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE')}`, pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 15;
  
  // KEY DIFFERENCES BOX
  doc.setFillColor(59, 130, 246, 0.1);
  doc.rect(14, yPos, pageWidth - 28, 35, 'F');
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(2);
  doc.rect(14, yPos, pageWidth - 28, 35);
  
  yPos += 8;
  doc.setFontSize(12);
  doc.setTextColor(59, 130, 246);
  doc.setFont(undefined, 'bold');
  doc.text('DEUTSCHE BESONDERHEIT:', 20, yPos);
  
  yPos += 7;
  doc.setFontSize(10);
  doc.setTextColor(16, 185, 129);
  doc.text('✓ Krypto > 1 Jahr = STEUERFREI! (§ 23 EStG)', 20, yPos);
  
  yPos += 6;
  doc.setTextColor(239, 68, 68);
  doc.text('✗ Krypto ≤ 1 Jahr = 25% Abgeltungssteuer + 5,5% Soli', 20, yPos);
  
  yPos += 6;
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  doc.text('Aktien = Immer 25% + Soli (keine Haltefrist-Befreiung)', 20, yPos);
  
  yPos += 12;
  
  // Summary Section
  doc.setFontSize(14);
  doc.setTextColor(59, 130, 246);
  doc.setFont(undefined, 'bold');
  doc.text('ZUSAMMENFASSUNG', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 8;
  
  // Summary Table with color coding
  doc.autoTable({
    startY: yPos,
    head: [['Beschreibung', 'Betrag', 'Status']],
    body: [
      ['Krypto < 1 Jahr (steuerpflichtig)', formatCurrency(taxReport.cryptoTaxableGains, currency), '✗ Steuerpflichtig'],
      ['Krypto ≥ 1 Jahr (steuerfrei)', formatCurrency(taxReport.cryptoTaxFreeGains, currency), '✓ STEUERFREI'],
      ['Aktien (steuerpflichtig)', formatCurrency(taxReport.stocksGains, currency), '✗ Steuerpflichtig'],
      ['', '', ''],
      ['Gesamt Kapitaleinkommen', formatCurrency(taxReport.totalCapitalIncome, currency), ''],
      ['./. Freistellungsauftrag', '- ' + formatCurrency(taxReport.freistellungsauftragUsed, currency), ''],
      ['= Steuerpflichtiges Einkommen', formatCurrency(taxReport.taxableIncome, currency), ''],
      ['', '', ''],
      ['Abgeltungssteuer (25%)', formatCurrency(taxReport.abgeltungssteuer, currency), ''],
      ['Solidaritätszuschlag (5,5%)', formatCurrency(taxReport.solidarityTax, currency), ''],
      ['GESAMTE STEUERSCHULD', formatCurrency(taxReport.totalTax, currency), ''],
      ['Effektiver Steuersatz', taxReport.effectiveTaxRate.toFixed(2) + '%', ''],
    ],
    headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 11 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 50, halign: 'right', fontStyle: 'bold' },
      2: { cellWidth: 50, halign: 'center' }
    },
    didParseCell: function(data) {
      if (data.section === 'body') {
        if (data.cell.raw === '✓ STEUERFREI') {
          data.cell.styles.textColor = [16, 185, 129];
          data.cell.styles.fontStyle = 'bold';
        } else if (data.cell.raw === '✗ Steuerpflichtig') {
          data.cell.styles.textColor = [239, 68, 68];
        }
        
        if (data.row.index === 1) { // Tax-free crypto row
          data.cell.styles.fillColor = [220, 252, 231]; // Light green
        }
        
        if (data.row.index === 10) { // Total tax row
          data.cell.styles.fillColor = [254, 243, 199];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    }
  });
  
  yPos = doc.lastAutoTable.finalY + 15;
  
  // Tax Savings Highlight
  if (taxReport.cryptoTaxSavings > 0) {
    doc.setFillColor(220, 252, 231);
    doc.rect(14, yPos, pageWidth - 28, 18, 'F');
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(2);
    doc.rect(14, yPos, pageWidth - 28, 18);
    
    yPos += 7;
    doc.setFontSize(11);
    doc.setTextColor(16, 185, 129);
    doc.setFont(undefined, 'bold');
    doc.text(`💰 Steuerersparnis durch 1-Jahres-Regel: ${formatCurrency(taxReport.cryptoTaxSavings, currency)}`, 20, yPos);
    doc.setFont(undefined, 'normal');
    
    yPos += 6;
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`Sie haben ${formatCurrency(taxReport.cryptoTaxSavings, currency)} an Steuern gespart, weil Sie Ihre Kryptowährungen länger als 1 Jahr gehalten haben!`, 20, yPos);
    
    yPos += 15;
  }
  
  // Check if we need a new page
  if (yPos > pageHeight - 80) {
    doc.addPage();
    yPos = 20;
  }
  
  // Detailed Explanation
  doc.setFontSize(14);
  doc.setTextColor(59, 130, 246);
  doc.setFont(undefined, 'bold');
  doc.text('STEUERRECHTLICHE GRUNDLAGEN', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 10;
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  
  const explanation = [
    'KRYPTOWÄHRUNGEN (§ 23 EStG - Private Veräußerungsgeschäfte):',
    '  • Haltefrist < 1 Jahr: Steuerpflichtig als private Veräußerungsgeschäfte',
    '  • Haltefrist ≥ 1 Jahr: STEUERFREI (keine Besteuerung!)',
    `  • In diesem Jahr: ${formatCurrency(taxReport.cryptoTaxFreeGains, currency)} steuerfrei`,
    '',
    'AKTIEN UND FONDS (§ 20 EStG - Kapitalerträge):',
    '  • Immer 25% Abgeltungssteuer (unabhängig von Haltefrist)',
    '  • Plus 5,5% Solidaritätszuschlag auf die Steuer',
    '  • Keine Haltefrist-Befreiung wie bei Kryptowährungen',
    '',
    'FREISTELLUNGSAUFTRAG:',
    `  • Jährlicher Freibetrag: €1.000 (Single) / €2.000 (Verheiratet)`,
    `  • In diesem Bericht genutzt: ${formatCurrency(taxReport.freistellungsauftragUsed, currency)}`,
    '  • Wird auf alle Kapitalerträge angerechnet'
  ];
  
  explanation.forEach(line => {
    if (line.startsWith('KRYPTO') || line.startsWith('AKTIEN') || line.startsWith('FREI')) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(59, 130, 246);
    } else {
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0, 0, 0);
    }
    
    const lines = doc.splitTextToSize(line, pageWidth - 28);
    lines.forEach(l => {
      if (yPos > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
      }
      doc.text(l, 14, yPos);
      yPos += 5;
    });
  });
  
  // New page for transactions
  doc.addPage();
  yPos = 20;
  
  // Transaction Details
  doc.setFontSize(14);
  doc.setTextColor(59, 130, 246);
  doc.setFont(undefined, 'bold');
  doc.text(`TRANSAKTIONSDETAILS ${year}`, 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 8;
  
  if (taxReport.transactions && taxReport.transactions.length > 0) {
    const transData = taxReport.transactions.slice(0, 50).map(tx => {
      const gain = (tx.realizedGain && tx.realizedGain.gain) || 0;
      const holdingPeriod = (tx.realizedGain && tx.realizedGain.holdingPeriod) || 0;
      const isCrypto = tx.asset.category === 'crypto';
      const isTaxFree = isCrypto && holdingPeriod >= 365;
      
      return [
        formatDate(tx.timestamp || tx.transactionDate),
        tx.asset.symbol,
        tx.asset.category === 'crypto' ? 'Krypto' : 'Aktie',
        Math.floor(holdingPeriod) + 'd',
        formatCurrency(gain, currency),
        isTaxFree ? 'STEUERFREI' : 'Steuerpflichtig'
      ];
    });
    
    doc.autoTable({
      startY: yPos,
      head: [['Datum', 'Asset', 'Typ', 'Halted', 'Gewinn', 'Status']],
      body: transData,
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        3: { halign: 'center' },
        4: { halign: 'right' },
        5: { halign: 'center', fontSize: 7 }
      },
      didParseCell: function(data) {
        if (data.section === 'body' && data.column.index === 5) {
          if (data.cell.raw === 'STEUERFREI') {
            data.cell.styles.textColor = [16, 185, 129];
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [220, 252, 231];
          }
        }
      }
    });
    
    if (taxReport.transactions.length > 50) {
      yPos = doc.lastAutoTable.finalY + 8;
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(`Hinweis: Es werden die ersten 50 von ${taxReport.transactions.length} Transaktionen angezeigt.`, 14, yPos);
    }
  } else {
    doc.setFontSize(10);
    doc.text('Keine Transaktionen für dieses Jahr vorhanden.', 14, yPos);
  }
  
  // Add new page for disclaimer
  doc.addPage();
  yPos = 20;
  
  // Disclaimer
  doc.setFontSize(14);
  doc.setTextColor(59, 130, 246);
  doc.setFont(undefined, 'bold');
  doc.text('WICHTIGE HINWEISE', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 10;
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'italic');
  
  const disclaimer = [
    'Dieser Bericht dient nur zu Informationszwecken und stellt keine Steuerberatung dar.',
    'Bitte konsultieren Sie einen Steuerberater für eine professionelle Beratung.',
    'Die Berechnungen basieren auf den allgemeinen deutschen Steuerregelungen 2024/2025.',
    'Individuelle Umstände können zu abweichenden Steuerpflichten führen.',
    '',
    'Kirchensteuer (8-9%) ist in diesem Bericht NICHT berücksichtigt.',
    'Verlustverrechnung und Verlustvortrag wurden nicht automatisch angewendet.',
  ];
  
  disclaimer.forEach(line => {
    const lines = doc.splitTextToSize(line, pageWidth - 28);
    lines.forEach(l => {
      doc.text(l, 14, yPos);
      yPos += 5;
    });
    yPos += 2;
  });
  
  // Save PDF
  doc.save(`Steuerbericht_${year}_DE.pdf`);
}

function generateUSTaxReportPDF(taxReport, currency, year) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  let yPos = 20;
  
  // Title
  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59);
  doc.text(`TAX REPORT ${year}`, pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 8;
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('🇺🇸 United States', pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 5;
  doc.text('For U.S. Federal Income Tax Filing', pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 5;
  doc.text(`Generated: ${new Date().toLocaleDateString('en-US')} at ${new Date().toLocaleTimeString('en-US')}`, pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 15;
  
  // KEY DIFFERENCES BOX
  doc.setFillColor(16, 185, 129, 0.1);
  doc.rect(14, yPos, pageWidth - 28, 30, 'F');
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(2);
  doc.rect(14, yPos, pageWidth - 28, 30);
  
  yPos += 8;
  doc.setFontSize(12);
  doc.setTextColor(16, 185, 129);
  doc.setFont(undefined, 'bold');
  doc.text('U.S. TAX TREATMENT:', 20, yPos);
  
  yPos += 7;
  doc.setFontSize(10);
  doc.setTextColor(239, 68, 68);
  doc.text('✗ ALL crypto/stock sales are TAXABLE (no exemptions)', 20, yPos);
  
  yPos += 6;
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  doc.text('Short-term (≤ 1 year) = Ordinary income rates', 20, yPos);
  
  yPos += 6;
  doc.text('Long-term (> 1 year) = Preferential rates (0%, 15%, 20%)', 20, yPos);
  
  yPos += 12;
  
  // Summary Section
  doc.setFontSize(14);
  doc.setTextColor(16, 185, 129);
  doc.setFont(undefined, 'bold');
  doc.text('CAPITAL GAINS SUMMARY', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 8;
  
  // Summary Table
  doc.autoTable({
    startY: yPos,
    head: [['Description', 'Amount', 'Tax Rate']],
    body: [
      ['Short-Term Gains (≤ 1 year)', formatCurrency(taxReport.shortTermGains, 'USD'), taxReport.shortTermRate + '%'],
      ['Long-Term Gains (> 1 year)', formatCurrency(taxReport.longTermGains, 'USD'), taxReport.longTermRate + '%'],
      ['Total Realized Gains', formatCurrency(taxReport.totalGains, 'USD'), ''],
      ['', '', ''],
      ['Estimated Short-Term Tax', formatCurrency(taxReport.shortTermTax, 'USD'), ''],
      ['Estimated Long-Term Tax', formatCurrency(taxReport.longTermTax, 'USD'), ''],
      ['TOTAL ESTIMATED TAX', formatCurrency(taxReport.totalTax, 'USD'), ''],
      ['Effective Tax Rate', taxReport.effectiveTaxRate.toFixed(2) + '%', ''],
    ],
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 11 },
    bodyStyles: { fontSize: 10 },
    columnStyles: {
      1: { halign: 'right', fontStyle: 'bold' },
      2: { halign: 'center' }
    },
    didParseCell: function(data) {
      if (data.section === 'body' && data.row.index === 6) {
        data.cell.styles.fillColor = [220, 252, 231];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });
  
  yPos = doc.lastAutoTable.finalY + 15;
  
  // Asset Breakdown
  doc.setFontSize(14);
  doc.setTextColor(16, 185, 129);
  doc.setFont(undefined, 'bold');
  doc.text('BREAKDOWN BY ASSET TYPE', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 8;
  
  doc.autoTable({
    startY: yPos,
    head: [['Asset Type', 'Short-Term', 'Long-Term', 'Total']],
    body: [
      [
        'Cryptocurrency',
        formatCurrency(taxReport.cryptoShortTermGains, 'USD'),
        formatCurrency(taxReport.cryptoLongTermGains, 'USD'),
        formatCurrency(taxReport.cryptoShortTermGains + taxReport.cryptoLongTermGains, 'USD')
      ],
      [
        'Stocks',
        formatCurrency(taxReport.stocksShortTermGains, 'USD'),
        formatCurrency(taxReport.stocksLongTermGains, 'USD'),
        formatCurrency(taxReport.stocksShortTermGains + taxReport.stocksLongTermGains, 'USD')
      ],
      [
        'TOTAL',
        formatCurrency(taxReport.shortTermGains, 'USD'),
        formatCurrency(taxReport.longTermGains, 'USD'),
        formatCurrency(taxReport.totalGains, 'USD')
      ]
    ],
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 10 },
    bodyStyles: { fontSize: 9, halign: 'right' },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold' }
    },
    didParseCell: function(data) {
      if (data.section === 'body' && data.row.index === 2) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [220, 252, 231];
      }
    }
  });
  
  yPos = doc.lastAutoTable.finalY + 15;
  
  // Check if we need a new page
  if (yPos > pageHeight - 100) {
    doc.addPage();
    yPos = 20;
  }
  
  // IRS Form Reference
  doc.setFontSize(14);
  doc.setTextColor(16, 185, 129);
  doc.setFont(undefined, 'bold');
  doc.text('IRS FORM REFERENCES', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 10;
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  
  const formInfo = [
    'REQUIRED FORMS:',
    '  Form 8949 - Sales and Other Dispositions of Capital Assets',
    '    • Part I: Short-Term (assets held ≤ 1 year)',
    '    • Part II: Long-Term (assets held > 1 year)',
    '  Schedule D - Capital Gains and Losses',
    '    • Summarize totals from Form 8949',
    '',
    'CRYPTOCURRENCY REPORTING (IRS Notice 2014-21):',
    '  • Cryptocurrency is treated as PROPERTY, not currency',
    '  • Every sale, exchange, or disposal is a taxable event',
    '  • Must answer "Yes" to virtual currency question on Form 1040',
    `  • Total crypto transactions this year: ${taxReport.transactions.filter(t => t.asset.category === 'crypto').length}`,
    '',
    'IMPORTANT: This report provides estimated taxes. Actual liability',
    'may vary based on your income bracket and filing status.'
  ];
  
  formInfo.forEach(line => {
    if (line.startsWith('REQUIRED') || line.startsWith('CRYPTOCURRENCY') || line.startsWith('IMPORTANT')) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(16, 185, 129);
    } else {
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0, 0, 0);
    }
    
    const lines = doc.splitTextToSize(line, pageWidth - 28);
    lines.forEach(l => {
      if (yPos > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
      }
      doc.text(l, 14, yPos);
      yPos += 5;
    });
  });
  
  // New page for transactions
  doc.addPage();
  yPos = 20;
  
  // Transaction Details
  doc.setFontSize(14);
  doc.setTextColor(16, 185, 129);
  doc.setFont(undefined, 'bold');
  doc.text('TRANSACTION DETAILS (Form 8949 Format)', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 6;
  doc.setFontSize(9);
  doc.setFont(undefined, 'italic');
  doc.text('Use these details to complete your Form 8949', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 10;
  
  if (taxReport.transactions && taxReport.transactions.length > 0) {
    const transData = taxReport.transactions.slice(0, 40).map(tx => {
      const gain = (tx.realizedGain && tx.realizedGain.gain) || 0;
      const holdingPeriod = (tx.realizedGain && tx.realizedGain.holdingPeriod) || 0;
      const costBasis = (tx.realizedGain && tx.realizedGain.costBasis) || 0;
      const proceeds = (tx.realizedGain && tx.realizedGain.proceeds) || 0;
      const dateAcquired = tx.realizedGain && tx.realizedGain.matchedBuys && tx.realizedGain.matchedBuys[0] 
        ? formatDate(tx.realizedGain.matchedBuys[0].buyDate) 
        : 'Various';
      const ltst = holdingPeriod >= 365 ? 'LT' : 'ST';
      
      return [
        dateAcquired,
        formatDate(tx.timestamp || tx.transactionDate),
        tx.asset.symbol,
        formatCurrency(proceeds, 'USD'),
        formatCurrency(costBasis, 'USD'),
        formatCurrency(gain, 'USD'),
        ltst
      ];
    });
    
    doc.autoTable({
      startY: yPos,
      head: [['Acquired', 'Sold', 'Asset', 'Proceeds', 'Cost Basis', 'Gain/Loss', 'Term']],
      body: transData,
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      columnStyles: {
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'center', fontSize: 6 }
      }
    });
    
    if (taxReport.transactions.length > 40) {
      yPos = doc.lastAutoTable.finalY + 8;
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.setFont(undefined, 'italic');
      doc.text(`Note: Showing first 40 of ${taxReport.transactions.length} transactions.`, 14, yPos);
      doc.setFont(undefined, 'normal');
    }
  } else {
    doc.setFontSize(10);
    doc.text('No transactions for this year.', 14, yPos);
  }
  
  // Add new page for tax rates and disclaimer
  doc.addPage();
  yPos = 20;
  
  // Tax Rates Reference
  doc.setFontSize(14);
  doc.setTextColor(16, 185, 129);
  doc.setFont(undefined, 'bold');
  doc.text('2024 TAX RATES REFERENCE', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 10;
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  
  const ratesInfo = [
    'SHORT-TERM CAPITAL GAINS (Ordinary Income Rates):',
    '  Taxed at your marginal income tax rate:',
    '  10%, 12%, 22%, 24%, 32%, 35%, or 37%',
    `  This report estimates at ${taxReport.shortTermRate}% (common marginal rate)`,
    '',
    'LONG-TERM CAPITAL GAINS (Preferential Rates):',
    '  0% - For income up to $44,625 (single) / $89,250 (married)',
    '  15% - For income up to $492,300 (single) / $553,850 (married)',
    '  20% - For income above these thresholds',
    `  This report estimates at ${taxReport.longTermRate}% (most common rate)`,
    '',
    'ADDITIONAL CONSIDERATIONS:',
    '  • Net Investment Income Tax (3.8%) may apply for high earners',
    '  • State taxes not included (vary by state)',
    '  • Alternative Minimum Tax (AMT) not considered'
  ];
  
  ratesInfo.forEach(line => {
    if (line.includes(':') && !line.startsWith('  ')) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(16, 185, 129);
    } else {
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0, 0, 0);
    }
    
    doc.text(line, 14, yPos);
    yPos += 5;
  });
  
  yPos += 5;
  
  // Disclaimer
  doc.setFontSize(14);
  doc.setTextColor(16, 185, 129);
  doc.setFont(undefined, 'bold');
  doc.text('IMPORTANT NOTICES', 14, yPos);
  doc.setFont(undefined, 'normal');
  
  yPos += 8;
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'italic');
  
  const disclaimer = [
    'This report is for informational purposes only and does not constitute tax advice.',
    'Please consult a qualified tax professional or CPA for guidance specific to your situation.',
    'Tax calculations are estimates and may not reflect your actual liability.',
    'State taxes are not included and may apply depending on your residence.',
    'Wash sale rules have not been automatically applied.',
    'Keep detailed records of all transactions for IRS audit purposes.',
  ];
  
  disclaimer.forEach(line => {
    const lines = doc.splitTextToSize(line, pageWidth - 28);
    lines.forEach(l => {
      doc.text(l, 14, yPos);
      yPos += 4;
    });
    yPos += 2;
  });
  
  // Save PDF
  doc.save(`Tax_Report_${year}_US.pdf`);
}

// Export function that handles both jurisdictions
function exportTaxReportPDF(taxReport, currency, year, jurisdiction) {
  if (!window.jspdf) {
    alert('PDF library not loaded. Please refresh the page and try again.');
    return;
  }
  
  try {
    if (jurisdiction === 'de') {
      generateGermanTaxReportPDF(taxReport, currency, year);
    } else if (jurisdiction === 'us') {
      generateUSTaxReportPDF(taxReport, currency, year);
    } else {
      alert('Unknown jurisdiction: ' + jurisdiction);
    }
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Error generating PDF: ' + error.message);
  }
}

// Make function globally available
window.exportTaxReportPDF = exportTaxReportPDF;

console.log('[PDF EXPORT] Tax PDF generator loaded');
console.log('[PDF EXPORT] Supports accurate DE (crypto 1yr exemption) and US (all taxable) rules');
