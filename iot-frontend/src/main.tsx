// Composition root: the only place that knows the concrete services.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Services } from './application/ports'
import { BetterAuthService } from './infrastructure/better-auth-service'
import { HttpDeviceApi } from './infrastructure/http-device-api'
import { HttpSettingsApi } from './infrastructure/http-settings-api'
import { LocalThemeStore } from './infrastructure/local-theme-store'
import { SseLiveFeed } from './infrastructure/sse-live-feed'
import { App } from './presentation/App'
import { ServicesContext } from './presentation/services-context'
import './presentation/index.css'

const services: Services = {
  deviceApi: new HttpDeviceApi(),
  settingsApi: new HttpSettingsApi(),
  liveFeed: new SseLiveFeed(),
  auth: new BetterAuthService(),
  themeStore: new LocalThemeStore(),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesContext value={services}>
      <App />
    </ServicesContext>
  </StrictMode>,
)
