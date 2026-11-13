let cvLoadPromise: Promise<typeof window.cv> | null = null

export function loadOpenCV(): Promise<typeof window.cv> {
  if (cvLoadPromise) return cvLoadPromise

  cvLoadPromise = new Promise((resolve, reject) => {
    // Already loaded
    if (typeof (window as any).cv !== 'undefined' && (window as any).cv.Mat) {
      resolve((window as any).cv)
      return
    }

    // Poll until ready
    let tries = 0
    const maxTries = 300 // 150 seconds

    const poll = () => {
      const cv = (window as any).cv
      if (cv && cv.Mat && typeof cv.Mat === 'function') {
        resolve(cv)
        return
      }
      if (++tries >= maxTries) {
        reject(new Error('OpenCV.js 加载超时，请检查网络连接后刷新页面'))
        return
      }
      setTimeout(poll, 500)
    }

    // If the script tag fired onload already
    if ((window as any).cvReady) {
      poll()
    } else {
      // Wait for onOpenCvReady callback
      const callbacks = (window as any).cvReadyCallbacks
      if (Array.isArray(callbacks)) {
        callbacks.push(() => poll())
      } else {
        // Fallback: just poll
        setTimeout(poll, 1000)
      }
    }
  })

  return cvLoadPromise
}

export function isCVReady(): boolean {
  const cv = (window as any).cv
  return !!(cv && cv.Mat && typeof cv.Mat === 'function')
}

// Declare global cv type
declare global {
  interface Window {
    cv: any
    cvReady: boolean
    cvReadyCallbacks: (() => void)[]
  }
}
