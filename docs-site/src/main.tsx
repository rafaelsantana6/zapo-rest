import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { LocaleProvider } from './i18n/context'
import './styles/index.css'

/** Vite `base` ends with `/`; React Router basename should not. */
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')
createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
)

