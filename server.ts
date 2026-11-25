import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
let fileProjectId = '';
if (fs.existsSync(firebaseConfigPath)) {
  try {
    const parsedConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8')) as {
      projectId?: string;
    };
    fileProjectId = parsedConfig.projectId || '';
  } catch {
    fileProjectId = '';
  }
}
const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || fileProjectId || 'payroll-c89c3';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const QR_SIGNING_SECRET =
  process.env.QR_SIGNING_SECRET && process.env.QR_SIGNING_SECRET.length >= 16
    ? process.env.QR_SIGNING_SECRET
    : crypto.randomBytes(32).toString('hex');

const usedNonces = new Map<string, number>();

function pruneExpiredNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonces.entries()) {
    if (expiresAt < now) {
      usedNonces.delete(nonce);
    }
  }
}

interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email: string;
    emailVerified: boolean;
  };
}

async function requireFirebaseAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization Bearer token.' });
      return;
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: 'Empty authentication token.' });
      return;
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });

    const uid = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const emailVerified = Boolean(payload.email_verified);

    if (!uid || !emailVerified) {
      res.status(403).json({ error: 'Verified Firebase account required.' });
      return;
    }

    req.user = { uid, email, emailVerified };
    next();
  } catch (err) {
    res.status(401).json({
      error: 'Authentication token verification failed.',
      detail: err instanceof Error ? err.message : 'Invalid token',
    });
  }
}

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((v) => Number(v));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function signHmac(payloadStr: string): string {
  return crypto.createHmac('sha256', QR_SIGNING_SECRET).update(payloadStr).digest('hex');
}

function calculateMaharashtraPT(grossMonthly: number, monthStr: string): number {
  const monthPart = Number(monthStr.split('-')[1] || '0');
  if (grossMonthly <= 7500) return 0;
  if (grossMonthly <= 10000) return 175;
  return monthPart === 2 ? 300 : 200;
}

function calculateMonthlyTDS(annualGross: number, regime: 'new' | 'old'): number {
  const stdDeduction = regime === 'new' ? 75000 : 50000;
  const taxable = Math.max(0, annualGross - stdDeduction);
  let annualTax = 0;

  if (regime === 'new') {
    if (taxable <= 1200000) {
      return 0; // Section 87A rebate under FY 2025-26 New Regime
    }
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
    if (taxable <= 500000) {
      return 0;
    }
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

  const cess = annualTax * 0.04;
  return Math.round((annualTax + cess) / 12);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many API requests. Please wait a moment.' },
  });

  app.use('/api', apiLimiter);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'NexusPay Payroll & Biometric Attendance API',
      serverTime: new Date().toISOString(),
    });
  });

  app.post('/api/auth/verify', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({
      verified: true,
      user: req.user,
      serverTimestamp: new Date().toISOString(),
    });
  });

  // GPS Location Geofence Verification
  app.post('/api/attendance/location/verify', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyMeters: z.number().min(0).max(50000).optional(),
      allowWfh: z.boolean().optional(),
      locations: z.array(
        z.object({
          locationId: z.string().min(1),
          name: z.string().min(1),
          latitude: z.number(),
          longitude: z.number(),
          radiusMeters: z.number().min(10).max(50000),
        })
      ),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid location payload', issues: parsed.error.issues });
      return;
    }

    const { latitude, longitude, accuracyMeters, allowWfh, locations } = parsed.data;
    let bestLocation: { locationId: string; name: string; distanceMeters: number; radiusMeters: number } | null = null;

    for (const loc of locations) {
      const dist = haversineDistanceMeters(latitude, longitude, loc.latitude, loc.longitude);
      if (!bestLocation || dist < bestLocation.distanceMeters) {
        bestLocation = {
          locationId: loc.locationId,
          name: loc.name,
          distanceMeters: dist,
          radiusMeters: loc.radiusMeters,
        };
      }
    }

    const insideGeofence = bestLocation ? bestLocation.distanceMeters <= bestLocation.radiusMeters : false;
    const gpsStatus = insideGeofence ? 'verified' : allowWfh ? 'wfh' : 'outside_geofence';

    res.json({
      gpsStatus,
      insideGeofence,
      distanceMeters: bestLocation?.distanceMeters ?? null,
      matchedLocationId: bestLocation?.locationId ?? null,
      matchedLocationName: bestLocation?.name ?? (allowWfh ? 'Remote / WFH' : 'Unmatched'),
      accuracyMeters: accuracyMeters ?? null,
      serverTimestamp: new Date().toISOString(),
    });
  });

  // Dynamic Expiring QR Code Generation (90-second TTL)
  app.post('/api/attendance/qr/generate', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      companyId: z.string().min(1).max(64),
      locationId: z.string().min(1).max(64),
      locationName: z.string().min(1).max(120),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid QR generation request', issues: parsed.error.issues });
      return;
    }

    const now = Date.now();
    const expiresAt = now + 90 * 1000;
    const nonce = crypto.randomBytes(12).toString('hex');
    const core = {
      companyId: parsed.data.companyId,
      locationId: parsed.data.locationId,
      locationName: parsed.data.locationName,
      issuedBy: req.user!.uid,
      issuedAt: now,
      expiresAt,
      nonce,
    };
    const serialized = JSON.stringify(core);
    const signature = signHmac(serialized);

    res.json({
      tokenPayload: JSON.stringify({ ...core, signature }),
      expiresAt,
      ttlSeconds: 90,
      nonce,
    });
  });

  // Dynamic QR Validation & Single-Use Anti-Replay Verification
  app.post('/api/attendance/qr/verify', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    pruneExpiredNonces();
    const schema = z.object({
      tokenPayload: z.string().min(10).max(4000),
      expectedCompanyId: z.string().min(1).max(64),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid QR verification payload' });
      return;
    }

    try {
      const decoded = JSON.parse(parsed.data.tokenPayload);
      const { signature, ...core } = decoded;
      if (!signature || typeof signature !== 'string' || !core.nonce || !core.expiresAt) {
        res.status(400).json({ error: 'Malformed QR token structure.' });
        return;
      }

      const expectedSig = signHmac(JSON.stringify(core));
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        res.status(403).json({ error: 'QR signature mismatch. Token may be forged.' });
        return;
      }

      if (core.companyId !== parsed.data.expectedCompanyId) {
        res.status(403).json({ error: 'QR code belongs to a different organization.' });
        return;
      }

      if (Date.now() > Number(core.expiresAt)) {
        res.status(410).json({ error: 'QR code has expired. Please scan a fresh code.' });
        return;
      }

      const nonceKey = `qr:${core.nonce}:${req.user!.uid}`;
      if (usedNonces.has(nonceKey)) {
        res.status(409).json({ error: 'QR token already redeemed by this user (anti-replay triggered).' });
        return;
      }

      usedNonces.set(nonceKey, Number(core.expiresAt) + 60000);

      res.json({
        verified: true,
        locationId: core.locationId,
        locationName: core.locationName,
        verificationNonce: core.nonce,
        serverTimestamp: new Date().toISOString(),
      });
    } catch {
      res.status(400).json({ error: 'Unable to parse QR token payload.' });
    }
  });

  // Biometric Face Liveness & Quality Check
  app.post('/api/biometric/face/liveness', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    pruneExpiredNonces();
    const schema = z.object({
      frames: z.array(z.string().min(100)).min(1).max(5),
      challengeType: z.enum(['blink_or_turn', 'multi_frame_capture']).default('multi_frame_capture'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid camera frames are required for liveness check.' });
      return;
    }

    const { frames } = parsed.data;
    const validFrames = frames.filter((f) => f.startsWith('data:image/jpeg;base64,') || f.startsWith('data:image/png;base64,'));
    if (validFrames.length === 0) {
      res.status(400).json({ error: 'Unsupported image format. Capture live JPEG/PNG frames.' });
      return;
    }

    // Check frame uniqueness (detect static identical frame replay when > 1 frame submitted)
    const frameHashes = validFrames.map((f) => crypto.createHash('sha256').update(f).digest('hex'));
    const uniqueHashes = new Set(frameHashes);
    const hasTemporalVariance = validFrames.length === 1 || uniqueHashes.size > 1;

    const avgByteLength =
      validFrames.reduce((sum, f) => sum + Buffer.byteLength(f, 'utf8'), 0) / validFrames.length;
    const qualityScore = Math.min(99, Math.max(62, Math.round(68 + Math.min(30, avgByteLength / 4000))));

    if (!hasTemporalVariance) {
      res.status(422).json({
        livenessStatus: 'failed',
        reason: 'Identical static frames detected across capture sequence (anti-replay check).',
        qualityScore,
      });
      return;
    }

    const livenessNonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 120 * 1000;
    const signature = signHmac(`${req.user!.uid}:${livenessNonce}:${expiresAt}`);

    res.json({
      livenessStatus: 'passed',
      qualityScore,
      frameCount: validFrames.length,
      templateDigest: frameHashes[0].slice(0, 32),
      livenessToken: `${livenessNonce}.${expiresAt}.${signature}`,
      providerMode: 'local_camera_quality_and_anti_replay',
      serverTimestamp: new Date().toISOString(),
    });
  });

  // Biometric Face Verification (1:1 Check against registered 128-D face descriptor + Liveness Token Validation)
  app.post('/api/biometric/face/verify', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    pruneExpiredNonces();
    const schema = z.object({
      livenessToken: z.string().min(20),
      frameBase64: z.string().min(100),
      registeredStatus: z.string().optional(),
      confidenceThreshold: z.number().min(50).max(99).default(80),
      attemptCount: z.number().int().min(1).max(20).default(1),
      maxRetries: z.number().int().min(1).max(20).default(3),
      faceDetected: z.boolean().default(false),
      liveDescriptor: z.array(z.number().finite()).length(128).optional(),
      registeredDescriptor: z.array(z.number().finite()).length(128).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid face verification request.' });
      return;
    }

    const {
      livenessToken,
      registeredStatus,
      confidenceThreshold,
      attemptCount,
      maxRetries,
      faceDetected,
      liveDescriptor,
      registeredDescriptor,
    } = parsed.data;

    if (attemptCount > maxRetries) {
      res.status(429).json({
        faceVerification: 'failed',
        error: `Maximum verification retry limit (${maxRetries}) exceeded. Please ask HR for manual verification or try again after re-capturing.`,
      });
      return;
    }

    const parts = livenessToken.split('.');
    if (parts.length !== 3) {
      res.status(400).json({ error: 'Invalid liveness token.' });
      return;
    }

    const [nonce, expStr, sig] = parts;
    const expiresAt = Number(expStr);
    const expectedSig = signHmac(`${req.user!.uid}:${nonce}:${expiresAt}`);
    if (sig !== expectedSig || Date.now() > expiresAt) {
      res.status(403).json({ error: 'Liveness token expired or invalid.' });
      return;
    }

    const usedKey = `face:${nonce}:${req.user!.uid}`;
    if (usedNonces.has(usedKey)) {
      res.status(409).json({ error: 'Liveness verification token already used (replay blocked).' });
      return;
    }
    usedNonces.set(usedKey, expiresAt);

    if (!faceDetected || !liveDescriptor || liveDescriptor.length !== 128) {
      res.json({
        faceVerification: 'failed',
        confidenceScore: 0,
        verificationNonce: nonce,
        reason: 'No human face detected in the live selfie. Keep your full face centered in bright light.',
        serverTimestamp: new Date().toISOString(),
      });
      return;
    }

    if (registeredStatus !== 'approved' || !registeredDescriptor || registeredDescriptor.length !== 128) {
      res.json({
        faceVerification: 'failed',
        confidenceScore: 0,
        verificationNonce: nonce,
        reason:
          registeredStatus === 'pending_verification'
            ? 'Your face photo is still pending HR approval. Ask HR or Company Admin to approve it in Face Enrollment.'
            : 'No approved reference face enrolled for this employee. HR or Company Admin must upload or capture your reference photo first.',
        serverTimestamp: new Date().toISOString(),
      });
      return;
    }

    let sumSq = 0;
    for (let i = 0; i < 128; i++) {
      const diff = liveDescriptor[i] - registeredDescriptor[i];
      sumSq += diff * diff;
    }
    const euclideanDistance = Math.sqrt(sumSq);
    const matchCeiling = 0.54;

    const confidenceScore =
      euclideanDistance <= matchCeiling
        ? Math.min(99, Math.max(80, Math.round(99 - (euclideanDistance / matchCeiling) * 19)))
        : Math.max(5, Math.min(79, Math.round(79 - ((euclideanDistance - matchCeiling) / 0.46) * 74)));

    const passed = euclideanDistance <= matchCeiling && confidenceScore >= confidenceThreshold;

    res.json({
      faceVerification: passed ? 'verified' : 'failed',
      confidenceScore,
      matchDistance: Math.round(euclideanDistance * 1000) / 1000,
      verificationNonce: nonce,
      ...(passed
        ? {}
        : {
            reason: `Wrong face detected! Live selfie (${confidenceScore}% match) does not match registered employee face.`,
          }),
      serverTimestamp: new Date().toISOString(),
    });
  });

  // Shift & Working Hours Calculation
  app.post('/api/attendance/calculate-hours', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      checkInIso: z.string(),
      checkOutIso: z.string(),
      breakMinutes: z.number().min(0).max(600).default(0),
      shiftStartTime: z.string().default('09:30'),
      shiftEndTime: z.string().default('18:30'),
      gracePeriodMinutes: z.number().min(0).max(120).default(15),
      requiredWorkMinutes: z.number().min(60).max(960).default(480),
      overtimeEligible: z.boolean().default(true),
      isNightShift: z.boolean().default(false),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid attendance calculation payload' });
      return;
    }

    const d = parsed.data;
    const inDate = new Date(d.checkInIso);
    const outDate = new Date(d.checkOutIso);
    const grossMinutes = Math.max(0, Math.round((outDate.getTime() - inDate.getTime()) / 60000));
    const netWorkingMinutes = Math.max(0, grossMinutes - d.breakMinutes);

    const checkInMinutesOfDay = inDate.getHours() * 60 + inDate.getMinutes();
    const shiftStartMins = parseTimeToMinutes(d.shiftStartTime);
    let lateMinutes = 0;
    if (!d.isNightShift) {
      lateMinutes = Math.max(0, checkInMinutesOfDay - (shiftStartMins + d.gracePeriodMinutes));
    }

    const overtimeMinutes = d.overtimeEligible
      ? Math.max(0, netWorkingMinutes - d.requiredWorkMinutes)
      : 0;

    res.json({
      grossMinutes,
      breakMinutes: d.breakMinutes,
      netWorkingMinutes,
      lateMinutes,
      overtimeMinutes,
      attendanceStatus: netWorkingMinutes >= d.requiredWorkMinutes / 2 ? (lateMinutes > 0 ? 'late' : 'checked_out') : 'half_day',
    });
  });

  // Hardware Fingerprint Biometric Device Sync Adapter
  app.post('/api/biometric/devices/:id/sync', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      deviceId: z.string().min(1),
      protocol: z.string().default('ZKTeco Push / REST Adapter'),
      events: z.array(
        z.object({
          deviceEmployeeCode: z.string().min(1),
          timestamp: z.string().min(8),
          punchType: z.enum(['check_in', 'check_out', 'break_start', 'break_end']),
        })
      ),
      employeeMap: z.record(z.string(), z.object({
        employeeId: z.string(),
        employeeUid: z.string(),
        employeeName: z.string(),
      })),
    });

    const parsed = schema.safeParse({ ...req.body, deviceId: req.params.id });
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid device sync payload', issues: parsed.error.issues });
      return;
    }

    const { deviceId, events, employeeMap } = parsed.data;
    const seen = new Set<string>();
    const accepted: Array<Record<string, unknown>> = [];
    const failed: Array<{ deviceEmployeeCode: string; timestamp: string; reason: string }> = [];

    for (const ev of events) {
      const dedupeKey = `${deviceId}:${ev.deviceEmployeeCode}:${ev.timestamp}:${ev.punchType}`;
      if (seen.has(dedupeKey)) {
        failed.push({
          deviceEmployeeCode: ev.deviceEmployeeCode,
          timestamp: ev.timestamp,
          reason: 'Duplicate punch event skipped',
        });
        continue;
      }
      seen.add(dedupeKey);

      const mapped = employeeMap[ev.deviceEmployeeCode];
      if (!mapped) {
        failed.push({
          deviceEmployeeCode: ev.deviceEmployeeCode,
          timestamp: ev.timestamp,
          reason: 'Unmapped device employee ID',
        });
        continue;
      }

      accepted.push({
        deviceId,
        employeeId: mapped.employeeId,
        employeeUid: mapped.employeeUid,
        employeeName: mapped.employeeName,
        timestamp: ev.timestamp,
        punchType: ev.punchType,
        date: ev.timestamp.slice(0, 10),
      });
    }

    res.json({
      syncedAt: new Date().toISOString(),
      totalReceived: events.length,
      acceptedCount: accepted.length,
      failedCount: failed.length,
      accepted,
      failed,
    });
  });

  // Statutory EPF Calculator
  app.post('/api/pf/calculate', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      basicWage: z.number().min(0),
      wageCeiling: z.number().min(0).default(15000),
      employeeRate: z.number().min(0).max(0.5).default(0.12),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid PF calculation input' });
      return;
    }
    const { basicWage, wageCeiling, employeeRate } = parsed.data;
    const pfWage = wageCeiling > 0 ? Math.min(basicWage, wageCeiling) : basicWage;
    const employeePf = Math.round(pfWage * employeeRate);
    const employerEps = Math.round(pfWage * 0.0833);
    const employerEpf = Math.round(pfWage * 0.0367);
    const employerEdli = Math.round(pfWage * 0.005);

    res.json({
      pfWage,
      employeePf,
      employerEpf,
      employerEps,
      employerEdli,
      totalEmployerContribution: employerEpf + employerEps + employerEdli,
    });
  });

  // Statutory ESI Calculator
  app.post('/api/esi/calculate', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      grossWage: z.number().min(0),
      wageCeiling: z.number().min(0).default(21000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid ESI calculation input' });
      return;
    }
    const { grossWage, wageCeiling } = parsed.data;
    const eligible = grossWage > 0 && grossWage <= wageCeiling;
    const employeeEsi = eligible ? Math.ceil(grossWage * 0.0075) : 0;
    const employerEsi = eligible ? Math.ceil(grossWage * 0.0325) : 0;

    res.json({
      eligible,
      employeeEsi,
      employerEsi,
      totalEsi: employeeEsi + employerEsi,
    });
  });

  // Authoritative Monthly Payroll Engine
  app.post('/api/payroll/calculate', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      ptState: z.enum(['Maharashtra', 'Karnataka', 'Gujarat', 'Exempt']).default('Maharashtra'),
      pfWageCeiling: z.number().min(0).default(15000),
      esiWageCeiling: z.number().min(0).default(21000),
      lateMarksPerCut: z.number().min(0).max(31).default(3),
      lateCutDaysPerThreshold: z.number().min(0).max(31).default(1),
      prorateByAttendanceOnly: z.boolean().default(false),
      items: z.array(
        z.object({
          employeeId: z.string().min(1),
          employeeUid: z.string().min(1),
          employeeName: z.string().min(1),
          basic: z.number().min(0),
          grossMonthly: z.number().min(0),
          pfApplicable: z.boolean().default(true),
          esiApplicable: z.boolean().default(true),
          ptApplicable: z.boolean().default(true),
          taxRegime: z.enum(['new', 'old']).default('new'),
          paidDays: z.number().min(0).max(31),
          unpaidDays: z.number().min(0).max(31),
          workingDays: z.number().min(0).max(31).default(0),
          presentDays: z.number().min(0).max(31).default(0),
          halfDays: z.number().min(0).max(31).default(0),
          paidLeaveDays: z.number().min(0).max(31).default(0),
          unpaidLeaveDays: z.number().min(0).max(31).default(0),
          absentDays: z.number().min(0).max(31).default(0),
          lateMarksCount: z.number().min(0).max(31).default(0),
          overtimeMinutes: z.number().min(0).default(0),
          loanEmi: z.number().min(0).default(0),
        })
      ),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payroll calculation request', issues: parsed.error.issues });
      return;
    }

    const {
      month,
      ptState,
      pfWageCeiling,
      esiWageCeiling,
      lateMarksPerCut,
      lateCutDaysPerThreshold,
      prorateByAttendanceOnly,
      items,
    } = parsed.data;
    const [yr, mo] = month.split('-').map(Number);
    const totalDaysInMonth = new Date(yr, mo, 0).getDate() || 30;

    let totalGross = 0;
    let totalNet = 0;
    let totalEmployeePf = 0;
    let totalEmployerPf = 0;
    let totalEmployeeEsi = 0;
    let totalEmployerEsi = 0;
    let totalPt = 0;
    let totalTds = 0;

    const payslips = items.map((item) => {
      const dailyRate = item.grossMonthly / totalDaysInMonth;
      const lateDeductionDays =
        lateMarksPerCut > 0
          ? Math.floor(item.lateMarksCount / lateMarksPerCut) * lateCutDaysPerThreshold
          : 0;
      const rawLeaveDeductionDays = item.unpaidLeaveDays + item.absentDays + item.halfDays * 0.5;
      const strictUnworkedDays = Math.max(
        0,
        totalDaysInMonth - Math.min(totalDaysInMonth, item.workingDays + item.paidLeaveDays)
      );
      const leaveDeductionDays = prorateByAttendanceOnly
        ? strictUnworkedDays
        : rawLeaveDeductionDays;

      const lateDeductionAmount = Math.min(
        item.grossMonthly,
        Math.round(lateDeductionDays * dailyRate)
      );
      const leaveDeductionAmount = prorateByAttendanceOnly
        ? Math.max(
            0,
            item.grossMonthly -
              Math.round(
                item.grossMonthly *
                  (Math.min(totalDaysInMonth, item.workingDays + item.paidLeaveDays) / totalDaysInMonth)
              )
          )
        : Math.min(item.grossMonthly, Math.round(leaveDeductionDays * dailyRate));

      const effectivePaidDays = prorateByAttendanceOnly
        ? Math.max(
            0,
            Math.min(totalDaysInMonth, item.workingDays + item.paidLeaveDays - lateDeductionDays)
          )
        : Math.max(0, Math.min(totalDaysInMonth, totalDaysInMonth - leaveDeductionDays - lateDeductionDays));

      const effectiveUnpaidDays = Math.max(0, totalDaysInMonth - effectivePaidDays);

      const proratedGross = Math.max(0, item.grossMonthly - leaveDeductionAmount - lateDeductionAmount);

      const ratio = Math.min(1, Math.max(0, effectivePaidDays / totalDaysInMonth));
      const proratedBasic = Math.round(item.basic * ratio);
      const hourlyRate = item.grossMonthly / (totalDaysInMonth * 8);
      const overtimePay = Math.round((item.overtimeMinutes / 60) * hourlyRate * 1.5);
      const grossEarnings = proratedGross + overtimePay;

      const pfWage =
        item.pfApplicable && grossEarnings > 0
          ? pfWageCeiling > 0
            ? Math.min(proratedBasic, pfWageCeiling)
            : proratedBasic
          : 0;
      const employeePf = item.pfApplicable && grossEarnings > 0 ? Math.round(pfWage * 0.12) : 0;
      const employerPf = item.pfApplicable && grossEarnings > 0 ? Math.round(pfWage * 0.125) : 0;

      const esiEligible = item.esiApplicable && grossEarnings > 0 && grossEarnings <= esiWageCeiling;
      const employeeEsi = esiEligible ? Math.ceil(grossEarnings * 0.0075) : 0;
      const employerEsi = esiEligible ? Math.ceil(grossEarnings * 0.0325) : 0;

      let professionalTax = 0;
      if (item.ptApplicable && grossEarnings > 0) {
        if (ptState === 'Maharashtra') {
          professionalTax = calculateMaharashtraPT(grossEarnings, month);
        } else if (ptState === 'Karnataka') {
          professionalTax = grossEarnings >= 15000 ? 200 : 0;
        } else if (ptState === 'Gujarat') {
          professionalTax = grossEarnings >= 12000 ? 200 : 0;
        }
      }

      const tds =
        grossEarnings > 0 ? calculateMonthlyTDS(item.grossMonthly * 12, item.taxRegime) : 0;
      const loanEmi = grossEarnings > 0 ? Math.min(item.loanEmi, grossEarnings) : 0;
      const totalDeductions = employeePf + employeeEsi + professionalTax + tds + loanEmi;
      const netSalary = Math.max(0, grossEarnings - totalDeductions);

      totalGross += grossEarnings;
      totalNet += netSalary;
      totalEmployeePf += employeePf;
      totalEmployerPf += employerPf;
      totalEmployeeEsi += employeeEsi;
      totalEmployerEsi += employerEsi;
      totalPt += professionalTax;
      totalTds += tds;

      return {
        employeeId: item.employeeId,
        employeeUid: item.employeeUid,
        employeeName: item.employeeName,
        month,
        paidDays: effectivePaidDays,
        unpaidDays: effectiveUnpaidDays,
        workingDays: item.workingDays,
        presentDays: item.presentDays,
        halfDays: item.halfDays,
        paidLeaveDays: item.paidLeaveDays,
        unpaidLeaveDays: item.unpaidLeaveDays,
        absentDays: item.absentDays,
        lateMarksCount: item.lateMarksCount,
        lateDeductionDays,
        baseMonthlyGross: item.grossMonthly,
        leaveDeductionAmount,
        lateDeductionAmount,
        grossEarnings,
        employeePf,
        employerPf,
        employeeEsi,
        employerEsi,
        professionalTax,
        tds,
        loanEmi,
        overtimePay,
        netSalary,
        paymentStatus: 'pending' as const,
      };
    });

    res.json({
      month,
      totalDaysInMonth,
      employeeCount: payslips.length,
      totalGross,
      totalNet,
      totalEmployeePf,
      totalEmployerPf,
      totalEmployeeEsi,
      totalEmployerEsi,
      totalPt,
      totalTds,
      payslips,
      calculatedAt: new Date().toISOString(),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`NexusPay server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
