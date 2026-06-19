# PRODUCTION_AUTH_FLOW_LOCKDOWN_REPORT.md

**التاريخ:** 2026-06-18  
**الهدف:** إغلاق الوصول العام إلى صفحة إنشاء الشركة وإعادة توجيه الزوار لتسجيل الدخول  
**البناء:** ✅ نظيف — 0 TypeScript errors

---

## 1. المشكلة الأصلية

عند فتح `http://91.98.80.25/`:
- `getPath()` تُرجع `/` التي لا تطابق أي route معروف
- الـ catch-all في `AppRouter.tsx` يُحوِّل الـ URL لـ `/create-company` ويُظهر نموذج إنشاء شركة
- أي زائر غير مسجّل يُعرَض عليه نموذج تسجيل شركة جديدة ← **مقبول للتطوير، مرفوض إنتاجياً**

**المشاكل المكتشفة:**

| # | المشكلة | الموقع |
|---|---------|--------|
| 1 | `getPath()` تفول إلى `ROUTES.CREATE_COMPANY` لأي مسار غير معروف | `AppRouter.tsx:44` |
| 2 | `/create-company` له `AuthGate requireAuth={false}` — مفتوح لأي زائر | `AppRouter.tsx:166` |
| 3 | الـ catch-all يُحوَّل لـ `/create-company` بدل `/login` | `AppRouter.tsx:268` |
| 4 | `AuthGate` عند رفض المصادقة يُظهر نص "Unauthorized" بدل redirect للـ login | `AuthGate.tsx:18` |
| 5 | `LoginPage` يحتوي رابط "Create a workspace" ظاهر لجميع الزوار | `LoginPage.tsx:143` |

---

## 2. الملفات التي تغيّرت

| الملف | التغيير |
|-------|---------|
| `src/components/auth/AuthGate.tsx` | إضافة `useEffect` يُعيد التوجيه لـ `/login` بدل عرض "Unauthorized" |
| `src/routes/AppRouter.tsx` | تغيير fallback + حماية `/create-company` + إضافة `CreateCompanyGuard` |
| `src/pages/LoginPage.tsx` | إزالة رابط "Create a workspace" من الـ footer |

---

## 3. التدفق الجديد — خطوة بخطوة

### الزائر غير المسجّل يفتح أي رابط

```
http://91.98.80.25/           → catch-all → URL يتحول لـ /login → LoginPage ✅
http://91.98.80.25/app        → AuthGate requireAuth → useEffect يُعيد توجيه لـ /login ✅
http://91.98.80.25/app/xxx    → نفس آلية AuthGate ✅
http://91.98.80.25/create-company → AuthGate requireAuth → redirect لـ /login ✅
```

### المستخدم المسجَّل بدون company_id

```
/login → sign in → /app
   (أو)
/create-company → AuthGate ✅ → CreateCompanyGuard:
  profile.company_id === null → يعرض CreateCompanyPage ✅
```

### المستخدم المسجَّل مع company_id

```
/create-company → AuthGate ✅ → CreateCompanyGuard:
  profile.company_id !== null → useEffect يُعيد توجيه لـ /app ✅
```

---

## 4. التفاصيل التقنية للتغييرات

### 4.1 `AuthGate.tsx` — redirect بدل "Unauthorized"

**قبل:**
```tsx
if (requireAuth && !user) {
  return <div style={{...}}>Unauthorized</div>
}
```

**بعد:**
```tsx
// useEffect يُطلق redirect فور انتهاء loading
useEffect(() => {
  if (!authLoading && !appLoading && requireAuth && !user) {
    window.history.replaceState(null, '', ROUTES.LOGIN)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}, [authLoading, appLoading, requireAuth, user])

if (requireAuth && !user) {
  return <LuxuryLoadingScreen fullScreen message="Loading" />
}
```

**لماذا `useEffect` وليس في الـ render مباشرة؟**  
React لا يضمن أن `window.dispatchEvent` في وسط الـ render يحدث في الوقت الصحيح. الـ `useEffect` يضمن أن الـ DOM جاهز ثم يُطلق الحدث — نفس الـ lifecycle pattern المستخدم في المشروع.

### 4.2 `AppRouter.tsx` — ثلاثة تغييرات

**أ. `getPath()` fallback:**
```diff
- return window.location.pathname || ROUTES.CREATE_COMPANY
+ return window.location.pathname || ROUTES.LOGIN
```

**ب. `CreateCompanyGuard` — مكوِّن حماية جديد:**
```tsx
function CreateCompanyGuard() {
  const { profile } = useAuth()

  useEffect(() => {
    if (profile?.company_id) {
      window.history.replaceState(null, '', ROUTES.APP_HOME)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }, [profile])

  if (profile?.company_id) return null
  return <CreateCompanyPage />
}
```

- يُقرأ `profile.company_id` من `AuthProvider` (متاح بالفعل عند وصول الـ render لهنا لأن `AuthGate` ينتظر انتهاء loading)
- `company_id` نوعه `string | null` (موثَّق في `src/types/auth.ts`)
- لا يحتاج قراءة إضافية من DB — البيانات جاهزة في context

**ج. الـ catch-all:**
```diff
- window.history.replaceState(null, '', ROUTES.CREATE_COMPANY)
- return <AuthGate requireAuth={false}><CreateCompanyPage /></AuthGate>
+ window.history.replaceState(null, '', ROUTES.LOGIN)
+ return <AuthGate requireAuth={false}><LoginPage /></AuthGate>
```

### 4.3 `LoginPage.tsx` — إزالة رابط "Create a workspace"

**حُذف بالكامل:**
```tsx
// قبل:
<div className="lp-footer">
  New to the platform? · جديد على المنصة؟&nbsp;
  <a href={ROUTES.CREATE_COMPANY} onClick={...}>
    Create a workspace / إنشاء مساحة عمل
  </a>
</div>
```

الـ `lp-footer` CSS class تبقى في الـ stylesheet بدون أثر وظيفي.

---

## 5. ما لم يتغيّر عمداً

| العنصر | السبب |
|--------|--------|
| `CreateCompanyPage.tsx` نفسها | المحتوى لم يتغيّر — الحماية تأتي من الـ route guard لا من الصفحة |
| `signUpAndCreateCompany()` في authService | الدالة سليمة، الحماية على مستوى الـ route |
| RLS في Supabase | لم يُلمَس |
| منطق `create_company_for_owner` RPC | لم يُلمَس — الـ RPC محمي بـ `auth.uid()` check داخله |
| صفحة `LoginPage` UI | تغيّر فقط الـ footer link، لا تصميم آخر |

---

## 6. نتائج البناء والتحقق

```
npx tsc -p tsconfig.app.json --noEmit  → 0 errors ✅
npm run worker:typecheck               → 0 errors ✅
npm run build                          → ✓ built in 1.93s (236 modules) ✅
```

---

## 7. اختبار يدوي مطلوب بعد النشر على السيرفر

```
□ فتح http://91.98.80.25/             → يظهر صفحة Login (لا create-company)
□ فتح http://91.98.80.25/create-company → redirect لـ /login
□ فتح http://91.98.80.25/app/employees → redirect لـ /login
□ فتح http://91.98.80.25/xyz          → redirect لـ /login
□ تسجيل الدخول بحساب Owner           → /app يفتح
□ صفحة Login لا تحتوي رابط "Create a workspace"
□ محاولة الوصول المباشر لـ /create-company بعد login + company_id → redirect لـ /app
```

---

## 8. ملاحظة: إنشاء الشركات في Production

**الوضع الحالي:**
- `/create-company` محمي بـ authentication
- يمكن الوصول إليه فقط لمستخدم مسجَّل دخول وليس لديه `company_id`
- هذا يعني: **لا يمكن إنشاء شركة جديدة من الواجهة** إلا إذا كان المستخدم موجوداً مسبقاً في Supabase Auth بدون ربط بشركة

**التوصية للمستقبل:**

> **إنشاء شركات جديدة يجب أن يكون عبر Super Admin / Invite Flow.**

المقترح:
1. Super Admin (صاحب المنصة) ينشئ الشركة يدوياً من Supabase Dashboard أو عبر Admin API
2. يُرسَل invitation link للـ Owner الجديد يحتوي token يربطه بالشركة المنشأة
3. لا يوجد public signup form — كل إنشاء شركة يمر عبر عملية controlled

هذا يُغلق بالكامل مشكلة public self-signup ويتيح control كامل على من يستخدم المنصة.

---

## 9. توزيع الملفات المتأثرة

```
src/
├── components/auth/AuthGate.tsx        ← useEffect redirect بدل "Unauthorized"
├── routes/AppRouter.tsx                ← fallback + CreateCompanyGuard + /create-company guard
└── pages/LoginPage.tsx                 ← إزالة footer "Create a workspace"
```
