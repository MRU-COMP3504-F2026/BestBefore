/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { router } from './router'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import './styles/index.css'
import { InstallApp } from './InstallApp'
import { registerServiceWorker } from './lib/pwa'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Respects the OS "reduce motion" setting: movement is dropped, fades remain. */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
        <InstallApp />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)
