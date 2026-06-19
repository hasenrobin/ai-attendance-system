type LuxuryLoadingScreenProps = {
  message?: string
  fullScreen?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const spinnerDim = { sm: 28, md: 44, lg: 64 }
const borderWidth = { sm: 2, md: 3, lg: 3 }
const dotDim = { sm: 6, md: 8, lg: 12 }

export function LuxuryLoadingScreen({ message, fullScreen = false, size = 'md' }: LuxuryLoadingScreenProps) {
  const dim = spinnerDim[size]
  const bw = borderWidth[size]
  const dd = dotDim[size]

  const wrapper = fullScreen ? wrapperFullScreen : wrapperContained

  return (
    <div style={wrapper}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-5)' }}>
        {/* Spinner stack */}
        <div style={{ position: 'relative', width: dim, height: dim }}>
          {/* Outer track */}
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `${bw}px solid rgba(201,168,76,0.1)`,
          }} />

          {/* Spinning arc */}
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `${bw}px solid transparent`,
            borderTopColor: 'var(--color-gold)',
            borderRightColor: 'rgba(201,168,76,0.4)',
            animation: 'spin 0.9s cubic-bezier(0.45,0.05,0.55,0.95) infinite',
          }} />

          {/* Inner violet ring */}
          <div style={{
            position: 'absolute',
            inset: bw + 5,
            borderRadius: '50%',
            border: `${bw}px solid transparent`,
            borderBottomColor: 'rgba(124,92,191,0.6)',
            borderLeftColor:  'rgba(124,92,191,0.25)',
            animation: 'spin 1.4s cubic-bezier(0.45,0.05,0.55,0.95) infinite reverse',
          }} />

          {/* Center pulse dot */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            width: dd,
            height: dd,
            borderRadius: '50%',
            backgroundColor: 'var(--color-gold)',
            boxShadow: 'var(--shadow-glow-gold)',
            animation: 'spinnerPulse 1.8s ease-in-out infinite',
          }} />
        </div>

        {message && (
          <span style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontWeight: 500,
            animation: 'ambientPulse 2s ease-in-out infinite',
          }}>
            {message}
          </span>
        )}
      </div>
    </div>
  )
}

import type { CSSProperties } from 'react'

const wrapperFullScreen: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--color-bg-base)',
  zIndex: 9999,
}

const wrapperContained: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-12)',
  width: '100%',
}
