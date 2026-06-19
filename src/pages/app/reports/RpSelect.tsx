type RpSelectProps = {
  label?: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}

// Shared filter dropdown for the Reports tabs, styled to match the
// `emp-select` / `pr-select`-style dropdowns used elsewhere in the app.
export function RpSelect({ label, value, onChange, options, placeholder }: RpSelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {label && <span className="rp-form-label">{label}</span>}
      <div className="rp-select-wrap">
        <select value={value} onChange={e => onChange(e.target.value)} className="rp-select">
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
