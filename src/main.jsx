import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error("Root element not found");

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (e) {
  console.error("Render Error:", e);
  document.body.innerHTML = `<div style="color:red; padding:20px;">
    <h1>Application Error</h1>
    <pre>${e.toString()}</pre>
    <p>Check console for more details.</p>
  </div>`;
}
