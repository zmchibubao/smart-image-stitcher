let cvLoadPromise: Promise<any> | null = null

export function loadOpenCV(): Promise<any> {
  if (cvLoadPromise) return cvLoadPromise

  cvLoadPromise = new Promise((resolve, reject) => {
    // 1. Check if already loaded
    if (typeof (window as any).cv !== 'undefined' && (window as any).cv.Mat) {
      resolve((window as any).cv)
      return
    }

    // 2. Timeout protection (60s)
    const timeout = setTimeout(() => {
      clearInterval(poll)
      reject(new Error('OpenCV.js 加载超时，请检查网络或刷新页面'))
    }, 60000)

    // 3. Poll for readiness
    const poll = setInterval(() => {
      const cv = (window as any).cv
      if (cv && cv.Mat && typeof cv.Mat === 'function') {
        clearInterval(poll)
        clearTimeout(timeout)
        resolve(cv)
      }
    }, 200)

    // 4. Inject script if not present
    if (!document.getElementById('opencv-script')) {
      const script = document.createElement('script')
      script.id = 'opencv-script'
      script.async = true
      script.src = 'https://docs.opencv.org/4.8.0/opencv.js'
      script.onerror = () => {
        clearInterval(poll)
        clearTimeout(timeout)
        reject(new Error('OpenCV.js 脚本加载失败，请检查网络连接'))
      }
      document.head.appendChild(script)
    }
  })

  return cvLoadPromise
}

export function isCVReady(): boolean {
  const cv = (window as any).cv
  return !!(cv && cv.Mat && typeof cv.Mat === 'function')
}

declare global {
  interface Window {
    cv: any
    cvReady: boolean
    cvReadyCallbacks: (() => void)[]
  }
}
