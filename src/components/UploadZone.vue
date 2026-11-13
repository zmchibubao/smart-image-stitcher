<script setup lang="ts">
import { ref } from 'vue'
import { useImageStore } from '../stores/imageStore'

const store = useImageStore()
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement>()

function handleFiles(files: FileList | File[]) {
  const arr = Array.from(files).filter(f =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(f.type)
  )
  if (arr.length > 0) {
    store.addImages(arr)
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  if (e.dataTransfer?.files) {
    handleFiles(e.dataTransfer.files)
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave() {
  isDragging.value = false
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) handleFiles(input.files)
  input.value = ''
}

function openFilePicker() {
  fileInput.value?.click()
}
</script>

<template>
  <div
    class="upload-zone card"
    :class="{ 'is-dragging': isDragging, 'has-images': store.images.length > 0 }"
    @drop="onDrop"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @click="openFilePicker"
  >
    <input
      ref="fileInput"
      type="file"
      multiple
      accept="image/jpeg,image/png,image/webp"
      style="display:none"
      @change="onFileInput"
    />

    <div class="upload-content">
      <div class="upload-icon">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="20" fill="var(--primary-light)"/>
          <path d="M20 10 L20 24 M14 16 L20 10 L26 16" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 28 H28" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="upload-text">
        <p class="upload-primary">
          {{ store.images.length > 0 ? '继续添加图片' : '拖拽图片到这里' }}
        </p>
        <p class="upload-secondary">
          或 <span class="link">点击选择文件</span> · 支持 JPG、PNG、WEBP
        </p>
      </div>
      <p v-if="store.images.length > 0" class="upload-count">
        已上传 {{ store.images.length }} 张图片
      </p>
    </div>
  </div>
</template>

<style scoped>
.upload-zone {
  padding: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 2px dashed var(--border);
  background: var(--bg-secondary);
  transition: all var(--transition);
  user-select: none;
}

.upload-zone:hover {
  border-color: var(--primary);
  background: var(--primary-light);
}

.upload-zone.is-dragging {
  border-color: var(--primary);
  background: var(--primary-light);
  transform: scale(1.01);
  box-shadow: 0 0 0 4px rgba(99,102,241,0.15);
}

.upload-zone.has-images {
  padding: 20px 32px;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  pointer-events: none;
}

.upload-icon {
  transition: transform var(--transition);
}

.upload-zone:hover .upload-icon,
.upload-zone.is-dragging .upload-icon {
  transform: translateY(-4px);
}

.upload-text {
  text-align: center;
}

.upload-primary {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.upload-secondary {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.link {
  color: var(--primary);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.upload-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-light);
  padding: 4px 12px;
  border-radius: 999px;
}
</style>
