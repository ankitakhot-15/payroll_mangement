import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  UserPlus,
  Download,
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Trash2,
  Eye,
  FileImage,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  Company,
  Employee,
  EmployeeDocument,
  OfficeLocation,
  Shift,
  UserRole,
} from '../types/payroll';
import {
  createDocStrict,
  deleteDocStrict,
  logAuditEvent,
  makeId,
  updateDocStrict,
} from '../services/firestoreService';
import { exportToExcel, todayIsoDate } from '../utils/exports';
import { DocumentViewerModal } from '../components/DocumentViewerModal';

interface EmployeesPageProps {
  company: Company;
  currentEmployee: Employee;
  effectiveRole: UserRole;
  employees: Employee[];
  shifts: Shift[];
  locations: OfficeLocation[];
  documents: EmployeeDocument[];
}

const DOC_TYPE_LABELS: Record<EmployeeDocument['docType'], string> = {
  aadhaar: 'Aadhaar Card (Photo / PDF)',
  pan: 'PAN Card (Photo / PDF)',
  pf_passbook: 'PF Passbook / EPFO Document',
  uan: 'UAN Card / Member ID',
  esi: 'ESI e-Pehchan Card',
  bank_proof: 'Bank Passbook / Cancelled Cheque',
  passport: 'Passport',
  driving_license: 'Driving License',
  photo_id: 'Passport Photo / Employee ID',
  resume: 'Resume / CV',
  educational: 'Educational Certificate',
  offer_letter: 'Offer Letter',
  appointment_letter: 'Appointment Letter',
  experience_letter: 'Experience Letter',
  relieving_letter: 'Relieving Letter',
  form_16: 'Form 16',
  other: 'Other Compliance Document',
};

const MAX_DATA_URL_LENGTH = 700000;

async function compressImageToDataUrl(file: File): Promise<{
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
    image.src = rawUrl;
  });

  const maxSide = 1280;
  let width = img.width || 800;
  let height = img.height || 600;
  if (width > maxSide || height > maxSide) {
    if (width >= height) {
      height = Math.round((height * maxSide) / width);
      width = maxSide;
    } else {
      width = Math.round((width * maxSide) / height);
      height = maxSide;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not process image in browser.');
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  if (dataUrl.length > 480000) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.62);
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.45);
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error('Image is still too large after compression. Please select a smaller image.');
  }

  const approxBytes = Math.round((dataUrl.length * 3) / 4);
  return {
    dataUrl,
    mimeType: 'image/jpeg',
    sizeBytes: approxBytes,
  };
}

async function readPdfToDataUrl(file: File): Promise<{
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected PDF file.'));
    reader.readAsDataURL(file);
  });

  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error(
      'PDF exceeds 500 KB compressed storage limit. Please upload a smaller PDF or a JPG/PNG photo of the document.'
    );
  }
  return {
    dataUrl,
    mimeType: 'application/pdf',
    sizeBytes: file.size,
  };
}

export const EmployeesPage: React.FC<EmployeesPageProps> = ({
  company,
  currentEmployee,
  effectiveRole,
  employees,
  shifts,
  locations,
  documents,
}) => {
  const isAdminOrHr = ['super_admin', 'company_admin', 'hr_manager'].includes(effectiveRole);
  const canVerifyDocs = isAdminOrHr;
  const canManageDirectory = isAdminOrHr || effectiveRole === 'dept_manager';

  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

  const [employeeCode, setEmployeeCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('Engineering');
  const [designation, setDesignation] = useState('Software Engineer');
  const [shiftId, setShiftId] = useState(shifts[0]?.shiftId || 'SHIFT_GEN_01');
  const [workLocationId, setWorkLocationId] = useState(locations[0]?.locationId || 'LOC_HQ_01');
  const [employmentType, setEmploymentType] = useState<Employee['employmentType']>('full_time');
  const [employmentStatus, setEmploymentStatus] = useState<Employee['employmentStatus']>('active');
  const [uan, setUan] = useState('');
  const [esiNumber, setEsiNumber] = useState('');
  const [panMasked, setPanMasked] = useState('');
  const [bankAccountMasked, setBankAccountMasked] = useState('');
  const [deviceEmployeeCode, setDeviceEmployeeCode] = useState('');

  // KYC Document upload state
  const [docEmpId, setDocEmpId] = useState(currentEmployee.employeeId);
  const [docType, setDocType] = useState<EmployeeDocument['docType']>('aadhaar');
  const [docNumber, setDocNumber] = useState('');
  const [docFileName, setDocFileName] = useState('');
  const [docMimeType, setDocMimeType] = useState('');
  const [docSizeBytes, setDocSizeBytes] = useState<number>(0);
  const [docDataUrl, setDocDataUrl] = useState('');
  const [docExpiry, setDocExpiry] = useState('');
  const [docError, setDocError] = useState('');
  const [docSuccess, setDocSuccess] = useState('');
  const [previewDoc, setPreviewDoc] = useState<EmployeeDocument | null>(null);

  // Reject with reason state
  const [rejectingDoc, setRejectingDoc] = useState<EmployeeDocument | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Re-upload rejected/pending document state
  const [reuploadDoc, setReuploadDoc] = useState<EmployeeDocument | null>(null);
  const [reuploadFileName, setReuploadFileName] = useState('');
  const [reuploadMimeType, setReuploadMimeType] = useState('');
  const [reuploadSizeBytes, setReuploadSizeBytes] = useState<number>(0);
  const [reuploadDataUrl, setReuploadDataUrl] = useState('');
  const [reuploadNumber, setReuploadNumber] = useState('');
  const [reuploadExpiry, setReuploadExpiry] = useState('');
  const [reuploadError, setReuploadError] = useState('');

  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setEditingEmp(null);
    setEmployeeCode(`EMP${String(employees.length + 1).padStart(3, '0')}`);
    setFullName('');
    setEmail('');
    setPhone('+91 ');
    setDepartment('Engineering');
    setDesignation('Associate');
    setShiftId(shifts[0]?.shiftId || 'SHIFT_GEN_01');
    setWorkLocationId(locations[0]?.locationId || 'LOC_HQ_01');
    setEmploymentType('full_time');
    setEmploymentStatus('active');
    setUan('');
    setEsiNumber('');
    setPanMasked('');
    setBankAccountMasked('');
    setDeviceEmployeeCode(String(1001 + employees.length));
    setShowModal(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingEmp(emp);
    setEmployeeCode(emp.employeeCode);
    setFullName(emp.fullName);
    setEmail(emp.email);
    setPhone(emp.phone || '');
    setDepartment(emp.department);
    setDesignation(emp.designation);
    setShiftId(emp.shiftId || shifts[0]?.shiftId || '');
    setWorkLocationId(emp.workLocationId || locations[0]?.locationId || '');
    setEmploymentType(emp.employmentType || 'full_time');
    setEmploymentStatus(emp.employmentStatus);
    setUan(emp.uan || '');
    setEsiNumber(emp.esiNumber || '');
    setPanMasked(emp.panMasked || '');
    setBankAccountMasked(emp.bankAccountMasked || '');
    setDeviceEmployeeCode(emp.deviceEmployeeCode || '');
    setShowModal(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const employeeId = editingEmp?.employeeId || makeId('EMP');
      const normalizedEmail = email.trim().toLowerCase();
      const fixedRole: NonNullable<Employee['role']> =
        normalizedEmail === 'wavecodeankita@gmail.com'
          ? 'company_admin'
          : normalizedEmail === 'ankitakhot012@gmail.com'
            ? 'hr_manager'
            : 'employee';
      const payload = {
        employeeCode: employeeCode.trim(),
        fullName: fullName.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        department: department.trim(),
        designation: designation.trim(),
        shiftId,
        workLocationId,
        employmentType,
        employmentStatus,
        joiningDate: editingEmp?.joiningDate || todayIsoDate(),
        panMasked: panMasked.trim(),
        uan: uan.trim(),
        esiNumber: esiNumber.trim(),
        bankAccountMasked: bankAccountMasked.trim(),
        deviceEmployeeCode: deviceEmployeeCode.trim(),
        role: fixedRole,
      };

      if (editingEmp) {
        await updateDocStrict('employees', employeeId, payload);
      } else {
        await createDocStrict('employees', employeeId, {
          employeeId,
          companyId: company.companyId,
          companyOwnerUid: currentEmployee.companyOwnerUid,
          employeeUid: currentEmployee.companyOwnerUid,
          ...payload,
        });
      }

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: editingEmp ? 'EMPLOYEE_UPDATED' : 'EMPLOYEE_CREATED',
        targetCollection: 'employees',
        targetId: employeeId,
        summary: `${editingEmp ? 'Updated' : 'Added'} employee ${fullName} (${employeeCode}).`,
      });
      setShowModal(false);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);
      for (const row of rows.slice(0, 50)) {
        const name = String(row.fullName || row.Name || '').trim();
        const mail = String(row.email || row.Email || '').trim().toLowerCase();
        if (!name || !mail) continue;
        const employeeId = makeId('EMP');
        const fixedRole: NonNullable<Employee['role']> =
          mail === 'wavecodeankita@gmail.com'
            ? 'company_admin'
            : mail === 'ankitakhot012@gmail.com'
              ? 'hr_manager'
              : 'employee';
        await createDocStrict('employees', employeeId, {
          employeeId,
          companyId: company.companyId,
          companyOwnerUid: currentEmployee.companyOwnerUid,
          employeeUid: currentEmployee.companyOwnerUid,
          employeeCode: String(row.employeeCode || row.Code || `EMP_${employeeId.slice(-4)}`),
          fullName: name,
          email: mail,
          department: String(row.department || row.Department || 'Operations'),
          designation: String(row.designation || row.Designation || 'Staff'),
          ...(shifts[0]?.shiftId ? { shiftId: shifts[0].shiftId } : {}),
          ...(locations[0]?.locationId ? { workLocationId: locations[0].locationId } : {}),
          employmentStatus: 'active',
          employmentType: 'full_time',
          joiningDate: todayIsoDate(),
          role: fixedRole,
        });
      }
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const processSelectedFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    const isImage =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|jfif|webp|gif|bmp)$/i.test(lower);
    const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');

    if (!isImage && !isPdf) {
      throw new Error('Unsupported file type. Upload PNG, JPG, JPEG, WEBP, GIF, or PDF.');
    }

    const processed = isImage
      ? await compressImageToDataUrl(file)
      : await readPdfToDataUrl(file);
    return {
      fileName: file.name.slice(0, 150),
      mimeType: processed.mimeType,
      sizeBytes: processed.sizeBytes,
      dataUrl: processed.dataUrl,
    };
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setDocError('');
    setDocSuccess('');
    if (!file) return;

    setBusy(true);
    try {
      const processed = await processSelectedFile(file);
      setDocFileName(processed.fileName);
      setDocMimeType(processed.mimeType);
      setDocSizeBytes(processed.sizeBytes);
      setDocDataUrl(processed.dataUrl);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to process attachment.');
      setDocDataUrl('');
      setDocMimeType('');
      setDocSizeBytes(0);
      setDocFileName('');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const handleReuploadFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setReuploadError('');
    if (!file) return;

    setBusy(true);
    try {
      const processed = await processSelectedFile(file);
      setReuploadFileName(processed.fileName);
      setReuploadMimeType(processed.mimeType);
      setReuploadSizeBytes(processed.sizeBytes);
      setReuploadDataUrl(processed.dataUrl);
    } catch (err) {
      setReuploadError(err instanceof Error ? err.message : 'Failed to process attachment.');
      setReuploadDataUrl('');
      setReuploadMimeType('');
      setReuploadSizeBytes(0);
      setReuploadFileName('');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocError('');
    setDocSuccess('');
    if (!docDataUrl) {
      setDocError('Please select an image (PNG, JPG, JPEG) or PDF file first.');
      return;
    }
    const targetEmp = isAdminOrHr
      ? employees.find((x) => x.employeeId === docEmpId) || currentEmployee
      : currentEmployee;

    setBusy(true);
    try {
      const docId = makeId('DOC');
      await createDocStrict('employeeDocuments', docId, {
        docId,
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        employeeId: targetEmp.employeeId,
        employeeUid: targetEmp.employeeUid || currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        employeeName: targetEmp.fullName,
        docType,
        fileName: (docFileName || `${docType}_${targetEmp.employeeCode}`).trim().slice(0, 155),
        mimeType: docMimeType,
        fileSizeBytes: docSizeBytes,
        fileDataUrl: docDataUrl,
        ...(docNumber.trim() ? { documentNumber: docNumber.trim().slice(0, 64) } : {}),
        status: 'pending_verification',
        ...(docExpiry ? { expiryDate: docExpiry } : {}),
      });

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: currentEmployee.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'KYC_DOCUMENT_UPLOADED',
        targetCollection: 'employeeDocuments',
        targetId: docId,
        summary: `Uploaded ${docType.toUpperCase()} document (${docFileName || docId}) for ${targetEmp.fullName}.`,
      });

      setDocFileName('');
      setDocMimeType('');
      setDocSizeBytes(0);
      setDocDataUrl('');
      setDocNumber('');
      setDocExpiry('');
      setDocSuccess(`Uploaded ${DOC_TYPE_LABELS[docType]} for ${targetEmp.fullName}.`);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to upload KYC document.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyDocument = async (docItem: EmployeeDocument) => {
    setBusy(true);
    setDocError('');
    try {
      await updateDocStrict('employeeDocuments', docItem.docId, {
        status: 'approved',
        reviewNote: `Verified by ${currentEmployee.fullName}`.slice(0, 280),
      });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: docItem.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'KYC_DOCUMENT_APPROVED',
        targetCollection: 'employeeDocuments',
        targetId: docItem.docId,
        summary: `${currentEmployee.fullName} verified ${docItem.employeeName}'s ${docItem.docType.toUpperCase()}.`,
      });
      setDocSuccess(`Verified ${docItem.employeeName}'s ${DOC_TYPE_LABELS[docItem.docType] || docItem.docType}.`);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to verify document.');
    } finally {
      setBusy(false);
    }
  };

  const openRejectModal = (docItem: EmployeeDocument) => {
    setRejectingDoc(docItem);
    setRejectReason('');
    setRejectError('');
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingDoc) return;
    const trimmed = rejectReason.trim();
    if (trimmed.length < 3) {
      setRejectError('Please enter a clear reason (at least 3 characters) so the employee knows what to re-upload.');
      return;
    }

    setBusy(true);
    setRejectError('');
    try {
      const note = `${trimmed} (Rejected by ${currentEmployee.fullName})`.slice(0, 280);
      await updateDocStrict('employeeDocuments', rejectingDoc.docId, {
        status: 'rejected',
        reviewNote: note,
      });
      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: rejectingDoc.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'KYC_DOCUMENT_REJECTED',
        targetCollection: 'employeeDocuments',
        targetId: rejectingDoc.docId,
        summary: `${currentEmployee.fullName} rejected ${rejectingDoc.employeeName}'s ${rejectingDoc.docType.toUpperCase()}: ${trimmed}`,
      });
      setDocSuccess(`Rejected ${rejectingDoc.employeeName}'s ${DOC_TYPE_LABELS[rejectingDoc.docType] || rejectingDoc.docType} with reason.`);
      setRejectingDoc(null);
      setRejectReason('');
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'Failed to reject document.');
    } finally {
      setBusy(false);
    }
  };

  const openReuploadModal = (docItem: EmployeeDocument) => {
    setReuploadDoc(docItem);
    setReuploadFileName('');
    setReuploadMimeType('');
    setReuploadSizeBytes(0);
    setReuploadDataUrl('');
    setReuploadNumber(docItem.documentNumber || '');
    setReuploadExpiry(docItem.expiryDate || '');
    setReuploadError('');
  };

  const handleConfirmReupload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reuploadDoc) return;
    if (!reuploadDataUrl) {
      setReuploadError('Please select a new PNG, JPG, JPEG, or PDF file to re-upload.');
      return;
    }

    setBusy(true);
    setReuploadError('');
    try {
      const canUpdateExisting =
        isAdminOrHr || reuploadDoc.employeeUid === currentEmployee.employeeUid;

      if (canUpdateExisting) {
        await updateDocStrict('employeeDocuments', reuploadDoc.docId, {
          fileName: reuploadFileName.trim().slice(0, 155),
          mimeType: reuploadMimeType,
          fileSizeBytes: reuploadSizeBytes,
          fileDataUrl: reuploadDataUrl,
          documentNumber: reuploadNumber.trim().slice(0, 64),
          expiryDate: reuploadExpiry || '',
          reviewNote: '',
          status: 'pending_verification',
        });
      } else {
        const newDocId = makeId('DOC');
        await createDocStrict('employeeDocuments', newDocId, {
          docId: newDocId,
          companyId: company.companyId,
          companyOwnerUid: currentEmployee.companyOwnerUid,
          employeeId: currentEmployee.employeeId,
          employeeUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
          employeeName: currentEmployee.fullName,
          docType: reuploadDoc.docType,
          fileName: reuploadFileName.trim().slice(0, 155),
          mimeType: reuploadMimeType,
          fileSizeBytes: reuploadSizeBytes,
          fileDataUrl: reuploadDataUrl,
          ...(reuploadNumber.trim() ? { documentNumber: reuploadNumber.trim().slice(0, 64) } : {}),
          status: 'pending_verification',
          ...(reuploadExpiry ? { expiryDate: reuploadExpiry } : {}),
        });
      }

      await logAuditEvent({
        companyId: company.companyId,
        companyOwnerUid: reuploadDoc.companyOwnerUid,
        actorUid: currentEmployee.employeeUid || currentEmployee.companyOwnerUid,
        actorName: currentEmployee.fullName,
        action: 'KYC_DOCUMENT_REUPLOADED',
        targetCollection: 'employeeDocuments',
        targetId: reuploadDoc.docId,
        summary: `${currentEmployee.fullName} re-uploaded ${reuploadDoc.docType.toUpperCase()} (${reuploadFileName}).`,
      });

      setDocSuccess(`Re-uploaded ${DOC_TYPE_LABELS[reuploadDoc.docType] || reuploadDoc.docType}. Sent for verification.`);
      setReuploadDoc(null);
      setReuploadDataUrl('');
    } catch (err) {
      setReuploadError(err instanceof Error ? err.message : 'Failed to re-upload document.');
    } finally {
      setBusy(false);
    }
  };

  const visibleDocuments = isAdminOrHr
    ? documents
    : documents.filter((d) => d.employeeId === currentEmployee.employeeId);

  const filtered = employees.filter(
    (emp) =>
      emp.fullName.toLowerCase().includes(search.toLowerCase()) ||
      emp.employeeCode.toLowerCase().includes(search.toLowerCase()) ||
      emp.department.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {effectiveRole === 'company_admin' && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-3 text-xs text-indigo-900">
          <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0" />
          <span>
            <strong>Company Admin Full Authority:</strong> You have complete control over Employee Management, HR Approvals, KYC Verification, Payroll Locking/Recalculation, and Company Policy Settings.
          </span>
        </div>
      )}

      {!canManageDirectory ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-semibold text-slate-900">My Employee Profile &amp; Statutory IDs</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-lg">
              <dt className="text-slate-500">Employee Name</dt>
              <dd className="font-semibold text-slate-900 mt-0.5 truncate">{currentEmployee.fullName}</dd>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg">
              <dt className="text-slate-500">Employee Code</dt>
              <dd className="font-mono font-semibold text-slate-900 mt-0.5">{currentEmployee.employeeCode}</dd>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg">
              <dt className="text-slate-500">Department / Title</dt>
              <dd className="font-semibold text-slate-900 mt-0.5 truncate">
                {currentEmployee.department} · {currentEmployee.designation}
              </dd>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg">
              <dt className="text-slate-500">UAN / PAN / ESI</dt>
              <dd className="font-mono font-semibold text-slate-900 mt-0.5 truncate">
                {currentEmployee.uan || 'NA'} · {currentEmployee.panMasked || 'NA'}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Employee Directory &amp; Lifecycle</h2>
              <p className="text-xs text-slate-500">
                {employees.length} employees · PAN &amp; bank numbers masked for privacy
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap">
                <Upload className="w-3.5 h-3.5" />
                <span>Import Excel</span>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleBulkImport} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() =>
                  exportToExcel(
                    'Employees_Directory',
                    'Employees',
                    employees.map((e) => ({
                      Code: e.employeeCode,
                      FullName: e.fullName,
                      Email: e.email,
                      Department: e.department,
                      Designation: e.designation,
                      Status: e.employmentStatus,
                      UAN: e.uan || '',
                      ESINumber: e.esiNumber || '',
                      DeviceCode: e.deviceEmployeeCode || '',
                    }))
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add Employee
              </button>
            </div>
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by employee name, code, or department..."
            className="w-full sm:max-w-sm px-3 py-2 text-sm border border-slate-200 rounded-lg"
          />

          <div className="hidden md:block">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-3">Code</th>
                  <th className="py-2.5 pr-3">Employee</th>
                  <th className="py-2.5 pr-3">Department &amp; Role</th>
                  <th className="py-2.5 pr-3">Statutory IDs</th>
                  <th className="py-2.5 pr-3">Status</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((emp) => (
                  <tr key={emp.employeeId} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-mono text-xs text-slate-700">{emp.employeeCode}</td>
                    <td className="py-2.5 pr-3">
                      <p className="font-medium text-slate-900">{emp.fullName}</p>
                      <p className="text-xs text-slate-500">{emp.email}</p>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-slate-700">
                      <p>{emp.department}</p>
                      <p className="text-slate-500">{emp.designation}</p>
                    </td>
                    <td className="py-2.5 pr-3 text-xs font-mono text-slate-600">
                      <p>UAN: {emp.uan || 'NA'}</p>
                      <p>DevID: {emp.deviceEmployeeCode || 'NA'}</p>
                    </td>
                    <td className="py-2.5 pr-3 text-xs font-semibold capitalize text-slate-800">
                      {emp.employmentStatus.replace('_', ' ')}
                    </td>
                    <td className="py-2.5 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => openEdit(emp)}
                        className="text-xs font-semibold text-indigo-600 hover:underline"
                      >
                        Edit
                      </button>
                      {emp.employeeId !== currentEmployee.employeeId && (
                        <button
                          type="button"
                          onClick={() => deleteDocStrict('employees', emp.employeeId)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-slate-100">
            {filtered.map((emp) => (
              <div key={emp.employeeId} className="py-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{emp.fullName}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {emp.employeeCode} · {emp.department} · {emp.designation}
                    </p>
                  </div>
                  <span className="text-xs font-semibold capitalize text-indigo-600 shrink-0">
                    {emp.employmentStatus.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => openEdit(emp)}
                    className="font-semibold text-indigo-600"
                  >
                    Edit Profile
                  </button>
                  {emp.employeeId !== currentEmployee.employeeId && (
                    <button
                      type="button"
                      onClick={() => deleteDocStrict('employees', emp.employeeId)}
                      className="text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Employee KYC & Compliance Documents (Real Image + PDF Uploads) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">Employee KYC &amp; Compliance Documents</h3>
              <p className="text-xs text-slate-500">
                Attach Aadhaar card photos, PAN card, PF Passbook/UAN, ESI, Bank Proof, or Passport (PNG, JPG, JPEG, WEBP, PDF)
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-500 shrink-0">
            {visibleDocuments.length} documents
          </span>
        </div>

        {docError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {docError}
          </div>
        )}
        {docSuccess && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
            {docSuccess}
          </div>
        )}

        <form onSubmit={handleAddDocument} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {isAdminOrHr && (
            <select
              value={docEmpId}
              onChange={(e) => setDocEmpId(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            >
              {employees.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>
                  {e.fullName}
                </option>
              ))}
            </select>
          )}
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as EmployeeDocument['docType'])}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
          >
            {(Object.keys(DOC_TYPE_LABELS) as Array<EmployeeDocument['docType']>).map((key) => (
              <option key={key} value={key}>
                {DOC_TYPE_LABELS[key]}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value)}
            placeholder="Doc / ID No. (optional)"
            className="px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
          />

          <label className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg cursor-pointer hover:bg-indigo-100 truncate">
            <FileImage className="w-4 h-4 shrink-0" />
            <span className="truncate">{docFileName || 'Choose Image / PDF'}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf,.png,.jpg,.jpeg,.webp,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>

          <input
            type="date"
            value={docExpiry}
            onChange={(e) => setDocExpiry(e.target.value)}
            title="Expiry date (optional)"
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
          />

          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40"
          >
            Upload Document
          </button>
        </form>

        {docDataUrl && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3 min-w-0">
              {docMimeType.startsWith('image/') ? (
                <img
                  src={docDataUrl}
                  alt="Selected document preview"
                  className="w-12 h-12 rounded object-cover border border-slate-200 shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded bg-red-50 border border-red-200 flex items-center justify-center text-red-700 font-bold shrink-0">
                  PDF
                </div>
              )}
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 truncate">{docFileName}</p>
                <p className="text-slate-500">
                  Ready to attach · {Math.max(1, Math.round(docSizeBytes / 1024))} KB ({docMimeType})
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setDocDataUrl('');
                setDocFileName('');
                setDocMimeType('');
                setDocSizeBytes(0);
              }}
              className="text-red-600 font-medium hover:underline shrink-0"
            >
              Clear
            </button>
          </div>
        )}

        {visibleDocuments.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No KYC or compliance documents uploaded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleDocuments.map((d) => {
              const isImg = Boolean(d.fileDataUrl && (d.mimeType?.startsWith('image/') || d.fileDataUrl.startsWith('data:image/')));
              const isPdf = Boolean(d.fileDataUrl && (d.mimeType === 'application/pdf' || d.fileDataUrl.startsWith('data:application/pdf')));
              const canReuploadDoc =
                d.status !== 'approved' &&
                (isAdminOrHr || d.employeeId === currentEmployee.employeeId);

              return (
                <div
                  key={d.docId}
                  className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {isImg ? (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(d)}
                        className="shrink-0 rounded-lg overflow-hidden border border-slate-200 hover:opacity-90"
                        title="Preview image"
                      >
                        <img
                          src={d.fileDataUrl}
                          alt={d.fileName}
                          className="w-12 h-12 object-cover"
                        />
                      </button>
                    ) : isPdf ? (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(d)}
                        className="w-12 h-12 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center font-bold text-red-700 shrink-0"
                        title="Preview PDF"
                      >
                        PDF
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(d)}
                        className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0"
                        title="Open document details"
                      >
                        <FileText className="w-5 h-5" />
                      </button>
                    )}

                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold text-slate-900 truncate">
                        {d.employeeName} · {DOC_TYPE_LABELS[d.docType] || d.docType.toUpperCase()}
                      </p>
                      <p className="text-slate-600 truncate font-mono">
                        {d.fileName}
                        {d.documentNumber ? ` · No: ${d.documentNumber}` : ''}
                        {d.fileSizeBytes ? ` · ${Math.max(1, Math.round(d.fileSizeBytes / 1024))} KB` : ''}
                      </p>
                      <p className="text-slate-500">
                        Status:{' '}
                        <span
                          className={`font-semibold capitalize ${
                            d.status === 'approved'
                              ? 'text-emerald-700'
                              : d.status === 'rejected'
                                ? 'text-red-600'
                                : 'text-amber-600'
                          }`}
                        >
                          {d.status.replace('_', ' ')}
                        </span>
                        {d.expiryDate ? ` · Expires ${d.expiryDate}` : ''}
                        {d.status !== 'rejected' && d.reviewNote ? ` · ${d.reviewNote}` : ''}
                        {!d.fileDataUrl && (
                          <span className="ml-1.5 text-amber-700 font-medium">· No file attached</span>
                        )}
                      </p>
                      {d.status === 'rejected' && (
                        <div className="mt-1 p-2 rounded-md bg-red-50 border border-red-200 text-red-800 flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                          <span>
                            <strong>Rejection Reason:</strong>{' '}
                            {d.reviewNote || 'Document rejected by manager. Please upload a clearer file.'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(d)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-indigo-700 bg-indigo-50 rounded hover:bg-indigo-100"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </button>
                    {d.fileDataUrl && (
                      <a
                        href={d.fileDataUrl}
                        download={d.fileName}
                        className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Save
                      </a>
                    )}
                    {canReuploadDoc && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openReuploadModal(d)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 font-semibold rounded ${
                          d.status === 'rejected' || !d.fileDataUrl
                            ? 'text-white bg-amber-600 hover:bg-amber-700'
                            : 'text-amber-800 bg-amber-50 hover:bg-amber-100'
                        }`}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Re-upload
                      </button>
                    )}
                    {canVerifyDocs && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleVerifyDocument(d)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Verify
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openRejectModal(d)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-red-700 bg-red-50 rounded hover:bg-red-100"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                    {(canVerifyDocs || d.status !== 'approved') && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => deleteDocStrict('employeeDocuments', d.docId)}
                        className="p-1 text-slate-500 hover:text-red-600"
                        title="Delete Document"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Document Attachment Viewer Modal */}
      {previewDoc && (
        <DocumentViewerModal
          doc={previewDoc}
          docTypeLabel={DOC_TYPE_LABELS[previewDoc.docType] || previewDoc.docType}
          canReupload={
            previewDoc.status !== 'approved' &&
            (isAdminOrHr || previewDoc.employeeId === currentEmployee.employeeId)
          }
          onClose={() => setPreviewDoc(null)}
          onRequestReupload={(docItem) => openReuploadModal(docItem)}
        />
      )}

      {/* Reject Reason Modal (Company Admin / HR Manager) */}
      {rejectingDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Reject KYC Document</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {rejectingDoc.employeeName} · {DOC_TYPE_LABELS[rejectingDoc.docType] || rejectingDoc.docType}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRejectingDoc(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {rejectError && (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {rejectError}
              </div>
            )}

            <form onSubmit={handleConfirmReject} className="space-y-3">
              <div>
                <p className="text-xs font-medium text-slate-700 mb-1.5">Quick Rejection Reasons</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Blurred or unreadable photo — please upload a clearer image',
                    'Missing back side or full document page',
                    'Document number does not match employee profile',
                    'Expired or wrong document uploaded',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setRejectReason(preset)}
                      className="text-[11px] px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-left"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Reason for Rejection (shown to Employee for re-upload)
                </label>
                <textarea
                  rows={3}
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Write why this document is rejected so the employee knows what to fix..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRejectingDoc(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40"
                >
                  Reject &amp; Notify Employee
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Re-upload Document Modal (Employee / HR) */}
      {reuploadDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900">Re-upload KYC Document</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {reuploadDoc.employeeName} · {DOC_TYPE_LABELS[reuploadDoc.docType] || reuploadDoc.docType}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReuploadDoc(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reuploadDoc.status === 'rejected' && reuploadDoc.reviewNote && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <strong>Rejection Reason:</strong> {reuploadDoc.reviewNote}
              </div>
            )}

            {reuploadError && (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {reuploadError}
              </div>
            )}

            <form onSubmit={handleConfirmReupload} className="space-y-3">
              <label className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-dashed border-indigo-300 rounded-lg cursor-pointer hover:bg-indigo-100">
                <FileImage className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {reuploadFileName || 'Choose New Image (PNG/JPG/JPEG) or PDF'}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf,.png,.jpg,.jpeg,.webp,.pdf"
                  onChange={handleReuploadFileSelect}
                  className="hidden"
                />
              </label>

              {reuploadDataUrl && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-3 text-xs">
                  {reuploadMimeType.startsWith('image/') ? (
                    <img
                      src={reuploadDataUrl}
                      alt="Replacement preview"
                      className="w-14 h-14 rounded object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded bg-red-50 border border-red-200 flex items-center justify-center text-red-700 font-bold shrink-0">
                      PDF
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{reuploadFileName}</p>
                    <p className="text-slate-500">
                      {Math.max(1, Math.round(reuploadSizeBytes / 1024))} KB · Ready to re-upload
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Document / ID Number (optional)
                  </label>
                  <input
                    type="text"
                    value={reuploadNumber}
                    onChange={(e) => setReuploadNumber(e.target.value)}
                    placeholder="e.g. Aadhaar / PAN No."
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Expiry Date (optional)
                  </label>
                  <input
                    type="date"
                    value={reuploadExpiry}
                    onChange={(e) => setReuploadExpiry(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReuploadDoc(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Submit Re-upload
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Employee Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 space-y-4 my-8">
            <h3 className="text-lg font-semibold text-slate-900">
              {editingEmp ? 'Update Employee Record' : 'Onboard New Employee'}
            </h3>
            <form onSubmit={handleSaveEmployee} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Employee Code</label>
                <input
                  type="text"
                  required
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                <input
                  type="text"
                  required
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Designation</label>
                <input
                  type="text"
                  required
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Shift</label>
                <select
                  value={shiftId}
                  onChange={(e) => setShiftId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  {shifts.map((s) => (
                    <option key={s.shiftId} value={s.shiftId}>
                      {s.name} ({s.startTime}-{s.endTime})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Work Location</label>
                <select
                  value={workLocationId}
                  onChange={(e) => setWorkLocationId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  {locations.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Employment Status</label>
                <select
                  value={employmentStatus}
                  onChange={(e) => setEmploymentStatus(e.target.value as Employee['employmentStatus'])}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                >
                  <option value="onboarding">Onboarding</option>
                  <option value="active">Active</option>
                  <option value="notice_period">Notice Period</option>
                  <option value="exited">Exited</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Biometric Device Emp Code</label>
                <input
                  type="text"
                  value={deviceEmployeeCode}
                  onChange={(e) => setDeviceEmployeeCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">UAN Number</label>
                <input
                  type="text"
                  value={uan}
                  onChange={(e) => setUan(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ESI Number</label>
                <input
                  type="text"
                  value={esiNumber}
                  onChange={(e) => setEsiNumber(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Masked PAN</label>
                <input
                  type="text"
                  value={panMasked}
                  onChange={(e) => setPanMasked(e.target.value)}
                  placeholder="ABCDE****F"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Masked Bank A/C</label>
                <input
                  type="text"
                  value={bankAccountMasked}
                  onChange={(e) => setBankAccountMasked(e.target.value)}
                  placeholder="XXXX-XXXX-4821"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Portal Role (Auto-Assigned)</label>
                <input
                  type="text"
                  readOnly
                  value={
                    email.trim().toLowerCase() === 'wavecodeankita@gmail.com'
                      ? 'Company Admin'
                      : email.trim().toLowerCase() === 'ankitakhot012@gmail.com'
                        ? 'HR Manager'
                        : 'Employee'
                  }
                  className="w-full px-3 py-2 text-sm bg-slate-50 text-slate-700 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="sm:col-span-2 flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  Save Employee
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
