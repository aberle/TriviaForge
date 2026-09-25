import { ref } from 'vue'

/**
 * Public server settings from GET /api/config, shared by every page that needs them.
 *
 * Solo play is off unless the server runs with SOLO_MODE=true. The last known value is kept in
 * localStorage so links don't pop in and out on every page load; loadServerConfig() then refreshes it.
 */

const readCached = (key) => {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

const soloEnabled = ref(readCached('soloMode'))
let loading = null

export function loadServerConfig() {
  if (!loading) {
    loading = fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        soloEnabled.value = data.soloMode === true
        try {
          localStorage.setItem('soloMode', String(soloEnabled.value))
        } catch {
          // storage unavailable: the value just isn't remembered
        }
      })
      .catch((err) => {
        console.warn('[CONFIG] Could not load server config; using the last known setting', err.message)
        loading = null // try again on the next call
      })
  }
  return loading
}

export function useServerConfig() {
  loadServerConfig()
  return { soloEnabled }
}
