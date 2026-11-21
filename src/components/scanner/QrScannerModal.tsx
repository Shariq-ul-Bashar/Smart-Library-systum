import React, { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, CameraOff, CheckCircle2, Keyboard, RefreshCw, ScanBarcode } from 'lucide-react';
import { Button, Input, Modal } from '../ui/primitives.tsx';

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
  title?: string;
  description?: string;
  placeholder?: string;
  /** 'qr' for Student/Founder QR, 'barcode' for ISBN/1D book barcodes, 'all' for both */
  mode?: 'qr' | 'barcode' | 'all';
  /** Keep scanner open after each scan (great for Bulk Scan & Add Books) */
  continuous?: boolean;
}

function getSupportedFormats(mode: 'qr' | 'barcode' | 'all'): Html5QrcodeSupportedFormats[] {
  const barcodeFormats = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.ITF,
    Html5QrcodeSupportedFormats.CODABAR,
  ];
  if (mode === 'qr') {
    return [Html5QrcodeSupportedFormats.QR_CODE];
  }
  if (mode === 'barcode') {
    return [...barcodeFormats, Html5QrcodeSupportedFormats.QR_CODE];
  }
  return [Html5QrcodeSupportedFormats.QR_CODE, ...barcodeFormats];
}

export function QrScannerModal({
  open,
  onClose,
  onScan,
  title = 'Scan QR Code or Barcode',
  description = 'Point your camera at a book ISBN barcode, copy barcode, or Student Digital ID QR, or enter/scan manually below.',
  placeholder = 'Paste QR token, ISBN, or barcode...',
  mode = 'all',
  continuous = false,
}: QrScannerModalProps) {
  const uniqueId = useId().replace(/:/g, '');
  const regionId = `qivora-scanner-${uniqueId}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isStartedRef = useRef(false);
  const handledSingleRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const continuousRef = useRef(continuous);

  onScanRef.current = onScan;
  onCloseRef.current = onClose;
  continuousRef.current = continuous;

  const [manualValue, setManualValue] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  const safeStopScanner = async (instance: Html5Qrcode | null) => {
    if (!instance) return;
    try {
      const state = instance.getState();
      if (
        isStartedRef.current ||
        state === Html5QrcodeScannerState.SCANNING ||
        state === Html5QrcodeScannerState.PAUSED
      ) {
        await instance.stop();
      }
    } catch {
      // Ignore already-stopped scanner errors
    } finally {
      isStartedRef.current = false;
      try {
        instance.clear();
      } catch {
        // Ignore clear errors if DOM already unmounted
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    handledSingleRef.current = false;
    setCameraError(null);
    setCameraActive(false);
    setStartingCamera(true);
    setLastScanned(null);

    const startScanner = async () => {
      await new Promise((r) => setTimeout(r, 140));
      if (cancelled) return;
      const el = document.getElementById(regionId);
      if (!el) {
        setStartingCamera(false);
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStartingCamera(false);
        setCameraError(
          'Camera API is not available in this browser or context (HTTPS required). Use a USB barcode scanner or type the code below.'
        );
        return;
      }

      try {
        const scanner = new Html5Qrcode(regionId, {
          formatsToSupport: getSupportedFormats(mode),
          verbose: false,
          useBarCodeDetectorIfSupported: true,
        });
        scannerRef.current = scanner;

        const qrbox =
          mode === 'barcode'
            ? { width: 280, height: 135 }
            : mode === 'qr'
              ? { width: 230, height: 230 }
              : { width: 265, height: 170 };

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 12,
            qrbox,
            aspectRatio: mode === 'barcode' ? 1.777 : 1.333,
          },
          (decodedText) => {
            const clean = decodedText.trim();
            if (!clean) return;
            const now = Date.now();

            if (continuousRef.current) {
              // Cooldown debounce for same barcode in continuous bulk scan mode
              if (lastScanRef.current.value === clean && now - lastScanRef.current.at < 2200) {
                return;
              }
              lastScanRef.current = { value: clean, at: now };
              setLastScanned(clean);
              onScanRef.current(clean);
              return;
            }

            if (handledSingleRef.current) return;
            handledSingleRef.current = true;
            setLastScanned(clean);
            const activeInstance = scannerRef.current;
            scannerRef.current = null;
            void safeStopScanner(activeInstance).finally(() => {
              onScanRef.current(clean);
              onCloseRef.current();
            });
          },
          () => {
            // Frame had no readable barcode yet
          }
        );

        if (cancelled) {
          isStartedRef.current = true;
          await safeStopScanner(scanner);
          return;
        }
        isStartedRef.current = true;
        setCameraActive(true);
        setStartingCamera(false);
      } catch (err: unknown) {
        if (!cancelled) {
          setStartingCamera(false);
          setCameraActive(false);
          const msg = err instanceof Error ? err.message : '';
          if (/permission|denied|notallowed/i.test(msg)) {
            setCameraError(
              'Camera permission was denied. Allow camera access in your browser address bar and click Retry, or enter/scan with a USB scanner below.'
            );
          } else if (/notfound|no camera|device/i.test(msg)) {
            setCameraError(
              'No camera device detected on this machine. Use a handheld USB barcode scanner or type the ISBN/code below.'
            );
          } else {
            setCameraError(
              'Unable to start live camera feed in this environment. You can type or scan with a USB barcode reader below.'
            );
          }
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      const activeInstance = scannerRef.current;
      scannerRef.current = null;
      void safeStopScanner(activeInstance);
    };
  }, [open, regionId, mode, retryCounter]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualValue.trim();
    if (!cleaned) return;
    onScan(cleaned);
    setManualValue('');
    setLastScanned(cleaned);
    if (!continuous) {
      onClose();
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title} description={description}>
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
          <div id={regionId} className="min-h-[260px] w-full" />

          {startingCamera && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 p-6 text-center text-white">
              <ScanBarcode className="h-9 w-9 text-[#38BDF8] animate-pulse mb-2" />
              <p className="text-xs font-medium text-slate-200">Initializing camera barcode scanner...</p>
            </div>
          )}

          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 p-6 text-center text-white">
              <CameraOff className="h-9 w-9 text-amber-400 mb-3" />
              <p className="text-xs text-slate-200 max-w-sm leading-relaxed">{cameraError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 bg-white/10 text-white border-white/20 hover:bg-white/20"
                onClick={() => setRetryCounter((c) => c + 1)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry Camera
              </Button>
            </div>
          )}

          {cameraActive && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium text-emerald-300 border border-emerald-500/30">
              <Camera className="h-3 w-3" />
              {mode === 'barcode'
                ? 'ISBN / 1D Barcode Live'
                : mode === 'qr'
                  ? 'QR Scanner Live'
                  : 'QR + Barcode Live'}
              {continuous && ' · Continuous'}
            </div>
          )}

          {lastScanned && continuous && (
            <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-lg bg-emerald-600/95 px-3 py-2 text-xs font-medium text-white shadow-lg">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="truncate">Last scanned: <span className="font-mono">{lastScanned}</span></span>
            </div>
          )}
        </div>

        <form onSubmit={handleManualSubmit} className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <Keyboard className="h-3.5 w-3.5" />
            USB Barcode Scanner or Manual Entry Fallback
          </label>
          <div className="flex gap-2">
            <Input
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
            />
            <Button type="submit" disabled={!manualValue.trim()}>
              {continuous ? 'Add' : 'Apply'}
            </Button>
          </div>
          {continuous && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500">
                Continuous mode stays open so you can scan multiple books rapidly.
              </span>
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Done Scanning
              </Button>
            </div>
          )}
        </form>
      </div>
    </Modal>
  );
}
