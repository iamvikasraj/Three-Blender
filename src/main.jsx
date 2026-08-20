import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './game/App.jsx'
import './game/styles.css'

createRoot(document.querySelector('#root')).render(<App />)
