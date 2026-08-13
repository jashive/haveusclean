import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ServiceOSAuthGate, { useServiceOSContext } from './auth/ServiceOSAuthGate'

const REVENUE_PILOT_UI =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_SERVICEOS_REVENUE_PILOT_UI === 'true'

const ServiceOSPilotPanel = REVENUE_PILOT_UI
  ? lazy(() => import('./features/pilot/ServiceOSPilotPanel'))
  : null

function PilotPanelMount() {
  const ctx = useServiceOSContext()
  if (!ServiceOSPilotPanel) return null
  return (
    <Suspense fallback={null}>
      <ServiceOSPilotPanel
        session={ctx?.session ?? null}
        revenueContext={ctx?.revenueContext ?? null}
      />
    </Suspense>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ServiceOSAuthGate>
      <App />
      <PilotPanelMount />
    </ServiceOSAuthGate>
  </React.StrictMode>
)
