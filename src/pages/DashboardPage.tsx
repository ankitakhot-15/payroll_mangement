import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ArrowRight } from 'lucide-react';
import {
  AttendanceCorrection,
  AttendanceRecord,
  AuditLog,
  Company,
  Employee,
  LeaveRequest,
  PayrollRun,
  Payslip,
  UserRole,
} from '../types/payroll';
import { currentYearMonth, formatCurrencyINR, formatMinutes, todayIsoDate } from '../utils/exports';
import { computeMonthlyAttendanceSummary } from '../utils/attendanceSummary';
import { NavSection } from '../components/Sidebar';

interface DashboardPageProps {
  effectiveRole: UserRole;
  company?: Company;
  employees: Employee[];
  attendance: AttendanceRecord[];
  corrections: AttendanceCorrection[];
  leaves: LeaveRequest[];
  payrollRuns: PayrollRun[];
  payslips: Payslip[];
  auditLogs: AuditLog[];
  currentEmployee?: Employee;
  onNavigate: (section: NavSection) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  effectiveRole,
  company,
  employees,
  attendance,
  corrections,
  leaves,
  payrollRuns,
  payslips,
  auditLogs,
  currentEmployee,
  onNavigate,
}) => {
  const today = todayIsoDate();
  const todayRecords = attendance.filter((a) => a.date === today);
  const presentToday = todayRecords.filter((a) =>
    ['present', 'on_break', 'checked_out', 'late', 'wfh'].includes(a.attendanceStatus)
  ).length;
  const lateToday = todayRecords.filter((a) => (a.lateMinutes || 0) > 0).length;
  const pendingLeaves = leaves.filter((l) => l.status === 'pending').length;
  const pendingCorrections = corrections.filter((c) => c.status.startsWith('pending')).length;

  const latestPayroll = [...payrollRuns].sort((a, b) => b.month.localeCompare(a.month))[0];
  const latestPayslipMonth = [...payslips].sort((a, b) => b.month.localeCompare(a.month))[0]?.month;
  const targetPayrollMonth =
    latestPayroll && (!latestPayslipMonth || latestPayroll.month >= latestPayslipMonth)
      ? latestPayroll.month
      : latestPayslipMonth;
  const monthPayslips = targetPayrollMonth
    ? payslips.filter((p) => p.month === targetPayrollMonth)
    : [];
  const livePayrollNet =
    monthPayslips.length > 0
      ? monthPayslips.reduce((sum, p) => sum + (p.netSalary || 0), 0)
      : (latestPayroll?.totalNet ?? 0);
  const livePayrollCount =
    monthPayslips.length > 0 ? monthPayslips.length : (latestPayroll?.employeeCount ?? 0);
  const livePayrollCuts = monthPayslips.reduce(
    (sum, p) => sum + (p.leaveDeductionAmount || 0) + (p.lateDeductionAmount || 0),
    0
  );

  const myToday = todayRecords.find((a) => a.employeeId === currentEmployee?.employeeId);
  const myPayslips = [...payslips]
    .filter((p) => p.employeeId === currentEmployee?.employeeId)
    .sort((a, b) => b.month.localeCompare(a.month));
  const currentMonth = currentYearMonth();
  const myMonthSummary = currentEmployee
    ? computeMonthlyAttendanceSummary({
        employeeId: currentEmployee.employeeId,
        month: currentMonth,
        attendance,
        leaves,
        company,
      })
    : null;

  const deptCounts = employees.reduce<Record<string, { department: string; headcount: number; present: number }>>(
    (acc, emp) => {
      const dept = emp.department || 'General';
      if (!acc[dept]) acc[dept] = { department: dept, headcount: 0, present: 0 };
      acc[dept].headcount += 1;
      if (todayRecords.some((a) => a.employeeId === emp.employeeId)) {
        acc[dept].present += 1;
      }
      return acc;
    },
    {}
  );
  const chartData = Object.values(deptCounts).slice(0, 6);

  const isEmployeeView = effectiveRole === 'employee';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-900 truncate">
            {isEmployeeView
              ? `Welcome, ${currentEmployee?.fullName || 'Team Member'}`
              : `${company?.name || 'Organization'} Overview`}
          </h2>
          <p className="text-sm text-slate-600">
            {today} · {company?.code || 'WORKSPACE'} · {employees.length} active records synced
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(isEmployeeView ? 'my-attendance' : 'payroll')}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
        >
          <span>{isEmployeeView ? 'Mark Attendance' : 'Run Monthly Payroll'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isEmployeeView ? (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">Today&apos;s Status</p>
              <p className="text-2xl font-bold text-slate-900 capitalize">
                {myToday ? myToday.attendanceStatus.replace('_', ' ') : 'Not Checked In'}
              </p>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                In: {myToday?.checkInAt ? new Date(myToday.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'} · {formatMinutes(myToday?.workingMinutes)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">Working Days ({currentMonth})</p>
              <p className="text-2xl font-bold text-emerald-700 font-mono tabular-nums">
                {myMonthSummary?.workingDays ?? 0}d
              </p>
              <p className="text-xs text-slate-500">
                Late Marks: <span className="font-semibold text-amber-700">{myMonthSummary?.lateMarksCount ?? 0}</span> ({myMonthSummary?.lateDeductionDays ?? 0}d cut)
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">Leaves &amp; Attendance Cut</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {myMonthSummary?.totalDeductionDays ?? 0}d cut
              </p>
              <p className="text-xs text-slate-500">
                {myMonthSummary?.leaveDeductionDays ?? 0}d leave · {leaves.filter((l) => l.employeeId === currentEmployee?.employeeId && l.status === 'pending').length} pending
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">Latest Net Payslip</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {myPayslips[0] ? formatCurrencyINR(myPayslips[0].netSalary) : 'INR 0'}
              </p>
              <p className="text-xs text-slate-500">
                {myPayslips[0]
                  ? `${myPayslips[0].month} · Worked ${myPayslips[0].workingDays ?? myPayslips[0].paidDays ?? 0}d${
                      (myPayslips[0].leaveDeductionAmount || 0) + (myPayslips[0].lateDeductionAmount || 0) > 0
                        ? ` · Cut -${formatCurrencyINR(
                            (myPayslips[0].leaveDeductionAmount || 0) + (myPayslips[0].lateDeductionAmount || 0)
                          )}`
                        : ''
                    }`
                  : 'No payslips generated yet'}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">Total Workforce</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {employees.length}
              </p>
              <p className="text-xs text-slate-500">
                Active: {employees.filter((e) => e.employmentStatus === 'active').length}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">Present Today</p>
              <p className="text-2xl font-bold text-emerald-700 font-mono tabular-nums">
                {presentToday}
              </p>
              <p className="text-xs text-slate-500">
                Late arrivals: {lateToday}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">Pending Approvals</p>
              <p className="text-2xl font-bold text-amber-600 font-mono tabular-nums">
                {pendingLeaves + pendingCorrections}
              </p>
              <p className="text-xs text-slate-500">
                {pendingLeaves} leaves · {pendingCorrections} corrections
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <p className="text-xs font-medium text-slate-500">Latest Payroll Net</p>
              <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {formatCurrencyINR(livePayrollNet)}
              </p>
              <p className="text-xs text-slate-500">
                {targetPayrollMonth
                  ? `${targetPayrollMonth} · ${livePayrollCount} ${livePayrollCount === 1 ? 'employee' : 'employees'}${
                      livePayrollCuts > 0 ? ` · Cuts -${formatCurrencyINR(livePayrollCuts)}` : ''
                    } · ${latestPayroll?.status || 'draft'}`
                  : 'No payroll run yet'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Department Headcount &amp; Attendance</h3>
              <p className="text-xs text-slate-500">Real-time presence across company departments for {today}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('admin-attendance')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 whitespace-nowrap shrink-0"
            >
              Open Monitor
            </button>
          </div>

          {chartData.length > 0 ? (
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="department" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="headcount" name="Headcount" fill="#0F172A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="present" name="Present Today" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-52 flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-lg p-6">
              <p className="text-sm font-medium text-slate-700">No department metrics yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Add employees to see live department presence and payroll breakdowns.
              </p>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Recent Audit Activity</h3>
            <button
              type="button"
              onClick={() => onNavigate('reports-settings')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 whitespace-nowrap shrink-0"
            >
              View All
            </button>
          </div>

          {auditLogs.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {auditLogs.slice(0, 6).map((log) => (
                <div key={log.logId} className="py-2.5 space-y-0.5">
                  <p className="text-xs font-semibold text-slate-800 truncate">{log.action}</p>
                  <p className="text-xs text-slate-600 line-clamp-2">{log.summary}</p>
                  <p className="text-[11px] text-slate-400 truncate">{log.actorName}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-8 text-center">
              Audit events will appear here as attendance, leave, and payroll actions occur.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
