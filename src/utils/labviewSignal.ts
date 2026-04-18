// LabVIEW 信号通信工具
// 通过 localStorage 将OK/NG信号暴露给 LabVIEW WebBrowser控件读取
// LabVIEW 可通过 WebBrowser 的 Execute Script 读取 window._mesSignal

import type { TestResult, LabviewSignal } from '../types/mes'

const SIGNAL_KEY = 'mes_test_signal'
const SIGNAL_WINDOW_KEY = '_mesSignal'

/**
 * 写入测试信号（供LabVIEW读取）
 * LabVIEW 使用方式：
 *   - 方案A（推荐）: 使用 WebBrowser "Execute Script" 运行 window._mesSignal
 *   - 方案B: 轮询读取 localStorage key: "mes_test_signal"
 */
export function writeSignal(
  result: TestResult,
  orderCode: string,
  productCode: string,
  routeNo: string
): void {
  const signal: LabviewSignal = {
    result,
    orderCode,
    productCode,
    routeNo,
    timestamp: new Date().toISOString()
  }

  // 方案A: 写入 window 全局变量，LabVIEW 通过 ExecuteScript 读取
  ;(window as any)[SIGNAL_WINDOW_KEY] = signal

  // 方案B: 写入 localStorage，供轮询读取
  localStorage.setItem(SIGNAL_KEY, JSON.stringify(signal))

  // 触发自定义事件（同页面监听）
  window.dispatchEvent(
    new CustomEvent('mes:signal', { detail: signal })
  )

  console.log('[LabVIEW信号]', signal)
}

/**
 * 读取当前信号（调试用）
 */
export function readSignal(): LabviewSignal | null {
  const raw = localStorage.getItem(SIGNAL_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LabviewSignal
  } catch {
    return null
  }
}

/**
 * 清除信号（复位）
 */
export function clearSignal(): void {
  ;(window as any)[SIGNAL_WINDOW_KEY] = null
  localStorage.removeItem(SIGNAL_KEY)
}
