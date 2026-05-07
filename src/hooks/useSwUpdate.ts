import { useState, useEffect } from 'react'

export function useSwUpdate() {
  const [needsRefresh, setNeedsRefresh] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // Capture whether a SW was already controlling this page at mount.
    // If true, a subsequent controllerchange means a NEW SW just took over — show the banner.
    // If false, the first controllerchange is just the initial claim — ignore it.
    const hadController = !!navigator.serviceWorker.controller

    const handleControllerChange = () => {
      if (hadController) setNeedsRefresh(true)
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
  }, [])

  return {
    needsRefresh,
    refresh: () => window.location.reload(),
  }
}
