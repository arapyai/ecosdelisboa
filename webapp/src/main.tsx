import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './lib/pwa';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(<App />);
registerServiceWorker();
