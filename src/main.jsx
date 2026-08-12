import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ServiceOSAuthGate from './auth/ServiceOSAuthGate'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ServiceOSAuthGate>
      <App />
    </ServiceOSAuthGate>
  </React.StrictMode>
)
