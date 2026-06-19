import { useState } from 'react'
import { AuthLayout } from '../layouts/AuthLayout'
import { LuxuryButton } from '../components/ui/LuxuryButton'
import { LuxuryInput } from '../components/ui/LuxuryInput'
import { LuxuryBadge } from '../components/ui/LuxuryBadge'
import { signInWithEmail } from '../features/auth/authService'
import { ROUTES } from '../routes/routePaths'
import './loginPage.css'

type FormState = {
  email: string
  password: string
}

type FieldErrors = Partial<Record<keyof FormState, string>>

function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function LoginPage() {
  const [form, setForm] = useState<FormState>({ email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }))
      setFieldErrors(prev => ({ ...prev, [field]: undefined }))
      setSubmitError(null)
    }
  }

  function validate(): boolean {
    const errors: FieldErrors = {}
    if (!form.email.trim())  errors.email    = 'Username or email is required. · اسم المستخدم أو البريد الإلكتروني مطلوب.'
    if (!form.password)      errors.password = 'Password is required. · كلمة المرور مطلوبة.'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    setSubmitError(null)

    // If the input contains '@', treat it as a full email address.
    // Otherwise, convert the username to the internal email format used by
    // employee accounts created via the Add Employee flow.
    const raw = form.email.trim()
    const emailToUse = raw.includes('@') ? raw : `${raw.toLowerCase()}@attendance.local`

    const { error } = await signInWithEmail(emailToUse, form.password)
    setLoading(false)
    if (error) {
      setSubmitError(error.message)
      return
    }
    setSuccess(true)
    setTimeout(() => navigate(ROUTES.APP_HOME), 800)
  }

  return (
    <AuthLayout panelWidth={440}>
      <div className="lp-header">
        <div className="lp-logo-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>

        <div className="lp-badges">
          <LuxuryBadge tone="gold">AI Attendance</LuxuryBadge>
          <span className="lp-dot" />
          <LuxuryBadge tone="violet">Security</LuxuryBadge>
          <span className="lp-dot" />
          <LuxuryBadge tone="electric">Payroll</LuxuryBadge>
        </div>

        <h1 className="lp-title">
          Welcome <span>Back</span>
        </h1>
        <p className="lp-title-ar" dir="rtl">مرحباً بعودتك</p>

        <p className="lp-subtitle">
          Sign in to your command center and take control.
        </p>
        <p className="lp-subtitle-ar" dir="rtl">
          سجّل دخولك إلى مركز القيادة وتولَّ زمام الأمور.
        </p>
      </div>

      <div className="lp-divider" />

      {success ? (
        <div className="lp-success-box">
          <strong>Signed in successfully. · تم تسجيل الدخول بنجاح.</strong>
          <span>Redirecting to your workspace…</span>
          <span dir="rtl" className="lp-success-ar">جارٍ التوجيه إلى مساحة عملك…</span>
        </div>
      ) : (
        <form className="lp-form" onSubmit={handleSubmit} noValidate>
          <LuxuryInput
            label="Username or Email / اسم المستخدم أو البريد الإلكتروني"
            type="text"
            value={form.email}
            onChange={set('email')}
            placeholder="ahmad  or  you@company.com"
            required
            disabled={loading}
            error={fieldErrors.email}
          />

          <LuxuryInput
            label="Password / كلمة المرور"
            type="password"
            value={form.password}
            onChange={set('password')}
            placeholder="••••••••"
            required
            disabled={loading}
            error={fieldErrors.password}
          />

          {submitError && (
            <div className="lp-error-box">
              <span>{submitError}</span>
            </div>
          )}

          <LuxuryButton type="submit" variant="primary" fullWidth disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In · تسجيل الدخول'}
          </LuxuryButton>
        </form>
      )}

    </AuthLayout>
  )
}
