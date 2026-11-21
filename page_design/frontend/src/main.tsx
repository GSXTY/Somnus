import React from 'react';
import ReactDOM from 'react-dom/client';
import 'antd/dist/reset.css';
import './app/styles.css';
import './chat/assistant.css';
import App from './app/App';
import { TaskAttentionNotices } from './app/TaskAttentionNotices';
import { installEmbeddedConfigurationBridge } from './configuration/embeddedConfigurationBridge.mjs';

installEmbeddedConfigurationBridge();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><TaskAttentionNotices /></React.StrictMode>);
