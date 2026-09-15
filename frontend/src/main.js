import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './index.less'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './axios'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

const app = createApp(App)

for(const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(ElementPlus)

app.mount('#app')
