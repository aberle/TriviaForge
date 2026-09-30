<template>
  <section class="theme-settings">
    <h3>Theme Settings</h3>
    <div class="theme-options">
      <div class="theme-info">
        <p>Choose your preferred color theme. Your selection will be saved to your account.</p>
      </div>

      <div class="theme-grid">
        <!-- Light Theme -->
        <div
          class="theme-card"
          :class="{ active: currentTheme === 'light' }"
          @click="selectTheme('light')"
        >
          <div class="theme-preview light-preview">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-box"></div>
              <div class="preview-box"></div>
            </div>
          </div>
          <div class="theme-label">
            <span class="theme-name">Light</span>
            <AppIcon v-if="currentTheme === 'light'" name="check" size="lg" class="check-icon" />
          </div>
          <div class="theme-description">Soft grays and blues</div>
        </div>

        <!-- Dark Theme -->
        <div
          class="theme-card"
          :class="{ active: currentTheme === 'dark' }"
          @click="selectTheme('dark')"
        >
          <div class="theme-preview dark-preview">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-box"></div>
              <div class="preview-box"></div>
            </div>
          </div>
          <div class="theme-label">
            <span class="theme-name">Dark</span>
            <AppIcon v-if="currentTheme === 'dark'" name="check" size="lg" class="check-icon" />
          </div>
          <div class="theme-description">Default dark blue (Admin)</div>
        </div>

        <!-- Grey Theme -->
        <div
          class="theme-card"
          :class="{ active: currentTheme === 'grey' }"
          @click="selectTheme('grey')"
        >
          <div class="theme-preview grey-preview">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-box"></div>
              <div class="preview-box"></div>
            </div>
          </div>
          <div class="theme-label">
            <span class="theme-name">Grey</span>
            <AppIcon v-if="currentTheme === 'grey'" name="check" size="lg" class="check-icon" />
          </div>
          <div class="theme-description">Muted grey-blue (Player)</div>
        </div>

        <!-- Murder! Theme -->
        <div
          class="theme-card"
          :class="{ active: currentTheme === 'murder' }"
          @click="selectTheme('murder')"
        >
          <div class="theme-preview murder-preview">
            <div class="preview-header"></div>
            <div class="preview-content">
              <div class="preview-box"></div>
              <div class="preview-box"></div>
            </div>
          </div>
          <div class="theme-label">
            <span class="theme-name">Murder!</span>
            <AppIcon v-if="currentTheme === 'murder'" name="check" size="lg" class="check-icon" />
          </div>
          <div class="theme-description">Blood red, stone and gold</div>
        </div>

        <!-- System Theme -->
        <div
          class="theme-card"
          :class="{ active: currentTheme === 'system' }"
          @click="selectTheme('system')"
        >
          <div class="theme-preview system-preview">
            <div class="preview-split">
              <div class="preview-half light-half"></div>
              <div class="preview-half dark-half"></div>
            </div>
            <div class="preview-content">
              <div class="preview-box"></div>
              <div class="preview-box"></div>
            </div>
          </div>
          <div class="theme-label">
            <span class="theme-name">System</span>
            <AppIcon v-if="currentTheme === 'system'" name="check" size="lg" class="check-icon" />
          </div>
          <div class="theme-description">Follows OS preference</div>
        </div>
      </div>

      <!-- Save Status Message -->
      <div v-if="saveMessage" class="save-message" :class="'message-' + saveMessageType">
        {{ saveMessage }}
      </div>
    </div>

    <hr class="settings-divider" />

    <div class="default-theme-settings">
      <h4>Default Theme for Player Clients</h4>
      <p class="theme-info-text">
        Sets the theme guests and players see the first time they join, before they've picked one of
        their own. Doesn't change anything for someone who already has a saved theme (in their browser
        or on their account).
      </p>
      <div class="default-theme-row">
        <select v-model="defaultPlayerTheme" class="default-theme-select" aria-label="Default theme for player clients">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="grey">Grey</option>
          <option value="murder">Murder!</option>
          <option value="system">System (follows device)</option>
        </select>
        <Button variant="success" @click="saveDefaultPlayerTheme">Save</Button>
      </div>
      <div v-if="defaultThemeSaveMessage" class="save-message" :class="'message-' + defaultThemeSaveMessageType">
        {{ defaultThemeSaveMessage }}
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useTheme } from '../../composables/useTheme'
import AppIcon from '@/components/common/AppIcon.vue'
import Button from '@/components/common/Button.vue'
import { useApi } from '@/composables/useApi.js'

const { currentTheme, setTheme } = useTheme('ADMIN')
const { get, post } = useApi()

const saveMessage = ref('')
const saveMessageType = ref('success')

const defaultPlayerTheme = ref('grey')
const defaultThemeSaveMessage = ref('')
const defaultThemeSaveMessageType = ref('success')

async function fetchDefaultPlayerTheme() {
  try {
    const response = await get('/api/options')
    defaultPlayerTheme.value = response.data.defaultPlayerTheme || 'grey'
  } catch (error) {
    console.error('Error fetching the default player theme:', error)
  }
}

async function saveDefaultPlayerTheme() {
  try {
    await post('/api/options', { defaultPlayerTheme: defaultPlayerTheme.value })
    defaultThemeSaveMessage.value = 'Default player theme saved'
    defaultThemeSaveMessageType.value = 'success'
  } catch (error) {
    console.error('Error saving the default player theme:', error)
    defaultThemeSaveMessage.value = error.response?.data?.error || 'Failed to save default player theme'
    defaultThemeSaveMessageType.value = 'error'
  }
  setTimeout(() => {
    defaultThemeSaveMessage.value = ''
  }, 3000)
}

const selectTheme = async (theme) => {
  try {
    setTheme(theme)

    // Show success message
    saveMessage.value = `Theme changed to ${theme}`
    saveMessageType.value = 'success'

    // Clear message after 3 seconds
    setTimeout(() => {
      saveMessage.value = ''
    }, 3000)
  } catch (error) {
    console.error('Failed to save theme:', error)
    saveMessage.value = 'Failed to save theme preference'
    saveMessageType.value = 'error'

    setTimeout(() => {
      saveMessage.value = ''
    }, 3000)
  }
}

onMounted(() => {
  // Theme is already initialized by useTheme composable
  fetchDefaultPlayerTheme()
})
</script>

<style scoped>
section {
  padding: 2rem;
  background: var(--bg-overlay-10);
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

h3 {
  margin: 0 0 1.5rem 0;
  color: var(--info-light);
  font-size: 1.5rem;
  font-weight: 600;
}

.theme-options {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.theme-info {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.theme-info p {
  margin: 0;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}

.theme-card {
  background: var(--bg-overlay-10);
  border: 2px solid var(--border-color);
  border-radius: 12px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.theme-card:hover {
  background: var(--bg-overlay-20);
  border-color: var(--info-light);
  transform: translateY(-2px);
}

.theme-card.active {
  background: var(--info-bg-10);
  border-color: var(--info-light);
  box-shadow: 0 0 20px var(--info-bg-30);
}

.theme-preview {
  aspect-ratio: 16 / 10;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

/* Light Theme Preview */
.light-preview {
  background: #f8f9fa;
}

.light-preview .preview-header {
  height: 25%;
  background: linear-gradient(135deg, #DCF1FF 0%, #73A1CA 100%);
}

.light-preview .preview-content {
  padding: 0.5rem;
  display: flex;
  gap: 0.3rem;
}

.light-preview .preview-box {
  flex: 1;
  height: 30px;
  background: #e9ecef;
  border-radius: 4px;
  border: 1px solid #dee2e6;
}

/* Dark Theme Preview */
.dark-preview {
  background: #1e293b;
}

.dark-preview .preview-header {
  height: 25%;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}

.dark-preview .preview-content {
  padding: 0.5rem;
  display: flex;
  gap: 0.3rem;
}

.dark-preview .preview-box {
  flex: 1;
  height: 30px;
  background: #334155;
  border-radius: 4px;
  border: 1px solid #475569;
}

/* Grey Theme Preview */
.grey-preview {
  background: #2d3748;
}

.grey-preview .preview-header {
  height: 25%;
  background: linear-gradient(135deg, #4a5568 0%, #2d3748 100%);
}

.grey-preview .preview-content {
  padding: 0.5rem;
  display: flex;
  gap: 0.3rem;
}

.grey-preview .preview-box {
  flex: 1;
  height: 30px;
  background: #4a5568;
  border-radius: 4px;
  border: 1px solid #64748b;
}

/* Murder! Theme Preview */
.murder-preview {
  background: #1a0f0f;
}

.murder-preview .preview-header {
  height: 25%;
  background: linear-gradient(135deg, #7f1d1d 0%, #1a0f0f 100%);
}

.murder-preview .preview-content {
  padding: 0.5rem;
  display: flex;
  gap: 0.3rem;
}

.murder-preview .preview-box {
  flex: 1;
  height: 30px;
  background: #2d1414;
  border-radius: 4px;
  border: 1px solid #4a2020;
}

/* System Theme Preview */
.system-preview {
  background: #1e293b;
  position: relative;
}

.preview-split {
  height: 25%;
  display: flex;
}

.preview-half {
  flex: 1;
}

.light-half {
  background: linear-gradient(135deg, #DCF1FF 0%, #73A1CA 100%);
}

.dark-half {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}

.system-preview .preview-content {
  padding: 0.5rem;
  display: flex;
  gap: 0.3rem;
}

.system-preview .preview-box {
  flex: 1;
  height: 30px;
  background: #334155;
  border-radius: 4px;
  border: 1px solid #475569;
}

/* Theme Label */
.theme-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.theme-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 1rem;
}

.check-icon {
  color: var(--info-light);
  font-size: 1.2rem;
  font-weight: bold;
}

.theme-description {
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.settings-divider {
  margin: 2rem 0;
  border: none;
  border-top: 1px solid var(--border-color);
}

.default-theme-settings h4 {
  margin: 0 0 0.5rem 0;
  color: var(--info-light);
  font-size: 1.1rem;
  font-weight: 600;
}

.theme-info-text {
  margin: 0 0 1rem 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.default-theme-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.default-theme-select {
  flex: 1;
  max-width: 20rem;
  padding: 0.6rem 0.75rem;
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.95rem;
}

/* Save Message */
.save-message {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  text-align: center;
  animation: slideIn 0.3s ease;
}

.message-success {
  background: var(--secondary-bg-20);
  border: 1px solid var(--secondary-light);
  color: var(--secondary-light);
}

.message-error {
  background: var(--danger-bg-20);
  border: 1px solid var(--danger-light);
  color: var(--danger-light);
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Responsive */
@media (max-width: 768px) {
  section {
    padding: 1.5rem;
  }

  .theme-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .theme-grid {
    grid-template-columns: 1fr;
  }
}
</style>
