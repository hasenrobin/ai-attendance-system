// Local placeholder detector/embedder engines for the Face Recognition
// pipeline (Phase 3).
//
// These implement the vendor-neutral FaceDetectorEngine / FaceEmbedderEngine
// interfaces from src/types/faceRecognition.ts using the same
// @vladmandic/face-api models already loaded for Face Enrollment
// (src/features/faceEnrollment/faceModels.ts — read-only reuse, not modified).
//
// A future phase can swap these for an InsightFace (or other) engine without
// changing recognitionPipeline.ts, faceRecognitionService.ts, or
// attendanceDecisionService.ts — they only depend on FaceDetectorEngine /
// FaceEmbedderEngine.

import { faceapi, loadFaceModels, TINY_FACE_DETECTOR_OPTIONS } from '../faceEnrollment/faceModels'
import { isRawImageFrame } from './engines/rawFrame'
import type {
  FaceBox,
  FaceDetection,
  FaceDetectorEngine,
  FaceEmbedderEngine,
  FaceEmbedding,
  FrameSource,
} from '../../types/faceRecognition'

function boxCenterDistance(a: FaceBox, b: FaceBox): number {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.hypot(ax - bx, ay - by)
}

/**
 * face-api runs against DOM canvas/video/image elements only. The recognition
 * worker (Node) has no DOM and passes RawImageFrame instead — for that case
 * this engine fails honestly rather than silently no-op'ing. Configure
 * FACE_ENGINE=onnx_arcface for worker use.
 */
function assertDomFrame(frame: FrameSource): HTMLVideoElement | HTMLCanvasElement | HTMLImageElement {
  if (isRawImageFrame(frame)) {
    throw new Error('The faceapi engine only supports browser frame sources (canvas/video/image). Configure FACE_ENGINE=onnx_arcface for server-side/worker recognition.')
  }
  return frame
}

export class LocalFaceApiDetectorEngine implements FaceDetectorEngine {
  async detect(frame: FrameSource): Promise<FaceDetection[]> {
    await loadFaceModels()
    const results = await faceapi.detectAllFaces(assertDomFrame(frame), TINY_FACE_DETECTOR_OPTIONS)
    return results.map(result => ({
      box: { x: result.box.x, y: result.box.y, width: result.box.width, height: result.box.height },
      score: result.score,
    }))
  }
}

export class LocalFaceApiEmbedderEngine implements FaceEmbedderEngine {
  async embed(frame: FrameSource, detection: FaceDetection): Promise<FaceEmbedding | null> {
    await loadFaceModels()
    const results = await faceapi
      .detectAllFaces(assertDomFrame(frame), TINY_FACE_DETECTOR_OPTIONS)
      .withFaceLandmarks()
      .withFaceDescriptors()

    if (results.length === 0) return null

    let closest = results[0]
    let closestDistance = boxCenterDistance(detection.box, closest.detection.box)
    for (const result of results.slice(1)) {
      const distance = boxCenterDistance(detection.box, result.detection.box)
      if (distance < closestDistance) {
        closest = result
        closestDistance = distance
      }
    }

    return {
      vector: Array.from(closest.descriptor),
      detection,
    }
  }
}

export function createLocalFaceApiEngines(): { detector: FaceDetectorEngine; embedder: FaceEmbedderEngine } {
  return {
    detector: new LocalFaceApiDetectorEngine(),
    embedder: new LocalFaceApiEmbedderEngine(),
  }
}
