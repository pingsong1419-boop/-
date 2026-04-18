<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue'
import type { AppConfig, OrderInfo, RouteStep, TestResult, WorkStep, TighteningTask } from './types/mes'
import { getOrderByProcess, getRouteList } from './services/mesApi'
import { writeSignal, clearSignal } from './utils/labviewSignal'
import ConfigModal from './components/ConfigModal.vue'
import RouteTable from './components/RouteTable.vue'
import ApiDetail from './components/ApiDetail.vue'
import type { ApiRecord } from './components/ApiDetail.vue'
import MaterialScanner from './components/MaterialScanner.vue'
import TorqueInteraction from './components/TorqueInteraction.vue'

const CONFIG_KEY = 'mes_app_config_v2'
const DEFAULT_CONFIG: AppConfig = {
  orderApiUrl: '/mes-api/api/OrderInfo/GetOtherOrderInfoByProcess',
  routeApiUrl: '/mes-api/api/OrderInfo/GetTechRouteListByCode',
  technicsProcessCode: 'CTP_P1240',
  desoutterIp: '192.168.5.212',
  desoutterPort: 4545
}

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

const config = reactive<AppConfig>(loadConfig())
const showConfig = ref(false)
const onConfigSaved = () => localStorage.setItem(CONFIG_KEY, JSON.stringify(config))

const productCode = ref('')
const scanInputRef = ref<HTMLInputElement | null>(null)
const focusScan = () => nextTick(() => scanInputRef.value?.focus())
onMounted(focusScan)

const orderInfo = ref<OrderInfo | null>(null)
const orderLoading = ref(false)
const orderError = ref('')
const routeSteps = ref<RouteStep[]>([])
const routeLoading = ref(false)
const routeError = ref('')
const tighteningTasks = ref<TighteningTask[]>([])

const testResult = ref<TestResult>('IDLE')
const resultMessage = ref('')
const logs = ref<any[]>([])
const apiRecords = ref<ApiRecord[]>([])
const activeTab = ref<'route' | 'api' | 'log' | 'material' | 'torque'>('route')

function addLog(level: any, msg: string) {
  logs.value.unshift({ time: new Date().toLocaleTimeString(), level, msg })
  if (logs.value.length > 50) logs.value.pop()
}

function resetAll() {
  orderInfo.value = null; orderError.value = ''; routeSteps.value = [];
  routeError.value = ''; testResult.value = 'IDLE'; resultMessage.value = '';
  apiRecords.value = []; clearSignal();
}

async function handleScan() {
  const code = productCode.value.trim()
  if (!code || !config.technicsProcessCode) return
  resetAll()
  addLog('info', `开始查询工单: ${code}`)
  orderLoading.value = true
  const t0 = Date.now()
  const rec: ApiRecord = { title: '获取工单', url: config.orderApiUrl, status: 'pending', time: new Date().toLocaleTimeString(), reqBody: { code } }
  apiRecords.value.unshift(rec)
  activeTab.value = 'api'
  try {
    const res = await getOrderByProcess(config, code)
    rec.duration = Date.now() - t0
    rec.resBody = res
    if (res.datas?.[0]) {
      rec.status = 'success'
      orderInfo.value = res.datas[0]
      addLog('success', '工单获取成功')
      await fetchRouteList(res.datas[0].route_No)
    } else {
      rec.status = 'error'; addLog('error', '未找到工单')
    }
  } catch (err: any) {
    rec.status = 'error'; addLog('error', err.message)
  } finally { orderLoading.value = false }
}

async function fetchRouteList(routeCode: string) {
  routeLoading.value = true
  const t0 = Date.now()
  const rec: ApiRecord = { title: '获取工步', url: config.routeApiUrl, status: 'pending', time: new Date().toLocaleTimeString(), reqBody: { routeCode } }
  apiRecords.value.unshift(rec)
  try {
    const res = await getRouteList(config, routeCode)
    rec.resBody = res
    const steps = res.data?.workSeqList || (Array.isArray(res.data) ? res.data : [])
    routeSteps.value = steps
    generateTasks(steps)
    rec.status = 'success'; addLog('success', `获取到 ${steps.length} 条工步`)
    activeTab.value = 'material'
  } catch (err: any) {
    rec.status = 'error'; addLog('error', err.message)
  } finally { routeLoading.value = false }
}

function generateTasks(steps: RouteStep[]) {
  const newTasks: TighteningTask[] = []
  const subSteps: WorkStep[] = steps.flatMap(s => s.workStepList || [])
  subSteps.forEach(step => {
    const count = (step.workStepLineList as any[])?.[0]?.torqueSettingCount || step.torqueSettingCount || 0
    if (count > 0) {
      for (let i = 1; i <= count; i++) {
        (step.workStepParamList || []).forEach(p => {
          newTasks.push({
            id: `${step.workstepNo}-${i}-${p.paramName}`,
            workstepNo: step.workstepNo || '',
            workstepName: step.workstepName || '',
            screwIndex: i,
            itemDisplayName: `螺丝${i} - ${p.paramName}`,
            paramName: p.paramName || '',
            min: Number(p.minQualityValue) || 0,
            max: Number(p.maxQualityValue) || 0,
            unit: p.paramUnit || '',
            actualValue: null, result: 'PENDING'
          })
        })
      }
    }
  })
  tighteningTasks.value = newTasks
}
</script>

<template>
  <div class="app-root">
    <!-- 椤堕儴鏍囬鏍?-->
    <header class="app-header">
      <div class="header-left">
        <div class="brand-icon">MES</div>
        <div class="brand-text">
          <span class="brand-title">宸ュ簭鎵爜绯荤粺</span>
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
        <button class="icon-btn" title="绯荤粺閰嶇疆" @click="showConfig = true">
          鈿欙笍 閰嶇疆
        </button>
      </div>
    </header>

    <!-- 涓讳綋鍐呭 -->
    <main class="app-main">
      <!-- 宸﹁竟锛氭搷浣滃尯 -->
      <section class="left-panel">

        <!-- 鎵爜杈撳叆鍖?-->
        <div class="card scan-card">
          <div class="card-title">
            <span class="step-badge">1</span>
            鎵弿浜у搧鐮?          </div>
          <div class="scan-input-wrap" :class="{ 'scanning': orderLoading }">
            <span class="scan-icon">馃摲</span>
            <input
              ref="scanInputRef"
              v-model="productCode"
              type="text"
              placeholder="璇锋壂鎻忔垨杈撳叆浜у搧鐮?.."
              class="scan-input"
              :disabled="orderLoading || routeLoading"
              @keydown.enter="handleScan"
            />
            <button
              class="scan-btn"
              :disabled="orderLoading || !productCode.trim()"
              @click="handleScan"
            >
              {{ orderLoading ? '查询涓?..' : '查询' }}
            </button>
          </div>
          <p class="scan-hint">扫描后请按 <kbd>Enter</kbd> 提交</p>
        </div>

        <!-- 宸ュ崟淇℃伅鍖?-->
        <div class="card info-card">
          <div class="card-title">
            <span class="step-badge">2</span>
            宸ュ崟淇℃伅
            <div v-if="orderLoading" class="loading-spin" />
          </div>

          <div v-if="orderError" class="error-box">
            <span>鈿狅笍</span> {{ orderError }}
          </div>

          <div v-else-if="orderInfo" class="info-grid">
            <div class="info-item">
              <span class="info-label">宸ュ崟鍙?</span>
              <span class="info-value highlight">{{ orderInfo.orderCode }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">宸ヨ壓璺嚎缂栫爜 (route_No)</span>
              <span class="info-value mono">{{ orderInfo.route_No }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">浜у搧鐮?</span>
              <span class="info-value mono">{{ productCode }}</span>
            </div>
            <!-- 鏄剧ず鍏朵粬杩斿洖瀛楁 -->
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

        <!-- OK/NG 鍖哄煙 -->
        <div class="card result-card">
          <div class="card-title">
            <span class="step-badge">3</span>
            娴嬭瘯缁撴灉
            <span class="lv-badge">鈫?LabVIEW淇″彿</span>
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
              鉁?OK 鈥?鍚堟牸
            </button>
            <button
              class="btn-ng"
              :disabled="!orderInfo || testResult !== 'IDLE'"
              @click="setNG"
            >
              鉂?NG 鈥?涓嶅悎鏍?            </button>
          </div>

          <button
            v-if="testResult !== 'IDLE'"
            class="btn-reset"
            @click="resetResult"
          >
            馃攧 澶嶄綅 / 涓嬩竴浠?          </button>
        </div>
      </section>

      <!-- 鍙宠竟锛氭爣绛鹃〉鏁版嵁鍖?-->
      <section class="right-panel">
        <!-- 鏍囩鏍?-->
        <div class="tab-bar">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'route' }"
            @click="activeTab = 'route'"
          >
            <span>馃搵</span> 宸ユ鍒楄〃
            <span v-if="routeSteps.length" class="tab-count">{{ routeSteps.length }}</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'material' }"
            @click="activeTab = 'material'"
          >
            <span>馃摝</span> 鐗╂枡楠岃瘉
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'torque' }"
            @click="activeTab = 'torque'"
          >
            <span>馃敡</span> 瀹氭壄浜や簰
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'api' }"
            @click="activeTab = 'api'"
          >
            <span>馃攲</span> 鎺ュ彛浜や簰
            <span v-if="apiRecords.length" class="tab-count">{{ apiRecords.length }}</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'log' }"
            @click="activeTab = 'log'"
          >
            <span>馃摕</span> 鎿嶄綔鏃ュ織
            <span v-if="logs.length" class="tab-count">{{ logs.length }}</span>
          </button>
        </div>

        <!-- 鏍囩鍐呭鍖?-->
        <div class="tab-content">
          <!-- 宸ユ鍒楄〃 -->
          <div v-show="activeTab === 'route'" class="tab-pane">
            <div v-if="routeError" class="error-box">
              <span>鈿狅笍</span> {{ routeError }}
            </div>
            <RouteTable :steps="routeSteps" :loading="routeLoading" />
          </div>

          <!-- 鐗╂枡楠岃瘉 -->
          <div v-show="activeTab === 'material'" class="tab-pane flex-column">
            <MaterialScanner 
              :steps="routeSteps" 
              @log="addLog"
              @complete="setOK"
            />

            <!-- 瀹氭壄鍒ゅ畾鐭╅樀琛ㄦ牸 (宸叉寜闇€绉诲姩鑷崇墿鏂欎笅鏂? -->
            <div class="tightening-matrix-card-modern">
              <div class="matrix-header-modern">
                <span class="matrix-title">馃敥 瀹氭壄鍒ゅ畾鐭╅樀 (鍩轰簬宸ュ崟宸ユ鑷姩灞曡В)</span>
                <button class="btn-text-modern" @click="tighteningTasks.forEach(t => t.actualValue = null)">閲嶇疆杩涘害</button>
              </div>
              <div class="matrix-table-wrap">
                <table class="matrix-table-modern">
                  <thead>
                    <tr>
                      <th style="width: 50px">搴忓彿</th>
                      <th>宸ユ鍚嶇О</th>
                      <th>椤圭洰鍚嶇О</th>
                      <th>鏈€灏 </th>
                      <th>鏈€ </th>
                      <th>鍗曚綅</th>
                      <th>娴嬭瘯鍊?</th>
                      <th>缁撴灉</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(task, idx) in tighteningTasks" :key="task.id" :class="task.result">
                      <td>{{ idx + 1 }}</td>
                      <td>{{ task.workstepName }}</td>
                      <td>{{ task.itemDisplayName }}</td>
                      <td>{{ task.min }}</td>
                      <td>{{ task.max }}</td>
                      <td>{{ task.unit }}</td>
                      <td class="mono b">{{ task.actualValue || '--' }}</td>
                      <td>
                        <span v-if="task.result === 'PASS'" class="badge pass">OK</span>
                        <span v-else-if="task.result === 'FAIL'" class="badge fail">NG</span>
                        <span v-else class="badge pending">绛夊緟</span>
                      </td>
                    </tr>
                    <tr v-if="!tighteningTasks.length">
                      <td colspan="8" class="empty-text">鏆傛棤瀹氭壄閰嶇疆锛岃鍏堟煡璇㈠伐鍗曞伐姝?</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- 瀹氭壄浜や簰 -->
          <div v-show="activeTab === 'torque'" class="tab-pane">
            <TorqueInteraction 
              :ip="config.desoutterIp"
              :port="config.desoutterPort"
              v-model:tasks="tighteningTasks"
              @log="addLog"
            />
          </div>

          <!-- 鎺ュ彛浜や簰璇︽儏 -->
          <div v-show="activeTab === 'api'" class="tab-pane">
            <ApiDetail :records="apiRecords" />
          </div>

          <!-- 鎿嶄綔鏃ュ織 -->
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
              <div v-if="!logs.length" class="log-empty">鏆傛棤鏃ュ織</div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- 閰嶇疆寮圭獥 -->
    <ConfigModal
      v-model="config"
      v-model:visible="showConfig"
      @save="onConfigSaved"
    />
  </div>
</template>

<style scoped>
/* 鏍瑰鍣?*/
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

/* 椤堕儴鏍囬鏍?*/
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

/* 涓讳綋 */
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

/* 鏍囩鏍?*/
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

/* 鏍囩鍐呭鍖?*/
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

/* 閫氱敤鍗＄墖 */
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

/* 鎵爜杈撳叆 */
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

/* 宸ュ崟淇℃伅 */
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

/* OK/NG 缁撴灉 */
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

/* 閿欒妗?*/
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

/* 鍔犺浇鍔ㄧ敾 */
.loading-spin {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(66, 165, 245, 0.2);
  border-top-color: #42a5f5;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-left: auto;
}

/* 鏃ュ織 */
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

/* 瀹氭壄鍒ゅ畾鐭╅樀 (瀵归綈鐗╂枡楠岃瘉 UI) */
.tightening-matrix-card-modern {
  margin-top: 24px;
  border-top: 1px solid rgba(100, 181, 246, 0.1);
}

.matrix-header-modern {
  padding: 12px 14px;
  background: rgba(13, 71, 161, 0.15);
  border-bottom: 1px solid rgba(100, 181, 246, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.matrix-title {
  color: #e3f2fd;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.matrix-table-modern {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.matrix-table-modern th {
  background: rgba(21, 101, 192, 0.2);
  color: #78909c;
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid rgba(100, 181, 246, 0.1);
}

.matrix-table-modern td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(100, 181, 246, 0.05);
  color: #cfd8dc;
}

.badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  display: inline-block;
}

.badge.pass { background: rgba(0, 230, 118, 0.15); color: #00e676; }
.badge.fail { background: rgba(244, 67, 54, 0.15); color: #f44336; }
.badge.pending { background: rgba(255, 171, 64, 0.15); color: #ffab40; }

.matrix-mono { font-family: 'Consolas', monospace; color: #64b5f6; }

.btn-reset-light {
  background: #1976d2;
  color: white;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 定扭判定矩阵 (对齐物料验证 UI) */
.tightening-matrix-card-modern {
  margin-top: 24px;
  border-top: 1px solid rgba(100, 181, 246, 0.1);
  display: flex;
  flex-direction: column;
}

.matrix-header-modern {
  padding: 12px 14px;
  background: rgba(13, 71, 161, 0.15);
  border-bottom: 1px solid rgba(100, 181, 246, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.matrix-title {
  color: #e3f2fd;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.matrix-table-wrap {
  flex: 1;
  max-height: 350px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(100, 181, 246, 0.2) transparent;
}

.matrix-table-modern {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.matrix-table-modern th {
  background: #0d1117;
  color: #78909c;
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid rgba(100, 181, 246, 0.1);
  position: sticky;
  top: 0;
  z-index: 10;
}

.matrix-table-modern td {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(100, 181, 246, 0.05);
  color: #cfd8dc;
}

.badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  display: inline-block;
}

.badge.pass { background: rgba(0, 230, 118, 0.15); color: #00e676; }
.badge.fail { background: rgba(244, 67, 54, 0.15); color: #f44336; }
.badge.pending { background: rgba(255, 171, 64, 0.15); color: #ffab40; }

.matrix-mono { font-family: 'Consolas', monospace; color: #64b5f6; }
</style>