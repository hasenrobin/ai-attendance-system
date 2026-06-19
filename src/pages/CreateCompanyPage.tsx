import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { AuthLayout } from '../layouts/AuthLayout'
import { LuxuryButton } from '../components/ui/LuxuryButton'
import { LuxuryInput } from '../components/ui/LuxuryInput'
import { LuxuryBadge } from '../components/ui/LuxuryBadge'
import { signUpAndCreateCompany } from '../features/auth/authService'
import './createCompanyPage.css'

type FormState = {
  companyName: string
  ownerFullName: string
  email: string
  password: string
  confirmPassword: string
}

type FieldErrors = Partial<Record<keyof FormState, string>>

// Debug panel — shown during sign-up attempt to expose exact error state.
// Remove or gate behind a flag once the flow is confirmed stable in production.
function DebugPanel({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <div style={{
      marginTop: '12px',
      padding: '10px 12px',
      background: '#0f0f0f',
      border: '1px solid #333',
      borderRadius: '6px',
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#aaa',
      lineHeight: 1.7,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}

export function CreateCompanyPage() {
  const [form, setForm] = useState<FormState>({
    companyName: '',
    ownerFullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [debugLines, setDebugLines] = useState<string[]>([])

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }))
      setFieldErrors(prev => ({ ...prev, [field]: undefined }))
      setSubmitError(null)
    }
  }

  function validate(): boolean {
    const errors: FieldErrors = {}
    if (!form.companyName.trim())    errors.companyName    = 'Company name is required. · اسم الشركة مطلوب.'
    if (!form.ownerFullName.trim())  errors.ownerFullName  = 'Full name is required. · الاسم الكامل مطلوب.'
    if (!form.email.trim())          errors.email          = 'Email is required. · البريد الإلكتروني مطلوب.'
    if (!form.password)              errors.password       = 'Password is required. · كلمة المرور مطلوبة.'
    else if (form.password.length < 6) errors.password    = 'Minimum 6 characters. · 6 أحرف على الأقل.'
    if (!form.confirmPassword)       errors.confirmPassword = 'Please confirm your password. · أكد كلمة المرور.'
    else if (form.password !== form.confirmPassword)
                                     errors.confirmPassword = 'Passwords do not match. · كلمتا المرور غير متطابقتين.'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    setSubmitError(null)
    setNeedsConfirmation(false)
    setDebugLines([])

    // Capture session state before signUp so we can compare after
    const { data: { session: sessionBefore } } = await supabase.auth.getSession()

    const result = await signUpAndCreateCompany({
      companyName: form.companyName.trim(),
      ownerFullName: form.ownerFullName.trim(),
      email: form.email.trim(),
      password: form.password,
    })

    const { data: { session: sessionAfter } } = await supabase.auth.getSession()

    const debug = [
      `session_before: ${sessionBefore ? 'present (user_id=' + sessionBefore.user.id.slice(0, 8) + '…)' : 'null'}`,
      `session_after:  ${sessionAfter  ? 'present (user_id=' + sessionAfter.user.id.slice(0, 8) + '…)' : 'null'}`,
      `needs_email_confirmation: ${result.needsEmailConfirmation}`,
      result.error
        ? `error_code: ${result.error.code ?? 'n/a'}`
        : `error: none`,
      result.error
        ? `error_message: ${result.error.message}`
        : `rpc_data: ${result.data ? JSON.stringify(result.data).slice(0, 80) : 'null'}`,
    ]
    setDebugLines(debug)
    setLoading(false)

    if (result.needsEmailConfirmation) {
      setNeedsConfirmation(true)
      return
    }

    if (result.error) {
      setSubmitError(result.error.message)
      return
    }

    // Company created successfully. Hard-redirect to /app so that
    // AppContextProvider re-initialises from scratch with the new company
    // data already in the database — avoids the race where loadContext() ran
    // before the RPC completed and cached an empty company state.
    window.location.href = '/app'
  }

  const showForm = !needsConfirmation

  return (
    <AuthLayout panelWidth={480}>
      <div className="cc-header">
        <div className="cc-logo-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>

        <div className="cc-badges">
          <LuxuryBadge tone="gold">AI Attendance</LuxuryBadge>
          <span className="cc-dot" />
          <LuxuryBadge tone="violet">Security</LuxuryBadge>
          <span className="cc-dot" />
          <LuxuryBadge tone="electric">Payroll</LuxuryBadge>
        </div>

        <h1 className="cc-title">
          Launch Your <span>Command Center</span>
        </h1>
        <p className="cc-title-ar" dir="rtl">أطلق مركز القيادة الخاص بك</p>

        <p className="cc-subtitle">
          Enterprise-grade attendance, AI-powered insights, and payroll — all in one platform.
        </p>
        <p className="cc-subtitle-ar" dir="rtl">
          حضور على مستوى المؤسسات، رؤى بالذكاء الاصطناعي، ورواتب آلية — كل ذلك في منصة واحدة.
        </p>
      </div>

      <div className="cc-divider" />

      {needsConfirmation ? (
        <div className="cc-success-box">
          <strong>Account created — email confirmation required.</strong>
          <span>
            Please check your inbox and confirm your email address.
            Once confirmed, <a href="/login" style={{ color: 'var(--color-gold)' }}>sign in here</a> — the workspace will be set up on first login.
          </span>
          <span dir="rtl" className="cc-success-ar">
            تحقق من بريدك الإلكتروني وأكِّد عنوانك. بعد التأكيد سجّل الدخول وسيتم إعداد مساحة العمل.
          </span>
          <DebugPanel lines={debugLines} />
        </div>
      ) : showForm ? (
        <form className="cc-form" onSubmit={handleSubmit} noValidate>
          <span className="cc-section-label">Company · الشركة</span>

          <LuxuryInput
            label="Company Name / اسم الشركة"
            type="text"
            value={form.companyName}
            onChange={set('companyName')}
            placeholder="Acme Corp"
            required
            disabled={loading}
            error={fieldErrors.companyName}
          />

          <span className="cc-section-label">Owner Account · حساب المالك</span>

          <LuxuryInput
            label="Full Name / الاسم الكامل"
            type="text"
            value={form.ownerFullName}
            onChange={set('ownerFullName')}
            placeholder="Jane Smith"
            required
            disabled={loading}
            error={fieldErrors.ownerFullName}
          />

          <LuxuryInput
            label="Email / البريد الإلكتروني"
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="jane@acmecorp.com"
            required
            disabled={loading}
            error={fieldErrors.email}
          />

          <div className="cc-form-row">
            <LuxuryInput
              label="Password / كلمة المرور"
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder="Min. 6 characters"
              required
              disabled={loading}
              error={fieldErrors.password}
            />
            <LuxuryInput
              label="Confirm / تأكيد"
              type="password"
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
              placeholder="Repeat password"
              required
              disabled={loading}
              error={fieldErrors.confirmPassword}
            />
          </div>

          {submitError && (
            <div className="cc-error-box">
              <span>{submitError}</span>
            </div>
          )}

          <DebugPanel lines={debugLines} />

          <LuxuryButton type="submit" variant="primary" fullWidth disabled={loading}>
            {loading ? 'Creating workspace…' : 'Create Workspace · إنشاء مساحة العمل'}
          </LuxuryButton>
        </form>
      ) : null}

      <div className="cc-footer">
        Already have an account? · هل لديك حساب؟&nbsp;
        <a href="/login">Sign in / تسجيل الدخول</a>
      </div>
    </AuthLayout>
  )
}
