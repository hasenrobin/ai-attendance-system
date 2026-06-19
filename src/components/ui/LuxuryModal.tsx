import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type LuxuryModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  actions?: ReactNode
  width?: number | string
}

export function LuxuryModal({ open, onClose, title, children, actions, width = 520 }: LuxuryModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return createPortal(
    <div style={styles.backdrop} onClick={onClose} aria-modal role="dialog">
      <div
        style={{
          ...styles.panel,
          width: typeof width === 'number' ? `${width}px` : width,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent line */}
        <div style={styles.topAccent} />

        {/* Inner glow */}
        <div style={styles.innerGlow} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Header */}
          {(title) && (
            <div style={styles.header}>
              <h2 style={styles.title}>{title}</h2>
              <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          )}

          {/* Body */}
          <div style={title ? styles.body : styles.bodyNoHeader}>
            {children}
          </div>

          {/* Footer */}
          {actions && (
            <div style={styles.footer}>
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-6)',
    zIndex: 1000,
    animation: 'fadeIn 0.2s ease both',
  },
  panel: {
    position: 'relative',
    maxWidth: '100%',
    maxHeight: '90vh',
    overflowY: 'auto',
    backgroundColor: 'rgba(11, 13, 22, 0.96)',
    backdropFilter: 'blur(40px)',
    WebkitBackdropFilter: 'blur(40px)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderTop: '1px solid rgba(255,255,255,0.14)',
    borderBottom: '1px solid rgba(0,0,0,0.5)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-panel), 0 0 0 1px rgba(255,255,255,0.04) inset',
    animation: 'modalSlideIn 0.35s cubic-bezier(0.16,1,0.3,1) both',
  },
  topAccent: {
    position: 'absolute',
    top: 0,
    left: '20%',
    right: '20%',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.4) 40%, rgba(124,92,191,0.4) 60%, transparent)',
    borderRadius: 'var(--radius-full)',
    pointerEvents: 'none',
  },
  innerGlow: {
    position: 'absolute',
    inset: 0,
    borderRadius: 'var(--radius-xl)',
    background: 'radial-gradient(ellipse 60% 30% at 50% 0%, rgba(201,168,76,0.04) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-6) var(--space-8)',
    borderBottom: '1px solid var(--color-border)',
    gap: 'var(--space-4)',
  },
  title: {
    fontSize: 'var(--text-xl)',
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    letterSpacing: '-0.015em',
    margin: 0,
  },
  closeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all var(--transition-fast)',
  },
  body: {
    padding: 'var(--space-8)',
  },
  bodyNoHeader: {
    padding: 'var(--space-8)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 'var(--space-3)',
    padding: 'var(--space-5) var(--space-8)',
    borderTop: '1px solid var(--color-border)',
    flexWrap: 'wrap',
  },
}
