import { useEffect, useRef, useState } from 'react'
import type { CameraHealthStatus } from '../../types/camera'
import { getCameraHealthStatuses } from './cameraService'
import { runCameraHealthCheck, type CameraHealthCheckTarget } from './cameraHealthService'

const CHECK_INTERVAL_MS = 60_000

// Periodically health-checks the given cameras while mounted (e.g. while the
// Cameras page is open) and returns the latest known status per camera,
// loaded from camera_health_status and refreshed on each check.
export function useCameraHealthMonitor(cameras: CameraHealthCheckTarget[]) {
  const [healthByCameraId, setHealthByCameraId] = useState<Map<string, CameraHealthStatus>>(new Map())
  const camerasRef = useRef(cameras)
  camerasRef.current = cameras
  const healthRef = useRef(healthByCameraId)
  healthRef.current = healthByCameraId

  const cameraIds = cameras.map(c => c.id).join(',')

  useEffect(() => {
    if (camerasRef.current.length === 0) {
      setHealthByCameraId(new Map())
      return
    }
    let cancelled = false

    async function runChecks() {
      const current = camerasRef.current
      const results = await Promise.all(
        current.map(camera => runCameraHealthCheck(camera, healthRef.current.get(camera.id))),
      )
      if (cancelled) return
      setHealthByCameraId(prev => {
        const next = new Map(prev)
        results.forEach((result, index) => {
          if (result.data) next.set(current[index].id, result.data)
        })
        return next
      })
    }

    async function init() {
      const { data } = await getCameraHealthStatuses(camerasRef.current.map(c => c.id))
      if (cancelled) return
      healthRef.current = data
      setHealthByCameraId(data)
      await runChecks()
    }

    init()
    const interval = setInterval(runChecks, CHECK_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [cameraIds])

  return healthByCameraId
}
