# Security Specification & Payload-First TDD

## 1. Data Invariants
1. **Identity & Email Verification**: All read and write operations require `request.auth != null` and `request.auth.token.email_verified == true`.
2. **Self-Assigned Role Prevention**: Non-super-admin users creating a `users/{uid}` document can only assign `role == 'employee'` and cannot mutate `role` on update.
3. **Immutable Ownership & Temporal Integrity**: `createdAt` must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on update. `companyOwnerUid` and `employeeUid` are immutable after creation.
4. **Append-Only Audit & Punch Streams**: `attendanceEvents` and `auditLogs` allow `create` only and prohibit client `update` and `delete`.
5. **Terminal State Locking**: Locked `payrollRuns` (`status == 'locked'`) cannot be modified or deleted by non-super-admins. Approved/rejected `leaveRequests`, `attendanceCorrections`, `loans`, and `reimbursements` cannot be edited by employees.
6. **Zero-Trust Query Enforcement**: Every `allow list` rule evaluates `resource.data` against `request.auth.uid` or verified bootstrapped super-admin email without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Privilege Escalation on Signup**: `users/attacker` create with `role: "super_admin"` by unprivileged user -> `PERMISSION_DENIED`.
2. **Shadow Ghost Field Injection**: `employees/EMP1` create with extra undeclared field `isAdminBypass: true` -> `PERMISSION_DENIED`.
3. **Unverified Email Spoofing**: `companies/COMP1` write with `email: "ankitakhot012@gmail.com"` and `email_verified: false` -> `PERMISSION_DENIED`.
4. **ID Poisoning (1.5KB Document ID)**: `attendance/` write with `attendanceId` exceeding 128 chars or containing `/` -> `PERMISSION_DENIED`.
5. **Client Timestamp Forgery**: `attendance/ATT1` create with backdated `createdAt` not matching `request.time` -> `PERMISSION_DENIED`.
6. **Cross-Tenant Employee Read**: Non-owner `employee` reading another employee's `payslips/PAY1` -> `PERMISSION_DENIED`.
7. **Unauthorized Attendance Event Mutation**: Employee attempting `update` or `delete` on `attendanceEvents/EVT1` -> `PERMISSION_DENIED`.
8. **Locked Payroll Tampering**: Accountant attempting `update` on `payrollRuns/RUN1` where `existing().status == 'locked'` -> `PERMISSION_DENIED`.
9. **Leave Status Shortcutting by Employee**: Employee updating `leaveRequests/LV1` `status` from `pending` to `approved` -> `PERMISSION_DENIED`.
10. **PII Blanket List Scraping**: Non-admin issuing unfiltered `list` on `employees` -> `PERMISSION_DENIED`.
11. **Value Type Poisoning**: Updating `attendance/ATT1` `workingMinutes` with a 1MB string instead of number -> `PERMISSION_DENIED`.
12. **Audit Log Deletion**: Any non-super-admin attempting `delete` on `auditLogs/LOG1` -> `PERMISSION_DENIED`.
