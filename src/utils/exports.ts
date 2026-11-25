import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { Company, Employee, Payslip } from '../types/payroll';

export function formatCurrencyINR(amount: number | undefined): string {
  const val = Number(amount || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val);
}

export function formatMinutes(minutes: number | undefined): string {
  const m = Math.max(0, Math.round(minutes || 0));
  const hrs = Math.floor(m / 60);
  const rem = m % 60;
  return `${hrs}h ${String(rem).padStart(2, '0')}m`;
}

export function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function currentYearMonth(): string {
  return todayIsoDate().slice(0, 7);
}

export function downloadPayslipPdf(payslip: Payslip, company?: Company, employee?: Employee): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 595, 86, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(company?.name || 'NexusPay Enterprise', 40, 38);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Salary Payslip · Pay Period ${payslip.month}`, 40, 58);
  doc.text(`Payslip ID: ${payslip.payslipId}`, 400, 38);
  doc.text(`Status: ${payslip.paymentStatus.toUpperCase()}`, 400, 58);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Employee Details', 40, 118);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const leftMeta = [
    `Employee Name: ${payslip.employeeName}`,
    `Employee ID: ${employee?.employeeCode || payslip.employeeId}`,
    `Department: ${employee?.department || 'Operations'}`,
    `Designation: ${employee?.designation || 'Staff'}`,
    `UAN / ESI: ${employee?.uan || 'NA'} / ${employee?.esiNumber || 'NA'}`,
  ];
  const rightMeta = [
    `Attended Working Days: ${payslip.workingDays ?? payslip.paidDays ?? 0}d`,
    `Paid Days: ${payslip.paidDays ?? 30}d · Unpaid / Cut: ${payslip.unpaidDays ?? 0}d`,
    `Leaves (Paid / LWP / Absent): ${payslip.paidLeaveDays ?? 0}d / ${payslip.unpaidLeaveDays ?? 0}d / ${payslip.absentDays ?? 0}d`,
    `Late Marks: ${payslip.lateMarksCount ?? 0} (${payslip.lateDeductionDays ?? 0}d cut)`,
  ];

  leftMeta.forEach((line, i) => doc.text(line, 40, 136 + i * 15));
  rightMeta.forEach((line, i) => doc.text(line, 305, 136 + i * 15));

  doc.setDrawColor(226, 232, 240);
  doc.line(40, 218, 555, 218);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Earnings & Adjustments', 40, 242);
  doc.text('Amount (INR)', 210, 242);
  doc.text('Deductions', 310, 242);
  doc.text('Amount (INR)', 490, 242);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const leaveCutAmt = payslip.leaveDeductionAmount || 0;
  const lateCutAmt = payslip.lateDeductionAmount || 0;

  const earningsRows: Array<[string, string]> = [
    ['Base Monthly Salary', (payslip.baseMonthlyGross ?? payslip.grossEarnings).toLocaleString('en-IN')],
    ['Leave / Absent Reduction', leaveCutAmt > 0 ? `-${leaveCutAmt.toLocaleString('en-IN')}` : '0'],
    ['Late Mark Reduction', lateCutAmt > 0 ? `-${lateCutAmt.toLocaleString('en-IN')}` : '0'],
    ['Overtime Pay', (payslip.overtimePay || 0).toLocaleString('en-IN')],
    ['Payable Gross Earnings', payslip.grossEarnings.toLocaleString('en-IN')],
  ];

  const deductionRows: Array<[string, number]> = [
    ['Employee EPF (12%)', payslip.employeePf || 0],
    ['Employee ESI (0.75%)', payslip.employeeEsi || 0],
    ['Professional Tax (PT)', payslip.professionalTax || 0],
    ['TDS (Income Tax)', payslip.tds || 0],
    ['Loan / Advance EMI', payslip.loanEmi || 0],
  ];

  earningsRows.forEach(([label, val], i) => {
    doc.text(label, 40, 264 + i * 18);
    doc.text(val, 210, 264 + i * 18);
  });

  deductionRows.forEach(([label, val], i) => {
    doc.text(label, 310, 264 + i * 18);
    doc.text(val.toLocaleString('en-IN'), 490, 264 + i * 18);
  });

  doc.line(40, 368, 555, 368);

  doc.setFillColor(248, 250, 252);
  doc.rect(40, 382, 515, 52, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Net Payable Salary', 56, 412);
  doc.setFontSize(15);
  doc.text(`INR ${payslip.netSalary.toLocaleString('en-IN')}`, 410, 412);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Employer Statutory Contributions (Tracked Separately): EPF/EPS/EDLI INR ${(payslip.employerPf || 0).toLocaleString('en-IN')} · ESI INR ${(payslip.employerEsi || 0).toLocaleString('en-IN')}`,
    40,
    460
  );
  doc.text('This is a computer-generated payslip issued via NexusPay Enterprise Payroll.', 40, 480);

  doc.save(`Payslip_${payslip.employeeId}_${payslip.month}.pdf`);
}

export function exportToExcel(
  fileName: string,
  sheetName: string,
  rows: Array<Record<string, string | number | boolean | undefined>>
): void {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}
