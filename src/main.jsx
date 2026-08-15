import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ServiceOSAuthGate, { useServiceOSContext } from './auth/ServiceOSAuthGate'

const REVENUE_PILOT_UI =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_SERVICEOS_REVENUE_PILOT_UI === 'true'

const OPERATIONS_PILOT_UI =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_SERVICEOS_OPERATIONS_ENABLED === 'true' &&
  import.meta.env?.VITE_SERVICEOS_OPERATIONS_PILOT_UI === 'true'

const WAVE4_PILOT_UI =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_SERVICEOS_OPERATIONS_ENABLED === 'true' &&
  import.meta.env?.VITE_SERVICEOS_WAVE4_PILOT_UI === 'true'

const ServiceOSPilotPanel = REVENUE_PILOT_UI
  ? lazy(() => import('./features/pilot/ServiceOSPilotPanel'))
  : null

const ServiceOSOperationsPilotPanel = OPERATIONS_PILOT_UI
  ? lazy(() => import('./features/pilot/ServiceOSOperationsPilotPanel'))
  : null

const ServiceOSWave4PilotPanel = WAVE4_PILOT_UI
  ? lazy(() => import('./features/pilot/ServiceOSWave4PilotPanel'))
  : null

function PilotPanelMount() {
  const ctx = useServiceOSContext()
  return (
    <>
      {ServiceOSPilotPanel && (
        <Suspense fallback={null}>
          <ServiceOSPilotPanel
            session={ctx?.session ?? null}
            revenueContext={ctx?.revenueContext ?? null}
          />
        </Suspense>
      )}
      {ServiceOSOperationsPilotPanel && (
        <Suspense fallback={null}>
          <ServiceOSOperationsPilotPanel
            session={ctx?.session ?? null}
            revenueContext={ctx?.revenueContext ?? null}
          />
        </Suspense>
      )}
      {ServiceOSWave4PilotPanel && (
        <Suspense fallback={null}>
          <ServiceOSWave4PilotPanel
            session={ctx?.session ?? null}
          />
        </Suspense>
      )}
    </>
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
