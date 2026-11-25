import { AttendanceRecord, Company, LeaveRequest } from '../types/payroll';

export interface MonthlyAttendanceSummary {
  month: string;
  totalDaysInMonth: number;
  workingDays: number;
  presentDays: number;
  halfDays: number;
  wfhDays: number;
  absentDays: number;
  lateMarksCount: number;
  totalLateMinutes: number;
  overtimeMinutes: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  lateDeductionDays: number;
  leaveDeductionDays: number;
  totalDeductionDays: number;
  suggestedPaidDays: number;
}

function parseIsoDayUtc(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d);
}

function getMonthLeaveDaysOverlap(leave: LeaveRequest, month: string): number {
  const [yr, mo] = month.split('-').map(Number);
  if (!yr || !mo) return 0;
  const totalDays = new Date(yr, mo, 0).getDate() || 30;
  const monthStart = Date.UTC(yr, mo - 1, 1);
  const monthEnd = Date.UTC(yr, mo - 1, totalDays);

  const lStart = parseIsoDayUtc(leave.startDate);
  const lEnd = parseIsoDayUtc(leave.endDate || leave.startDate);
  if (Number.isNaN(lStart) || Number.isNaN(lEnd)) return 0;

  const overlapStart = Math.max(monthStart, lStart);
  const overlapEnd = Math.min(monthEnd, lEnd);
  if (overlapEnd < overlapStart) return 0;

  const calendarOverlapDays = Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
  if (leave.isHalfDay) {
    return 0.5;
  }
  return Math.min(leave.days || calendarOverlapDays, calendarOverlapDays);
}

export function computeMonthlyAttendanceSummary(params: {
  employeeId: string;
  month: string;
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  company?: Company;
  lateMarksPerCut?: number;
  lateCutDaysPerThreshold?: number;
  prorateByAttendanceOnly?: boolean;
}): MonthlyAttendanceSummary {
  const {
    employeeId,
    month,
    attendance,
    leaves,
    company,
    lateMarksPerCut = company?.attendancePolicy?.lateMarksPerDeduction ?? 3,
    lateCutDaysPerThreshold = company?.attendancePolicy?.lateDeductionDaysPerThreshold ?? 1,
    prorateByAttendanceOnly = company?.attendancePolicy?.prorateByAttendanceOnly ?? false,
  } = params;

  const [yr, mo] = month.split('-').map(Number);
  const totalDaysInMonth = yr && mo ? new Date(yr, mo, 0).getDate() || 30 : 30;

  const empAtt = attendance.filter(
    (a) => a.employeeId === employeeId && a.date.startsWith(month)
  );

  let presentDays = 0;
  let halfDays = 0;
  let wfhDays = 0;
  let absentDays = 0;
  let lateMarksCount = 0;
  let totalLateMinutes = 0;
  let overtimeMinutes = 0;

  for (const rec of empAtt) {
    if (['present', 'on_break', 'checked_out', 'late', 'wfh'].includes(rec.attendanceStatus)) {
      presentDays += 1;
      if (rec.attendanceStatus === 'wfh') wfhDays += 1;
    } else if (rec.attendanceStatus === 'half_day') {
      halfDays += 1;
    } else if (rec.attendanceStatus === 'absent') {
      absentDays += 1;
    }

    if ((rec.lateMinutes || 0) > 0 || rec.attendanceStatus === 'late') {
      lateMarksCount += 1;
    }
    totalLateMinutes += rec.lateMinutes || 0;
    overtimeMinutes += rec.overtimeMinutes || 0;
  }

  const workingDays = presentDays + halfDays * 0.5;

  const approvedLeaves = leaves.filter(
    (l) => l.employeeId === employeeId && l.status === 'approved'
  );

  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  for (const lv of approvedLeaves) {
    const overlap = getMonthLeaveDaysOverlap(lv, month);
    if (overlap <= 0) continue;
    if (lv.leaveType === 'unpaid') {
      unpaidLeaveDays += overlap;
    } else {
      paidLeaveDays += overlap;
    }
  }

  const lateDeductionDays =
    lateMarksPerCut > 0
      ? Math.floor(lateMarksCount / lateMarksPerCut) * lateCutDaysPerThreshold
      : 0;

  // Leave / absence shortfall days:
  // - In strict attendance-only mode: every calendar day not worked or on paid leave counts as unpaid/absent cut.
  // - In standard mode: approved unpaid leaves + explicit absent days + half-day shortfalls (0.5d each).
  const rawLeaveDeductionDays = unpaidLeaveDays + absentDays + halfDays * 0.5;
  const strictUnworkedDays = Math.max(
    0,
    totalDaysInMonth - Math.min(totalDaysInMonth, workingDays + paidLeaveDays)
  );
  const leaveDeductionDays = prorateByAttendanceOnly ? strictUnworkedDays : rawLeaveDeductionDays;
  const totalDeductionDays = Math.min(totalDaysInMonth, leaveDeductionDays + lateDeductionDays);

  const suggestedPaidDays = prorateByAttendanceOnly
    ? Math.max(0, Math.min(totalDaysInMonth, workingDays + paidLeaveDays - lateDeductionDays))
    : Math.max(0, totalDaysInMonth - totalDeductionDays);

  return {
    month,
    totalDaysInMonth,
    workingDays,
    presentDays,
    halfDays,
    wfhDays,
    absentDays,
    lateMarksCount,
    totalLateMinutes,
    overtimeMinutes,
    paidLeaveDays,
    unpaidLeaveDays,
    lateDeductionDays,
    leaveDeductionDays,
    totalDeductionDays,
    suggestedPaidDays,
  };
}
