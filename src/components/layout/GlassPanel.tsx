import type { CSSProperties, ReactNode } from 'react'

type GlassPanelProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  width?: string | number
}

export function GlassPanel({ children, className, style, width = 440 }: GlassPanelProps) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: typeof width === 'number' ? `${width}px` : width,
        maxWidth: '100%',

        /* Rich layered glass */
        backgroundColor: 'var(--color-bg-glass)',
        backdropFilter: 'blur(32px) saturate(160%)',
        WebkitBackdropFilter: 'blur(32px) saturate(160%)',

        /* Premium border treatment — top edge catches light */
        border: '1px solid rgba(255,255,255,0.09)',
        borderTop: '1px solid rgba(255,255,255,0.14)',
        borderBottom: '1px solid rgba(0,0,0,0.4)',
        borderRadius: 'var(--radius-xl)',

        /* Depth shadows */
        boxShadow: 'var(--shadow-panel)',

        padding: 'var(--space-10)',

        /* Cinematic entrance */
        animation: 'panelEntrance 0.65s cubic-bezier(0.16,1,0.3,1) both',

        ...style,
      }}
    >
      {/* Inner top glow line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '15%',
          right: '15%',
          height: '1px',
          background:
            'linear-gradient(90deg, transparent, rgba(201,168,76,0.35) 40%, rgba(124,92,191,0.35) 60%, transparent)',
          borderRadius: 'var(--radius-full)',
          pointerEvents: 'none',
        }}
      />

      {/* Inner subtle glow fill */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'var(--radius-xl)',
          background:
            'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(201,168,76,0.04) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>
    </div>
  )
}
