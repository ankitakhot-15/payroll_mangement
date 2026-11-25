import React, { useEffect, useState } from 'react';
import { Wallet, Receipt, Download, Settings2, CheckCircle2, XCircle } from 'lucide-react';
import {
  AttendanceMethod,
  AttendanceRecord,
  AuditLog,
  Company,
  Employee,
  LoanAdvance,
  PayrollRun,
  Payslip,
  Reimbursement,
  UserRole,
} from '../types/payroll';
import { createDocStrict, logAuditEvent, makeId, updateDocStrict } from '../services/firestoreService';
import { exportToExcel, formatCurrencyINR, todayIsoDate } from '../utils/exports';

interface LoansReimbursementsProps {
  mode: 'loans-reimbursements' | 'reports-settings';
  company: Company;
  currentEmployee: Employee;
  effectiveRole: UserRole;
  loans: LoanAdvance[];
  reimbursements: Reimbursement[];
  attendance: AttendanceRecord[];
  payrollRuns: PayrollRun[];
  payslips: Payslip[];
  auditLogs: AuditLog[];
}

export const LoansReimbursementsReportsPage: React.FC<LoansReimbursementsProps> = ({
  mode,
  company,
  currentEmployee,
  effectiveRole,
  loans,
  reimbursements,
  attendance,
  payrollRuns,
  payslips,
  auditLogs,
}) => {
  const canApprove = ['super_admin', 'company_admin', 'hr_manager', 'accountant'].includes(effectiveRole);

  // Loan form
  const [loanKind, setLoanKind] = useState<'loan' | 'salary_advance'>('loan');
  const [principal, setPrincipal] = useState('25000');
  const [monthlyEmi, setMonthlyEmi] = useState('5000');
  const [loanReason, setLoanReason] = useState('');

  // Reimbursement form
  const [expCategory, setExpCategory] = useState<Reimbursement['category']>('travel');
  const [expAmount, setExpAmount] = useState('1200');
  const [expDate, setExpDate] = useState(todayIsoDate());
  const [expDesc, setExpDesc] = useState('');

  // Company Policy settings
  const [enabledMethods, setEnabledMethods] = useState<AttendanceMethod[]>(
    company.attendancePolicy?.enabledMethods || ['selfie_gps', 'face_verification', 'gps', 'qr_code', 'fingerprint', 'manual_hr']
  );
  const [faceThreshold, setFaceThreshold] = useState(
    String(company.attendancePolicy?.faceConfidenceThreshold ?? 80)
  );
  const [maxRetries, setMaxRetries] = useState(
    String(company.attendancePolicy?.maxVerificationRetries ?? 3)
  );
  const [requireGeofence, setRequireGeofence] = useState(
    company.attendancePolicy?.requireGeofence ?? true
  );
  const [allowWfh, setAllowWfh] = useState(company.attendancePolicy?.allowWfhCheckIn ?? true);
  const [ptState, setPtState] = useState<'Maharashtra' | 'Karnataka' | 'Gujarat' | 'Exempt'>(
    company.statutoryConfig?.ptState || 'Maharashtra'
  );
  const [pfCeiling, setPfCeiling] = useState(String(company.statutoryConfig?.pfWageCeiling ?? 15000));
  const [esiCeiling, setEsiCeiling] = useState(String(company.statutoryConfig?.esiWageCeiling ?? 21000));
  const [lateMarksThreshold, setLateMarksThreshold] = useState(
    String(company.attendancePolicy?.lateMarksPerDeduction ?? 3)
  );
  const [lateDeductionDays, setLateDeductionDays] = useState(
    String(company.attendancePolicy?.lateDeductionDaysPerThreshold ?? 1)
  );
  const [prorateByAttendanceOnly, setProrateByAttendanceOnly] = useState(
    Boolean(company.attendancePolicy?.prorateByAttendanceOnly ?? false)
  );

  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    setEnabledMethods(
      company.attendancePolicy?.enabledMethods || [
        'selfie_gps',
        'face_verification',
        'gps',
        'qr_code',
        'fingerprint',
        'manual_hr',
      ]
    );
    setFaceThreshold(String(company.attendancePolicy?.faceConfidenceThreshold ?? 80));
    setMaxRetries(String(company.attendancePolicy?.maxVerificationRetries ?? 3));
    setRequireGeofence(company.attendancePolicy?.requireGeofence ?? true);
    setAllowWfh(company.attendancePolicy?.allowWfhCheckIn ?? true);
    setPtState(company.statutoryConfig?.ptState || 'Maharashtra');
    setPfCeiling(String(company.statutoryConfig?.pfWageCeiling ?? 15000));
    setEsiCeiling(String(company.statutoryConfig?.esiWageCeiling ?? 21000));
    setLateMarksThreshold(String(company.attendancePolicy?.lateMarksPerDeduction ?? 3));
    setLateDeductionDays(String(company.attendancePolicy?.lateDeductionDaysPerThreshold ?? 1));
    setProrateByAttendanceOnly(Boolean(company.attendancePolicy?.prorateByAttendanceOnly ?? false));
  }, [company]);

  const handleApplyLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanReason.trim()) return;
    setBusy(true);
    try {
      const loanId = makeId('LN');
      const amt = Number(principal) || 10000;
      const emi = Number(monthlyEmi) || 2000;
      await createDocStrict('loans', loanId, {
        loanId,
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        employeeId: currentEmployee.employeeId,
        employeeUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        employeeName: currentEmployee.fullName,
        kind: loanKind,
        principalAmount: amt,
        monthlyEmi: emi,
        outstandingBalance: amt,
        reason: loanReason.trim(),
        status: 'pending',
      });
      setLoanReason('');
    } finally {
      setBusy(false);
    }
  };

  const handleApplyReimbursement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expDesc.trim()) return;
    setBusy(true);
    try {
      const reimbursementId = makeId('RMB');
      await createDocStrict('reimbursements', reimbursementId, {
        reimbursementId,
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        employeeId: currentEmployee.employeeId,
        employeeUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        employeeName: currentEmployee.fullName,
        category: expCategory,
        amount: Number(expAmount) || 100,
        expenseDate: expDate,
        description: expDesc.trim(),
        status: 'pending',
      });
      setExpDesc('');
    } finally {
      setBusy(false);
    }
  };

  const toggleMethod = (m: AttendanceMethod) => {
    setEnabledMethods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSavedMsg('');
    try {
      await updateDocStrict('companies', company.companyId, {
        attendancePolicy: {
          enabledMethods,
          faceConfidenceThreshold: Number(faceThreshold) || 80,
          maxVerificationRetries: Number(maxRetries) || 3,
          requireLiveness: true,
          requireGeofence,
          allowWfhCheckIn: allowWfh,
          lateMarksPerDeduction: Math.max(0, Number(lateMarksThreshold) || 0),
          lateDeductionDaysPerThreshold: Math.max(0, Number(lateDeductionDays) || 0),
          prorateByAttendanceOnly,
        },
        statutoryConfig: {
          pfRateEmployee: 0.12,
          pfRateEmployer: 0.125,
          pfWageCeiling: Number(pfCeiling) || 15000,
          esiEmployeeRate: 0.0075,
          esiEmployerRate: 0.0325,
          esiWageCeiling: Number(esiCeiling) || 21000,
          ptState,
        },
      });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'COMPANY_POLICY_UPDATED',
        targetCollection: 'companies',
        targetId: company.companyId,
        summary: `Updated attendance policy (${enabledMethods.length} methods) and statutory settings (${ptState}).`,
      });
      setSavedMsg('Company policies saved to Firestore.');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'loans-reimbursements') {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Loans & Advances */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-semibold text-slate-900">Loans &amp; Salary Advances</h2>
            </div>

            <form onSubmit={handleApplyLoan} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={loanKind}
                onChange={(e) => setLoanKind(e.target.value as 'loan' | 'salary_advance')}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              >
                <option value="loan">Employee Loan</option>
                <option value="salary_advance">Salary Advance</option>
              </select>
              <input
                type="number"
                required
                min={500}
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                placeholder="Amount (INR)"
                className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
              <input
                type="number"
                required
                min={100}
                value={monthlyEmi}
                onChange={(e) => setMonthlyEmi(e.target.value)}
                placeholder="Monthly EMI"
                className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                required
                value={loanReason}
                onChange={(e) => setLoanReason(e.target.value)}
                placeholder="Purpose of loan / advance"
                className="sm:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                Apply
              </button>
            </form>

            <div className="divide-y divide-slate-100">
              {loans.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No loan or advance applications yet.</p>
              ) : (
                loans.map((ln) => (
                  <div key={ln.loanId} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {ln.employeeName} · {ln.kind.replace('_', ' ')} ({formatCurrencyINR(ln.principalAmount)})
                      </p>
                      <p className="text-slate-500 font-mono tabular-nums">
                        EMI {formatCurrencyINR(ln.monthlyEmi)} · Balance {formatCurrencyINR(ln.outstandingBalance)} ·{' '}
                        <span className="font-sans font-semibold capitalize text-slate-800">{ln.status}</span>
                      </p>
                    </div>
                    {canApprove && ln.status === 'pending' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateDocStrict('loans', ln.loanId, { status: 'approved' })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-semibold text-white bg-emerald-600 rounded"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => updateDocStrict('loans', ln.loanId, { status: 'rejected' })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-red-700 bg-red-50 rounded"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Reimbursements */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-semibold text-slate-900">Expense Reimbursements</h2>
            </div>

            <form onSubmit={handleApplyReimbursement} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value as Reimbursement['category'])}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              >
                <option value="travel">Travel</option>
                <option value="food">Food</option>
                <option value="fuel">Fuel</option>
                <option value="medical">Medical</option>
                <option value="accommodation">Accommodation</option>
                <option value="internet">Internet</option>
                <option value="other">Other</option>
              </select>
              <input
                type="number"
                required
                min={1}
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                placeholder="Amount (INR)"
                className="px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg"
              />
              <input
                type="date"
                required
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                required
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="Expense description / invoice ref"
                className="sm:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                Submit Claim
              </button>
            </form>

            <div className="divide-y divide-slate-100">
              {reimbursements.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No reimbursement claims submitted yet.</p>
              ) : (
                reimbursements.map((rb) => (
                  <div
                    key={rb.reimbursementId}
                    className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {rb.employeeName} · <span className="capitalize">{rb.category}</span> ({formatCurrencyINR(rb.amount)})
                      </p>
                      <p className="text-slate-500">
                        {rb.expenseDate} · {rb.description} ·{' '}
                        <span className="font-semibold capitalize text-slate-800">{rb.status}</span>
                      </p>
                    </div>
                    {canApprove && rb.status === 'pending' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateDocStrict('reimbursements', rb.reimbursementId, { status: 'approved' })}
                          className="px-2.5 py-1 font-semibold text-white bg-emerald-600 rounded"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => updateDocStrict('reimbursements', rb.reimbursementId, { status: 'rejected' })}
                          className="px-2.5 py-1 font-medium text-red-700 bg-red-50 rounded"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {canApprove && rb.status === 'approved' && (
                      <button
                        type="button"
                        onClick={() => updateDocStrict('reimbursements', rb.reimbursementId, { status: 'paid' })}
                        className="px-2.5 py-1 font-semibold text-white bg-indigo-600 rounded shrink-0"
                      >
                        Mark Paid
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reports & Statutory Exports */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Statutory &amp; Operational Exports</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() =>
              exportToExcel(
                'Report_Attendance_Summary',
                'Attendance',
                attendance.map((a) => ({
                  EmployeeID: a.employeeId,
                  EmployeeName: a.employeeName,
                  Date: a.date,
                  Method: a.attendanceMethod,
                  WorkingMinutes: a.workingMinutes || 0,
                  LateMinutes: a.lateMinutes || 0,
                  OvertimeMinutes: a.overtimeMinutes || 0,
                  Status: a.attendanceStatus,
                }))
              )
            }
            className="flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:bg-slate-50 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">Attendance Register</p>
              <p className="text-xs text-slate-500">{attendance.length} records</p>
            </div>
            <Download className="w-4 h-4 text-indigo-600 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() =>
              exportToExcel(
                'Report_Payroll_Runs',
                'PayrollRuns',
                payrollRuns.map((r) => ({
                  Month: r.month,
                  Status: r.status,
                  Employees: r.employeeCount,
                  TotalGross: r.totalGross,
                  TotalNet: r.totalNet,
                  EmployeePF: r.totalEmployeePf || 0,
                  EmployerPF: r.totalEmployerPf || 0,
                  PT: r.totalPt || 0,
                  TDS: r.totalTds || 0,
                }))
              )
            }
            className="flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:bg-slate-50 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">Monthly Payroll Summary</p>
              <p className="text-xs text-slate-500">{payrollRuns.length} payroll runs</p>
            </div>
            <Download className="w-4 h-4 text-indigo-600 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() =>
              exportToExcel(
                'EPFO_ECR_Export',
                'PF_ECR',
                payslips.map((p) => ({
                  EmployeeID: p.employeeId,
                  MemberName: p.employeeName,
                  Month: p.month,
                  GrossWages: p.grossEarnings,
                  EmployeePF_12Pct: p.employeePf || 0,
                  EmployerPF_Total: p.employerPf || 0,
                }))
              )
            }
            className="flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:bg-slate-50 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">EPFO PF ECR Export</p>
              <p className="text-xs text-slate-500">{payslips.length} member lines</p>
            </div>
            <Download className="w-4 h-4 text-indigo-600 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() =>
              exportToExcel(
                'ESIC_Monthly_Return',
                'ESI_Return',
                payslips.map((p) => ({
                  EmployeeID: p.employeeId,
                  EmployeeName: p.employeeName,
                  Month: p.month,
                  GrossWages: p.grossEarnings,
                  EmployeeESI: p.employeeEsi || 0,
                  EmployerESI: p.employerEsi || 0,
                }))
              )
            }
            className="flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:bg-slate-50 text-left"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">ESIC Monthly Return</p>
              <p className="text-xs text-slate-500">{payslips.length} records</p>
            </div>
            <Download className="w-4 h-4 text-indigo-600 shrink-0" />
          </button>
        </div>
      </div>

      {/* Company Attendance & Statutory Settings */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-slate-900">Biometric Policy &amp; Statutory Configuration</h3>
        </div>

        {savedMsg && (
          <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            {savedMsg}
          </p>
        )}

        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">Enabled Attendance Methods</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
              {(
                [
                  ['selfie_gps', 'Selfie + GPS'],
                  ['face_verification', 'Face Match'],
                  ['gps', 'GPS Only'],
                  ['qr_code', 'QR Code'],
                  ['fingerprint', 'Fingerprint'],
                  ['manual_hr', 'Manual HR'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-lg cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={enabledMethods.includes(key)}
                    onChange={() => toggleMethod(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Face Confidence (%)</label>
              <input
                type="number"
                min={50}
                max={99}
                value={faceThreshold}
                onChange={(e) => setFaceThreshold(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Max Retry Attempts</label>
              <input
                type="number"
                min={1}
                max={10}
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">PT State Rule</label>
              <select
                value={ptState}
                onChange={(e) => setPtState(e.target.value as typeof ptState)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              >
                <option value="Maharashtra">Maharashtra</option>
                <option value="Karnataka">Karnataka</option>
                <option value="Gujarat">Gujarat</option>
                <option value="Exempt">Exempt</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">PF Wage Ceiling (INR)</label>
              <input
                type="number"
                value={pfCeiling}
                onChange={(e) => setPfCeiling(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">ESI Wage Ceiling (INR)</label>
              <input
                type="number"
                value={esiCeiling}
                onChange={(e) => setEsiCeiling(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Late Marks Threshold (0 = Off)
              </label>
              <input
                type="number"
                min={0}
                max={31}
                value={lateMarksThreshold}
                onChange={(e) => setLateMarksThreshold(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                {Number(lateMarksThreshold) <= 0
                  ? 'Off: late marks will not cut salary.'
                  : `Every ${Number(lateMarksThreshold)} late marks cuts ${Number(lateDeductionDays) || 0} day(s) salary.`}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Salary Cut Days Per Late Threshold
              </label>
              <input
                type="number"
                min={0}
                max={31}
                step={0.5}
                value={lateDeductionDays}
                onChange={(e) => setLateDeductionDays(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Days deducted each time late marks reach the threshold.
              </p>
            </div>
            <div className="flex items-center pb-2">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prorateByAttendanceOnly}
                  onChange={(e) => setProrateByAttendanceOnly(e.target.checked)}
                />
                <span>Pay Strictly by Attended + Paid Leave Days</span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requireGeofence}
                onChange={(e) => setRequireGeofence(e.target.checked)}
              />
              <span>Enforce Office Geofence on On-Site Punches</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={allowWfh} onChange={(e) => setAllowWfh(e.target.checked)} />
              <span>Allow Work-From-Home Policy Fallback</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
          >
            Save Policy Settings
          </button>
        </form>
      </div>

      {/* Audit Log Stream */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h3 className="text-base font-semibold text-slate-900">Compliance Audit Trail</h3>
        {auditLogs.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No audit events recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.logId} className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs">
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-slate-900">{log.action}</span>
                  <span className="text-slate-600"> — {log.summary}</span>
                </div>
                <span className="text-slate-400 shrink-0">{log.actorName}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
