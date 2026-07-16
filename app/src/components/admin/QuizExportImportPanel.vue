<template>
  <section class="export-section">
    <div class="export-header">
      <h2><AppIcon name="share-2" size="lg" /> Quiz Library Export / Import</h2>
    </div>

    <p class="export-description">
      Export your quiz library to share with another TriviaForge instance, or import a library someone has shared with you.
      This is separate from the full database backup — it only includes quiz and question content.
    </p>

    <!-- Status message -->
    <div v-if="statusMsg" class="status-msg" :class="statusType">
      <AppIcon :name="statusType === 'success' ? 'check-circle' : 'alert-circle'" size="sm" />
      {{ statusMsg }}
    </div>

    <div class="panels-grid">
      <!-- ── Export Panel ─────────────────────────────────── -->
      <div class="panel-card">
        <h3><AppIcon name="upload" size="md" /> Export</h3>

        <div class="export-actions">
          <div class="export-row">
            <div class="export-info">
              <strong>All Quizzes (JSON)</strong>
              <span class="export-hint">Full structure — quizzes, questions, answers, tags. Use for sharing or migration.</span>
            </div>
            <button class="action-btn primary-btn" @click="downloadAllJSON" :disabled="downloading === 'all-json'">
              <AppIcon :name="downloading === 'all-json' ? 'loader' : 'download'" size="sm" :class="{ spinning: downloading === 'all-json' }" />
              Export JSON
            </button>
          </div>

          <div class="export-row">
            <div class="export-info">
              <strong>All Questions (CSV)</strong>
              <span class="export-hint">Flat spreadsheet format — useful for editing in Excel or Google Sheets.</span>
            </div>
            <button class="action-btn secondary-btn" @click="downloadCSV" :disabled="downloading === 'csv'">
              <AppIcon :name="downloading === 'csv' ? 'loader' : 'download'" size="sm" :class="{ spinning: downloading === 'csv' }" />
              Export CSV
            </button>
          </div>

          <div class="export-row single-quiz-row">
            <div class="export-info">
              <strong>Single Quiz (JSON)</strong>
              <span class="export-hint">Export one quiz with all its questions.</span>
            </div>
            <div class="single-quiz-controls">
              <select v-model="selectedQuizId" class="quiz-select" :disabled="quizzesLoading">
                <option value="">{{ quizzesLoading ? 'Loading...' : 'Select a quiz…' }}</option>
                <option v-for="quiz in quizzes" :key="quiz.id" :value="quiz.id">{{ quiz.title }}</option>
              </select>
              <button
                class="action-btn secondary-btn"
                @click="downloadSingleJSON"
                :disabled="!selectedQuizId || downloading === 'single-json'"
              >
                <AppIcon :name="downloading === 'single-json' ? 'loader' : 'download'" size="sm" :class="{ spinning: downloading === 'single-json' }" />
                Export
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Import Panel ─────────────────────────────────── -->
      <div class="panel-card">
        <h3><AppIcon name="download" size="md" /> Import</h3>

        <!-- File drop zone -->
        <div
          class="drop-zone"
          :class="{ dragover: isDragging, 'has-file': importFile }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
          @click="$refs.fileInput.click()"
        >
          <input ref="fileInput" type="file" accept=".json" class="hidden-input" @change="onFileChange" />
          <template v-if="!importFile">
            <AppIcon name="file-up" size="2xl" />
            <p>Drop a <code>.json</code> export file here, or click to browse</p>
          </template>
          <template v-else>
            <AppIcon name="file-check" size="2xl" />
            <p class="file-name">{{ importFile.name }}</p>
            <button class="clear-btn" @click.stop="clearFile">
              <AppIcon name="x" size="sm" /> Remove
            </button>
          </template>
        </div>

        <!-- Preview (parsed from file client-side) -->
        <div v-if="importPreview" class="import-preview">
          <div class="preview-header">
            <AppIcon name="eye" size="sm" />
            <strong>Preview</strong>
            <span class="preview-meta">v{{ importPreview.appVersion }} · exported {{ formatTimestamp(importPreview.exportedAt) }}</span>
          </div>
          <ul class="preview-list">
            <li v-for="quiz in importPreview.quizzes" :key="quiz.title">
              <AppIcon name="book-open" size="sm" />
              <span>{{ quiz.title }}</span>
              <span class="q-count">{{ quiz.questions?.length || 0 }} questions</span>
            </li>
          </ul>
        </div>

        <!-- Import results -->
        <div v-if="importResult" class="import-result">
          <div class="result-row">
            <AppIcon name="plus-circle" size="sm" />
            <span>{{ importResult.quizzesCreated }} quiz{{ importResult.quizzesCreated !== 1 ? 'zes' : '' }} created</span>
          </div>
          <div class="result-row">
            <AppIcon name="file-plus" size="sm" />
            <span>{{ importResult.questionsCreated }} new question{{ importResult.questionsCreated !== 1 ? 's' : '' }} added</span>
          </div>
          <div class="result-row muted">
            <AppIcon name="copy" size="sm" />
            <span>{{ importResult.questionsReused }} duplicate{{ importResult.questionsReused !== 1 ? 's' : '' }} reused from existing library</span>
          </div>
        </div>

        <button
          class="action-btn primary-btn import-btn"
          @click="doImport"
          :disabled="!importPreview || importing"
        >
          <AppIcon :name="importing ? 'loader' : 'upload'" size="sm" :class="{ spinning: importing }" />
          {{ importing ? 'Importing...' : 'Import Library' }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { useApi } from '@/composables/useApi.js'

const { get, post } = useApi()

const quizzes = ref([])
const quizzesLoading = ref(false)
const selectedQuizId = ref('')
const downloading = ref('')
const statusMsg = ref('')
const statusType = ref('success')
const isDragging = ref(false)
const importFile = ref(null)
const importPreview = ref(null)
const importResult = ref(null)
const importing = ref(false)
const fileInput = ref(null)

let statusTimer = null

const showStatus = (msg, type = 'success') => {
  statusMsg.value = msg
  statusType.value = type
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { statusMsg.value = '' }, 6000)
}

const fetchQuizzes = async () => {
  quizzesLoading.value = true
  try {
    const response = await get('/api/quizzes')
    quizzes.value = (response.data.data || response.data || []).sort((a, b) =>
      a.title.localeCompare(b.title)
    )
  } catch {
    // Non-critical — single quiz export just won't have options
  } finally {
    quizzesLoading.value = false
  }
}

const triggerDownload = async (url, filename, key) => {
  downloading.value = key
  try {
    const response = await get(url, { responseType: 'blob' })
    const blob = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = blob
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blob)
  } catch (err) {
    showStatus('Export failed: ' + (err.message || 'Unknown error'), 'error')
  } finally {
    downloading.value = ''
  }
}

const downloadAllJSON = () =>
  triggerDownload('/api/admin/export/quizzes', `triviaforge-library-${Date.now()}.json`, 'all-json')

const downloadCSV = () =>
  triggerDownload('/api/admin/export/questions.csv', `triviaforge-questions-${Date.now()}.csv`, 'csv')

const downloadSingleJSON = () => {
  if (!selectedQuizId.value) return
  const quiz = quizzes.value.find((q) => q.id === selectedQuizId.value)
  const slug = quiz ? quiz.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : selectedQuizId.value
  triggerDownload(
    `/api/admin/export/quizzes?quizId=${selectedQuizId.value}`,
    `triviaforge-${slug}-${Date.now()}.json`,
    'single-json'
  )
}

const parseImportFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        resolve(data)
      } catch {
        reject(new Error('File is not valid JSON'))
      }
    }
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsText(file)
  })
}

const loadFile = async (file) => {
  if (!file || !file.name.endsWith('.json')) {
    showStatus('Please select a .json export file', 'error')
    return
  }
  importFile.value = file
  importPreview.value = null
  importResult.value = null
  try {
    const data = await parseImportFile(file)
    if (!data.quizzes || !Array.isArray(data.quizzes)) {
      throw new Error('Not a valid TriviaForge export file')
    }
    importPreview.value = data
  } catch (err) {
    showStatus(err.message, 'error')
    importFile.value = null
  }
}

const onFileChange = (e) => loadFile(e.target.files[0])
const onDrop = (e) => { isDragging.value = false; loadFile(e.dataTransfer.files[0]) }

const clearFile = () => {
  importFile.value = null
  importPreview.value = null
  importResult.value = null
  if (fileInput.value) fileInput.value.value = ''
}

const doImport = async () => {
  if (!importPreview.value) return
  importing.value = true
  importResult.value = null
  try {
    const response = await post('/api/admin/export/import', importPreview.value)
    importResult.value = response.data.data
    showStatus(response.data.message || 'Import complete')
    clearFile()
  } catch (err) {
    showStatus(err.response?.data?.error?.message || err.message || 'Import failed', 'error')
  } finally {
    importing.value = false
  }
}

const formatTimestamp = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleString()
}

onMounted(fetchQuizzes)
</script>

<style scoped>
.export-section {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}

.export-header {
  display: flex;
  align-items: center;
  padding-bottom: 1rem;
  border-bottom: 2px solid var(--primary-color);
}

.export-header h2 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--primary-color);
  margin: 0;
  font-size: 2rem;
}

.export-description {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 0;
}

/* Status message */
.status-msg {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 0.9rem;
}
.status-msg.success { background: var(--success-bg-10, rgba(34,197,94,.1)); color: var(--success-color); border: 1px solid var(--success-color); }
.status-msg.error   { background: var(--error-bg-10, rgba(239,68,68,.1));   color: var(--error-color);   border: 1px solid var(--error-color); }

/* Two-column grid */
.panels-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.panel-card {
  background: var(--bg-overlay-10);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.panel-card h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--primary-color);
  margin: 0;
  font-size: 1.1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color);
}

/* Export rows */
.export-actions { display: flex; flex-direction: column; gap: 1rem; }

.export-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 8px;
}

.single-quiz-row { flex-wrap: wrap; }

.export-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}

.export-info strong { color: var(--text-primary); font-size: 0.9rem; }
.export-hint { color: var(--text-tertiary); font-size: 0.8rem; }

.single-quiz-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-shrink: 0;
}

.quiz-select {
  padding: 0.4rem 0.6rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.85rem;
  max-width: 160px;
}

/* Buttons */
.action-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.primary-btn   { background: var(--primary-color); color: white; }
.secondary-btn { background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border-color); }

.action-btn:hover:not(:disabled) { opacity: 0.85; }
.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.import-btn { width: 100%; justify-content: center; margin-top: auto; }

/* Drop zone */
.drop-zone {
  border: 2px dashed var(--border-color);
  border-radius: 10px;
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  color: var(--text-tertiary);
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
  font-size: 0.9rem;
}

.drop-zone:hover, .drop-zone.dragover {
  border-color: var(--primary-color);
  background: var(--bg-overlay-10);
}

.drop-zone.has-file {
  border-color: var(--success-color);
  color: var(--success-color);
}

.drop-zone p { margin: 0; }
.drop-zone code { font-size: 0.85rem; background: var(--bg-tertiary); padding: 0.1rem 0.3rem; border-radius: 3px; }

.hidden-input { display: none; }

.file-name { font-weight: 600; word-break: break-all; }

.clear-btn {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  background: transparent;
  border: 1px solid var(--success-color);
  border-radius: 5px;
  color: var(--success-color);
  cursor: pointer;
  font-size: 0.8rem;
}

/* Import preview */
.import-preview {
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.preview-meta { color: var(--text-tertiary); font-size: 0.8rem; margin-left: auto; }

.preview-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 160px;
  overflow-y: auto;
}

.preview-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-primary);
}

.q-count {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.8rem;
  white-space: nowrap;
}

/* Import result */
.import-result {
  background: var(--success-bg-10, rgba(34,197,94,.07));
  border: 1px solid var(--success-color);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--success-color);
}

.result-row.muted { color: var(--text-tertiary); }

/* Spinner */
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  .panels-grid { grid-template-columns: 1fr; }
}

@media (max-width: 600px) {
  .export-row { flex-direction: column; align-items: flex-start; }
  .single-quiz-controls { width: 100%; }
  .quiz-select { flex: 1; max-width: none; }
}
</style>
