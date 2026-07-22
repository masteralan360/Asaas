import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BarcodeScanner, type DetectedBarcode } from 'react-barcode-scanner'
import 'react-barcode-scanner/polyfill'

const CAMERA_SCAN_OPTIONS = {
    formats: [
        'code_128',
        'code_39',
        'code_93',
        'codabar',
        'ean_13',
        'ean_8',
        'itf',
        'upc_a',
        'upc_e',
        'qr_code'
    ],
    delay: 1000
}

interface CameraBarcodeScannerProps {
    selectedCameraId: string
    onCapture: (barcodes: DetectedBarcode[]) => void
}

/**
 * Keeps the scanner library's reference-sensitive props stable. The library
 * opens a new MediaStream whenever `trackConstraints` changes, so recreating
 * that object during ordinary POS renders makes the camera preview stutter.
 */
export function CameraBarcodeScanner({ selectedCameraId, onCapture }: CameraBarcodeScannerProps) {
    const onCaptureRef = useRef(onCapture)

    useEffect(() => {
        onCaptureRef.current = onCapture
    }, [onCapture])

    const handleCapture = useCallback((barcodes: DetectedBarcode[]) => {
        onCaptureRef.current(barcodes)
    }, [])

    const trackConstraints = useMemo<MediaTrackConstraints>(() => ({
        deviceId: selectedCameraId || undefined,
        facingMode: selectedCameraId ? undefined : { ideal: 'environment' },
        // Barcode detection does not need the package's default 1920px
        // preference. Capping the stream at 720p keeps preview rendering and
        // detector work smooth on lower-powered POS devices.
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 30, max: 30 },
        advanced: []
    }), [selectedCameraId])

    return (
        <BarcodeScanner
            onCapture={handleCapture}
            trackConstraints={trackConstraints}
            options={CAMERA_SCAN_OPTIONS}
        />
    )
}
