# EMPLOYEE_LOGIN_ACCOUNT_EDGE_FUNCTION_FIX_REPORT.md

**التاريخ:** 2026-06-18  
**النوع:** Root Cause Fix — ليس workaround  
**Build:** ✅ 0 TypeScript errors  
**Edge Function:** ✅ Version 2 — ACTIVE  
**Server:** ✅ bundle `index-D-cu-7jS.js` مُنشَر

---

## 1. الأعراض

عند إنشاء موظف جديد والضغط على "حساب تسجيل الدخول":
```
Edge Function returned a non-2xx status code
```

---

## 2. التشخيص

### الـ Edge Function موجودة ومنشورة

```
name: create-employee-account
status: ACTIVE
version: 1 (before fix) → 2 (after fix)
```

الـ function منشورة، الخطأ ليس "function not found".

### السبب الجذري — أدوار مفقودة في الشركات الجديدة

`create_company_for_owner` (الـ Postgres function) تُنشئ فقط دور **"Owner"** لكل شركة جديدة:

```sql
insert into public.roles (company_id, name, description, is_system_role)
values (v_company_id, 'Owner', 'Company owner with full permissions', true)
```

الـ Edge Function `create-employee-account` تبحث عن الدور المطلوب (Employee/HR/Branch Manager) في جدول `roles`:

```ts
const { data: roleRow } = await adminClient
  .from('roles')
  .eq('company_id', company_id)
  .eq('name', role_name)  // ← لا يوجد هذا الدور للشركات الجديدة
  .maybeSingle()

if (!roleRow) {
  return jsonResponse({
    error: `Role '${role_name}' is not set up for this company.`
  }, 400)  // ← 400 = non-2xx
}
```

نتيجة: الـ function تُرجع **HTTP 400** مع رسالة واضحة في الـ JSON body، لكن الـ frontend يعرض فقط الرسالة العامة من Supabase JS.

### مشكلة ثانوية — رسالة الخطأ مُبتلَعة

```ts
// قبل الإصلاح في employeeService.ts:
const { data, error } = await supabase.functions.invoke(...)
if (error) return { data: null, error: error.message }
//                                       ^^^^^^^^^^^^^
// error.message = "Edge Function returned a non-2xx status code"
// الرسالة الحقيقية في error.data?.error كانت تُفقَد
```

`FunctionsHttpError` في Supabase JS v2 تحمل body الـ response المُحلَّل في `error.data`. المشكلة أن الكود لم يستخرجه.

---

## 3. الإصلاحات

### إصلاح A — `src/features/employees/employeeService.ts`

**استخراج الخطأ الحقيقي من `error.data`:**

```ts
// بعد الإصلاح:
if (error) {
  const fnErr = error as unknown as { data?: { error?: string }; message: string }
  const body = fnErr.data
  const detail = typeof body?.error === 'string' ? body.error : null
  return {
    data: null,
    error: detail
      ? `create-employee-account: ${detail}`
      : `create-employee-account (${error.message})`,
  }
}
```

الآن أي خطأ من الـ function (validation، permission، DB error) يظهر كاملاً في الـ UI.

### إصلاح B — `supabase/functions/create-employee-account/index.ts` (Version 2)

**Auto-seed الأدوار المفقودة بدلاً من الرفض:**

```ts
// بدلاً من:
if (!roleRow) {
  return jsonResponse({ error: `Role not set up...` }, 400)
}

// الآن:
if (!existingRole) {
  // ← ينشئ الدور تلقائياً مع الصلاحيات المناسبة
  const { data: newRole } = await adminClient.from('roles').insert({
    company_id, name: role_name,
    description: `${role_name} — auto-seeded`,
    is_system_role: true,
  }).select('id, name').single()

  // ← يجلب IDs الصلاحيات من permissions catalog
  const permKeys = DEFAULT_ROLE_PERMISSIONS[role_name] ?? []
  const { data: permRows } = await adminClient.from('permissions')
    .select('id').in('permission_key', permKeys)
  
  // ← يربط الصلاحيات بالدور الجديد
  await adminClient.from('role_permissions').insert(
    permRows.map(p => ({ role_id: newRole.id, permission_id: p.id }))
  )
  
  roleRow = newRole
}
```

**الأدوار التي تُنشأ تلقائياً:**

| الدور | عدد الصلاحيات | أبرزها |
|-------|--------------|--------|
| `Employee` | 6 | view_own_profile, view_own_attendance, request_leave, enroll_face |
| `HR` | 21 | employees.*, leaves.*, attendance.*, payroll.view, payroll.create |
| `Branch Manager` | 20 | employees.view/edit, leaves.*, attendance.*, cameras.view, security.view |

---

## 4. الملفات التي تغيّرت

| الملف | التغيير |
|-------|---------|
| `src/features/employees/employeeService.ts` | استخراج `error.data?.error` من FunctionsHttpError |
| `supabase/functions/create-employee-account/index.ts` | Auto-seed أدوار مفقودة + `DEFAULT_ROLE_PERMISSIONS` constant |

---

## 5. نتائج البناء والنشر

```
npx tsc -p tsconfig.app.json --noEmit    → 0 errors ✅
npm run worker:typecheck                  → 0 errors ✅
npm run build                            → ✓ built in 2.04s ✅
supabase functions deploy                → Version 2 ACTIVE ✅
Server deployment                        → bundle index-D-cu-7jS.js ✅
```

---

## 6. اختبار الـ Flow الصحيح

### خطوات التحقق اليدوي:

```
1. افتح http://91.98.80.25/login
2. سجّل دخولك كـ Owner
3. اذهب إلى Employees → New Employee (أو Add Employee)
4. أدخل البيانات بما فيها:
   - Login Account: YES
   - Username: e.g. "ahmad_test"
   - Password: 8+ chars
   - Role: Employee (أو HR أو Branch Manager)
5. انقر Save/Create
```

### النتائج المتوقعة:

```sql
-- يجب أن تجد هذه الصفوف في Supabase:

-- الموظف الجديد:
SELECT id, full_name, company_id FROM employees WHERE full_name = 'Ahmad Test';

-- الحساب في Auth:
-- Supabase Dashboard → Authentication → Users → email: ahmad_test@attendance.local

-- user_profiles مرتبط بالموظف:
SELECT id, company_id, employee_id, username, email FROM user_profiles
WHERE username = 'ahmad_test';

-- user_roles مع الدور الصحيح:
SELECT ur.user_id, r.name AS role FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
WHERE ur.user_id = (SELECT id FROM user_profiles WHERE username = 'ahmad_test');

-- الأدوار الجديدة في الشركة (يجب أن تظهر Employee/HR/Branch Manager):
SELECT name, is_system_role FROM roles WHERE company_id = '<your_company_id>';
```

### اختبار تسجيل الدخول بحساب الموظف:

```
1. URL: http://91.98.80.25/login
2. Username: ahmad_test  (الـ login page يُحوِّل التلقائياً لـ ahmad_test@attendance.local)
3. Password: <كلمة المرور التي أدخلتها>
4. يجب أن يدخل للـ /app ويظهر My Space في الـ sidebar
```

---

## 7. ملاحظة للإنتاج

الـ auto-seeding يحدث مرة واحدة فقط لكل دور في كل شركة. بعد الإنشاء الأول:
- `roles` table يحتوي الأدوار الثلاثة
- الأدوار تستخدم مباشرة في الـ lookups التالية
- لا overhead إضافي

للشركات المستقبلية، يُفضَّل تحديث `create_company_for_owner` Postgres function لتنشئ الأدوار الثلاثة مباشرة عند إنشاء الشركة — هذا يجعل كل شركة جاهزة فوراً بدون الاعتماد على auto-seed في الـ Edge Function.
