// Security Rule Verification Suite for NexusPay Firestore Rules
// Covers the 12 Dirty Dozen adversarial payloads against firestore.rules.

export const DIRTY_DOZEN_CASES = [
  { id: 1, name: 'Privilege escalation on user profile creation', collection: 'users', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Shadow ghost field injection on employee write', collection: 'employees', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Unverified email spoofing as bootstrapped admin', collection: 'companies', operation: 'write', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Document ID poisoning exceeding 128 chars', collection: 'attendance', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Client timestamp forgery bypassing request.time', collection: 'attendance', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Cross-tenant payslip get by unrelated employee', collection: 'payslips', operation: 'get', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Mutation of append-only attendanceEvents', collection: 'attendanceEvents', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Mutation of locked payrollRuns record', collection: 'payrollRuns', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Employee self-approving pending leaveRequest', collection: 'leaveRequests', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Blanket list query on employees PII', collection: 'employees', operation: 'list', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Value type poisoning on attendance workingMinutes', collection: 'attendance', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Audit log deletion attempt', collection: 'auditLogs', operation: 'delete', expected: 'PERMISSION_DENIED' },
];
