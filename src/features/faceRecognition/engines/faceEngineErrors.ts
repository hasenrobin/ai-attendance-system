/**
 * Thrown by a face engine adapter when it cannot run because its required
 * model file(s) are not present (or another configuration prerequisite is
 * missing). Callers must surface this message as-is rather than silently
 * falling back to a different engine — per Phase 7 directive: "Do NOT fake
 * production recognition."
 */
export class FaceEngineNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FaceEngineNotConfiguredError'
  }
}
