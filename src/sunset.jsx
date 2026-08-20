import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/press-start-2p'
import { SunsetApp } from './sunset/SunsetApp.jsx'
import './sunset/styles.css'

createRoot(document.querySelector('#root')).render(<SunsetApp />)
