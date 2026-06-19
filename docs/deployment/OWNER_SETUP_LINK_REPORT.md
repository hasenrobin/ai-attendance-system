# OWNER_SETUP_LINK_REPORT.md

**التاريخ:** 2026-06-18  
**الهدف:** إضافة setup_key آمن للسماح لصاحب المنصة بإنشاء شركة جديدة دون فتح الصفحة للعامة  
**البناء:** ✅ نظيف — 0 TypeScript errors

---

## 1. الفكرة

بعد قفل `/create-company` في [PRODUCTION_AUTH_FLOW_LOCKDOWN_REPORT.md](PRODUCTION_AUTH_FLOW_LOCKDOWN_REPORT.md)، احتاج صاحب المنصة لطريقة للوصول إلى نموذج إنشاء الشركة بدون فتحه للجميع.

الحل: **query parameter سري** — يُضاف للرابط، يُقارَن مع قيمة من `.env`، لا يُعرض في أي مكان بالـ UI.

---

## 2. الملفات التي تغيّرت

| الملف | التغيير |
|-------|---------|
| `.env` (محلي) | إضافة `VITE_OWNER_SETUP_KEY` |
| `src/routes/AppRouter.tsx` | تغيير منطق `/create-company` من auth-guard إلى setup_key check |
| `dist/` | build جديد يتضمن المفتاح embedded بـ Vite |
| `/var/www/ai-attendance/.env` (السيرفر) | إضافة `VITE_OWNER_SETUP_KEY` |

---

## 3. الرابط السري

```
http://91.98.80.25/create-company?setup_key=att-setup-458763dc1ba2f0e9
```

> **احتفظ بهذا الرابط في مكان آمن. لا تنشره.**

---

## 4. التدفق الجديد

| الرابط | النتيجة |
|--------|---------|
| `http://91.98.80.25/` | ← صفحة Login |
| `http://91.98.80.25/create-company` | ← redirect لـ Login (لا مفتاح) |
| `http://91.98.80.25/create-company?setup_key=wrong` | ← redirect لـ Login (مفتاح خاطئ) |
| `http://91.98.80.25/create-company?setup_key=att-setup-458763dc1ba2f0e9` | ← **صفحة إنشاء الشركة** ✅ |

---

## 5. التفاصيل التقنية

### منطق الحماية في `AppRouter.tsx`

```tsx
if (path === ROUTES.CREATE_COMPANY) {
  const params = new URLSearchParams(window.location.search)
  const providedKey = params.get('setup_key')
  const expectedKey = readEnv('VITE_OWNER_SETUP_KEY')

  if (expectedKey && providedKey === expectedKey) {
    return <CreateCompanyPage />   // ← مفتاح صحيح: اعرض النموذج
  }

  // مفتاح مفقود أو خاطئ أو ENV غير مضبوط: توجيه لـ Login
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', ROUTES.LOGIN)
  }
  return (
    <AuthGate requireAuth={false}>
      <LoginPage />
    </AuthGate>
  )
}
```

### `readEnv('VITE_OWNER_SETUP_KEY')`

- يقرأ من `import.meta.env.VITE_OWNER_SETUP_KEY`
- **Vite يُضمِّن القيمة في الـ bundle وقت البناء** — المفتاح يصبح جزءاً من `dist/assets/index-ZPsk83EE.js`
- إذا لم تُضبط القيمة في `.env` → `expectedKey = undefined` → الشرط `if (expectedKey && ...)` يفشل → redirect لـ Login ✅

### ضمانات الأمان

| الضمان | التنفيذ |
|--------|---------|
| لا hardcoded في الكود | القيمة تأتي من `VITE_OWNER_SETUP_KEY` env فقط |
| مفتاح خاطئ = redirect | `providedKey !== expectedKey` → Login |
| لا مفتاح = redirect | `params.get('setup_key')` يُرجع `null` → Login |
| ENV غير مضبوط = redirect | `expectedKey = undefined` → condition fails → Login |
| لا رابط في LoginPage | حُذف في PRODUCTION_AUTH_FLOW_LOCKDOWN |
| RLS لم يتغيّر | `create_company_for_owner` RPC يظل كما هو |

### ملاحظة أمنية

> المفتاح مُضمَّن في الـ JavaScript bundle (ملف `index-ZPsk83EE.js`). يمكن لمستخدم محترف يفحص source code المتصفح إيجاده. هذا **مقبول** لهذا الاستخدام المؤقت — الهدف منع الزوار العاديين من الوصول العرضي. الأمان الحقيقي يأتي من Supabase: `create_company_for_owner` RPC يتحقق من `auth.uid()` ويُطبِّق RLS.

---

## 6. نتائج البناء والنشر

```
TSC: 0 errors ✅
Build: ✓ built in 1.84s (236 modules) ✅
Bundle: dist/assets/index-ZPsk83EE.js ✅
Server: index.html محدَّث → يشير لـ index-ZPsk83EE.js ✅
Nginx: reload ناجح ✅
```

---

## 7. تغيير المفتاح مستقبلاً

إذا احتجت تغيير المفتاح:

```bash
# 1. عدّل محلياً:
# .env → VITE_OWNER_SETUP_KEY=<new_key>

# 2. أعد البناء:
npm run build

# 3. ارفع الـ build للسيرفر

# 4. عدّل على السيرفر:
# /var/www/ai-attendance/.env → VITE_OWNER_SETUP_KEY=<new_key>
# (ملاحظة: المفتاح القديم مُضمَّن في الـ bundle، فتغييره في .env فقط لن يكفي
#  — يجب إعادة البناء ورفع dist/ الجديد)
```

---

## 8. توصية: Invite Flow للمستقبل

هذا الحل **مؤقت** لمرحلة التجربة. للإنتاج الكامل:

1. **Super Admin Panel** (منفصل عن التطبيق الرئيسي، أو Supabase Dashboard مباشرة) ينشئ الشركة والمالك
2. **Invite Link** يُرسَل للمالك بـ token يُرتبط بشركة منشأة مسبقاً
3. لا `create-company` عامة من أي نوع — كل إنشاء شركة يمر عبر عملية controlled من المشغِّل

هذا يُغلق نهائياً مشكلة self-signup العشوائي ويعطي تحكماً كاملاً في من يحصل على وصول للمنصة.
