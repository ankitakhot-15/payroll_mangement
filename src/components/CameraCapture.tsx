import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface CameraCaptureProps {
  onCaptureFrames: (frames: string[]) => void;
  sampleCount?: number;
  buttonLabel?: string;
  busy?: boolean;
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({
  onCaptureFrames,
  sampleCount = 2,
  buttonLabel = 'Capture Live Selfie',
  busy = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'ready' | 'denied'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    setCameraState('starting');
    setErrorMsg('');
    stopCamera();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API is not supported in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('ready');
    } catch (err) {
      setCameraState('denied');
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Camera permission denied. Allow camera access or use manual HR attendance fallback.'
      );
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || cameraState !== 'ready') return;
    setCapturing(true);
    const frames: string[] = [];
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      for (let i = 0; i < sampleCount; i++) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        frames.push(dataUrl);
        if (i < sampleCount - 1) {
          await new Promise((r) => setTimeout(r, 260));
        }
      }
      setCapturedPreview(frames[0]);
      onCaptureFrames(frames);
    }
    setCapturing(false);
  };

  return (
    <div className="space-y-3">
      <div className="relative w-full aspect-[4/3] max-h-72 bg-slate-900 rounded-xl overflow-hidden border border-slate-200 flex items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`w-full h-full object-cover ${cameraState === 'ready' ? 'block' : 'hidden'}`}
        />
        {cameraState === 'idle' && (
          <div className="text-center p-6 space-y-3">
            <Camera className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="text-sm text-slate-300">Camera preview is paused for privacy until you start capture.</p>
            <button
              type="button"
              onClick={startCamera}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Enable Camera
            </button>
          </div>
        )}
        {cameraState === 'starting' && (
          <p className="text-sm text-slate-300">Requesting camera permission...</p>
        )}
        {cameraState === 'denied' && (
          <div className="text-center p-6 space-y-2 max-w-xs">
            <ShieldAlert className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-xs text-red-200">{errorMsg}</p>
            <button
              type="button"
              onClick={startCamera}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-600"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Camera
            </button>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {cameraState === 'ready' && (
            <button
              type="button"
              disabled={capturing || busy}
              onClick={handleCapture}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4" />
              {capturing ? `Capturing ${sampleCount} frames...` : buttonLabel}
            </button>
          )}
          {cameraState === 'ready' && (
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setCameraState('idle');
              }}
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Stop Camera
            </button>
          )}
        </div>
        {capturedPreview && (
          <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Frame captured</span>
            <img
              src={capturedPreview}
              alt="Captured selfie preview"
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-lg object-cover border border-slate-200"
            />
          </div>
        )}
      </div>
    </div>
  );
};
