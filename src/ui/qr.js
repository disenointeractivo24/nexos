import QRCode from 'qrcode'

/**
 * QR codes: drawn for a donation (it holds the link that follows it, so any phone
 * camera opens the right page) and read by a collection point's camera.
 */

/** An SVG QR of `text`, ready to drop into the page. */
export function qrSvg(text) {
    return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#011E41', light: '#FFFFFF' } })
}

/** The same QR as a PNG, to save. */
export function qrPng(text) {
    return QRCode.toDataURL(text, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#011E41', light: '#FFFFFF' } })
}

/**
 * Reads QR codes from the camera into `video` until one is found or `stop()` is called.
 * Uses the browser's own detector where there is one (Chrome, Android) and jsQR
 * elsewhere (iPhone).
 *
 * @returns {{ result: Promise<string|null>, stop: () => void }}  null if stopped, or if there is no camera
 */
export function scanQr(video) {
    let stopped = false
    let stream = null
    let finish
    const result = new Promise((r) => (finish = r))
    const stop = () => {
        if (stopped) return
        stopped = true
        stream?.getTracks().forEach((t) => t.stop())
        video.srcObject = null
        finish(null)
    }
    ;(async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        } catch (err) {
            stopped = true
            finish(Promise.reject(err))
            return
        }
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        video.srcObject = stream
        video.setAttribute('playsinline', '')
        video.muted = true
        await video.play().catch(() => {})
        const native = 'BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')
        const detector = native ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null
        const jsQR = native ? null : (await import('jsqr')).default
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const tick = async () => {
            if (stopped) return
            if (video.readyState >= 2 && video.videoWidth) {
                let text = null
                if (detector) {
                    const found = await detector.detect(video).catch(() => [])
                    text = found[0]?.rawValue ?? null
                } else {
                    const w = Math.min(640, video.videoWidth)
                    const h = Math.round((video.videoHeight / video.videoWidth) * w)
                    canvas.width = w
                    canvas.height = h
                    ctx.drawImage(video, 0, 0, w, h)
                    text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
                }
                if (text && !stopped) {
                    stopped = true
                    stream.getTracks().forEach((t) => t.stop())
                    video.srcObject = null
                    finish(text)
                    return
                }
            }
            setTimeout(tick, 180)
        }
        tick()
    })()
    return { result, stop }
}
