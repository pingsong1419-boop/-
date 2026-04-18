<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue'
import type { AppConfig, OrderInfo, RouteStep, TestResult, WorkStep } from './types/mes'
import { getOrderByProcess, getRouteList } from './services/mesApi'
import { writeSignal, clearSignal } from './utils/labviewSignal'
import ConfigModal from './components/ConfigModal.vue'
import RouteTable from './components/RouteTable.vue'
import ApiDetail from './components/ApiDetail.vue'
import type { ApiRecord } from './components/ApiDetail.vue'
import MaterialScanner from './components/MaterialScanner.vue'

// ==================== 配置 ====================
const CONFIG_KEY = 'mes_app_config_v2'

const DEFAULT_CONFIG: AppConfig = {
  orderApiUrl:
    'http://172.25.57.144:8076/api/0rderInfo/GetOtherOrderInfoByProcess',
  routeApiUrl:
    'http://172.25.57.144:8076/api/0rderInfo/GetTechRouteListByCode',
  technicsProcessCode: 'CTP_P1240'
}

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

function saveConfig(cfg: AppConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

const config = reactive<AppConfig>(loadConfig())
const showConfig = ref(false)

function onConfigSaved() {
  saveConfig(config)
}

// ==================== 扫码输入 ====================
const productCode = ref('')
const scanInputRef = ref<HTMLInputElement | null>(null)
// Removed unused scanBuffer and lastScanTime

/** 聚焦扫码框 */
function focusScan() {
  nextTick(() => scanInputRef.value?.focus())
}

onMounted(() => {
  focusScan()
})

// ==================== 状态数据 ====================
/** 步骤 1 */
const orderInfo = ref<OrderInfo | null>(null)
const orderLoading = ref(false)
const orderError = ref('')

/** 步骤 2 */
const routeSteps = ref<RouteStep[]>([])
const routeLoading = ref(false)
const routeError = ref('')

/** 测试结果 */
const testResult = ref<TestResult>('IDLE')
const resultMessage = ref('')

// ==================== 日志 ====================
interface LogEntry {
  time: string
  level: 'info' | 'success' | 'error' | 'warn'
  msg: string
}
const logs = ref<LogEntry[]>([])

function addLog(level: LogEntry['level'], msg: string) {
  logs.value.unshift({
    time: new Date().toLocaleTimeString('zh-CN'),
    level,
    msg
  })
  if (logs.value.length > 50) logs.value.pop()
}

// ==================== 接口交互记录 ====================
const apiRecords = ref<ApiRecord[]>([])

// ==================== 标签页 ====================
const activeTab = ref<'route' | 'api' | 'log' | 'material'>('route')

// ==================== 核心流程 ====================
/** 重置所有状态 */
function resetAll() {
  orderInfo.value = null
  orderError.value = ''
  routeSteps.value = []
  routeError.value = ''
  testResult.value = 'IDLE'
  resultMessage.value = ''
  apiRecords.value = []
  clearSignal()
}

/** 扫码触发查询 */
async function handleScan() {
  const code = productCode.value.trim()
  if (!code) return
  if (!config.technicsProcessCode) {
    addLog('error', '请先在配置中设置工序代码')
    orderError.value = '工序代码未设置，请点击右上角⚙️配置'
    return
  }

  resetAll()
  addLog('info', `扫码：${code}，开始查询工单...`)

  // ===== 步骤一：获取工单 =====
  orderLoading.value = true
  const t0 = Date.now()
  // 创建接口记录
  const rec1: ApiRecord = {
    title: '接口一：获取工单',
    url: config.orderApiUrl,
    reqBody: { technicsProcessCode: config.technicsProcessCode, productCode: code },
    resBody: undefined,
    status: 'pending',
    time: new Date().toLocaleTimeString('zh-CN')
  }
  apiRecords.value.unshift(rec1)
  activeTab.value = 'api'  // 请求时自动切换到交互详情
  try {
    const res = await getOrderByProcess(config, code)
    rec1.duration = Date.now() - t0
    rec1.resBody = res
    const isOk = res.code === 200 || res.code === '200' || res.success === true
    // 实际响应：{ code, message, datas: OrderInfo[] }
    const dataItem = res.datas?.[0] ?? (Array.isArray(res.data) ? res.data[0] : res.data) ?? null
    if (isOk && dataItem) {
      rec1.status = 'success'
      orderInfo.value = dataItem
      addLog('success', `工单获取成功 → orderCode: ${dataItem.orderCode}，route_No: ${dataItem.route_No}`)
      // ===== 步骤二：获取工步列表（用 route_No 作为 routeCode）=====
      await fetchRouteList(dataItem.route_No)
    } else {
      rec1.status = 'error'
      const msg = res.message ?? res.msg ?? '未获取到工单数据'
      orderError.value = msg
      addLog('error', `工单查询失败：${msg}`)
    }
  } catch (err: unknown) {
    rec1.status = 'error'
    rec1.duration = Date.now() - t0
    const msg = err instanceof Error ? err.message : String(err)
    rec1.resBody = { error: msg }
    orderError.value = `请求失败：${msg}`
    addLog('error', `接口请求异常：${msg}`)
  } finally {
    orderLoading.value = false
  }
}

/** 步骤二：获取工步列表 */
async function fetchRouteList(routeCode: string) {
  routeLoading.value = true
  routeError.value = ''
  addLog('info', `查询工步列表，routeCode: ${routeCode}，workSeqNo: ${config.technicsProcessCode}`)

  const t0 = Date.now()
  const rec2: ApiRecord = {
    title: '接口二：获取工步列表',
    url: config.routeApiUrl,
    reqBody: { routeCode, workSeqNo: config.technicsProcessCode },
    resBody: undefined,
    status: 'pending',
    time: new Date().toLocaleTimeString('zh-CN')
  }
  apiRecords.value.unshift(rec2)

  try {
    const res = await getRouteList(config, routeCode)
    rec2.duration = Date.now() - t0
    rec2.resBody = res
    const isOk = res.code === 200 || res.code === '200' || res.success === true
    if (isOk) {
      rec2.status = 'success'
      // 实际响应：{ code, message, data: { workSeqList: RouteStep[] } }
      const rawData = res.data as Record<string, unknown> | null
      let steps: RouteStep[] = []
      if (rawData && Array.isArray(rawData)) {
        steps = rawData as RouteStep[]
      } else if (rawData && Array.isArray(rawData['workSeqList'])) {
        steps = rawData['workSeqList'] as RouteStep[]
      } else if (rawData) {
        steps = [rawData as unknown as RouteStep]
      }
      routeSteps.value = steps
      addLog('success', `工步列表获取成功，共 ${steps.length} 条`)
      // 如果有物料，自动跳转到物料验证页
      const hasMaterial = steps.some(s => (s.workStepList as WorkStep[])?.some(ws => (ws.workStepMaterialList as any[])?.length))
      if (hasMaterial) {
        activeTab.value = 'material'
      } else {
        activeTab.value = 'route'  // 成功后切换到工步列表
      }
    } else {
      rec2.status = 'error'
      const msg = res.message ?? res.msg ?? '未获取到工步数据'
      routeError.value = msg
      addLog('warn', `工步列表查询失败：${msg}`)
    }
  } catch (err: unknown) {
    rec2.status = 'error'
    rec2.duration = Date.now() - t0
    const msg = err instanceof Error ? err.message : String(err)
    rec2.resBody = { error: msg }
    routeError.value = `请求失败：${msg}`
    addLog('error', `工步接口异常：${msg}`)
  } finally {
    routeLoading.value = false
  }
}

// ==================== OK / NG 信号 ====================
function setOK() {
  testResult.value = 'OK'
  resultMessage.value = '检测通过'
  const info = orderInfo.value
  writeSignal('OK', info?.orderCode ?? '', productCode.value, info?.route_No ?? '')
  addLog('success', `[LabVIEW信号] 发出 ✅ OK 信号`)
}

function setNG() {
  testResult.value = 'NG'
  resultMessage.value = '检测不合格'
  const info = orderInfo.value
  writeSignal('NG', info?.orderCode ?? '', productCode.value, info?.route_No ?? '')
  addLog('error', `[LabVIEW信号] 发出 ❌ NG 信号`)
}

function resetResult() {
  testResult.value = 'IDLE'
  resultMessage.value = ''
  clearSignal()
  productCode.value = ''
  focusScan()
  addLog('info', '已复位，等待下一次扫码')
}
</script>

<template>
  <div class="app-root">
    <!-- 顶部标题栏 -->
    <header class="app-header">
      <div class="header-left">
        <div class="brand-icon">MES</div>
        <div class="brand-text">
          <span class="brand-title">工序扫码系统</span>
          <span class="brand-sub">MES Process Scanner v1.0</span>
        </div>
      </div>
      <div class="header-center">
        <span class="process-badge">
          <span class="label">当前工序：</span>
          <span class="value">{{ config.technicsProcessCode || '未设置' }}</span>
        </span>
      </div>
      <div class="header-right">
        <button class="icon-btn" title="系统配置" @click="showConfig = true">
          ⚙️ 配置
        </button>
      </div>
    </header>

    <!-- 主体内容 -->
    <main class="app-main">
      <!-- 左边：操作区 -->
      <section class="left-panel">

        <!-- 扫码输入区 -->
        <div class="card scan-card">
          <div class="card-title">
            <span class="step-badge">1</span>
            扫描产品码
          </div>
          <div class="scan-input-wrap" :class="{ 'scanning': orderLoading }">
            <span class="scan-icon">📷</span>
            <input
              ref="scanInputRef"
              v-model="productCode"
              type="text"
              placeholder="请扫描或输入产品码..."
              class="scan-input"
              :disabled="orderLoading || routeLoading"
              @keydown.enter="handleScan"
            />
            <button
              class="scan-btn"
              :disabled="orderLoading || !productCode.trim()"
              @click="handleScan"
            >
              {{ orderLoading ? '查询中...' : '查询' }}
            </button>
          </div>
          <p class="scan-hint">扫描完成后按 <kbd>Enter</kbd> 或点击「查询」按钮</p>
        </div>

        <!-- 工单信息区 -->
        <div class="card info-card">
          <div class="card-title">
            <span class="step-badge">2</span>
            工单信息
            <div v-if="orderLoading" class="loading-spin" />
          </div>

          <div v-if="orderError" class="error-box">
            <span>⚠️</span> {{ orderError }}
          </div>

          <div v-else-if="orderInfo" class="info-grid">
            <div class="info-item">
              <span class="info-label">工单号</span>
              <span class="info-value highlight">{{ orderInfo.orderCode }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">工艺路线编码 (route_No)</span>
              <span class="info-value mono">{{ orderInfo.route_No }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">产品码</span>
              <span class="info-value mono">{{ productCode }}</span>
            </div>
            <!-- 显示其他返回字段 -->
            <template v-for="(val, key) in orderInfo" :key="key">
              <div
                v-if="key !== 'orderCode' && key !== 'route_No'"
                class="info-item"
              >
                <span class="info-label">{{ key }}</span>
                <span class="info-value">{{ val }}</span>
              </div>
            </template>
          </div>

          <div v-else class="empty-hint">等待扫码查询...</div>
        </div>

        <!-- OK/NG 区域 -->
        <div class="card result-card">
          <div class="card-title">
            <span class="step-badge">3</span>
            测试结果
            <span class="lv-badge">↔ LabVIEW信号</span>
          </div>

          <div class="result-display" :class="testResult.toLowerCase()">
            <span class="result-icon">
              {{ testResult === 'OK' ? '✅' : testResult === 'NG' ? '❌' : '⏳' }}
            </span>
            <span class="result-text">
              {{ testResult === 'IDLE' ? '待检测' : testResult }}
            </span>
            <span v-if="resultMessage" class="result-msg">{{ resultMessage }}</span>
          </div>

          <div class="result-actions">
            <button
              class="btn-ok"
              :disabled="!orderInfo || testResult !== 'IDLE'"
              @click="setOK"
            >
              ✅ OK — 合格
            </button>
            <button
              class="btn-ng"
              :disabled="!orderInfo || testResult !== 'IDLE'"
              @click="setNG"
            >
              ❌ NG — 不合格
            </button>
          </div>

          <button
            v-if="testResult !== 'IDLE'"
            class="btn-reset"
            @click="resetResult"
          >
            🔄 复位 / 下一件
          </button>
        </div>
      </section>

      <!-- 右边：标签页数据区 -->
      <section class="right-panel">
        <!-- 标签栏 -->
        <div class="tab-bar">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'route' }"
            @click="activeTab = 'route'"
          >
            <span>📋</span> 工步列表
            <span v-if="routeSteps.length" class="tab-count">{{ routeSteps.length }}</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'material' }"
            @click="activeTab = 'material'"
          >
            <span>📦</span> 物料验证
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'api' }"
            @click="activeTab = 'api'"
          >
            <span>🔌</span> 接口交互
            <span v-if="apiRecords.length" class="tab-count">{{ apiRecords.length }}</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'log' }"
            @click="activeTab = 'log'"
          >
            <span>📟</span> 操作日志
            <span v-if="logs.length" class="tab-count">{{ logs.length }}</span>
          </button>
        </div>

        <!-- 标签内容区 -->
        <div class="tab-content">
          <!-- 工步列表 -->
          <div v-show="activeTab === 'route'" class="tab-pane">
            <div v-if="routeError" class="error-box">
              <span>⚠️</span> {{ routeError }}
            </div>
            <RouteTable :steps="routeSteps" :loading="routeLoading" />
          </div>

          <!-- 物料验证 -->
          <div v-show="activeTab === 'material'" class="tab-pane">
            <MaterialScanner 
              :steps="routeSteps" 
              @log="addLog"
              @complete="setOK"
            />
          </div>

          <!-- 接口交互详情 -->
          <div v-show="activeTab === 'api'" class="tab-pane">
            <ApiDetail :records="apiRecords" />
          </div>

          <!-- 操作日志 -->
          <div v-show="activeTab === 'log'" class="tab-pane log-pane">
            <div class="log-scroll">
              <div
                v-for="(entry, i) in logs"
                :key="i"
                class="log-entry"
                :class="entry.level"
              >
                <span class="log-time">{{ entry.time }}</span>
                <span class="log-msg">{{ entry.msg }}</span>
              </div>
              <div v-if="!logs.length" class="log-empty">暂无日志</div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- 配置弹窗 -->
    <ConfigModal
      v-model="config"
      v-model:visible="showConfig"
      @save="onConfigSaved"
    />
  </div>
</template>

<style scoped>
/* 根容器 */
.app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: #0a0e1a;
  color: #c8d6e5;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  overflow: hidden;
}

/* 顶部标题栏 */
.app-header {
  display: flex;
  align-items: center;
  padding: 0 20px;
  height: 52px;
  background: linear-gradient(135deg, #0d1b2a 0%, #112240 100%);
  border-bottom: 1px solid rgba(100, 181, 246, 0.2);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.4);
  flex-shrink: 0;
  gap: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  width: 34px;
  height: 34px;
  background: linear-gradient(135deg, #1565c0, #0d47a1);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  color: #e3f2fd;
  letter-spacing: -0.5px;
  box-shadow: 0 0 12px rgba(21, 101, 192, 0.5);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-title {
  font-size: 15px;
  font-weight: 700;
  color: #e3f2fd;
  line-height: 1.2;
}

.brand-sub {
  font-size: 10px;
  color: #546e7a;
  letter-spacing: 0.5px;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.process-badge {
  background: rgba(21, 101, 192, 0.2);
  border: 1px solid rgba(100, 181, 246, 0.2);
  border-radius: 20px;
  padding: 4px 16px;
  font-size: 12px;
  display: flex;
  gap: 6px;
}

.process-badge .label {
  color: #78909c;
}

.process-badge .value {
  color: #42a5f5;
  font-weight: 600;
}

.header-right {
  display: flex;
  gap: 8px;
}

.icon-btn {
  background: rgba(21, 101, 192, 0.2);
  border: 1px solid rgba(100, 181, 246, 0.2);
  border-radius: 6px;
  color: #90caf9;
  padding: 5px 14px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: rgba(21, 101, 192, 0.4);
  border-color: #42a5f5;
  color: #e3f2fd;
}

/* 主体 */
.app-main {
  display: flex;
  gap: 12px;
  padding: 12px;
  flex: 1;
  overflow: hidden;
}

.left-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 360px;
  flex-shrink: 0;
  overflow-y: auto;
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: #131929;
  border: 1px solid rgba(100, 181, 246, 0.12);
  border-radius: 10px;
}

/* 标签栏 */
.tab-bar {
  display: flex;
  gap: 2px;
  padding: 8px 10px 0;
  border-bottom: 1px solid rgba(100, 181, 246, 0.1);
  background: linear-gradient(180deg, #0d1525 0%, #131929 100%);
  flex-shrink: 0;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: #546e7a;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  bottom: -1px;
}

.tab-btn:hover {
  color: #90caf9;
  background: rgba(100, 181, 246, 0.05);
}

.tab-btn.active {
  color: #42a5f5;
  background: #131929;
  border-color: rgba(100, 181, 246, 0.15);
  font-weight: 600;
}

.tab-count {
  background: rgba(66, 165, 245, 0.2);
  color: #42a5f5;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}

.tab-btn.active .tab-count {
  background: rgba(66, 165, 245, 0.3);
}

/* 标签内容区 */
.tab-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.tab-pane {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.log-pane {
  padding: 10px;
}

/* 通用卡片 */
.card {
  background: #131929;
  border: 1px solid rgba(100, 181, 246, 0.12);
  border-radius: 10px;
  padding: 14px;
  flex-shrink: 0;
}

.route-card,
.log-card {
  flex-shrink: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.route-card {
  flex: 3;
}

.log-card {
  flex: 2;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #90caf9;
  margin-bottom: 12px;
  letter-spacing: 0.5px;
}

.step-badge {
  width: 20px;
  height: 20px;
  background: linear-gradient(135deg, #1565c0, #0d47a1);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: white;
  font-weight: 700;
  flex-shrink: 0;
}

.lv-badge {
  margin-left: auto;
  background: rgba(38, 198, 218, 0.1);
  color: #26c6da;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
}

/* 扫码输入 */
.scan-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #0d1117;
  border: 2px solid rgba(100, 181, 246, 0.2);
  border-radius: 8px;
  padding: 4px 6px 4px 12px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.scan-input-wrap.scanning {
  border-color: #42a5f5;
  box-shadow: 0 0 0 3px rgba(66, 165, 245, 0.1), 0 0 20px rgba(66, 165, 245, 0.2);
}

.scan-input-wrap:focus-within {
  border-color: #42a5f5;
  box-shadow: 0 0 0 3px rgba(66, 165, 245, 0.1);
}

.scan-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.scan-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: #e0e6ed;
  font-size: 14px;
  font-family: 'Consolas', monospace;
  padding: 8px 0;
  min-width: 0;
}

.scan-input::placeholder {
  color: #37474f;
}

.scan-btn {
  background: linear-gradient(135deg, #1565c0, #0d47a1);
  border: none;
  border-radius: 6px;
  color: #e3f2fd;
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  flex-shrink: 0;
}

.scan-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #1976d2, #1565c0);
  box-shadow: 0 4px 12px rgba(21, 101, 192, 0.4);
}

.scan-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.scan-hint {
  font-size: 11px;
  color: #37474f;
  margin: 6px 0 0 0;
}

kbd {
  background: rgba(100, 181, 246, 0.1);
  border: 1px solid rgba(100, 181, 246, 0.2);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: #64b5f6;
}

/* 工单信息 */
.info-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  background: rgba(21, 101, 192, 0.06);
  border-radius: 6px;
  border: 1px solid rgba(100, 181, 246, 0.08);
  gap: 8px;
}

.info-label {
  font-size: 11px;
  color: #546e7a;
  flex-shrink: 0;
}

.info-value {
  font-size: 12px;
  color: #cfd8dc;
  text-align: right;
  word-break: break-all;
}

.info-value.highlight {
  color: #42a5f5;
  font-weight: 700;
  font-size: 13px;
}

.info-value.mono {
  font-family: 'Consolas', monospace;
}

.empty-hint {
  text-align: center;
  color: #37474f;
  font-size: 12px;
  padding: 16px 0;
}

/* OK/NG 结果 */
.result-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 12px;
  background: rgba(21, 101, 192, 0.05);
  border: 1px solid rgba(100, 181, 246, 0.1);
  transition: all 0.3s;
}

.result-display.ok {
  background: rgba(0, 230, 118, 0.08);
  border-color: rgba(0, 230, 118, 0.3);
  box-shadow: 0 0 24px rgba(0, 230, 118, 0.15);
}

.result-display.ng {
  background: rgba(255, 82, 82, 0.08);
  border-color: rgba(255, 82, 82, 0.3);
  box-shadow: 0 0 24px rgba(255, 82, 82, 0.15);
}

.result-icon {
  font-size: 28px;
}

.result-text {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #e0e6ed;
}

.result-display.ok .result-text {
  color: #00e676;
}

.result-display.ng .result-text {
  color: #ff5252;
}

.result-msg {
  font-size: 12px;
  color: #78909c;
}

.result-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.btn-ok,
.btn-ng {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 0.5px;
}

.btn-ok {
  background: linear-gradient(135deg, #00c853, #00897b);
  color: white;
  box-shadow: 0 4px 16px rgba(0, 200, 83, 0.2);
}

.btn-ok:hover:not(:disabled) {
  box-shadow: 0 6px 24px rgba(0, 200, 83, 0.4);
  transform: translateY(-1px);
}

.btn-ng {
  background: linear-gradient(135deg, #f44336, #c62828);
  color: white;
  box-shadow: 0 4px 16px rgba(244, 67, 54, 0.2);
}

.btn-ng:hover:not(:disabled) {
  box-shadow: 0 6px 24px rgba(244, 67, 54, 0.4);
  transform: translateY(-1px);
}

.btn-ok:disabled,
.btn-ng:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn-reset {
  width: 100%;
  padding: 9px;
  background: rgba(100, 181, 246, 0.08);
  border: 1px solid rgba(100, 181, 246, 0.2);
  border-radius: 6px;
  color: #90caf9;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-reset:hover {
  background: rgba(100, 181, 246, 0.15);
  border-color: #42a5f5;
}

/* 错误框 */
.error-box {
  background: rgba(244, 67, 54, 0.08);
  border: 1px solid rgba(244, 67, 54, 0.25);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 12px;
  color: #ef9a9a;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 8px;
}

/* 加载动画 */
.loading-spin {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(66, 165, 245, 0.2);
  border-top-color: #42a5f5;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-left: auto;
}

/* 日志 */
.log-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-right: 4px;
}

.log-scroll::-webkit-scrollbar {
  width: 4px;
}

.log-scroll::-webkit-scrollbar-thumb {
  background: rgba(100, 181, 246, 0.2);
  border-radius: 2px;
}

.log-entry {
  display: flex;
  gap: 10px;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
}

.log-entry.success { color: #69f0ae; }
.log-entry.error { color: #ff5252; }
.log-entry.warn { color: #ffab40; }
.log-entry.info { color: #78909c; }

.log-time {
  color: #455a64;
  flex-shrink: 0;
  width: 70px;
}

.log-msg {
  word-break: break-all;
  line-height: 1.5;
}

.log-empty {
  text-align: center;
  color: #37474f;
  font-size: 12px;
  padding: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
