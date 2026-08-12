import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ICMSPreview.jsx'
import './theme.css'

if (localStorage.getItem('icms_theme') === 'dark') document.documentElement.classList.add('dark-invert')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
