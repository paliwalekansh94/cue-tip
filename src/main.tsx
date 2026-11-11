import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './Access';
import './styles.css';
// Build marker to verify the deployed JavaScript and CSS belong to the same release.
document.documentElement.dataset.cueTipBuild = 'cms-style-check-20261111';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
