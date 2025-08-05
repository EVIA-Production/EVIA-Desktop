
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Set document title
document.title = "EVIA"

createRoot(document.getElementById("root")!).render(<App />);
