# CREATE_COMPANY_FLOW_ROOT_FIX_REPORT.md

**التاريخ:** 2026-06-18  
**النوع:** Root Cause Fix — ليس workaround  
**البناء:** ✅ نظيف — 0 TypeScript errors  
**النشر:** ✅ مكتمل — `http://91.98.80.25`

---

## 1. الأعراض

- المستخدم الجديد يظهر في Supabase Auth Users
- لا شركة في `public.companies`
- لا `user_profiles`، لا `user_roles`
- الواجهة تدخل `/app` بدون sidebar وبدون company context
- الخطأ السابق: "permission denied for function create_company_for_owner"

---

## 2. الأسباب الجذرية (ثلاثة متراكمة)

### السبب الأول — لا تحقق من `session` بعد `signUp()`

```ts
// قبل الإصلاح:
const { data: signUpData } = await supabase.auth.signUp(...)
// ← لا يوجد تحقق من signUpData.session
const { error: rpcError } = await supabase.rpc('create_company_for_owner', ...)
```

عندما يكون "Email Confirmation" مفعّلاً في Supabase:
- `signUp()` يُرجع `{ user: {...}, session: null }` — بدون خطأ
- لا يوجد session → الـ RPC يُستدعى كـ `anon`
- داخل الدالة: `auth.uid()` = `NULL` → استثناء "User must be authenticated"

### السبب الثاني — Race Condition بين `onAuthStateChange` و RPC

عندما يكون Email Confirmation **معطَّلاً** (staging):
1. `signUp()` يُرجع session → `onAuthStateChange(SIGNED_IN)` يُطلَق
2. `AppContextProvider.loadContext()` يبدأ فوراً → يستعلم عن `user_profiles` + `companies`
3. في نفس الوقت، RPC قيد التنفيذ (طلب HTTP لم ينتهِ بعد)
4. `loadContext()` ينتهي بـ `company: null` (RPC لم ينشئ الشركة بعد)
5. RPC ينتهي → الشركة تُنشأ في DB
6. **لكن AppContextProvider لا يعلم** → يظل `company: null`، لا sidebar

### السبب الثالث — لا context refresh شامل بعد نجاح RPC

`refreshCompanyContext()` يُحدِّث `company`/`settings`/`featureSettings` فقط. لا يُحدِّث `permissions`، `branches`، `roleScopes`. حتى لو استُدعي بعد RPC، الـ Owner لن يرى أي صلاحيات.

---

## 3. الإصلاح

### الحل للسببين الأول والثاني والثالث معاً: `window.location.href = '/app'`

بعد نجاح RPC → **Hard redirect** بدل React navigation. هذا يُعيد تهيئة كل شيء من الصفر:
- React يُعاد تحميله بالكامل
- `AppContextProvider` يبدأ `loadContext()` جديد
- الآن `user_profiles`، `companies`، `user_roles`، `role_permissions` كلها في DB
- Context يُحمَّل بشكل صحيح مع الشركة والصلاحيات والفروع

---

## 4. الملفات التي تغيّرت

| الملف | التغيير |
|-------|---------|
| `src/features/auth/authService.ts` | تحقق من `signUpData.session`؛ نوع إرجاع منقَّح |
| `src/pages/CreateCompanyPage.tsx` | معالجة `needsEmailConfirmation`؛ hard redirect بعد نجاح؛ Debug panel |

---

## 5. تفاصيل `authService.ts`

**قبل:**
```ts
const { data: signUpData, error: signUpError } = await supabase.auth.signUp(...)
if (signUpError) return { data: null, error: signUpError }

// ← لا تحقق من session! يستدعي RPC كـ anon إذا session = null
const { data: rpcData, error: rpcError } = await supabase.rpc('create_company_for_owner', ...)
```

**بعد:**
```ts
const { data: signUpData, error: signUpError } = await supabase.auth.signUp(...)
if (signUpError) return { data: null, error: { message: ... }, needsEmailConfirmation: false }

// ← التحقق الجديد
if (!signUpData.session) {
  return { data: null, error: null, needsEmailConfirmation: true }
}

// Session موجود → RPC يُستدعى كـ authenticated → auth.uid() يُرجع UUID صحيح
const { data: rpcData, error: rpcError } = await supabase.rpc('create_company_for_owner', ...)
```

**نوع الإرجاع الجديد:**
```ts
type SignUpResult =
  | { data: { user; company }; error: null; needsEmailConfirmation: false }
  | { data: null; error: { message; code? }; needsEmailConfirmation: false }
  | { data: null; error: null; needsEmailConfirmation: true }
```

---

## 6. تفاصيل `CreateCompanyPage.tsx`

### Debug Panel (مؤقت للـ staging)

يظهر بعد كل محاولة إنشاء شركة:
```
session_before: null / present (user_id=abc12345…)
session_after:  null / present (user_id=abc12345…)
needs_email_confirmation: true / false
error_code: email_address_not_authorized / n/a
error_message: [رسالة الخطأ الكاملة]
rpc_data: [UUID الشركة أو null]
```

### المسارات الثلاثة

| الحالة | النتيجة |
|--------|---------|
| `needsEmailConfirmation = true` | رسالة "أكِّد بريدك ثم سجّل دخولك" |
| `error != null` | رسالة خطأ واضحة مع debug panel |
| `error = null, session = present` | **`window.location.href = '/app'`** — hard redirect |

### لماذا hard redirect وليس `navigate()`؟

```
navigate('/app') → React re-renders → AppContextProvider.loadContext() يجري للمرة الثانية
                   → race condition لا يزال محتملاً
                   
window.location.href = '/app' → صفحة جديدة كاملة → AppContextProvider يبدأ من الصفر
                                → البيانات في DB جاهزة → لا race
```

---

## 7. حالات الاستخدام بعد الإصلاح

| سيناريو | النتيجة المتوقعة |
|---------|-----------------|
| Email confirmation **OFF** (staging) | ✅ signUp → session → RPC → hard redirect → /app مع sidebar |
| Email confirmation **ON** (production) | ✅ رسالة "أكِّد بريدك" — لا RPC يُستدعى |
| RPC يفشل (خطأ فعلي) | ✅ رسالة خطأ دقيقة مع code + message |
| `signUp` يفشل (email مكرر) | ✅ رسالة `signUpError.message` |
| session null بدون email confirmation | 🚫 لا يحدث — signUp بدون email confirmation دائماً يُرجع session |

---

## 8. للاختبار بعد النشر

### خطوات التحقق:
```
1. افتح: http://91.98.80.25/create-company?setup_key=att-setup-458763dc1ba2f0e9
2. أدخل: اسم شركة + اسم مالك + إيميل جديد + كلمة مرور
3. انقر "Create Workspace"
4. يجب أن يظهر Debug Panel بعد المحاولة
5. إذا session_after = present → توجه تلقائي لـ /app
6. في /app: sidebar يظهر باسم الشركة وصلاحيات Owner
```

### التحقق من DB (Supabase Dashboard):
```sql
-- بعد إنشاء شركة جديدة
SELECT id, name, status FROM companies ORDER BY created_at DESC LIMIT 3;
SELECT id, company_id, full_name, email FROM user_profiles ORDER BY created_at DESC LIMIT 3;
SELECT ur.user_id, r.name AS role FROM user_roles ur JOIN roles r ON r.id = ur.role_id ORDER BY ur.created_at DESC LIMIT 3;
```

---

## 9. إذا كان Email Confirmation لا يزال يمنع العمل

إذا رأيت في Debug Panel:
```
session_after: null
needs_email_confirmation: true
```

اذهب إلى **Supabase Dashboard → Authentication → Providers → Email → Disable "Confirm email"** للـ staging.

بعد التعطيل: `signUp()` يُرجع session فوراً وكل الـ flow يعمل.

---

## 10. التقنية التفصيلية لـ `create_company_for_owner`

من `docs/live-db-snapshots/current_functions_snapshot.md`:

الدالة تفعل في transaction واحدة:
1. INSERT into companies
2. INSERT into company_settings
3. INSERT into branches (Main Branch)
4. INSERT into company_subscriptions
5. INSERT into roles (Owner)
6. INSERT into role_permissions (كل الـ permissions → Owner)
7. INSERT into user_profiles
8. INSERT into user_roles
9. RETURN company_id

`SECURITY DEFINER` + owner = `postgres` → تتجاوز RLS → تنجح على جميع الجداول

إذا أي خطوة فشلت: PostgreSQL يُلغي كل الـ transaction → لا شركة ناقصة.
