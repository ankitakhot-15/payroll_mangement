import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IndianRupee,
  Lock,
  Unlock,
  CheckCircle2,
  FileDown,
  Calculator,
  Download,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import {
  AttendanceRecord,
  Company,
  Employee,
  LeaveRequest,
  LoanAdvance,
  PayrollRun,
  Payslip,
  SalaryStructure,
  UserRole,
} from '../types/payroll';
import { backendApi } from '../services/api';
import { createDocStrict, logAuditEvent, updateDocStrict } from '../services/firestoreService';
import { currentYearMonth, downloadPayslipPdf, exportToExcel, formatCurrencyINR } from '../utils/exports';
import { computeMonthlyAttendanceSummary } from '../utils/attendanceSummary';

interface PayrollAndStatutoryPageProps {
  company: Company;
  currentEmployee: Employee;
  effectiveRole: UserRole;
  employees: Employee[];
  salaryStructures: SalaryStructure[];
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  loans: LoanAdvance[];
  payrollRuns: PayrollRun[];
  payslips: Payslip[];
}

function estimateMonthlyTdsClient(annualGross: number, regime: 'new' | 'old'): number {
  const stdDeduction = regime === 'new' ? 75000 : 50000;
  const taxable = Math.max(0, annualGross - stdDeduction);
  let annualTax = 0;

  if (regime === 'new') {
    if (taxable <= 1200000) return 0;
    const slabs: Array<[number, number]> = [
      [400000, 0],
      [400000, 0.05],
      [400000, 0.1],
      [400000, 0.15],
      [400000, 0.2],
      [400000, 0.25],
      [Infinity, 0.3],
    ];
    let remaining = taxable;
    for (const [band, rate] of slabs) {
      if (remaining <= 0) break;
      const chunk = Math.min(remaining, band);
      annualTax += chunk * rate;
      remaining -= chunk;
    }
  } else {
    if (taxable <= 500000) return 0;
    const slabs: Array<[number, number]> = [
      [250000, 0],
      [250000, 0.05],
      [500000, 0.2],
      [Infinity, 0.3],
    ];
    let remaining = taxable;
    for (const [band, rate] of slabs) {
      if (remaining <= 0) break;
      const chunk = Math.min(remaining, band);
      annualTax += chunk * rate;
      remaining -= chunk;
    }
  }

  return Math.round((annualTax * 1.04) / 12);
}

export const PayrollAndStatutoryPage: React.FC<PayrollAndStatutoryPageProps> = ({
  company,
  currentEmployee,
  effectiveRole,
  employees,
  salaryStructures,
  attendance,
  leaves,
  loans,
  payrollRuns,
  payslips,
}) => {
  const canProcessPayroll = ['super_admin', 'company_admin', 'hr_manager', 'accountant'].includes(effectiveRole);
  const isCompanyAdmin = effectiveRole === 'company_admin' || effectiveRole === 'super_admin';
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [selectedPayrollEmpId, setSelectedPayrollEmpId] = useState<string>('ALL');

  // Attendance & Late-mark deduction rules for payroll calculation
  const [lateMarksPerCut, setLateMarksPerCut] = useState(
    String(company.attendancePolicy?.lateMarksPerDeduction ?? 3)
  );
  const [lateCutDays, setLateCutDays] = useState(
    String(company.attendancePolicy?.lateDeductionDaysPerThreshold ?? 1)
  );
  const [prorateByAttendanceOnly, setProrateByAttendanceOnly] = useState(
    Boolean(company.attendancePolicy?.prorateByAttendanceOnly ?? false)
  );

  // Sync policy controls whenever company.attendancePolicy changes in Firestore
  useEffect(() => {
    setLateMarksPerCut(String(company.attendancePolicy?.lateMarksPerDeduction ?? 3));
    setLateCutDays(String(company.attendancePolicy?.lateDeductionDaysPerThreshold ?? 1));
    setProrateByAttendanceOnly(Boolean(company.attendancePolicy?.prorateByAttendanceOnly ?? false));
  }, [
    company.attendancePolicy?.lateMarksPerDeduction,
    company.attendancePolicy?.lateDeductionDaysPerThreshold,
    company.attendancePolicy?.prorateByAttendanceOnly,
  ]);

  // Salary structure assignment form
  const structureCardRef = useRef<HTMLDivElement | null>(null);
  const [empId, setEmpId] = useState(employees[0]?.employeeId || currentEmployee.employeeId);
  const [basic, setBasic] = useState('30000');
  const [hra, setHra] = useState('15000');
  const [conveyance, setConveyance] = useState('2500');
  const [medical, setMedical] = useState('2500');
  const [specialAllowance, setSpecialAllowance] = useState('10000');
  const [pfApplicable, setPfApplicable] = useState(true);
  const [esiApplicable, setEsiApplicable] = useState(false);
  const [ptApplicable, setPtApplicable] = useState(true);
  const [taxRegime, setTaxRegime] = useState<'new' | 'old'>('new');

  // Statutory calculator preview
  const [statPreview, setStatPreview] = useState<{
    pfWage: number;
    employeePf: number;
    employerEpf: number;
    employerEps: number;
    employerEdli: number;
    employeeEsi: number;
    employerEsi: number;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [calculatingEmpId, setCalculatingEmpId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  // Keep salary structure form populated when selected employee changes
  useEffect(() => {
    if (!empId && employees.length > 0) {
      setEmpId(employees[0].employeeId);
      return;
    }
    const existing = salaryStructures.find((st) => st.employeeId === empId);
    if (existing) {
      setBasic(String(existing.basic ?? 0));
      setHra(String(existing.hra ?? 0));
      setConveyance(String(existing.conveyance ?? 0));
      setMedical(String(existing.medical ?? 0));
      setSpecialAllowance(String(existing.specialAllowance ?? 0));
      setPfApplicable(existing.pfApplicable ?? true);
      setEsiApplicable(existing.esiApplicable ?? false);
      setPtApplicable(existing.ptApplicable ?? true);
      setTaxRegime(existing.taxRegime ?? 'new');
    } else {
      setBasic('25000');
      setHra('12500');
      setConveyance('2500');
      setMedical('2500');
      setSpecialAllowance('7500');
      setPfApplicable(true);
      setEsiApplicable(false);
      setPtApplicable(true);
      setTaxRegime('new');
    }
  }, [empId, employees, salaryStructures]);

  const handleSaveSalaryStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find((x) => x.employeeId === empId) || currentEmployee;
    const b = Number(basic) || 0;
    const h = Number(hra) || 0;
    const c = Number(conveyance) || 0;
    const m = Number(medical) || 0;
    const s = Number(specialAllowance) || 0;
    const grossMonthly = b + h + c + m + s;
    const annualCtc = grossMonthly * 12;

    setBusy(true);
    try {
      const existing = salaryStructures.find((st) => st.employeeId === emp.employeeId);
      const structureId = existing?.structureId || `SAL_${emp.employeeId}`;
      const payload = {
        basic: b,
        hra: h,
        da: 0,
        conveyance: c,
        medical: m,
        specialAllowance: s,
        grossMonthly,
        annualCtc,
        pfApplicable,
        esiApplicable: esiApplicable || grossMonthly <= 21000,
        ptApplicable,
        taxRegime,
        effectiveDate: new Date().toISOString().slice(0, 10),
      };

      if (existing) {
        await updateDocStrict('salaryStructures', structureId, payload);
      } else {
        await createDocStrict('salaryStructures', structureId, {
          structureId,
          companyId: company.companyId,
          companyOwnerUid: currentEmployee.companyOwnerUid,
          employeeId: emp.employeeId,
          employeeUid: emp.employeeUid || currentEmployee.companyOwnerUid,
          employeeName: emp.fullName,
          ...payload,
        });
      }
      setFeedback(`Saved salary structure for ${emp.fullName} (Gross ${formatCurrencyINR(grossMonthly)}/mo).`);
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewStatutory = async () => {
    setBusy(true);
    try {
      const b = Number(basic) || 0;
      const g =
        b +
        (Number(hra) || 0) +
        (Number(conveyance) || 0) +
        (Number(medical) || 0) +
        (Number(specialAllowance) || 0);
      const [pf, esi] = await Promise.all([
        backendApi.calculatePF({ basicWage: b, wageCeiling: company.statutoryConfig?.pfWageCeiling ?? 15000 }),
        backendApi.calculateESI({ grossWage: g, wageCeiling: company.statutoryConfig?.esiWageCeiling ?? 21000 }),
      ]);
      setStatPreview({
        pfWage: pf.pfWage,
        employeePf: pf.employeePf,
        employerEpf: pf.employerEpf,
        employerEps: pf.employerEps,
        employerEdli: pf.employerEdli,
        employeeEsi: esi.employeeEsi,
        employerEsi: esi.employerEsi,
      });
    } finally {
      setBusy(false);
    }
  };

  const lateThresholdNum = Math.max(0, Number(lateMarksPerCut) || 0);
  const lateCutDaysNum = Math.max(0, Number(lateCutDays) || 0);
  const ptState = company.statutoryConfig?.ptState || 'Maharashtra';
  const pfWageCeiling = company.statutoryConfig?.pfWageCeiling ?? 15000;
  const esiWageCeiling = company.statutoryConfig?.esiWageCeiling ?? 21000;

  const employeeWiseEngineRows = useMemo(() => {
    const activeEmployees = employees.filter((e) => e.employmentStatus !== 'exited');
    const monthPart = Number(selectedMonth.split('-')[1] || '0');

    return activeEmployees.map((emp) => {
      const struct = salaryStructures.find((s) => s.employeeId === emp.employeeId);
      const baseGross = struct?.grossMonthly ?? 50000;
      const baseBasic = struct?.basic ?? 25000;
      const pfApp = struct?.pfApplicable ?? true;
      const esiApp = struct?.esiApplicable ?? false;
      const ptApp = struct?.ptApplicable ?? true;
      const regime = struct?.taxRegime ?? 'new';

      const summary = computeMonthlyAttendanceSummary({
        employeeId: emp.employeeId,
        month: selectedMonth,
        attendance,
        leaves,
        company,
        lateMarksPerCut: lateThresholdNum,
        lateCutDaysPerThreshold: lateCutDaysNum,
        prorateByAttendanceOnly,
      });

      const activeLoanEmi = loans
        .filter((ln) => ln.employeeId === emp.employeeId && ln.status === 'approved' && ln.outstandingBalance > 0)
        .reduce((sum, ln) => sum + Math.min(ln.monthlyEmi, ln.outstandingBalance), 0);

      const dailyRate = baseGross / summary.totalDaysInMonth;
      const strictPaidRatio = Math.min(
        1,
        Math.max(0, (summary.workingDays + summary.paidLeaveDays) / summary.totalDaysInMonth)
      );
      const estLeaveCut = prorateByAttendanceOnly
        ? Math.max(0, baseGross - Math.round(baseGross * strictPaidRatio))
        : Math.min(baseGross, Math.round(summary.leaveDeductionDays * dailyRate));
      const estLateCut = Math.min(baseGross, Math.round(summary.lateDeductionDays * dailyRate));
      const estOvertimePay = Math.round((summary.overtimeMinutes / 60) * (baseGross / (summary.totalDaysInMonth * 8)) * 1.5);

      const proratedGross = Math.max(0, baseGross - estLeaveCut - estLateCut);
      const estPayableGross = proratedGross + estOvertimePay;
      const paidRatio = Math.min(1, Math.max(0, summary.suggestedPaidDays / summary.totalDaysInMonth));
      const proratedBasic = Math.round(baseBasic * paidRatio);
      const pfWage = pfApp && estPayableGross > 0 ? (pfWageCeiling > 0 ? Math.min(proratedBasic, pfWageCeiling) : proratedBasic) : 0;
      const estEpF = pfApp && estPayableGross > 0 ? Math.round(pfWage * 0.12) : 0;
      const estEsi = esiApp && estPayableGross > 0 && estPayableGross <= esiWageCeiling ? Math.ceil(estPayableGross * 0.0075) : 0;

      let estPt = 0;
      if (ptApp && estPayableGross > 0) {
        if (ptState === 'Maharashtra') {
          if (estPayableGross > 10000) estPt = monthPart === 2 ? 300 : 200;
          else if (estPayableGross > 7500) estPt = 175;
        } else if (ptState === 'Karnataka' && estPayableGross >= 15000) {
          estPt = 200;
        } else if (ptState === 'Gujarat' && estPayableGross >= 12000) {
          estPt = 200;
        }
      }

      const estTds = estPayableGross > 0 ? estimateMonthlyTdsClient(baseGross * 12, regime) : 0;
      const estLoanEmi = estPayableGross > 0 ? Math.min(activeLoanEmi, estPayableGross) : 0;
      const estNetSalary = Math.max(0, estPayableGross - (estEpF + estEsi + estPt + estTds + estLoanEmi));

      const savedPayslip = payslips.find(
        (p) => p.employeeId === emp.employeeId && p.month === selectedMonth
      );

      return {
        emp,
        hasAssignedStructure: Boolean(struct),
        taxRegime: regime,
        baseGross,
        baseBasic,
        pfApp,
        esiApp,
        ptApp,
        activeLoanEmi,
        summary,
        estLeaveCut,
        estLateCut,
        estOvertimePay,
        estPayableGross,
        estEpF,
        estEsi,
        estPt,
        estTds,
        estLoanEmi,
        estNetSalary,
        savedPayslip,
      };
    });
  }, [
    employees,
    salaryStructures,
    attendance,
    leaves,
    loans,
    payslips,
    company,
    selectedMonth,
    lateThresholdNum,
    lateCutDaysNum,
    prorateByAttendanceOnly,
    ptState,
    pfWageCeiling,
    esiWageCeiling,
  ]);

  const filteredEngineRows =
    selectedPayrollEmpId === 'ALL'
      ? employeeWiseEngineRows
      : employeeWiseEngineRows.filter((row) => row.emp.employeeId === selectedPayrollEmpId);

  const runCalculationForRows = async (
    targetRows: typeof employeeWiseEngineRows,
    scopeLabel: string
  ) => {
    const existingRun = payrollRuns.find((r) => r.month === selectedMonth);
    if (existingRun?.status === 'locked' && !isCompanyAdmin) {
      setFeedback(`Payroll for ${selectedMonth} is locked. Only Company Admin can unlock or recalculate it.`);
      return;
    }
    if (targetRows.length === 0) {
      setFeedback('No active employees selected for payroll calculation.');
      return;
    }

    setBusy(true);
    if (targetRows.length === 1) {
      setCalculatingEmpId(targetRows[0].emp.employeeId);
    }
    setFeedback('');

    try {
      const items = targetRows.map((row) => ({
        employeeId: row.emp.employeeId,
        employeeUid: row.emp.employeeUid || currentEmployee.companyOwnerUid,
        employeeName: row.emp.fullName,
        basic: row.baseBasic,
        grossMonthly: row.baseGross,
        pfApplicable: row.pfApp,
        esiApplicable: row.esiApp,
        ptApplicable: row.ptApp,
        taxRegime: row.taxRegime,
        paidDays: row.summary.suggestedPaidDays,
        unpaidDays: row.summary.totalDeductionDays,
        workingDays: row.summary.workingDays,
        presentDays: row.summary.presentDays,
        halfDays: row.summary.halfDays,
        paidLeaveDays: row.summary.paidLeaveDays,
        unpaidLeaveDays: row.summary.unpaidLeaveDays,
        absentDays: row.summary.absentDays,
        lateMarksCount: row.summary.lateMarksCount,
        overtimeMinutes: row.summary.overtimeMinutes,
        loanEmi: row.activeLoanEmi,
      }));

      const result = await backendApi.calculatePayroll({
        month: selectedMonth,
        ptState,
        pfWageCeiling,
        esiWageCeiling,
        lateMarksPerCut: lateThresholdNum,
        lateCutDaysPerThreshold: lateCutDaysNum,
        prorateByAttendanceOnly,
        items,
      });

      const runId = existingRun?.runId || `PAY_${selectedMonth.replace('-', '')}`;

      // Merge newly calculated slips with any already-saved slips for other employees in the same month
      const monthExistingSlips = payslips.filter((p) => p.month === selectedMonth);
      const mergedMap = new Map<string, {
        grossEarnings: number;
        netSalary: number;
        employeePf: number;
        employerPf: number;
        employeeEsi: number;
        employerEsi: number;
        professionalTax: number;
        tds: number;
      }>();

      for (const existing of monthExistingSlips) {
        mergedMap.set(existing.employeeId, {
          grossEarnings: existing.grossEarnings || 0,
          netSalary: existing.netSalary || 0,
          employeePf: existing.employeePf || 0,
          employerPf: existing.employerPf || 0,
          employeeEsi: existing.employeeEsi || 0,
          employerEsi: existing.employerEsi || 0,
          professionalTax: existing.professionalTax || 0,
          tds: existing.tds || 0,
        });
      }

      for (const slip of result.payslips) {
        mergedMap.set(slip.employeeId, {
          grossEarnings: slip.grossEarnings,
          netSalary: slip.netSalary,
          employeePf: slip.employeePf,
          employerPf: slip.employerPf,
          employeeEsi: slip.employeeEsi,
          employerEsi: slip.employerEsi,
          professionalTax: slip.professionalTax,
          tds: slip.tds,
        });
      }

      const aggregated = Array.from(mergedMap.values()).reduce(
        (acc, item) => ({
          employeeCount: acc.employeeCount + 1,
          totalGross: acc.totalGross + item.grossEarnings,
          totalNet: acc.totalNet + item.netSalary,
          totalEmployeePf: acc.totalEmployeePf + item.employeePf,
          totalEmployerPf: acc.totalEmployerPf + item.employerPf,
          totalEmployeeEsi: acc.totalEmployeeEsi + item.employeeEsi,
          totalEmployerEsi: acc.totalEmployerEsi + item.employerEsi,
          totalPt: acc.totalPt + item.professionalTax,
          totalTds: acc.totalTds + item.tds,
        }),
        {
          employeeCount: 0,
          totalGross: 0,
          totalNet: 0,
          totalEmployeePf: 0,
          totalEmployerPf: 0,
          totalEmployeeEsi: 0,
          totalEmployerEsi: 0,
          totalPt: 0,
          totalTds: 0,
        }
      );

      const runPayload = {
        month: selectedMonth,
        status: existingRun?.status === 'locked' && isCompanyAdmin ? ('draft' as const) : (existingRun?.status || ('draft' as const)),
        ...aggregated,
      };

      if (existingRun) {
        await updateDocStrict('payrollRuns', runId, runPayload);
      } else {
        await createDocStrict('payrollRuns', runId, {
          runId,
          companyId: company.companyId,
          companyOwnerUid: currentEmployee.companyOwnerUid,
          ...runPayload,
        });
      }

      for (const slip of result.payslips) {
        const payslipId = `SLIP_${slip.employeeId}_${selectedMonth.replace('-', '')}`;
        const existingSlip = payslips.find((p) => p.payslipId === payslipId);
        if (existingSlip) {
          await updateDocStrict('payslips', payslipId, {
            runId,
            paidDays: slip.paidDays,
            unpaidDays: slip.unpaidDays,
            workingDays: slip.workingDays,
            presentDays: slip.presentDays,
            halfDays: slip.halfDays,
            paidLeaveDays: slip.paidLeaveDays,
            unpaidLeaveDays: slip.unpaidLeaveDays,
            absentDays: slip.absentDays,
            lateMarksCount: slip.lateMarksCount,
            lateDeductionDays: slip.lateDeductionDays,
            baseMonthlyGross: slip.baseMonthlyGross,
            leaveDeductionAmount: slip.leaveDeductionAmount,
            lateDeductionAmount: slip.lateDeductionAmount,
            grossEarnings: slip.grossEarnings,
            employeePf: slip.employeePf,
            employerPf: slip.employerPf,
            employeeEsi: slip.employeeEsi,
            employerEsi: slip.employerEsi,
            professionalTax: slip.professionalTax,
            tds: slip.tds,
            loanEmi: slip.loanEmi,
            overtimePay: slip.overtimePay,
            netSalary: slip.netSalary,
            paymentStatus: existingSlip.paymentStatus,
          });
        } else {
          await createDocStrict('payslips', payslipId, {
            payslipId,
            runId,
            companyId: company.companyId,
            companyOwnerUid: currentEmployee.companyOwnerUid,
            ...slip,
          });
        }
      }

      // Persist updated deduction rules to company policy if changed
      if (
        (company.attendancePolicy?.lateMarksPerDeduction ?? 3) !== lateThresholdNum ||
        (company.attendancePolicy?.lateDeductionDaysPerThreshold ?? 1) !== lateCutDaysNum ||
        Boolean(company.attendancePolicy?.prorateByAttendanceOnly ?? false) !== prorateByAttendanceOnly
      ) {
        await updateDocStrict('companies', company.companyId, {
          attendancePolicy: {
            enabledMethods: company.attendancePolicy?.enabledMethods || [
              'selfie_gps',
              'face_verification',
              'gps',
              'qr_code',
              'fingerprint',
              'manual_hr',
            ],
            faceConfidenceThreshold: company.attendancePolicy?.faceConfidenceThreshold ?? 80,
            maxVerificationRetries: company.attendancePolicy?.maxVerificationRetries ?? 3,
            requireLiveness: company.attendancePolicy?.requireLiveness ?? true,
            requireGeofence: company.attendancePolicy?.requireGeofence ?? true,
            allowWfhCheckIn: company.attendancePolicy?.allowWfhCheckIn ?? true,
            lateMarksPerDeduction: lateThresholdNum,
            lateDeductionDaysPerThreshold: lateCutDaysNum,
            prorateByAttendanceOnly,
          },
        });
      }

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'PAYROLL_CALCULATED',
        targetCollection: 'payrollRuns',
        targetId: runId,
        summary: `Calculated payroll (${scopeLabel}) for ${selectedMonth}: ${result.employeeCount} employee(s), Net ${formatCurrencyINR(result.totalNet)}.`,
      });

      setFeedback(
        `Calculated ${scopeLabel} for ${selectedMonth}: ${result.employeeCount} payslip(s) saved (${formatCurrencyINR(result.totalNet)} net).`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Payroll calculation failed.');
    } finally {
      setBusy(false);
      setCalculatingEmpId(null);
    }
  };

  const handleSaveDeductionPolicy = async () => {
    setBusy(true);
    setFeedback('');
    try {
      await updateDocStrict('companies', company.companyId, {
        attendancePolicy: {
          enabledMethods: company.attendancePolicy?.enabledMethods || [
            'selfie_gps',
            'face_verification',
            'gps',
            'qr_code',
            'fingerprint',
            'manual_hr',
          ],
          faceConfidenceThreshold: company.attendancePolicy?.faceConfidenceThreshold ?? 80,
          maxVerificationRetries: company.attendancePolicy?.maxVerificationRetries ?? 3,
          requireLiveness: company.attendancePolicy?.requireLiveness ?? true,
          requireGeofence: company.attendancePolicy?.requireGeofence ?? true,
          allowWfhCheckIn: company.attendancePolicy?.allowWfhCheckIn ?? true,
          lateMarksPerDeduction: lateThresholdNum,
          lateDeductionDaysPerThreshold: lateCutDaysNum,
          prorateByAttendanceOnly,
        },
      });
      setFeedback(
        lateThresholdNum === 0
          ? 'Saved payroll deduction rule: Late mark salary deduction is OFF.'
          : `Saved payroll deduction rule: Every ${lateThresholdNum} late mark(s) deducts ${lateCutDaysNum} day(s) of salary.`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to save deduction policy.');
    } finally {
      setBusy(false);
    }
  };

  const handleCalculateSelectedScope = () => {
    const scopeLabel =
      selectedPayrollEmpId === 'ALL'
        ? `all ${filteredEngineRows.length} employees`
        : filteredEngineRows[0]?.emp.fullName || 'selected employee';
    void runCalculationForRows(filteredEngineRows, scopeLabel);
  };

  const handleRunStatus = async (run: PayrollRun, nextStatus: PayrollRun['status']) => {
    setBusy(true);
    try {
      await updateDocStrict('payrollRuns', run.runId, { status: nextStatus });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: run.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: `PAYROLL_${nextStatus.toUpperCase()}`,
        targetCollection: 'payrollRuns',
        targetId: run.runId,
        summary: `Payroll run ${run.month} moved to ${nextStatus}.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const visiblePayslips =
    effectiveRole === 'employee'
      ? [...payslips.filter((p) => p.employeeId === currentEmployee.employeeId)].sort((a, b) =>
          b.month.localeCompare(a.month)
        )
      : payslips.filter(
          (p) =>
            p.month === selectedMonth &&
            (selectedPayrollEmpId === 'ALL' || p.employeeId === selectedPayrollEmpId)
        );

  const selectedScopeTotals = filteredEngineRows.reduce(
    (acc, row) => {
      const payableGross = row.savedPayslip?.grossEarnings ?? row.estPayableGross;
      const net = row.savedPayslip?.netSalary ?? row.estNetSalary;
      const leaveCut = row.savedPayslip?.leaveDeductionAmount ?? row.estLeaveCut;
      const lateCut = row.savedPayslip?.lateDeductionAmount ?? row.estLateCut;
      return {
        payableGross: acc.payableGross + payableGross,
        net: acc.net + net,
        deductions: acc.deductions + leaveCut + lateCut,
      };
    },
    { payableGross: 0, net: 0, deductions: 0 }
  );

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-800">
          {feedback}
        </div>
      )}

      {/* Monthly Payroll & Statutory Engine */}
      {canProcessPayroll && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  Monthly Payroll &amp; Statutory Engine (Employee-Wise)
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {effectiveRole === 'company_admin' ? 'Company Admin Authority' : 'HR Manager Authority'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Employee-wise calculation for EPF, ESI, {ptState} PT, TDS, Loan EMI + Attendance Working Days, Leave &amp; Late-Mark Salary Reduction
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <select
                value={selectedPayrollEmpId}
                onChange={(e) => setSelectedPayrollEmpId(e.target.value)}
                aria-label="Filter or calculate for specific employee"
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg max-w-[220px]"
              >
                <option value="ALL">All Employees ({employees.filter((e) => e.employmentStatus !== 'exited').length})</option>
                {employees
                  .filter((e) => e.employmentStatus !== 'exited')
                  .map((emp) => (
                    <option key={emp.employeeId} value={emp.employeeId}>
                      {emp.fullName} ({emp.employeeCode})
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={handleCalculateSelectedScope}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 whitespace-nowrap disabled:opacity-40"
              >
                <IndianRupee className="w-4 h-4" />
                {selectedPayrollEmpId === 'ALL' ? 'Calculate All Employees' : 'Calculate Selected Employee'}
              </button>
            </div>
          </div>

          {/* Late Mark & Working Day Salary Deduction Controls */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Late Marks Threshold (0 = Off)
                </label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={lateMarksPerCut}
                  onChange={(e) => setLateMarksPerCut(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Salary Cut Days Per Late Threshold
                </label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  step={0.5}
                  value={lateCutDays}
                  onChange={(e) => setLateCutDays(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Working-Day Salary Mode</label>
                <select
                  value={prorateByAttendanceOnly ? 'strict' : 'standard'}
                  onChange={(e) => setProrateByAttendanceOnly(e.target.value === 'strict')}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                >
                  <option value="standard">Monthly Gross minus LWP/Absent &amp; Late Marks</option>
                  <option value="strict">Pay Only Attendance Worked + Paid Leave Days</option>
                </select>
              </div>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveDeductionPolicy}
                  className="w-full px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-40"
                >
                  Save Rule
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              {lateThresholdNum === 0
                ? 'Late mark salary deduction is OFF (0). Employees will not have salary cut for late marks.'
                : `Rule active: Every ${lateThresholdNum} late mark(s) cuts ${lateCutDaysNum} day(s) of salary (e.g., ${lateThresholdNum} late marks = ${lateCutDaysNum}d cut; fewer than ${lateThresholdNum} = no cut).`}
            </p>
          </div>

          {/* Employee-Wise Scope KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="text-slate-500">Selected Scope Gross ({selectedMonth})</p>
              <p className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatCurrencyINR(selectedScopeTotals.payableGross)}
              </p>
            </div>
            <div className="p-3 bg-red-50/70 border border-red-200 rounded-lg">
              <p className="text-red-700">Attendance Leave + Late Cut</p>
              <p className="text-base font-bold font-mono tabular-nums text-red-700 mt-0.5">
                {selectedScopeTotals.deductions > 0
                  ? `-${formatCurrencyINR(selectedScopeTotals.deductions)}`
                  : formatCurrencyINR(0)}
              </p>
            </div>
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg">
              <p className="text-emerald-700">Estimated / Saved Net Payout</p>
              <p className="text-base font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                {formatCurrencyINR(selectedScopeTotals.net)}
              </p>
            </div>
          </div>

          {/* Employee-Wise Payroll & Statutory Calculation Display */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-800">
                Employee-Wise Calculation &amp; Statutory Breakdown ({selectedMonth})
              </p>
              <p className="text-[11px] text-slate-500">
                Click &ldquo;Calculate&rdquo; on any employee row to compute/update that employee&apos;s individual payslip &amp; monthly totals.
              </p>
            </div>

            {filteredEngineRows.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No active employees found.</p>
            ) : (
              <>
                <div className="hidden lg:block">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-medium text-slate-500">
                        <th className="py-2 pr-3">Employee &amp; Salary Structure</th>
                        <th className="py-2 pr-3">Attendance &amp; Late</th>
                        <th className="py-2 pr-3 text-right">Base Gross</th>
                        <th className="py-2 pr-3 text-right">Late / Leave Cut</th>
                        <th className="py-2 pr-3 text-right">Payable Gross</th>
                        <th className="py-2 pr-3 text-right">EPF / ESI / PT / TDS</th>
                        <th className="py-2 pr-3 text-right">Net Salary</th>
                        <th className="py-2 text-right">Employee Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEngineRows.map((row) => {
                        const slip = row.savedPayslip;
                        const lateCut = slip?.lateDeductionAmount ?? row.estLateCut;
                        const leaveCut = slip?.leaveDeductionAmount ?? row.estLeaveCut;
                        const payableGross = slip?.grossEarnings ?? row.estPayableGross;
                        const epf = slip?.employeePf ?? row.estEpF;
                        const esi = slip?.employeeEsi ?? row.estEsi;
                        const pt = slip?.professionalTax ?? row.estPt;
                        const tds = slip?.tds ?? row.estTds;
                        const emi = slip?.loanEmi ?? row.estLoanEmi;
                        const netPay = slip?.netSalary ?? row.estNetSalary;

                        return (
                          <tr key={row.emp.employeeId} className="hover:bg-slate-50">
                            <td className="py-2.5 pr-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-900">{row.emp.fullName}</span>
                                <span
                                  className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                                    slip
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-amber-50 text-amber-700'
                                  }`}
                                >
                                  {slip ? 'Calculated' : 'Preview'}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {row.emp.employeeCode} · {row.emp.department} ·{' '}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEmpId(row.emp.employeeId);
                                    structureCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  }}
                                  className="text-indigo-600 hover:underline font-medium inline-flex items-center gap-0.5"
                                >
                                  <SlidersHorizontal className="w-3 h-3" />
                                  {row.hasAssignedStructure ? 'Edit Salary' : 'Default ₹50k · Set Salary'}
                                </button>
                              </p>
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-700">
                              <p>
                                Worked {row.summary.workingDays}d · Paid {slip?.paidDays ?? row.summary.suggestedPaidDays}d
                              </p>
                              <p className="text-slate-500">
                                Late: {row.summary.lateMarksCount} ({row.summary.lateDeductionDays}d cut) · Abs/LWP: {row.summary.leaveDeductionDays}d
                              </p>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                              {formatCurrencyINR(row.baseGross)}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-red-600">
                              <p>
                                {lateCut + leaveCut > 0
                                  ? `-${formatCurrencyINR(lateCut + leaveCut)}`
                                  : formatCurrencyINR(0)}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                LM: {formatCurrencyINR(lateCut)} · L: {formatCurrencyINR(leaveCut)}
                              </p>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-900 font-medium">
                              {formatCurrencyINR(payableGross)}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[11px] text-slate-600">
                              <p>PF {formatCurrencyINR(epf)} · ESI {formatCurrencyINR(esi)}</p>
                              <p>
                                PT {formatCurrencyINR(pt)} · TDS {formatCurrencyINR(tds)}
                                {emi > 0 ? ` · EMI ${formatCurrencyINR(emi)}` : ''}
                              </p>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-bold text-emerald-700">
                              {formatCurrencyINR(netPay)}
                            </td>
                            <td className="py-2.5 text-right">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void runCalculationForRows([row], row.emp.fullName)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                              >
                                <Calculator className="w-3.5 h-3.5" />
                                {calculatingEmpId === row.emp.employeeId
                                  ? 'Calculating...'
                                  : slip
                                    ? 'Recalculate'
                                    : 'Calculate'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile & Tablet Employee-Wise Cards (Zero Horizontal Scroll) */}
                <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredEngineRows.map((row) => {
                    const slip = row.savedPayslip;
                    const lateCut = slip?.lateDeductionAmount ?? row.estLateCut;
                    const leaveCut = slip?.leaveDeductionAmount ?? row.estLeaveCut;
                    const payableGross = slip?.grossEarnings ?? row.estPayableGross;
                    const epf = slip?.employeePf ?? row.estEpF;
                    const esi = slip?.employeeEsi ?? row.estEsi;
                    const pt = slip?.professionalTax ?? row.estPt;
                    const tds = slip?.tds ?? row.estTds;
                    const netPay = slip?.netSalary ?? row.estNetSalary;

                    return (
                      <div
                        key={row.emp.employeeId}
                        className="p-3.5 border border-slate-200 rounded-xl text-xs space-y-2 bg-white"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate">{row.emp.fullName}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {row.emp.employeeCode} · {row.emp.department}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded shrink-0 ${
                              slip ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {slip ? 'Calculated' : 'Preview'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 font-mono bg-slate-50 p-2 rounded-lg text-[11px]">
                          <div>
                            <span className="text-slate-500">Worked / Paid</span>
                            <p className="font-semibold text-slate-900">
                              {row.summary.workingDays}d / {slip?.paidDays ?? row.summary.suggestedPaidDays}d
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500">Base → Payable</span>
                            <p className="font-semibold text-slate-900">
                              {formatCurrencyINR(row.baseGross)} → {formatCurrencyINR(payableGross)}
                            </p>
                          </div>
                          <div>
                            <span className="text-red-600">Late / Leave Cut</span>
                            <p className="font-semibold text-red-600">
                              {lateCut + leaveCut > 0
                                ? `-${formatCurrencyINR(lateCut + leaveCut)}`
                                : formatCurrencyINR(0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500">PF / ESI / PT / TDS</span>
                            <p className="font-semibold text-slate-800">
                              {formatCurrencyINR(epf + esi + pt + tds)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <div>
                            <span className="text-[11px] text-slate-500">Net Salary: </span>
                            <span className="font-mono font-bold text-sm text-emerald-700">
                              {formatCurrencyINR(netPay)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEmpId(row.emp.employeeId);
                                structureCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }}
                              className="px-2 py-1.5 text-[11px] font-medium text-indigo-700 bg-indigo-50 rounded-lg"
                            >
                              Salary
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void runCalculationForRows([row], row.emp.fullName)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-slate-900 rounded-lg disabled:opacity-40"
                            >
                              {calculatingEmpId === row.emp.employeeId
                                ? 'Running...'
                                : slip
                                  ? 'Recalculate'
                                  : 'Calculate'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {payrollRuns.length > 0 && (
            <div className="divide-y divide-slate-100 border-t border-slate-200 pt-3">
              {payrollRuns.map((run) => (
                <div
                  key={run.runId}
                  className="py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">
                      Period <span className="font-mono">{run.month}</span> · {run.employeeCount} Employees ·{' '}
                      <span className="uppercase text-indigo-600">{run.status}</span>
                    </p>
                    <p className="text-xs font-mono tabular-nums text-slate-600">
                      Gross {formatCurrencyINR(run.totalGross)} · Net {formatCurrencyINR(run.totalNet)} · EE PF{' '}
                      {formatCurrencyINR(run.totalEmployeePf)} · ER PF {formatCurrencyINR(run.totalEmployerPf)} · PT{' '}
                      {formatCurrencyINR(run.totalPt)} · TDS {formatCurrencyINR(run.totalTds)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {run.status === 'draft' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRunStatus(run, 'reviewed')}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200"
                      >
                        Mark Reviewed
                      </button>
                    )}
                    {run.status === 'reviewed' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRunStatus(run, 'approved')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve Payroll
                      </button>
                    )}
                    {run.status === 'approved' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRunStatus(run, 'locked')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        Lock Payroll
                      </button>
                    )}
                    {run.status === 'locked' && isCompanyAdmin && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRunStatus(run, 'draft')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 rounded-lg hover:bg-amber-200"
                      >
                        <Unlock className="w-3.5 h-3.5" />
                        Admin Unlock
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        exportToExcel(
                          `Bank_Payout_${run.month}`,
                          'BankPayout',
                          payslips
                            .filter((p) => p.month === run.month)
                            .map((p) => ({
                              EmployeeID: p.employeeId,
                              EmployeeName: p.employeeName,
                              WorkingDays: p.workingDays ?? p.paidDays ?? 0,
                              PaidDays: p.paidDays ?? 30,
                              LateMarks: p.lateMarksCount ?? 0,
                              LeaveDeductionINR: p.leaveDeductionAmount ?? 0,
                              LateDeductionINR: p.lateDeductionAmount ?? 0,
                              NetSalaryINR: p.netSalary,
                              PaymentStatus: p.paymentStatus,
                            }))
                        )
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Bank Export
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payslips Table with Attendance Days, Late Mark Cut, Leave Cut */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">
            {effectiveRole === 'employee' ? 'My Payslips & Attendance Deductions' : `Generated Payslips (${selectedMonth})`}
          </h3>
        </div>

        {visiblePayslips.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            No payslips generated for this selection yet.
          </p>
        ) : (
          <>
            <div className="hidden lg:block">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pr-3">Employee &amp; Working Days</th>
                    <th className="py-2.5 pr-3">Month</th>
                    <th className="py-2.5 pr-3 text-right">Base Gross</th>
                    <th className="py-2.5 pr-3 text-right">Leave / Late Cut</th>
                    <th className="py-2.5 pr-3 text-right">Payable Gross</th>
                    <th className="py-2.5 pr-3 text-right">PF/ESI/PT/TDS</th>
                    <th className="py-2.5 pr-3 text-right">Net Pay</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visiblePayslips.map((slip) => {
                    const emp = employees.find((e) => e.employeeId === slip.employeeId);
                    const totalStatutory =
                      (slip.employeePf || 0) +
                      (slip.employeeEsi || 0) +
                      (slip.professionalTax || 0) +
                      (slip.tds || 0);
                    const leaveCut = slip.leaveDeductionAmount || 0;
                    const lateCut = slip.lateDeductionAmount || 0;
                    return (
                      <tr key={slip.payslipId} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3">
                          <p className="font-medium text-slate-900">{slip.employeeName}</p>
                          <p className="text-xs text-slate-500 font-mono">
                            Worked {slip.workingDays ?? slip.paidDays ?? 0}d · Paid {slip.paidDays ?? 30}d · Late Marks: {slip.lateMarksCount ?? 0}
                          </p>
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-slate-700">{slip.month}</td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs text-slate-700">
                          {formatCurrencyINR(slip.baseMonthlyGross ?? slip.grossEarnings)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs text-red-600">
                          <p>
                            {leaveCut + lateCut > 0
                              ? `-${formatCurrencyINR(leaveCut + lateCut)}`
                              : formatCurrencyINR(0)}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            L: {formatCurrencyINR(leaveCut)} · LM: {formatCurrencyINR(lateCut)}
                          </p>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-900">
                          {formatCurrencyINR(slip.grossEarnings)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs text-slate-600">
                          {formatCurrencyINR(totalStatutory)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                          {formatCurrencyINR(slip.netSalary)}
                        </td>
                        <td className="py-2.5 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => downloadPayslipPdf(slip, company, emp)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 rounded"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            PDF
                          </button>
                          {canProcessPayroll && slip.paymentStatus === 'pending' && (
                            <button
                              type="button"
                              onClick={() =>
                                updateDocStrict('payslips', slip.payslipId, { paymentStatus: 'paid' })
                              }
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 rounded"
                            >
                              Mark Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden divide-y divide-slate-100">
              {visiblePayslips.map((slip) => {
                const emp = employees.find((e) => e.employeeId === slip.employeeId);
                const leaveCut = slip.leaveDeductionAmount || 0;
                const lateCut = slip.lateDeductionAmount || 0;
                return (
                  <div key={slip.payslipId} className="py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{slip.employeeName}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          {slip.month} · Worked {slip.workingDays ?? slip.paidDays ?? 0}d · Paid {slip.paidDays ?? 30}d
                        </p>
                        <p className="text-[11px] text-red-600 font-mono">
                          Late Marks: {slip.lateMarksCount ?? 0} ({lateCut > 0 ? `-${formatCurrencyINR(lateCut)}` : formatCurrencyINR(0)}) · Leave Cut: {leaveCut > 0 ? `-${formatCurrencyINR(leaveCut)}` : formatCurrencyINR(0)}
                        </p>
                      </div>
                      <span className="text-sm font-bold font-mono tabular-nums text-emerald-700 shrink-0">
                        {formatCurrencyINR(slip.netSalary)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => downloadPayslipPdf(slip, company, emp)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        Download PDF
                      </button>
                      {canProcessPayroll && slip.paymentStatus === 'pending' && (
                        <button
                          type="button"
                          onClick={() =>
                            updateDocStrict('payslips', slip.payslipId, { paymentStatus: 'paid' })
                          }
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg"
                        >
                          Mark Paid
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Salary Structure Assignment & Live EPF/ESI Preview */}
      {canProcessPayroll && (
        <div ref={structureCardRef} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Employee Salary Structure Assignment</h3>
            <form onSubmit={handleSaveSalaryStructure} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Employee</label>
                <select
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  {employees.map((e) => (
                    <option key={e.employeeId} value={e.employeeId}>
                      {e.fullName} ({e.employeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Basic (INR/mo)</label>
                <input
                  type="number"
                  value={basic}
                  onChange={(e) => setBasic(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">HRA (INR/mo)</label>
                <input
                  type="number"
                  value={hra}
                  onChange={(e) => setHra(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Conveyance</label>
                <input
                  type="number"
                  value={conveyance}
                  onChange={(e) => setConveyance(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Medical Allowance</label>
                <input
                  type="number"
                  value={medical}
                  onChange={(e) => setMedical(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Special Allowance</label>
                <input
                  type="number"
                  value={specialAllowance}
                  onChange={(e) => setSpecialAllowance(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Income Tax Regime</label>
                <select
                  value={taxRegime}
                  onChange={(e) => setTaxRegime(e.target.value as 'new' | 'old')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  <option value="new">New Tax Regime (FY 2025-26)</option>
                  <option value="old">Old Tax Regime</option>
                </select>
              </div>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-4 text-xs text-slate-700 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={pfApplicable} onChange={(e) => setPfApplicable(e.target.checked)} />
                  <span>EPF Applicable</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={esiApplicable} onChange={(e) => setEsiApplicable(e.target.checked)} />
                  <span>ESI Applicable</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={ptApplicable} onChange={(e) => setPtApplicable(e.target.checked)} />
                  <span>Professional Tax</span>
                </label>
              </div>
              <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                >
                  Assign Salary Structure
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handlePreviewStatutory}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                >
                  <Calculator className="w-4 h-4" />
                  Preview PF / ESI Breakdown
                </button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Statutory Contribution Preview</h3>
            {statPreview ? (
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <dt className="text-slate-500">PF Wage (Capped)</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                    {formatCurrencyINR(statPreview.pfWage)}
                  </dd>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <dt className="text-slate-500">Employee EPF (12%)</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                    {formatCurrencyINR(statPreview.employeePf)}
                  </dd>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <dt className="text-slate-500">Employer EPF (3.67%)</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                    {formatCurrencyINR(statPreview.employerEpf)}
                  </dd>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <dt className="text-slate-500">Employer EPS (8.33%)</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                    {formatCurrencyINR(statPreview.employerEps)}
                  </dd>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <dt className="text-slate-500">Employer EDLI (0.5%)</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                    {formatCurrencyINR(statPreview.employerEdli)}
                  </dd>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <dt className="text-slate-500">ESI (EE 0.75% / ER 3.25%)</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                    {formatCurrencyINR(statPreview.employeeEsi)} / {formatCurrencyINR(statPreview.employerEsi)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-slate-500 py-8 text-center">
                Click &ldquo;Preview PF / ESI Breakdown&rdquo; to compute exact EPFO and ESIC contributions from the backend API.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
