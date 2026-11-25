import React, { useEffect, useState } from 'react';
import { Download, CheckCircle2, XCircle, Eye, X, UserCheck } from 'lucide-react';
import {
  AttendanceCorrection,
  AttendanceRecord,
  Company,
  Employee,
  LeaveRequest,
} from '../types/payroll';
import { currentYearMonth, exportToExcel, formatMinutes, todayIsoDate } from '../utils/exports';
import { computeMonthlyAttendanceSummary } from '../utils/attendanceSummary';
import { createDocStrict, logAuditEvent, updateDocStrict } from '../services/firestoreService';

interface AdminAttendancePageProps {
  company: Company;
  currentEmployee: Employee;
  employees: Employee[];
  attendance: AttendanceRecord[];
  corrections: AttendanceCorrection[];
  leaves: LeaveRequest[];
}

export const AdminAttendancePage: React.FC<AdminAttendancePageProps> = ({
  company,
  currentEmployee,
  employees,
  attendance,
  corrections,
  leaves,
}) => {
  const [dateFilter, setDateFilter] = useState(todayIsoDate());
  const [monthFilter, setMonthFilter] = useState(currentYearMonth());
  const [deptFilter, setDeptFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [rejectingCorr, setRejectingCorr] = useState<AttendanceCorrection | null>(null);
  const [corrRejectNote, setCorrRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Manual HR / Admin attendance marking state
  const [markEmpId, setMarkEmpId] = useState(employees[0]?.employeeId || '');
  const [markDate, setMarkDate] = useState(todayIsoDate());
  const [markStatus, setMarkStatus] = useState<'present' | 'late' | 'half_day' | 'absent' | 'wfh'>('late');
  const [markLateMinutes, setMarkLateMinutes] = useState('30');
  const [markFeedback, setMarkFeedback] = useState('');

  useEffect(() => {
    if (!markEmpId && employees.length > 0) {
      setMarkEmpId(employees[0].employeeId);
    }
  }, [markEmpId, employees]);

  const dayRecords = attendance.filter((a) => !dateFilter || a.date === dateFilter);
  const presentCount = dayRecords.filter((a) =>
    ['present', 'on_break', 'checked_out', 'late', 'wfh'].includes(a.attendanceStatus)
  ).length;
  const lateCount = dayRecords.filter((a) => (a.lateMinutes || 0) > 0).length;
  const wfhCount = dayRecords.filter((a) => a.attendanceStatus === 'wfh').length;
  const incompleteCount = dayRecords.filter((a) => a.checkInAt && !a.checkOutAt).length;
  const onLeaveCount = leaves.filter(
    (l) => l.status === 'approved' && dateFilter >= l.startDate && dateFilter <= l.endDate
  ).length;
  const absentCount = Math.max(0, employees.length - presentCount - onLeaveCount);
  const pendingCorrections = corrections.filter((c) => c.status.startsWith('pending'));

  const departments = Array.from(new Set(employees.map((e) => e.department).filter(Boolean)));

  const filtered = dayRecords.filter((rec) => {
    if (deptFilter !== 'all' && rec.department !== deptFilter) return false;
    if (methodFilter !== 'all' && rec.attendanceMethod !== methodFilter) return false;
    if (
      search.trim() &&
      !rec.employeeName.toLowerCase().includes(search.toLowerCase()) &&
      !rec.employeeId.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const handleAttendanceApproval = async (rec: AttendanceRecord, approvalStatus: 'approved' | 'rejected') => {
    setBusy(true);
    try {
      await updateDocStrict('attendance', rec.attendanceId, {
        approvalStatus,
        ...(approvalStatus === 'rejected' ? { attendanceStatus: 'absent' } : {}),
      });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: rec.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: `ATTENDANCE_${approvalStatus.toUpperCase()}`,
        targetCollection: 'attendance',
        targetId: rec.attendanceId,
        summary: `${currentEmployee.fullName} marked ${rec.employeeName} (${rec.date}) as ${approvalStatus}.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCorrectionAction = async (
    corr: AttendanceCorrection,
    nextStatus: 'pending_hr' | 'approved' | 'rejected',
    reviewNote?: string
  ) => {
    setBusy(true);
    try {
      await updateDocStrict('attendanceCorrections', corr.correctionId, {
        status: nextStatus,
        ...(reviewNote ? { reviewNote: reviewNote.slice(0, 280) } : {}),
      });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: corr.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: `CORRECTION_${nextStatus.toUpperCase()}`,
        targetCollection: 'attendanceCorrections',
        targetId: corr.correctionId,
        summary: `Updated correction for ${corr.employeeName} (${corr.date}) to ${nextStatus}${reviewNote ? `: ${reviewNote}` : ''}.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleManualMarkAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmp = employees.find((emp) => emp.employeeId === markEmpId);
    if (!targetEmp || !markDate) return;

    setBusy(true);
    setMarkFeedback('');
    try {
      const existing = attendance.find(
        (a) => a.employeeId === targetEmp.employeeId && a.date === markDate
      );
      const lateMins =
        markStatus === 'late'
          ? Math.max(1, Number(markLateMinutes) || 15)
          : markStatus === 'present' || markStatus === 'wfh'
            ? Math.max(0, Number(markLateMinutes) || 0)
            : 0;
      const workMins =
        markStatus === 'absent' ? 0 : markStatus === 'half_day' ? 240 : 480;

      if (existing) {
        await updateDocStrict('attendance', existing.attendanceId, {
          attendanceStatus: markStatus,
          lateMinutes: lateMins,
          workingMinutes: workMins,
          approvalStatus: 'approved',
        });
      } else {
        const attendanceId = `ATT_${targetEmp.employeeId}_${markDate.replace(/-/g, '')}`;
        await createDocStrict('attendance', attendanceId, {
          attendanceId,
          companyId: company.companyId,
          companyOwnerUid: currentEmployee.companyOwnerUid,
          employeeId: targetEmp.employeeId,
          employeeUid: targetEmp.employeeUid || currentEmployee.companyOwnerUid,
          employeeName: targetEmp.fullName,
          department: targetEmp.department || 'General',
          date: markDate,
          attendanceMethod: 'manual_hr',
          attendanceStatus: markStatus,
          faceVerification: 'not_required',
          livenessStatus: 'not_required',
          gpsStatus: 'not_required',
          workingMinutes: workMins,
          breakMinutes: 0,
          overtimeMinutes: 0,
          lateMinutes: lateMins,
          approvalStatus: 'approved',
        });
      }

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'ATTENDANCE_MANUAL_MARKED',
        targetCollection: 'attendance',
        targetId: existing?.attendanceId || `ATT_${targetEmp.employeeId}_${markDate.replace(/-/g, '')}`,
        summary: `Marked ${targetEmp.fullName} (${markDate}) as ${markStatus}${lateMins > 0 ? ` (${lateMins}m late)` : ''}.`,
      });

      setDateFilter(markDate);
      setMonthFilter(markDate.slice(0, 7));
      setMarkFeedback(
        `Saved ${targetEmp.fullName} on ${markDate} as ${markStatus.replace('_', ' ')}${lateMins > 0 ? ` (${lateMins}m late)` : ''}.`
      );
    } catch (err) {
      setMarkFeedback(err instanceof Error ? err.message : 'Failed to save attendance record.');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    exportToExcel(
      `Attendance_${dateFilter || 'All'}`,
      'Attendance',
      filtered.map((r) => ({
        EmployeeID: r.employeeId,
        EmployeeName: r.employeeName,
        Department: r.department || '',
        Date: r.date,
        Method: r.attendanceMethod,
        CheckIn: r.checkInAt || '',
        CheckOut: r.checkOutAt || '',
        WorkingMinutes: r.workingMinutes || 0,
        LateMinutes: r.lateMinutes || 0,
        OvertimeMinutes: r.overtimeMinutes || 0,
        FaceVerification: r.faceVerification || '',
        GPSStatus: r.gpsStatus || '',
        Status: r.attendanceStatus,
      }))
    );
  };

  const monthlyRows = employees
    .filter((e) => deptFilter === 'all' || e.department === deptFilter)
    .map((emp) => ({
      employee: emp,
      summary: computeMonthlyAttendanceSummary({
        employeeId: emp.employeeId,
        month: monthFilter,
        attendance,
        leaves,
        company,
      }),
    }));

  const handleExportMonthlySummary = () => {
    exportToExcel(
      `Monthly_Attendance_LateMarks_${monthFilter}`,
      'MonthlySummary',
      monthlyRows.map(({ employee, summary }) => ({
        EmployeeCode: employee.employeeCode,
        EmployeeName: employee.fullName,
        Department: employee.department,
        Month: monthFilter,
        WorkingDaysAttended: summary.workingDays,
        FullDays: summary.presentDays,
        HalfDays: summary.halfDays,
        WFHDays: summary.wfhDays,
        LateMarksCount: summary.lateMarksCount,
        TotalLateMinutes: summary.totalLateMinutes,
        LateDeductionDays: summary.lateDeductionDays,
        PaidLeaves: summary.paidLeaveDays,
        UnpaidLeaves: summary.unpaidLeaveDays,
        AbsentDays: summary.absentDays,
        TotalSalaryCutDays: summary.totalDeductionDays,
        SuggestedPaidDays: summary.suggestedPaidDays,
      }))
    );
  };

  return (
    <div className="space-y-6">
      {/* 8 Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Total Workforce', val: employees.length, tone: 'text-slate-900' },
          { label: 'Present Today', val: presentCount, tone: 'text-emerald-700' },
          { label: 'Absent', val: absentCount, tone: 'text-red-600' },
          { label: 'Late Arrivals', val: lateCount, tone: 'text-amber-600' },
          { label: 'On Leave', val: onLeaveCount, tone: 'text-indigo-600' },
          { label: 'Working From Home', val: wfhCount, tone: 'text-slate-900' },
          { label: 'Active / Incomplete', val: incompleteCount, tone: 'text-amber-600' },
          { label: 'Pending Corrections', val: pendingCorrections.length, tone: 'text-indigo-600' },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 truncate">{item.label}</p>
            <p className={`text-xl font-bold font-mono tabular-nums mt-1 ${item.tone}`}>{item.val}</p>
          </div>
        ))}
      </div>

      {/* Employee Monthly Working Days & Late Mark Check Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Monthly Working Days &amp; Late Marks Check ({monthFilter})
            </h2>
            <p className="text-xs text-slate-500">
              {(company.attendancePolicy?.lateMarksPerDeduction ?? 3) === 0
                ? 'Late mark salary deduction is OFF (0).'
                : `Policy: Every ${company.attendancePolicy?.lateMarksPerDeduction ?? 3} late marks = ${company.attendancePolicy?.lateDeductionDaysPerThreshold ?? 1} day salary reduction (synced to Payroll)`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
            />
            <button
              type="button"
              onClick={handleExportMonthlySummary}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export Monthly
            </button>
          </div>
        </div>

        {monthlyRows.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No employees found for monthly rollup.</p>
        ) : (
          <>
            <div className="hidden lg:block">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pr-3">Employee</th>
                    <th className="py-2.5 pr-3 text-right">Days Worked</th>
                    <th className="py-2.5 pr-3 text-right">Late Marks</th>
                    <th className="py-2.5 pr-3 text-right">Leaves (Paid / LWP)</th>
                    <th className="py-2.5 pr-3 text-right">Absent / Half</th>
                    <th className="py-2.5 pr-3 text-right">Salary Cut Days</th>
                    <th className="py-2.5 text-right">Net Paid Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlyRows.map(({ employee, summary }) => (
                    <tr key={employee.employeeId} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-slate-900">{employee.fullName}</p>
                        <p className="text-xs text-slate-500">
                          {employee.employeeCode} · {employee.department}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                        {summary.workingDays}d
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs">
                        <span
                          className={`font-semibold px-2 py-0.5 rounded ${
                            summary.lateMarksCount >= (company.attendancePolicy?.lateMarksPerDeduction ?? 3)
                              ? 'bg-red-50 text-red-700'
                              : summary.lateMarksCount > 0
                                ? 'bg-amber-50 text-amber-700'
                                : 'text-slate-600'
                          }`}
                        >
                          {summary.lateMarksCount} ({summary.totalLateMinutes}m)
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs text-slate-700">
                        {summary.paidLeaveDays}d / {summary.unpaidLeaveDays}d
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-xs text-slate-700">
                        {summary.absentDays}d / {summary.halfDays}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-semibold text-red-600 text-xs">
                        {summary.totalDeductionDays}d ({summary.lateDeductionDays}d late)
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {summary.suggestedPaidDays} / {summary.totalDaysInMonth}d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden divide-y divide-slate-100">
              {monthlyRows.map(({ employee, summary }) => (
                <div key={employee.employeeId} className="py-3 space-y-1.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{employee.fullName}</p>
                      <p className="text-slate-500">
                        {employee.employeeCode} · {employee.department}
                      </p>
                    </div>
                    <span className="font-mono font-semibold text-emerald-700 shrink-0">
                      Worked {summary.workingDays}d
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-slate-700">
                    <span>Late Marks: {summary.lateMarksCount} ({summary.totalLateMinutes}m)</span>
                    <span>LWP/Absent: {summary.leaveDeductionDays}d</span>
                    <span className="text-red-600 font-semibold">
                      Salary Cut: {summary.totalDeductionDays}d
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Manual Attendance Marking (Present / Late Mark / Half-Day / Absent) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-indigo-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">Record / Update Employee Attendance</h2>
            <p className="text-xs text-slate-500">
              Mark an employee Present, Late (with late minutes), Half-Day, Absent, or WFH on any date—automatically updates payroll deductions.
            </p>
          </div>
        </div>

        {markFeedback && (
          <p className="text-xs font-medium text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
            {markFeedback}
          </p>
        )}

        <form onSubmit={handleManualMarkAttendance} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Employee</label>
            <select
              value={markEmpId}
              onChange={(e) => setMarkEmpId(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            >
              {employees.map((emp) => (
                <option key={emp.employeeId} value={emp.employeeId}>
                  {emp.fullName} ({emp.employeeCode})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Date</label>
            <input
              type="date"
              required
              value={markDate}
              onChange={(e) => setMarkDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Status</label>
            <select
              value={markStatus}
              onChange={(e) =>
                setMarkStatus(e.target.value as 'present' | 'late' | 'half_day' | 'absent' | 'wfh')
              }
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            >
              <option value="present">Present</option>
              <option value="late">Late Mark</option>
              <option value="half_day">Half-Day (0.5d Cut)</option>
              <option value="absent">Absent (1d Cut)</option>
              <option value="wfh">Work From Home</option>
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Late Minutes</label>
            <input
              type="number"
              min={0}
              max={600}
              disabled={markStatus === 'absent' || markStatus === 'half_day'}
              value={markStatus === 'absent' || markStatus === 'half_day' ? '0' : markLateMinutes}
              onChange={(e) => setMarkLateMinutes(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-100"
            />
          </div>
          <button
            type="submit"
            disabled={busy || employees.length === 0}
            className="px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 whitespace-nowrap"
          >
            Save Attendance
          </button>
        </form>
      </div>

      {/* Filters & Export */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Attendance Monitoring Log</h2>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Export Excel
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
          >
            <option value="all">All Methods</option>
            <option value="selfie_gps">Selfie + GPS</option>
            <option value="qr_code">QR Code</option>
            <option value="gps">GPS Only</option>
            <option value="fingerprint">Fingerprint Device</option>
            <option value="manual_hr">Manual HR</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee name or ID..."
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            No attendance records match the selected date and filters.
          </p>
        ) : (
          <>
            <div className="hidden lg:block">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-2.5 pr-3">Employee</th>
                    <th className="py-2.5 pr-3">Method</th>
                    <th className="py-2.5 pr-3">In / Out</th>
                    <th className="py-2.5 pr-3">Hours</th>
                    <th className="py-2.5 pr-3">Verification</th>
                    <th className="py-2.5 pr-3">Status</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((rec) => (
                    <tr key={rec.attendanceId} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-slate-900">{rec.employeeName}</p>
                        <p className="text-xs text-slate-500">{rec.department || 'General'}</p>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-700">
                        {rec.attendanceMethod.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-xs text-slate-700">
                        {rec.checkInAt ? new Date(rec.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        {' / '}
                        {rec.checkOutAt ? new Date(rec.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-xs text-slate-700">
                        {formatMinutes(rec.workingMinutes)}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-600">
                        In: {rec.checkInFaceVerification || rec.faceVerification || 'na'}
                        {' · Out: '}
                        {rec.checkOutFaceVerification || (rec.checkOutAt ? rec.faceVerification : 'pending')}
                        {' · GPS: '}
                        {rec.gpsStatus || 'na'}
                      </td>
                      <td className="py-2.5 pr-3 text-xs font-semibold capitalize text-slate-800">
                        <span>{rec.attendanceStatus.replace(/_/g, ' ')}</span>
                        {(rec.lateMinutes || 0) > 0 && (
                          <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 rounded">
                            +{rec.lateMinutes}m late
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(rec)}
                            className="p-1.5 text-slate-600 hover:text-indigo-600 rounded"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleAttendanceApproval(rec, 'approved')}
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"
                            title="Approve"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleAttendanceApproval(rec, 'rejected')}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                            title="Reject"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden divide-y divide-slate-100">
              {filtered.map((rec) => (
                <div key={rec.attendanceId} className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{rec.employeeName}</p>
                      <p className="text-xs text-slate-500">
                        {rec.department} · {rec.attendanceMethod.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <span className="text-xs font-semibold capitalize text-indigo-600">
                      {rec.attendanceStatus.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 font-mono tabular-nums">
                    Work: {formatMinutes(rec.workingMinutes)} · Face: {rec.faceVerification || 'na'} · GPS:{' '}
                    {rec.gpsStatus || 'na'}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRecord(rec)}
                      className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-md"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAttendanceApproval(rec, 'approved')}
                      className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 rounded-md"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAttendanceApproval(rec, 'rejected')}
                      className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 rounded-md"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Attendance Correction Approval Queue */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Attendance Correction Requests</h3>
        {corrections.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">No attendance correction requests filed.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {corrections.map((corr) => (
              <div
                key={corr.correctionId}
                className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {corr.employeeName} · <span className="font-mono text-xs">{corr.date}</span>
                  </p>
                  <p className="text-xs text-slate-600">
                    {corr.issueType.replace(/_/g, ' ')} · Requested {corr.requestedCheckIn || '--:--'} to{' '}
                    {corr.requestedCheckOut || '--:--'} · Status:{' '}
                    <span className="font-semibold text-slate-800">{corr.status.replace(/_/g, ' ')}</span>
                  </p>
                  <p className="text-xs text-slate-500">{corr.reason}</p>
                  {corr.reviewNote && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mt-1">
                      <strong>Note:</strong> {corr.reviewNote}
                    </p>
                  )}
                </div>
                {corr.status.startsWith('pending') && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {corr.status === 'pending_manager' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleCorrectionAction(corr, 'pending_hr')}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                      >
                        Manager Approve → HR
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleCorrectionAction(corr, 'approved')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                    >
                      HR Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRejectingCorr(corr);
                        setCorrRejectNote('');
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Attendance Verification Detail</h3>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-slate-500">Employee</dt>
                <dd className="font-semibold text-slate-900">{selectedRecord.employeeName}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Date</dt>
                <dd className="font-mono text-slate-900">{selectedRecord.date}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Check-In Selfie</dt>
                <dd className="font-semibold text-slate-900">
                  {selectedRecord.checkInFaceVerification || selectedRecord.faceVerification || 'na'}
                  {selectedRecord.checkInConfidenceScore ? ` (${selectedRecord.checkInConfidenceScore}%)` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Check-Out Selfie</dt>
                <dd className="font-semibold text-slate-900">
                  {selectedRecord.checkOutFaceVerification || (selectedRecord.checkOutAt ? selectedRecord.faceVerification : 'pending')}
                  {selectedRecord.checkOutConfidenceScore ? ` (${selectedRecord.checkOutConfidenceScore}%)` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Liveness</dt>
                <dd className="font-semibold text-slate-900">{selectedRecord.livenessStatus || 'na'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">GPS Status</dt>
                <dd className="font-semibold text-slate-900">{selectedRecord.gpsStatus || 'na'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Approval Status</dt>
                <dd className="font-semibold text-slate-900">{selectedRecord.approvalStatus || 'auto_approved'}</dd>
              </div>
            </dl>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {rejectingCorr && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Reject Correction Request</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {rejectingCorr.employeeName} · {rejectingCorr.date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRejectingCorr(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!corrRejectNote.trim()) return;
                await handleCorrectionAction(
                  rejectingCorr,
                  'rejected',
                  `${corrRejectNote.trim()} (by ${currentEmployee.fullName})`
                );
                setRejectingCorr(null);
              }}
              className="space-y-3"
            >
              <textarea
                rows={3}
                required
                value={corrRejectNote}
                onChange={(e) => setCorrRejectNote(e.target.value)}
                placeholder="Write why this attendance correction is rejected..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingCorr(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700"
                >
                  Confirm Reject
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
