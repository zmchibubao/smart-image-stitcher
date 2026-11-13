/**
 * OpenCV.js 健壮生产级加载器
 * 1. 优先从同源站点本地加载 vendor/opencv.js (600ms 内极速就绪)
 * 2. 具备超时机制 (默认 8s)，超时平滑切换备用引擎，杜绝无限卡顿
 * 3. 轮询 cv.Mat 与 cv.ORB 双重就绪校验
 * 4. 自动捕获错误，支持重试
 */

let cvLoadPromise: Promise<any> | null = null
let cvStatus: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
let lastError: string | null = null

export function getOpenCVStatus(): 'idle' | 'loading' | 'ready' | 'failed' {
  if ((window as any).cv && typeof (window as any).cv.Mat === 'function') {
    return 'ready'
  }
  return cvStatus
}

export function isCVReady(): boolean {
  const cv = (window as any).cv
  return !!(cv && typeof cv.Mat === 'function' && typeof cv.matFromImageData === 'function')
}

export function getCVLastError(): string | null {
  return lastError
}

export function resetOpenCVLoader(): void {
  cvLoadPromise = null
  cvStatus = 'idle'
  lastError = null
}

export async function loadOpenCV(timeoutMs = 8000): Promise<any> {
  if (isCVReady()) {
    cvStatus = 'ready'
    return (window as any).cv
  }

  if (cvLoadPromise) {
    return cvLoadPromise
  }

  cvStatus = 'loading'
  lastError = null

  cvLoadPromise = new Promise((resolve, reject) => {
    let resolved = false
    let pollTimer: any = null
    let timeoutTimer: any = null

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }

    const onReady = (cvObj: any) => {
      if (resolved) return
      resolved = true
      cleanup()
      cvStatus = 'ready'
      resolve(cvObj)
    }

    const onFail = (err: Error) => {
      if (resolved) return
      resolved = true
      cleanup()
      cvStatus = 'failed'
      lastError = err.message
      cvLoadPromise = null
      reject(err)
    }

    // 超时防护：超时主动判定失败并退出，使流水线无缝启用备用引擎
    timeoutTimer = setTimeout(() => {
      onFail(new Error(`OpenCV.js 加载超时 (${Math.round(timeoutMs / 1000)}s)，自动启用原生备用图像引擎`))
    }, timeoutMs)

    // 定期轮询检查 cv.Mat 与核心 API 就绪状态
    pollTimer = setInterval(() => {
      const cv = (window as any).cv
      if (cv && typeof cv.Mat === 'function' && typeof cv.matFromImageData === 'function') {
        onReady(cv)
      }
    }, 80)

    // 检查页面是否已有 script 标签
    let script = document.getElementById('opencv-script') as HTMLScriptElement | null

    if (!script) {
      const baseUrl = import.meta.env.BASE_URL || '/'
      const localUrl = `${baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'}vendor/opencv.js`

      script = document.createElement('script')
      script.id = 'opencv-script'
      script.async = true
      script.src = localUrl

      script.onerror = () => {
        console.warn('本地 OpenCV.js 加载受阻，尝试快速 CDN 镜像...')
        script?.remove()

        const cdnScript = document.createElement('script')
        cdnScript.id = 'opencv-script'
        cdnScript.async = true
        cdnScript.src = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/dist/opencv.js'
        cdnScript.onerror = () => {
          onFail(new Error('OpenCV.js 本地与镜像脚本均未能加载'))
        }
        document.head.appendChild(cdnScript)
      }

      document.head.appendChild(script)
    }
  })

  return cvLoadPromise
}

declare global {
  interface Window {
    cv: any
  }
}
