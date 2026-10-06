import { ref } from 'vue'

/**
 * Public server settings from GET /api/config, shared by every page that needs them.
 *
 * Solo play is off unless the server runs with SOLO_MODE=true, and the app's display name defaults
 * to "TriviaForge" unless the server sets APP_NAME. The last known values are kept in localStorage so
 * they don't pop in and out on every page load; loadServerConfig() then refreshes them.
 */

const DEFAULT_APP_NAME = 'TriviaForge'

const readCached = (key) => {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

const readCachedString = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

const soloEnabled = ref(readCached('soloMode'))
const appName = ref(readCachedString('appName', DEFAULT_APP_NAME))
const logoUrl = ref(readCachedString('logoUrl', ''))
const faviconUrl = ref(readCachedString('faviconUrl', ''))
let loading = null

// The browser tab title, exactly as index.html set it (once, before anything here can touch it), so
// the app name can be swapped into it without depending on what's there now
const originalDocumentTitle = (typeof document !== 'undefined' && typeof document.title === 'string') ? document.title : ''

const applyDocumentTitle = () => {
  // Some test harnesses stub out `document` without a real `title` (or without a settable one); this
  // is purely a browser-tab nicety, so silently skip it rather than let a fake DOM crash the app.
  if (typeof document === 'undefined' || typeof document.title !== 'string') return
  document.title = originalDocumentTitle.replace(DEFAULT_APP_NAME, appName.value)
}
applyDocumentTitle()

// index.html's <link rel="icon"> always points at the default /favicon.ico; swapped to a
// deployment-configured one once FAVICON_URL is known, left alone otherwise.
const applyFavicon = () => {
  if (typeof document === 'undefined' || !faviconUrl.value) return
  const link = document.querySelector('link[rel="icon"]')
  if (link) link.href = faviconUrl.value
}
applyFavicon()

export function loadServerConfig() {
  if (!loading) {
    loading = fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        soloEnabled.value = data.soloMode === true
        appName.value = data.appName || DEFAULT_APP_NAME
        logoUrl.value = data.logoUrl || ''
        faviconUrl.value = data.faviconUrl || ''
        applyDocumentTitle()
        applyFavicon()
        try {
          localStorage.setItem('soloMode', String(soloEnabled.value))
          localStorage.setItem('appName', appName.value)
          localStorage.setItem('logoUrl', logoUrl.value)
          localStorage.setItem('faviconUrl', faviconUrl.value)
        } catch {
          // storage unavailable: the values just aren't remembered
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
  return { soloEnabled, appName, logoUrl, faviconUrl }
}
