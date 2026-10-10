import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

// Only the app shell is cached. Records and credentials never enter Cache Storage.
if(import.meta.env.PROD&&'serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{});});}
