export function AuthBackground({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Fixed decorative background — purely visual, never blocks scroll */}
      <div style={styles.fixedBg} aria-hidden="true">
        <div style={styles.gradientBase} />
        <div style={styles.gradientMidnight} />
        <div style={{ ...styles.orb, ...styles.orbViolet }} />
        <div style={{ ...styles.orb, ...styles.orbElectric }} />
        <div style={{ ...styles.orb, ...styles.orbGold }} />
        <div style={{ ...styles.orb, ...styles.orbVioletSecondary }} />
        <div style={styles.scanLine} />
        <div style={styles.grid} />
        <div style={styles.noise} />
        <div style={styles.vignette} />
      </div>

      {/* Normal-flow content layer — scrolls freely */}
      <div style={styles.scrollLayer}>
        {children}
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  fixedBg: {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    backgroundColor: 'var(--color-bg-base)',
    zIndex: 0,
    pointerEvents: 'none',
  },
  scrollLayer: {
    position: 'relative',
    zIndex: 1,
    minHeight: '100vh',
  },
  gradientBase: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse 100% 80% at 50% -10%, #0d1128 0%, #080910 65%)',
  },
  gradientMidnight: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse 60% 50% at 50% 100%, rgba(13,16,33,0.9) 0%, transparent 70%)',
  },
  orb: {
    position: 'absolute',
    borderRadius: '50%',
    filter: 'blur(72px)',
    pointerEvents: 'none',
  },
  orbViolet: {
    top: '-18%',
    left: '-20%',
    width: '65%',
    height: '65%',
    background: 'radial-gradient(ellipse at center, rgba(124,92,191,0.22) 0%, transparent 65%)',
    animation: 'ambientDrift 22s ease-in-out infinite, ambientPulse 8s ease-in-out infinite',
  },
  orbElectric: {
    bottom: '-20%',
    right: '-15%',
    width: '60%',
    height: '60%',
    background: 'radial-gradient(ellipse at center, rgba(45,126,247,0.18) 0%, transparent 65%)',
    animation: 'ambientDriftReverse 26s ease-in-out infinite, ambientPulse 11s ease-in-out infinite 2s',
  },
  orbGold: {
    top: '30%',
    left: '55%',
    width: '35%',
    height: '35%',
    background: 'radial-gradient(ellipse at center, rgba(201,168,76,0.1) 0%, transparent 60%)',
    filter: 'blur(60px)',
    animation: 'ambientDrift 18s ease-in-out infinite 4s, ambientPulse 14s ease-in-out infinite 1s',
  },
  orbVioletSecondary: {
    bottom: '10%',
    left: '5%',
    width: '30%',
    height: '30%',
    background: 'radial-gradient(ellipse at center, rgba(124,92,191,0.12) 0%, transparent 60%)',
    filter: 'blur(56px)',
    animation: 'ambientDriftReverse 30s ease-in-out infinite 7s',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '1px',
    background: 'linear-gradient(90deg, transparent 0%, rgba(201,168,76,0.06) 30%, rgba(124,92,191,0.1) 50%, rgba(201,168,76,0.06) 70%, transparent 100%)',
    pointerEvents: 'none',
    animation: 'scanLine 12s linear infinite 3s',
  },
  grid: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
    backgroundSize: '64px 64px',
    pointerEvents: 'none',
    maskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 100%)',
    WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 100%)',
  },
  noise: {
    position: 'absolute',
    inset: 0,
    opacity: 0.028,
    backgroundImage:
      'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
    backgroundSize: '200px 200px',
    pointerEvents: 'none',
  },
  vignette: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0,0,0,0.55) 100%)',
    pointerEvents: 'none',
  },
}
