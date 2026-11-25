import React, { useState } from 'react';
import { CalendarDays, Clock, CheckCircle2, XCircle, Plus, X } from 'lucide-react';
import { Company, Employee, LeaveRequest, Shift, UserRole } from '../types/payroll';
import { createDocStrict, logAuditEvent, makeId, updateDocStrict } from '../services/firestoreService';
import { todayIsoDate } from '../utils/exports';

interface ShiftsAndLeavesPageProps {
  company: Company;
  currentEmployee: Employee;
  effectiveRole: UserRole;
  shifts: Shift[];
  leaves: LeaveRequest[];
}

export const ShiftsAndLeavesPage: React.FC<ShiftsAndLeavesPageProps> = ({
  company,
  currentEmployee,
  effectiveRole,
  shifts,
  leaves,
}) => {
  const canManage = ['super_admin', 'company_admin', 'hr_manager', 'dept_manager'].includes(effectiveRole);

  // Shift form
  const [shiftName, setShiftName] = useState('');
  const [shiftCode, setShiftCode] = useState('');
  const [shiftType, setShiftType] = useState<Shift['shiftType']>('general');
  const [startTime, setStartTime] = useState('09:30');
  const [endTime, setEndTime] = useState('18:30');
  const [graceMins, setGraceMins] = useState('15');
  const [breakMins, setBreakMins] = useState('60');
  const [isNightShift, setIsNightShift] = useState(false);

  // Leave form
  const [leaveType, setLeaveType] = useState<LeaveRequest['leaveType']>('casual');
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [rejectingLeave, setRejectingLeave] = useState<LeaveRequest | null>(null);
  const [leaveRejectNote, setLeaveRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftName.trim() || !shiftCode.trim()) return;
    setBusy(true);
    try {
      const shiftId = makeId('SHIFT');
      await createDocStrict('shifts', shiftId, {
        shiftId,
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        name: shiftName.trim(),
        code: shiftCode.trim().toUpperCase(),
        shiftType,
        startTime,
        endTime,
        breakDurationMinutes: Number(breakMins) || 60,
        gracePeriodMinutes: Number(graceMins) || 15,
        requiredWorkMinutes: 480,
        overtimeEligible: true,
        isNightShift,
      });
      setShiftName('');
      setShiftCode('');
    } finally {
      setBusy(false);
    }
  };

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const d1 = new Date(startDate);
      const d2 = new Date(endDate);
      const diff = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
      const days = isHalfDay ? 0.5 : diff;
      const leaveId = makeId('LV');

      await createDocStrict('leaveRequests', leaveId, {
        leaveId,
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        employeeId: currentEmployee.employeeId,
        employeeUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        employeeName: currentEmployee.fullName,
        leaveType,
        startDate,
        endDate,
        days,
        isHalfDay,
        reason: reason.trim(),
        status: 'pending',
      });

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'LEAVE_APPLIED',
        targetCollection: 'leaveRequests',
        targetId: leaveId,
        summary: `${currentEmployee.fullName} applied for ${days}d ${leaveType} leave (${startDate}).`,
      });
      setReason('');
    } finally {
      setBusy(false);
    }
  };

  const handleLeaveDecision = async (
    lv: LeaveRequest,
    status: 'approved' | 'rejected' | 'cancelled',
    reviewNote?: string
  ) => {
    setBusy(true);
    try {
      await updateDocStrict('leaveRequests', lv.leaveId, {
        status,
        ...(reviewNote ? { reviewNote: reviewNote.slice(0, 280) } : {}),
      });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: lv.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: `LEAVE_${status.toUpperCase()}`,
        targetCollection: 'leaveRequests',
        targetId: lv.leaveId,
        summary: `Leave ${lv.leaveId} for ${lv.employeeName} marked ${status}${reviewNote ? `: ${reviewNote}` : ''}.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const myUsedCasual = leaves
    .filter((l) => l.employeeId === currentEmployee.employeeId && l.leaveType === 'casual' && l.status === 'approved')
    .reduce((s, l) => s + l.days, 0);
  const myUsedSick = leaves
    .filter((l) => l.employeeId === currentEmployee.employeeId && l.leaveType === 'sick' && l.status === 'approved')
    .reduce((s, l) => s + l.days, 0);
  const myUsedEarned = leaves
    .filter((l) => l.employeeId === currentEmployee.employeeId && l.leaveType === 'earned' && l.status === 'approved')
    .reduce((s, l) => s + l.days, 0);

  return (
    <div className="space-y-6">
      {/* Leave Balances */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Casual Leave Balance</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {Math.max(0, 12 - myUsedCasual)} / 12
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Sick Leave Balance</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {Math.max(0, 10 - myUsedSick)} / 10
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Earned / Privilege Leave</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {Math.max(0, 18 - myUsedEarned)} / 18
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Apply Leave */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-900">Apply for Leave</h2>
          </div>

          <form onSubmit={handleApplyLeave} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Leave Type</label>
              <select
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value as LeaveRequest['leaveType'])}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              >
                <option value="casual">Casual Leave (CL)</option>
                <option value="sick">Sick Leave (SL)</option>
                <option value="earned">Earned Leave (EL)</option>
                <option value="privilege">Privilege Leave (PL)</option>
                <option value="maternity">Maternity Leave (ML)</option>
                <option value="paternity">Paternity Leave (PTL)</option>
                <option value="comp_off">Compensatory Off</option>
                <option value="unpaid">Unpaid Leave (LWP)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isHalfDay}
                onChange={(e) => setIsHalfDay(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600"
              />
              <span>Half-day leave application (0.5 days)</span>
            </label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for leave..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              Submit Leave Request
            </button>
          </form>
        </div>

        {/* Leave Requests List */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Leave Requests &amp; Approvals</h3>
          {leaves.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No leave applications recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {leaves.map((lv) => (
                <div
                  key={lv.leaveId}
                  className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {lv.employeeName} · <span className="capitalize">{lv.leaveType.replace('_', ' ')}</span> ({lv.days}d)
                    </p>
                    <p className="text-xs text-slate-500 font-mono">
                      {lv.startDate} → {lv.endDate} ·{' '}
                      <span className="font-sans font-semibold capitalize text-slate-800">{lv.status}</span>
                    </p>
                    {lv.reason && <p className="text-xs text-slate-600">{lv.reason}</p>}
                    {lv.reviewNote && (
                      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mt-1">
                        <strong>Rejection Reason:</strong> {lv.reviewNote}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {canManage && lv.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleLeaveDecision(lv, 'approved')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRejectingLeave(lv);
                            setLeaveRejectNote('');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                    {lv.employeeId === currentEmployee.employeeId && lv.status === 'pending' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleLeaveDecision(lv, 'cancelled')}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Shift Configuration */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-slate-900">Company Shifts &amp; Overtime Policies</h3>
        </div>

        {canManage && (
          <form onSubmit={handleCreateShift} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <input
              type="text"
              required
              value={shiftName}
              onChange={(e) => setShiftName(e.target.value)}
              placeholder="Shift Name"
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <input
              type="text"
              required
              value={shiftCode}
              onChange={(e) => setShiftCode(e.target.value)}
              placeholder="Code (GEN)"
              className="px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
            />
            <select
              value={shiftType}
              onChange={(e) => setShiftType(e.target.value as Shift['shiftType'])}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            >
              <option value="general">General</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
              <option value="night">Night</option>
              <option value="flexible">Flexible</option>
              <option value="rotational">Rotational</option>
            </select>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              <Plus className="w-4 h-4" />
              Add Shift
            </button>
            <div className="sm:col-span-2 lg:col-span-6 flex flex-wrap items-center gap-4 text-xs text-slate-600">
              <label className="flex items-center gap-2">
                <span>Grace (mins):</span>
                <input
                  type="number"
                  value={graceMins}
                  onChange={(e) => setGraceMins(e.target.value)}
                  className="w-16 px-2 py-1 border border-slate-200 rounded"
                />
              </label>
              <label className="flex items-center gap-2">
                <span>Break (mins):</span>
                <input
                  type="number"
                  value={breakMins}
                  onChange={(e) => setBreakMins(e.target.value)}
                  className="w-16 px-2 py-1 border border-slate-200 rounded"
                />
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isNightShift}
                  onChange={(e) => setIsNightShift(e.target.checked)}
                />
                <span>Overnight / Night Shift</span>
              </label>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shifts.map((sh) => (
            <div key={sh.shiftId} className="p-4 border border-slate-200 rounded-lg space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">{sh.name}</p>
                <span className="text-xs font-mono text-indigo-600">{sh.code}</span>
              </div>
              <p className="text-xs font-mono tabular-nums text-slate-700">
                {sh.startTime} – {sh.endTime} {sh.isNightShift ? '(Overnight)' : ''}
              </p>
              <p className="text-xs text-slate-500">
                Grace {sh.gracePeriodMinutes ?? 15}m · Break {sh.breakDurationMinutes ?? 60}m
              </p>
            </div>
          ))}
        </div>
      </div>
      {rejectingLeave && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Reject Leave Request</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {rejectingLeave.employeeName} · {rejectingLeave.startDate} → {rejectingLeave.endDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRejectingLeave(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!leaveRejectNote.trim()) return;
                await handleLeaveDecision(
                  rejectingLeave,
                  'rejected',
                  `${leaveRejectNote.trim()} (by ${currentEmployee.fullName})`
                );
                setRejectingLeave(null);
              }}
              className="space-y-3"
            >
              <textarea
                rows={3}
                required
                value={leaveRejectNote}
                onChange={(e) => setLeaveRejectNote(e.target.value)}
                placeholder="Write why this leave request is rejected..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingLeave(null)}
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
