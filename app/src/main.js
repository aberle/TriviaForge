import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router.js'
import { loadServerConfig } from './composables/useServerConfig.js'
import './styles/main.css'
import './styles/shared/navbars.css'
import './styles/shared/scrollbars.css'
import './styles/shared/badges.css'
import './styles/shared/modals.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

loadServerConfig() // sets document.title from APP_NAME as early as possible
app.mount('#app')
