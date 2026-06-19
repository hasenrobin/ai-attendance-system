// Minimal local types for jpeg-js (the published @types/jpeg-js package is
// for the old 0.3 API — boolean 2nd arg — and pulls in `/// <reference
// types="node" />`, which would re-introduce the @types/node global/DOM
// conflicts that `types: []` avoids in recognition-worker/tsconfig.json).
// Only the subset used by mjpegFrameSource.ts is declared.

declare module 'jpeg-js' {
  export type DecodedJpeg = {
    width: number
    height: number
    /** RGBA, 4 bytes/pixel (formatAsRGBA defaults to true); Uint8Array when useTArray is true. */
    data: Uint8Array
  }

  export type DecodeOptions = {
    useTArray?: boolean
    formatAsRGBA?: boolean
    tolerantDecoding?: boolean
    maxResolutionInMP?: number
    maxMemoryUsageInMB?: number
  }

  export function decode(jpegData: Uint8Array, options?: DecodeOptions): DecodedJpeg
}
