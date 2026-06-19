import { useState } from 'react'

type LuxuryInputProps = {
  label?: string
  type?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  error?: string
}

export function LuxuryInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  error,
}: LuxuryInputProps) {
  const [focused, setFocused] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {label && (
        <label style={styles.label}>
          {label}
          {required && <span style={styles.required}>&nbsp;*</span>}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...styles.input,
          borderColor: error
            ? 'rgba(239,68,68,0.6)'
            : focused
            ? 'rgba(201,168,76,0.5)'
            : 'var(--color-border)',
          boxShadow: error
            ? '0 0 0 3px rgba(239,68,68,0.12)'
            : focused
            ? '0 0 0 3px rgba(201,168,76,0.1)'
            : 'none',
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'not-allowed' : 'text',
        }}
      />
      {error && <span style={styles.error}>{error}</span>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  label: {
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  required: {
    color: 'var(--color-gold)',
  },
  input: {
    width: '100%',
    padding: 'var(--space-3) var(--space-4)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-primary)',
    fontSize: '0.9375rem',
    outline: 'none',
    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
  },
  error: {
    fontSize: '0.8125rem',
    color: 'rgba(239,68,68,0.9)',
  },
}
