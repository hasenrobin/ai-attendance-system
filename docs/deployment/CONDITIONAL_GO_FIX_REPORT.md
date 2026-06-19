# CONDITIONAL_GO_FIX_REPORT.md

**التاريخ:** 2026-06-17  
**الهدف:** تنفيذ إصلاحات CONDITIONAL GO قبل نشر المشروع كـ Staging Web  
**الحالة:** مكتمل — البناء نظيف

---

## 1. الملفات التي تغيّرت

| الملف | نوع التغيير | السبب |
|-------|-------------|--------|
| `src/pages/app/employeeDetailsShared.tsx` | إزالة سطر + إزالة prop | إصلاح Bug الإجازات: `branch_id` يُرسَل لجدول لا يملكه |
| `src/pages/app/EmployeeDetailsPage.tsx` | إزالة prop من JSX | تزامن مع حذف `branchId` من `LeavesTab` |
| `src/pages/app/MyLeaveRequestsPage.tsx` | إزالة prop من JSX | تزامن مع حذف `branchId` من `LeavesTab` |
| `docs/security/SETTINGS_UPDATE_RLS_PATCH.sql` | ملف جديد | UPDATE policies لـ companies و company_settings |

**لم يتغيّر:** أي منطق UI، أي feature، أي schema، أي service function، أي locale.

---

## 2. السطر الذي تم إصلاحه (Bug الإجازات)

### الجذر الحرج

**الملف:** `src/pages/app/employeeDetailsShared.tsx`

الوظيفة `createLeaveRequest()` كانت تُرسِل `branch_id` في كل INSERT لجدول `leave_requests`، لكن هذا الجدول لا يحتوي عمود `branch_id` (مثبَت من قاعدة البيانات الحية في PRODUCTION_FIX_EXECUTION_REPORT.md). PostgREST يرفض كل INSERT بخطأ `PGRST204`.

### التغييرات بالتفصيل

**1 — `employeeDetailsShared.tsx` (LeavesTab props — إزالة `branchId` من التعريف)**

```diff
- export function LeavesTab({
-   companyId, employeeId, branchId, canRequestLeave,
- }: {
-   companyId: string
-   employeeId: string
-   branchId: string | null
-   canRequestLeave: boolean
- })
+ export function LeavesTab({
+   companyId, employeeId, canRequestLeave,
+ }: {
+   companyId: string
+   employeeId: string
+   canRequestLeave: boolean
+ })
```

**2 — `employeeDetailsShared.tsx` (داخل handleRequestLeave — السطر الحرج)**

```diff
  const { error } = await createLeaveRequest({
    company_id: companyId,
-   branch_id: branchId,
    employee_id: employeeId,
    leave_type: leaveForm.leave_type,
    ...
  })
```

**3 — `EmployeeDetailsPage.tsx:1538`**

```diff
- <LeavesTab companyId={companyId} employeeId={employee.id} branchId={employee.branch_id} canRequestLeave={canUpdate} />
+ <LeavesTab companyId={companyId} employeeId={employee.id} canRequestLeave={canUpdate} />
```

**4 — `MyLeaveRequestsPage.tsx:69-74`**

```diff
  <LeavesTab
    companyId={company!.id}
    employeeId={employee.id}
-   branchId={employee.branch_id}
    canRequestLeave={permissions.includes('employee.request_leave')}
  />
```

### لماذا لم تُحذف `branch_id` من `leaveService.ts`؟

الـ service تعريف `CreateLeaveRequestParams.branch_id` هو `optional?: string | null`. لا يُرسَل الآن لأن الـ caller لم يعد يمرره. تغيير الـ service type هو تنظيف اختياري لا ضروري — التعديلات أعلاه تكفي لإصلاح Bug وتجاوز TypeScript strict checks.

---

## 3. SQL المطلوب تشغيله في Supabase

**الملف:** `docs/security/SETTINGS_UPDATE_RLS_PATCH.sql`

### الخطوة

Supabase Dashboard → SQL Editor → الصق الملف كاملاً → Run

### ما سيُضاف

```sql
-- Policy 1: companies UPDATE
CREATE POLICY "companies_update_settings" ON companies
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    id = current_user_company_id()
    AND current_user_has_permission('settings.manage')
  )
  WITH CHECK (
    id = current_user_company_id()
    AND current_user_has_permission('settings.manage')
  );

-- Policy 2: company_settings UPDATE
CREATE POLICY "company_settings_update" ON company_settings
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    company_id = current_user_company_id()
    AND current_user_has_permission('settings.manage')
  )
  WITH CHECK (
    company_id = current_user_company_id()
    AND current_user_has_permission('settings.manage')
  );
```

### لماذا هذه السياسات آمنة؟

| الضمان | التنفيذ |
|--------|---------|
| المستخدم المصادق فقط | `TO authenticated` |
| شركة المستخدم فقط | `id/company_id = current_user_company_id()` |
| لا cross-company | دالة SECURITY DEFINER تعيد company_id من user_profiles |
| صلاحية settings.manage مطلوبة | `current_user_has_permission('settings.manage')` |
| لا SELECT جديد | الـ policies الحالية تبقى كما هي |
| لا INSERT أو DELETE | السياستان UPDATE فقط |

### قبل التطبيق — تحقق من وجود `settings.manage` في permissions

```sql
SELECT permission_key FROM permissions WHERE permission_key = 'settings.manage';
```

إذا رجعت 0 صفوف: طبّق أولاً `docs/security/LAUNCH_BLOCKERS_RLS_PATCH.sql` الذي يضيف هذا المفتاح.

إذا رجعت 1 صف: تابع بـ `SETTINGS_UPDATE_RLS_PATCH.sql` مباشرة.

### بعد التطبيق — تحقق من ربط الصلاحية بالـ Owner

```sql
SELECT p.permission_key
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
JOIN roles r ON r.id = rp.role_id
WHERE r.name = 'Owner' AND p.permission_key = 'settings.manage';
```

إذا رجعت 0 صفوف: يجب إضافة الربط عبر role_permissions.

---

## 4. نتيجة البناء

```
npx tsc -p tsconfig.app.json --noEmit   → 0 errors  ✅
npm run worker:typecheck                  → 0 errors  ✅
npm run build                            → ✓ built in 2.18s (236 modules)  ✅
```

**تحذير موجود مسبقاً (غير متعلق بهذا الإصلاح):**
```
(!) Some chunks are larger than 500 kB after minification
    - main JS bundle: 2,900.98 kB (713 kB gzipped)
    - WASM asset:     26,239 kB  (6,244 kB gzipped)
    - HLS.js:         508 kB     (157 kB gzipped)
```
هذا التحذير موجود قبل هذا الإصلاح ولا يمنع النشر.

---

## 5. Recognition Worker — معطَّل حتى توفير ملفات ONNX

**الحالة:** Worker **لا يُشغَّل** في هذا الإطلاق.

**السبب التقني:**
- Worker يرفض `FACE_ENGINE=faceapi` (browser-only / DOM required)
- Worker يتطلب `FACE_ENGINE=onnx_arcface`
- ملفات ONNX غائبة من المشروع:
  - `public/models/onnx/face_detector.onnx` → **غير موجود**
  - `public/models/onnx/arcface.onnx` → **غير موجود**
- عند تشغيل Worker بدونها: يخرج `process.exit(1)` بعد رسالة "Production model not configured"

**ما يعمل بدل الـ Worker:**
- `FaceRecognitionMonitor.tsx` في المتصفح يعمل بـ face-api.js
- النماذج الخاصة بـ face-api موجودة في `public/models/` (3 ملفات .bin)
- Face Enrollment + الـ Recognition في المتصفح يعملان بالكامل

**لتفعيل الـ Worker مستقبلاً:**
```
1. احصل على ملفي ONNX من InsightFace (buffalo_l / w600k_r50):
   - face_detector.onnx  → public/models/onnx/face_detector.onnx
   - arcface.onnx        → public/models/onnx/arcface.onnx

2. أنشئ recognition-worker/.env.worker بـ:
   SUPABASE_URL=<url>
   SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
   FACE_ENGINE=onnx_arcface
   WORKER_POLL_INTERVAL_MS=10000

3. شغّل الاختبار:
   npm run worker:selftest
   (يجب أن تفشل Section 2 بـ PASS — بمعنى النماذج موجودة وtُحمَّل)

4. شغّل بـ PM2:
   pm2 start "npm run worker:start" --name ai-attendance-worker
```

---

## 6. هل أصبح المشروع جاهزاً للنشر كـ Staging Web فقط؟

### **نعم — بشروط واضحة**

| المكوّن | الجاهزية |
|---------|----------|
| Frontend SPA (React + Vite) | ✅ جاهز — 0 errors، Build نظيف |
| Nginx Static Serving | ✅ جاهز — يحتاج فقط إعداد الـ domain + SSL |
| Supabase (DB/Auth/RLS) | ✅ 86 RLS policy مُطبَّقة من Phase 4-6 |
| إدارة الموظفين / الفروع / الأقسام | ✅ يعمل |
| الورديات والحضور اليدوي | ✅ يعمل |
| تصحيحات الحضور | ✅ يعمل (RLS تم إصلاحه Phase 6) |
| طلب الإجازات (Bug الـ branch_id) | ✅ **مُصلَح الآن** |
| الرواتب | ✅ يعمل (RLS Phase 4) |
| الكاميرات / الأمان | ✅ يعمل (RLS Phase 4) |
| الأدوار والصلاحيات | ✅ يعمل (Phase 5) |
| الإعدادات — قراءة | ✅ يعمل |
| الإعدادات — حفظ | ⚠️ يعمل بعد تطبيق `SETTINGS_UPDATE_RLS_PATCH.sql` |
| Face Recognition (Browser) | ✅ يعمل بـ face-api.js |
| Recognition Worker | ⏸️ معطَّل — يحتاج ONNX models |

### الخطوات المتبقية قبل Staging

```
□ تطبيق SETTINGS_UPDATE_RLS_PATCH.sql في Supabase SQL Editor
□ التأكد من أن settings.manage مرتبط بـ Owner في role_permissions
□ تغيير Site URL في Supabase Auth → URL Configuration من localhost للـ domain
□ إضافة production domain في Allowed Redirect URLs في Supabase
□ Clone المشروع على سيرفر Hetzner + npm install + npm run build
□ إعداد Nginx لتقديم dist/ مع SPA fallback (try_files $uri /index.html)
□ SSL بـ Certbot
```

### ما يبقى موثَّقاً كـ known limitations في هذا الإصلاح

- `net_salary` دائماً = `gross_salary` (deductions/additions غير مدعومة V1، مُوثَّق في UI)
- `audit_logs` فارغة دائماً (لا triggers في DB)
- Worker معطَّل حتى توفير ONNX models
- الـ daily_attendance_summary تتطلب "Recalculate" يدوياً (لا auto-calculation)
- Employee role: self-service pages تعمل في المتصفح لكن بعض الـ features محدودة

---

## 7. ملخص الإصلاحات المنجزة في هذه الجلسة

| # | الإصلاح | النوع | الملف |
|---|---------|-------|-------|
| 1 | حذف `branch_id` من `createLeaveRequest` | كود — سطر واحد | `employeeDetailsShared.tsx` |
| 2 | إزالة `branchId` من `LeavesTab` props | كود — تنظيف ضروري لـ TypeScript strict | `employeeDetailsShared.tsx` |
| 3 | إزالة `branchId={employee.branch_id}` من caller | كود | `EmployeeDetailsPage.tsx` |
| 4 | إزالة `branchId={employee.branch_id}` من caller | كود | `MyLeaveRequestsPage.tsx` |
| 5 | UPDATE policy لـ companies | SQL patch | `docs/security/SETTINGS_UPDATE_RLS_PATCH.sql` |
| 6 | UPDATE policy لـ company_settings | SQL patch | `docs/security/SETTINGS_UPDATE_RLS_PATCH.sql` |

**البناء النهائي:** ✅ `built in 2.18s` — 0 TypeScript errors — 0 رسائل خطأ جديدة
