import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource-variable/archivo';
import '@fontsource/dm-mono/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './style.css';
import {App} from './App.js';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
