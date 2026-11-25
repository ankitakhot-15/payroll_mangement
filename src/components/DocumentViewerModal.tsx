import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Download, FileWarning, RefreshCw, X } from 'lucide-react';
import { EmployeeDocument } from '../types/payroll';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface DocumentViewerModalProps {
  doc: EmployeeDocument;
  docTypeLabel: string;
  canReupload: boolean;
  onClose: () => void;
  onRequestReupload: (doc: EmployeeDocument) => void;
}

function parseDataUrlBytes(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return null;
    const header = dataUrl.slice(0, commaIdx);
    const base64Part = dataUrl.slice(commaIdx + 1).replace(/\s/g, '');
    const mimeMatch = header.match(/data:([^;]+)/i);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const binaryStr = atob(base64Part);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return { mime, bytes };
  } catch {
    return null;
  }
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  doc,
  docTypeLabel,
  canReupload,
  onClose,
  onRequestReupload,
}) => {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [imgError, setImgError] = useState<string>('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);

  const isPdf = useMemo(() => {
    const url = doc.fileDataUrl || '';
    return (
      doc.mimeType === 'application/pdf' ||
      url.startsWith('data:application/pdf') ||
      doc.fileName.toLowerCase().endsWith('.pdf')
    );
  }, [doc]);

  useEffect(() => {
    setImgError('');
    setPdfError('');
    setPdfPageCount(0);

    if (!doc.fileDataUrl) {
      setBlobUrl('');
      return;
    }

    const parsed = parseDataUrlBytes(doc.fileDataUrl);
    if (!parsed) {
      setBlobUrl('');
      return;
    }

    const mime = doc.mimeType || parsed.mime || (isPdf ? 'application/pdf' : 'image/jpeg');
    const copy = new Uint8Array(parsed.bytes.length);
    copy.set(parsed.bytes);
    const blob = new Blob([copy.buffer], { type: mime });
    const objectUrl = URL.createObjectURL(blob);
    setBlobUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [doc, isPdf]);

  useEffect(() => {
    if (!isPdf || !doc.fileDataUrl) return;
    let cancelled = false;

    const renderPdf = async () => {
      setPdfLoading(true);
      setPdfError('');
      const container = pdfContainerRef.current;
      if (container) {
        container.innerHTML = '';
      }

      try {
        const parsed = parseDataUrlBytes(doc.fileDataUrl!);
        if (!parsed) {
          throw new Error('Stored PDF data could not be decoded.');
        }

        const loadingTask = pdfjsLib.getDocument({ data: parsed.bytes });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        setPdfPageCount(pdf.numPages);
        const maxPages = Math.min(pdf.numPages, 15);

        for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;

          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'w-full max-w-2xl h-auto bg-white rounded border border-slate-200 shadow-sm mx-auto';

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (cancelled) return;

          if (pdfContainerRef.current) {
            const label = document.createElement('p');
            label.className = 'text-[11px] font-mono text-slate-500 text-center mt-2 mb-1';
            label.textContent = `Page ${pageNum} of ${pdf.numPages}`;
            pdfContainerRef.current.appendChild(label);
            pdfContainerRef.current.appendChild(canvas);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setPdfError(
            err instanceof Error
              ? err.message
              : 'Unable to render this PDF in browser preview. Please download the attachment.'
          );
        }
      } finally {
        if (!cancelled) {
          setPdfLoading(false);
        }
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
    };
  }, [doc, isPdf]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full p-4 sm:p-5 space-y-4 max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 truncate">
              {doc.employeeName} · {docTypeLabel}
            </h3>
            <p className="text-xs text-slate-500 font-mono truncate">
              {doc.fileName}
              {doc.documentNumber ? ` · No: ${doc.documentNumber}` : ''}
              {doc.fileSizeBytes ? ` · ${Math.max(1, Math.round(doc.fileSizeBytes / 1024))} KB` : ''}
            </p>
            {doc.status === 'rejected' && doc.reviewNote && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 mt-2">
                <strong>Rejection Reason:</strong> {doc.reviewNote}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document viewer"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 border border-slate-200 rounded-lg p-3 min-h-[280px]">
          {!doc.fileDataUrl ? (
            <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center p-6 space-y-3">
              <FileWarning className="w-10 h-10 text-amber-500" />
              <div className="space-y-1 max-w-md">
                <p className="text-sm font-semibold text-slate-900">
                  No Image or PDF Attachment Stored
                </p>
                <p className="text-xs text-slate-600">
                  This document entry only contains metadata (or was created before file attachments were attached). Upload a PNG, JPG, JPEG, or PDF file to preview it here.
                </p>
              </div>
              {canReupload && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRequestReupload(doc);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Attach / Re-upload File
                </button>
              )}
            </div>
          ) : isPdf ? (
            <div className="space-y-3">
              {pdfLoading && (
                <div className="py-12 text-center text-xs font-medium text-slate-600">
                  Rendering PDF pages for preview...
                </div>
              )}
              {pdfError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 space-y-2">
                  <p>{pdfError}</p>
                  <p className="text-slate-600">You can still download the PDF directly using the button below.</p>
                </div>
              )}
              {pdfPageCount > 0 && (
                <p className="text-[11px] font-mono text-slate-500 text-center">
                  Showing {Math.min(pdfPageCount, 15)} of {pdfPageCount} page{pdfPageCount > 1 ? 's' : ''}
                </p>
              )}
              <div ref={pdfContainerRef} className="space-y-2" />
            </div>
          ) : imgError ? (
            <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center p-6 space-y-2">
              <FileWarning className="w-9 h-9 text-red-500" />
              <p className="text-xs text-red-700">{imgError}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[260px]">
              <img
                src={blobUrl || doc.fileDataUrl}
                alt={doc.fileName}
                onError={() => setImgError('Could not display this image in browser preview. Please re-upload a PNG or JPG image.')}
                className="max-w-full max-h-[65vh] object-contain rounded shadow-sm bg-white"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {doc.fileDataUrl && (
              <a
                href={blobUrl || doc.fileDataUrl}
                download={doc.fileName}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                <Download className="w-4 h-4" />
                Download Attachment
              </a>
            )}
            {canReupload && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRequestReupload(doc);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Re-upload File
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 ml-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
