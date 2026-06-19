// Drives the live face-detection loop for the Face Enrollment wizard.
// Throttled to ~5fps: detection + landmark inference run on a hidden canvas
// fed from the live <video> element, never sending frames anywhere.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { QualityCheckResult } from '../../types/faceEnrollment'
import { areFaceModelsLoaded, faceapi, loadFaceModels, TINY_FACE_DETECTOR_OPTIONS } from './faceModels'
import { evaluateFaceQuality, type DetectionWithLandmarks } from './faceQuality'

const DETECTION_INTERVAL_MS = 200

export type UseFaceCaptureResult = {
  modelsLoading: boolean
  modelsError: string | null
  detection: DetectionWithLandmarks | null
  quality: QualityCheckResult | null
  /** Runs the heavier recognition model and returns the 128-d descriptor for the current frame. */
  captureDescriptor: () => Promise<Float32Array | null>
  /** Encodes the current frame as a JPEG blob (used for the profile photo). */
  captureProfilePhoto: () => Promise<Blob | null>
}

export function useFaceCapture(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
): UseFaceCaptureResult {
  const [modelsLoading, setModelsLoading] = useState(!areFaceModelsLoaded())
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [detection, setDetection] = useState<DetectionWithLandmarks | null>(null)
  const [quality, setQuality] = useState<QualityCheckResult | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!canvasRef.current) canvasRef.current = document.createElement('canvas')

  const processingRef = useRef(false)
  const lastRunRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    loadFaceModels()
      .then(() => {
        if (!cancelled) setModelsLoading(false)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setModelsError(err instanceof Error ? err.message : 'Failed to load face detection models.')
          setModelsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!active || modelsLoading || modelsError) return

    let rafId = 0

    const loop = (timestamp: number) => {
      const video = videoRef.current
      const canvas = canvasRef.current

      if (
        video &&
        canvas &&
        !processingRef.current &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        timestamp - lastRunRef.current >= DETECTION_INTERVAL_MS
      ) {
        lastRunRef.current = timestamp
        processingRef.current = true

        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }
        const ctx = canvas.getContext('2d')

        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          faceapi
            .detectAllFaces(canvas, TINY_FACE_DETECTOR_OPTIONS)
            .withFaceLandmarks()
            .run()
            .then((detections) => {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
              setDetection(detections[0] ?? null)
              setQuality(evaluateFaceQuality(detections, imageData))
            })
            .catch(() => {
              setDetection(null)
              setQuality(null)
            })
            .finally(() => {
              processingRef.current = false
            })
        } else {
          processingRef.current = false
        }
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [active, modelsLoading, modelsError, videoRef])

  const captureDescriptor = useCallback(async (): Promise<Float32Array | null> => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const result = await faceapi
      .detectSingleFace(canvas, TINY_FACE_DETECTOR_OPTIONS)
      .withFaceLandmarks()
      .withFaceDescriptor()
    return result?.descriptor ?? null
  }, [])

  const captureProfilePhoto = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92))
  }, [])

  return { modelsLoading, modelsError, detection, quality, captureDescriptor, captureProfilePhoto }
}
