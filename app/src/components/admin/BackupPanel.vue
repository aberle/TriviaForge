<template>
  <section class="backup-section">
    <div class="backup-header">
      <h2><AppIcon name="database" size="lg" /> Database Backups</h2>
      <button class="backup-btn" @click="runBackup" :disabled="backingUp">
        <AppIcon :name="backingUp ? 'loader' : 'hard-drive-upload'" size="sm" :class="{ spinning: backingUp }" />
        {{ backingUp ? 'Creating Backup...' : 'Back Up Now' }}
      </button>
    </div>

    <p class="backup-description">
      Full database backups run automatically every day at 2:00 AM. The 10 most recent are retained.
      Download a backup to store it externally, or restore to roll back the entire database to a previous state.
    </p>

    <!-- Import backup file -->
    <div class="import-zone-wrapper">
      <div
        class="drop-zone"
        :class="{ dragover: isDragging, 'has-file': importFile }"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
        @click="$refs.backupFileInput.click()"
      >
        <input ref="backupFileInput" type="file" accept=".gz" class="hidden-input" @change="onFileChange" />
        <template v-if="!importFile">
          <AppIcon name="file-up" size="lg" />
          <p>
            Rebuilt the container from scratch? Drop a downloaded <code>.sql.gz</code> backup here to bring it back
            into the list below, or click to browse.
          </p>
        </template>
        <template v-else>
          <AppIcon name="file-check" size="lg" />
          <p class="file-name">{{ importFile.name }}</p>
          <button class="clear-btn" @click.stop="clearImportFile">
            <AppIcon name="x" size="sm" /> Remove
          </button>
        </template>
      </div>
      <button
        v-if="importFile"
        class="backup-btn import-confirm-btn"
        @click="doImportBackup"
        :disabled="importing"
      >
        <AppIcon :name="importing ? 'loader' : 'upload'" size="sm" :class="{ spinning: importing }" />
        {{ importing ? 'Importing...' : 'Import Backup' }}
      </button>
    </div>

    <!-- Status message -->
    <div v-if="statusMsg" class="status-msg" :class="statusType">
      <AppIcon :name="statusType === 'success' ? 'check-circle' : 'alert-circle'" size="sm" />
      {{ statusMsg }}
    </div>

    <!-- Error state -->
    <div v-if="error" class="error-box">
      <AppIcon name="alert-circle" size="lg" />
      <span>{{ error }}</span>
      <button class="retry-btn" @click="fetchBackups">Retry</button>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="loading-box">
      <AppIcon name="loader" size="xl" class="spinning" />
      <span>Loading backups...</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="backups.length === 0" class="empty-box">
      <AppIcon name="database" size="2xl" />
      <p>No backups yet. Click <strong>Back Up Now</strong> to create the first one.</p>
    </div>

    <!-- Backups table -->
    <div v-else class="table-wrapper">
      <table class="backups-table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Version</th>
            <th>Trigger</th>
            <th>Size</th>
            <th>Contents</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="backup in backups" :key="backup.name">
            <td class="timestamp">{{ formatTimestamp(backup.exportedAt) }}</td>
            <td class="version">{{ backup.appVersion ? `v${backup.appVersion}` : 'unknown' }}</td>
            <td>
              <span class="trigger-badge" :class="backup.trigger">{{ backup.trigger }}</span>
            </td>
            <td class="size">{{ formatSize(backup.sizeBytes) }}</td>
            <td class="row-counts">
              <span v-if="backup.rowCounts" class="counts-summary">{{ formatCounts(backup.rowCounts) }}</span>
              <span v-else class="text-tertiary">—</span>
            </td>
            <td class="actions">
              <button class="action-btn download-btn" @click="downloadBackup(backup)" title="Download .sql.gz">
                <AppIcon name="download" size="sm" />
              </button>
              <button class="action-btn restore-btn" @click="openRestoreModal(backup)" title="Restore database">
                <AppIcon name="rotate-ccw" size="sm" />
              </button>
              <button class="action-btn delete-btn" @click="doDelete(backup)" title="Delete backup">
                <AppIcon name="trash-2" size="sm" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Restore confirmation modal -->
    <div v-if="restoreTarget" class="modal-overlay" @click.self="restoreTarget = null">
      <div class="modal-box">
        <h3><AppIcon name="rotate-ccw" size="lg" /> Restore Database</h3>

        <div class="modal-backup-info">
          <div class="info-row">
            <span class="info-label">Backup</span>
            <span class="info-value mono">{{ restoreTarget.name }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Created</span>
            <span class="info-value">{{ formatTimestamp(restoreTarget.exportedAt) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">App version</span>
            <span class="info-value">{{ restoreTarget.appVersion ? `v${restoreTarget.appVersion}` : 'unknown' }}</span>
          </div>
          <div class="info-row" v-if="restoreTarget.rowCounts">
            <span class="info-label">Contents</span>
            <span class="info-value">{{ formatCounts(restoreTarget.rowCounts) }}</span>
          </div>
        </div>

        <div class="restore-warning">
          <AppIcon name="alert-triangle" size="md" />
          <div>
            <strong>This will wipe and replace the entire current database.</strong>
            The server will be offline for approximately 10–15 seconds while the restore runs,
            then restart automatically. All active quiz sessions will be disconnected.
          </div>
        </div>

        <div class="restore-warning" v-if="restoreTarget.imported">
          <AppIcon name="alert-triangle" size="md" />
          <div>
            <strong>This backup was imported from a file, not created on this instance.</strong>
            Its origin app version and contents could not be verified — only restore it if you trust the source.
          </div>
        </div>

        <div class="modal-actions">
          <button class="cancel-btn" @click="restoreTarget = null" :disabled="restoring">Cancel</button>
          <button class="confirm-restore-btn" @click="doRestore" :disabled="restoring">
            <AppIcon :name="restoring ? 'loader' : 'rotate-ccw'" size="sm" :class="{ spinning: restoring }" />
            {{ restoring ? 'Restoring...' : 'Restore Now' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { useApi } from '@/composables/useApi.js'

const { get, post, delete: deleteRequest, upload } = useApi()

const backups = ref([])
const loading = ref(false)
const error = ref(null)
const backingUp = ref(false)
const restoring = ref(false)
const restoreTarget = ref(null)
const statusMsg = ref('')
const statusType = ref('success')
const isDragging = ref(false)
const importFile = ref(null)
const importing = ref(false)
const backupFileInput = ref(null)
let statusTimer = null

const showStatus = (msg, type = 'success') => {
  statusMsg.value = msg
  statusType.value = type
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { statusMsg.value = '' }, 6000)
}

const fetchBackups = async () => {
  loading.value = true
  error.value = null
  try {
    const response = await get('/api/admin/backups')
    backups.value = response.data.data || []
  } catch (err) {
    error.value = err.response?.data?.error?.message || err.message || 'Failed to load backups'
  } finally {
    loading.value = false
  }
}

const runBackup = async () => {
  backingUp.value = true
  error.value = null
  try {
    const response = await post('/api/admin/backups')
    backups.value = [response.data.data, ...backups.value].slice(0, 10)
    showStatus('Backup created successfully.')
  } catch (err) {
    showStatus(err.response?.data?.error?.message || err.message || 'Backup failed', 'error')
  } finally {
    backingUp.value = false
  }
}

const downloadBackup = async (backup) => {
  try {
    const response = await get(`/api/admin/backups/${backup.name}/download`, { responseType: 'blob' })
    const url = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `${backup.name}.sql.gz`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    showStatus('Download failed: ' + (err.message || 'Unknown error'), 'error')
  }
}

const openRestoreModal = (backup) => {
  restoreTarget.value = backup
}

const doRestore = async () => {
  if (!restoreTarget.value) return
  restoring.value = true
  try {
    await post(`/api/admin/backups/${restoreTarget.value.name}/restore`)
    restoreTarget.value = null
    showStatus('Restore initiated — the server is restarting. Wait a few seconds, then refresh the page.')
  } catch (err) {
    showStatus(err.response?.data?.error?.message || err.message || 'Restore failed', 'error')
    restoring.value = false
  }
}

const doDelete = async (backup) => {
  if (!confirm(`Delete backup "${backup.name}"?\nThis cannot be undone.`)) return
  try {
    await deleteRequest(`/api/admin/backups/${backup.name}`)
    backups.value = backups.value.filter((b) => b.name !== backup.name)
    showStatus('Backup deleted.')
  } catch (err) {
    showStatus(err.response?.data?.error?.message || err.message || 'Delete failed', 'error')
  }
}

const loadImportFile = (file) => {
  if (!file || !file.name.endsWith('.gz')) {
    showStatus('Please select a .sql.gz backup file', 'error')
    return
  }
  importFile.value = file
}

const onFileChange = (e) => loadImportFile(e.target.files[0])
const onDrop = (e) => { isDragging.value = false; loadImportFile(e.dataTransfer.files[0]) }

const clearImportFile = () => {
  importFile.value = null
  if (backupFileInput.value) backupFileInput.value.value = ''
}

const doImportBackup = async () => {
  if (!importFile.value) return
  importing.value = true
  try {
    const formData = new FormData()
    formData.append('file', importFile.value)
    const response = await upload('/api/admin/backups/import', formData)
    backups.value = [response.data.data, ...backups.value].slice(0, 10)
    showStatus('Backup imported — it now appears in the list below and can be restored.')
    clearImportFile()
  } catch (err) {
    showStatus(err.response?.data?.error?.message || err.message || 'Import failed', 'error')
  } finally {
    importing.value = false
  }
}

const formatTimestamp = (ts) => new Date(ts).toLocaleString()

const formatSize = (bytes) => {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const formatCounts = (counts) => {
  if (!counts) return '—'
  const parts = Object.entries(counts)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${v.toLocaleString()} ${k}`)
  return parts.length ? parts.join(', ') : '—'
}

onMounted(fetchBackups)
</script>

<style scoped>
.backup-section {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}

.backup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1rem;
  border-bottom: 2px solid var(--primary-color);
}

.backup-header h2 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--primary-color);
  margin: 0;
  font-size: 2rem;
}

.backup-description {
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 0;
}

.backup-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.2rem;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.2s, opacity 0.2s;
}

.backup-btn:hover:not(:disabled) { background: var(--primary-dark); }
.backup-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.spinning { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* Status message */
.status-msg {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 0.9rem;
}

.status-msg.success {
  background: var(--success-bg-10, rgba(34,197,94,0.1));
  color: var(--success-color);
  border: 1px solid var(--success-color);
}

.status-msg.error {
  background: var(--error-bg-10, rgba(239,68,68,0.1));
  color: var(--error-color);
  border: 1px solid var(--error-color);
}

/* Import drop zone */
.import-zone-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.drop-zone {
  border: 2px dashed var(--border-color);
  border-radius: 10px;
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
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

.drop-zone p { margin: 0; max-width: 480px; }
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

.import-confirm-btn { align-self: flex-start; }

/* Error / loading / empty */
.error-box,
.loading-box,
.empty-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem;
  background: var(--bg-overlay-10);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  text-align: center;
}

.error-box { border-color: var(--error-color); color: var(--error-color); }

.retry-btn {
  padding: 0.5rem 1rem;
  background: var(--error-color);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

/* Table */
.table-wrapper { overflow-x: auto; border-radius: 10px; border: 1px solid var(--border-color); }

.backups-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.backups-table th,
.backups-table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.backups-table tbody tr:last-child td { border-bottom: none; }

.backups-table th {
  background: var(--bg-overlay-10);
  color: var(--text-tertiary);
  font-weight: 600;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.backups-table tbody tr:hover { background: var(--bg-overlay-10); }

.timestamp { color: var(--text-secondary); white-space: nowrap; }
.version { font-family: monospace; color: var(--info-color); }
.size { color: var(--text-secondary); white-space: nowrap; }

.counts-summary {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.text-tertiary { color: var(--text-tertiary); }

/* Trigger badge */
.trigger-badge {
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.trigger-badge.scheduled {
  background: var(--info-bg-10, rgba(59,130,246,0.1));
  color: var(--info-color);
}

.trigger-badge.manual {
  background: var(--success-bg-10, rgba(34,197,94,0.1));
  color: var(--success-color);
}

.trigger-badge.imported {
  background: var(--warning-bg-10, rgba(234,179,8,0.1));
  color: var(--warning-color);
}

/* Row action buttons */
.actions { display: flex; gap: 0.4rem; }

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  color: var(--text-secondary);
}

.download-btn:hover { background: var(--info-bg-10, rgba(59,130,246,0.1)); border-color: var(--info-color); color: var(--info-color); }
.restore-btn:hover { background: var(--warning-bg-10, rgba(234,179,8,0.1)); border-color: var(--warning-color); color: var(--warning-color); }
.delete-btn:hover { background: var(--error-bg-10, rgba(239,68,68,0.1)); border-color: var(--error-color); color: var(--error-color); }

/* Restore modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 2rem;
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.modal-box h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--warning-color);
  font-size: 1.3rem;
}

.modal-backup-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--bg-overlay-10);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.info-row {
  display: flex;
  gap: 1rem;
  font-size: 0.9rem;
}

.info-label {
  color: var(--text-tertiary);
  min-width: 90px;
}

.info-value { color: var(--text-primary); }
.mono { font-family: monospace; font-size: 0.85rem; word-break: break-all; }

.restore-warning {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 1rem;
  background: var(--error-bg-10, rgba(239,68,68,0.1));
  border: 1px solid var(--error-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
}

.restore-warning strong { color: var(--error-color); }

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.cancel-btn {
  padding: 0.6rem 1.2rem;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.15s;
}

.cancel-btn:hover:not(:disabled) { background: var(--bg-overlay-10); }
.cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.confirm-restore-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.2rem;
  background: var(--error-color);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  transition: opacity 0.15s;
}

.confirm-restore-btn:hover:not(:disabled) { opacity: 0.85; }
.confirm-restore-btn:disabled { opacity: 0.6; cursor: not-allowed; }

@media (max-width: 768px) {
  .backup-header { flex-direction: column; align-items: flex-start; gap: 1rem; }
  .backup-header h2 { font-size: 1.5rem; }

  .backups-table th:nth-child(5),
  .backups-table td:nth-child(5) { display: none; }
}
</style>
