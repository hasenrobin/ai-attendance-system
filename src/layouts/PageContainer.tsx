import type { CSSProperties, ReactNode } from 'react'

type PageContainerProps = {
  children: ReactNode
  fluid?: boolean
}

const MAX_WIDTH = '1280px'

export function PageContainer({ children, fluid = false }: PageContainerProps) {
  return (
    <div style={outerStyle}>
      <div style={fluid ? fluidInner : constrainedInner}>
        {children}
      </div>
    </div>
  )
}

const outerStyle: CSSProperties = {
  width: '100%',
  minHeight: '100%',
}

const constrainedInner: CSSProperties = {
  maxWidth: MAX_WIDTH,
  margin: '0 auto',
  padding: 'var(--space-8) var(--space-8)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-8)',
}

const fluidInner: CSSProperties = {
  width: '100%',
  padding: 'var(--space-8) var(--space-8)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-8)',
}
