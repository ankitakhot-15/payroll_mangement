import * as faceapi from '@vladmandic/face-api';

let modelsLoadPromise: Promise<void> | null = null;

export async function ensureFaceModelsLoaded(): Promise<void> {
  if (!modelsLoadPromise) {
    modelsLoadPromise = (async () => {
      const modelPath = '/models';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
      ]);
    })().catch((err) => {
      modelsLoadPromise = null;
      throw err;
    });
  }
  return modelsLoadPromise;
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode captured or uploaded image.'));
    img.src = dataUrl;
  });
}

function createCompressedFaceThumbnail(img: HTMLImageElement, maxSide = 320): string {
  const w0 = img.naturalWidth || img.width || 320;
  const h0 = img.naturalHeight || img.height || 320;
  let w = w0;
  let h = h0;
  if (w > maxSide || h > maxSide) {
    if (w >= h) {
      h = Math.round((h * maxSide) / w);
      w = maxSide;
    } else {
      w = Math.round((w * maxSide) / h);
      h = maxSide;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create image thumbnail canvas.');
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.78);
}

export interface ExtractedFaceTemplate {
  descriptor: number[];
  detectionScore: number;
  thumbnailDataUrl: string;
  faceCount: number;
}

export async function extractFaceTemplateFromDataUrl(
  dataUrl: string,
  options?: { rejectMultipleFaces?: boolean }
): Promise<ExtractedFaceTemplate> {
  await ensureFaceModelsLoaded();
  const img = await loadImageFromDataUrl(dataUrl);

  // Normalize large uploaded images onto an offscreen canvas for fast consistent detection
  const maxDetectSide = 640;
  let w = img.naturalWidth || img.width || 640;
  let h = img.naturalHeight || img.height || 480;
  if (w > maxDetectSide || h > maxDetectSide) {
    if (w >= h) {
      h = Math.round((h * maxDetectSide) / w);
      w = maxDetectSide;
    } else {
      w = Math.round((w * maxDetectSide) / h);
      h = maxDetectSide;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable for face analysis.');
  }
  ctx.drawImage(img, 0, 0, w, h);

  let detections = await faceapi
    .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }))
    .withFaceLandmarks(true)
    .withFaceDescriptors();

  if (detections.length === 0) {
    detections = await faceapi
      .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }))
      .withFaceLandmarks(true)
      .withFaceDescriptors();
  }

  if (detections.length === 0) {
    throw new Error(
      'No human face detected in the image. Please ensure your full face is clearly visible with good lighting.'
    );
  }

  if (options?.rejectMultipleFaces && detections.length > 1) {
    throw new Error(
      `Multiple faces (${detections.length}) detected in frame. Only one employee should be visible.`
    );
  }

  // Pick the largest / highest-confidence face
  const primary = [...detections].sort((a, b) => {
    const areaA = a.detection.box.width * a.detection.box.height;
    const areaB = b.detection.box.width * b.detection.box.height;
    return areaB - areaA;
  })[0];

  const descriptor = Array.from(primary.descriptor).map((v) => Math.round(v * 100000) / 100000);
  const detectionScore = Math.min(99, Math.max(50, Math.round(primary.detection.score * 100)));
  const thumbnailDataUrl = createCompressedFaceThumbnail(img, 320);

  return {
    descriptor,
    detectionScore,
    thumbnailDataUrl,
    faceCount: detections.length,
  };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });
}
