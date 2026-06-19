// Node-side ModelBytesLoader for the ONNX face engines (Phase 7, Task 5/6).
//
// The browser's default loader (fetchModelBytes in
// src/features/faceRecognition/engines/onnxModelSource.ts) fetches
// /<relativePath> from the Vite dev/prod server, which serves files from
// public/. The worker has no HTTP server in front of it, so it reads the
// same public/<relativePath> files directly from disk. Same path
// convention (ONNX_MODEL_PATHS), same FaceEngineNotConfiguredError on a
// missing file — see onnxFaceDetectorEngine.ts / onnxArcFaceEmbedderEngine.ts.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FaceEngineNotConfiguredError } from '../../src/features/faceRecognition/engines/faceEngineErrors'
import type { ModelBytesLoader } from '../../src/features/faceRecognition/engines/onnxModelSource'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const loadModelBytesFromDisk: ModelBytesLoader = async (relativePath) => {
  const fullPath = path.join(projectRoot, 'public', relativePath)
  try {
    const buffer = await readFile(fullPath)
    const arrayBuffer = new ArrayBuffer(buffer.byteLength)
    new Uint8Array(arrayBuffer).set(buffer)
    return arrayBuffer
  } catch (err) {
    throw new FaceEngineNotConfiguredError(
      `Production model not configured: could not read ${fullPath} (${err instanceof Error ? err.message : String(err)}). Place the model file at public/${relativePath}.`,
    )
  }
}
