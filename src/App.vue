<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useImageStore } from './stores/imageStore'
import UploadZone from './components/UploadZone.vue'
import ImageGrid from './components/ImageGrid.vue'
import ProcessPanel from './components/ProcessPanel.vue'
import StitchPreview from './components/StitchPreview.vue'
import ExportPanel from './components/ExportPanel.vue'

const store = useImageStore()
const isDark = ref(false)

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

onMounted(() => {
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    isDark.value = true
    document.documentElement.setAttribute('data-theme', 'dark')
  }
})

const hasImages = computed(() => store.images.length > 0)
const isDone = computed(() => store.processStatus.step === 'done')
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-inner">
        <div class="brand">
          <div class="brand-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="2" width="11" height="11" rx="3" fill="currentColor" opacity="0.9"/>
              <rect x="15" y="2" width="11" height="11" rx="3" fill="currentColor" opacity="0.6"/>
              <rect x="2" y="15" width="11" height="11" rx="3" fill="currentColor" opacity="0.6"/>
              <rect x="15" y="15" width="11" height="11" rx="3" fill="currentColor" opacity="0.3"/>
            </svg>
          </div>
          <div>
            <h1 class="brand-name">SmartImageStitcher</h1>
            <p class="brand-sub">智能图片排序与无缝拼接</p>
          </div>
        </div>
        <div class="header-actions">
          <span v-if="hasImages" class="image-count-badge">
            {{ store.images.length }} 张图片
          </span>
          <button class="btn btn-secondary btn-icon theme-btn" @click="toggleTheme" :title="isDark ? '切换浅色模式' : '切换深色模式'">
            <span v-if="isDark">☀️</span>
            <span v-else>🌙</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main content -->
    <main class="main">
      <!-- Upload Zone -->
      <section class="section">
        <UploadZone />
      </section>

      <!-- Image Grid (sorting) -->
      <section v-if="hasImages" class="section">
        <div class="section-header">
          <h2 class="section-title">
            <span class="step-num">1</span>
            图片管理与排序
          </h2>
          <span class="section-hint">可拖拽调整顺序，或等待自动识别</span>
        </div>
        <ImageGrid />
      </section>

      <!-- Process Panel -->
      <section v-if="hasImages" class="section">
        <div class="section-header">
          <h2 class="section-title">
            <span class="step-num">2</span>
            智能分析与拼接
          </h2>
        </div>
        <ProcessPanel />
      </section>

      <!-- Preview -->
      <section v-if="isDone" class="section">
        <div class="section-header">
          <h2 class="section-title">
            <span class="step-num">3</span>
            拼接预览
          </h2>
        </div>
        <StitchPreview />
      </section>

      <!-- Export -->
      <section v-if="isDone" class="section">
        <div class="section-header">
          <h2 class="section-title">
            <span class="step-num">4</span>
            导出长图
          </h2>
        </div>
        <ExportPanel />
      </section>

      <!-- Empty state -->
      <div v-if="!hasImages" class="empty-hint">
        <p>⬆️ 上传图片后开始智能拼接</p>
      </div>
    </main>

    <!-- Footer -->
    <footer class="footer">
      <p>SmartImageStitcher — 纯浏览器端处理，图片不会上传到任何服务器</p>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: var(--shadow);
}

.header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  color: var(--primary);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.brand-name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--text);
  line-height: 1.2;
}

.brand-sub {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.image-count-badge {
  background: var(--primary-light);
  color: var(--primary);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.theme-btn {
  font-size: 16px;
}

.main {
  flex: 1;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-num {
  width: 26px;
  height: 26px;
  background: var(--primary);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}

.section-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.empty-hint {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
  font-size: 16px;
}

.footer {
  border-top: 1px solid var(--border);
  padding: 16px 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

@media (max-width: 600px) {
  .header-inner { padding: 10px 16px; }
  .brand-name { font-size: 15px; }
  .brand-sub { display: none; }
  .main { padding: 16px; gap: 16px; }
}
</style>
