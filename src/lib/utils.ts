import { type ClassValue, clsx } from 'clsx';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import Papa from 'papaparse';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value?: string | Date | null, pattern = 'dd MMM yyyy'): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, pattern);
}

export function formatDateTime(value?: string | Date | null): string {
  return formatDate(value, 'dd MMM yyyy, HH:mm');
}

export function formatCurrency(amount: number | string | null | undefined, symbol = '₹'): string {
  const n = Number(amount ?? 0);
  if (Number.isNaN(n)) return `${symbol}0.00`;
  return `${symbol}${n.toFixed(2)}`;
}

export function getTimeGreeting(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
}

export function exportToCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Excel-compatible UTF-8 BOM Spreadsheet export (.xls/.csv compatible with MS Excel & LibreOffice)
export function exportToExcel(filename: string, rows: Record<string, unknown>[]) {
  const csv = '\uFEFF' + Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename.replace(/\.xlsx?$/, '')}-excel.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadReceiptPdf(params: {
  title: string;
  receiptNumber: string;
  organizationName: string;
  lines: Array<{ label: string; value: string }>;
  footerNote?: string;
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, 148, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('QIVORA', 12, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(params.organizationName || 'Smart Library Circulation Desk', 12, 19);
  doc.text(params.receiptNumber, 136, 15, { align: 'right' });

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(params.title, 12, 38);

  doc.setDrawColor(226, 232, 240);
  doc.line(12, 42, 136, 42);

  let y = 52;
  for (const row of params.lines) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(row.label, 12, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(String(row.value || '—'), 56, y, { maxWidth: 80 });
    y += 9;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(12, y + 6, 136, y + 6);
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    params.footerNote ||
      'QIVORA — Smart Library Management System · Intelligence for Every Library.',
    12,
    y + 12
  );
  doc.setFontSize(6.8);
  doc.text(
    'Designed & Developed by MOHAMMAD SHARIQ · BCA 1st Year | 2026–2027 Batch',
    12,
    y + 17
  );
  doc.save(`${params.receiptNumber}.pdf`);
}

export function downloadReportPdf(params: {
  title: string;
  organizationName: string;
  dateRangeLabel: string;
  metrics: Array<{ label: string; value: string }>;
  rows: Array<Record<string, string | number>>;
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('QIVORA Analytics Report', 14, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`${params.organizationName} · ${params.dateRangeLabel}`, 14, 21);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(params.title, 14, 40);

  let y = 50;
  let col = 0;
  for (const m of params.metrics) {
    const x = 14 + col * 62;
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, 56, 18, 2, 2, 'S');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(m.label, x + 4, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(m.value, x + 4, y + 14);
    col++;
    if (col === 3) {
      col = 0;
      y += 23;
    }
  }

  y += col === 0 ? 10 : 28;
  if (params.rows.length > 0) {
    const headers = Object.keys(params.rows[0]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const colWidth = 182 / headers.length;
    headers.forEach((h, i) => {
      doc.text(h.toUpperCase(), 14 + i * colWidth, y);
    });
    y += 4;
    doc.line(14, y, 196, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    for (const row of params.rows.slice(0, 28)) {
      headers.forEach((h, i) => {
        const val = String(row[h] ?? '—').slice(0, 28);
        doc.text(val, 14 + i * colWidth, y);
      });
      y += 6.5;
      if (y > 278) {
        doc.addPage();
        y = 20;
      }
    }
  }

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'QIVORA — Intelligence for Every Library. | Designed & Developed by MOHAMMAD SHARIQ · BCA 1st Year | 2026–2027 Batch',
    14,
    290
  );
  doc.save(`qivora-report-${Date.now()}.pdf`);
}

export function downloadBarcodesSheetPdf(params: {
  organizationName: string;
  bookTitle: string;
  copies: Array<{ barcode: string; accessionNumber: string; shelf?: string }>;
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`QIVORA Barcode Labels — ${params.bookTitle}`, 14, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`${params.organizationName} · ${params.copies.length} physical copy label(s)`, 14, 21);

  let x = 14;
  let y = 28;
  const labelW = 58;
  const labelH = 28;
  const gap = 4;

  for (const copy of params.copies) {
    if (y + labelH > 282) {
      doc.addPage();
      x = 14;
      y = 20;
    }
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(x, y, labelW, labelH, 2, 2, 'S');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(params.bookTitle.slice(0, 30), x + 3, y + 6);

    // Draw crisp barcode stripe representation
    let bx = x + 4;
    for (let i = 0; i < copy.barcode.length && bx < x + labelW - 5; i++) {
      const code = copy.barcode.charCodeAt(i);
      const w = (code % 3 === 0 ? 1.1 : 0.6);
      doc.setFillColor(15, 23, 42);
      doc.rect(bx, y + 8.5, w, 9.5, 'F');
      bx += w + 0.7;
      doc.rect(bx, y + 8.5, 0.45, 9.5, 'F');
      bx += 1.05;
    }

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.text(copy.barcode, x + labelW / 2, y + 22, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`${copy.accessionNumber}${copy.shelf ? ` · ${copy.shelf}` : ''}`, x + labelW / 2, y + 26, {
      align: 'center',
    });

    x += labelW + gap;
    if (x + labelW > 200) {
      x = 14;
      y += labelH + gap;
    }
  }

  doc.save(`qivora-barcodes-${Date.now()}.pdf`);
}
