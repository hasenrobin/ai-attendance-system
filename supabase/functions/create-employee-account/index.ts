// ============================================================================
// POST /create-employee-account
//
// Creates a full employee record with a login-ready Supabase Auth account.
// Combines: employees row + auth user + user_profiles row + user_roles row.
//
// Auth model:
//   - Caller must be authenticated (JWT via Authorization header).
//   - Caller must belong to the target company_id.
//   - Caller must hold employees.create + roles.manage permissions.
//   - Owner accounts cannot be created through this flow (role_name is
//     validated against ALLOWED_ROLE_NAMES).
//
// Username model:
//   - username is unique per company (enforced by DB unique index).
//   - username is normalized: lowercased, trimmed, only [a-z0-9_.\-] allowed.
//   - Supabase Auth requires an email, so the internal email is derived:
//       <username>@attendance.local
//   - Login page converts bare usernames to this format before signIn.
//
// Cleanup on partial failure:
//   - If auth user creation succeeds but user_profiles/user_roles fails,
//     the auth user and employee row are deleted before returning an error.
//   - If employee creation fails, nothing else was written — no cleanup needed.
//
// Security:
//   - Service-role key is only used inside this Edge Function, never exposed
//     to the browser.
//   - Permission checks use the caller's JWT via the anon-key client,
//     ensuring current_user_has_permission() resolves via RLS helpers.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Roles that can be assigned via the Add Employee flow.
// 'Owner' is intentionally excluded to prevent privilege escalation.
const ALLOWED_ROLE_NAMES = ['Employee', 'HR', 'Branch Manager']

// Default permissions seeded for each role when auto-creating it.
// Mirrors the permission sets from PRODUCTION_FIX_EXECUTION_REPORT.md Phase 3.
const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  'Employee': [
    'employee.view_own_profile',
    'employee.view_own_attendance',
    'employee.view_own_payroll_summary',
    'employee.request_leave',
    'employee.request_correction',
    'employee.enroll_face',
  ],
  'HR': [
    'employees.view', 'employees.create', 'employees.edit',
    'departments.view', 'branches.view', 'shifts.view',
    'leaves.view', 'leaves.approve', 'leaves.reject',
    'attendance.view', 'attendance.edit',
    'attendance_corrections.view', 'attendance_corrections.approve', 'attendance_corrections.reject',
    'manual_attendance_requests.view', 'manual_attendance_requests.approve', 'manual_attendance_requests.reject',
    'reports.view', 'payroll.view', 'payroll.create',
    'exit_requests.view', 'exit_requests.approve',
  ],
  'Branch Manager': [
    'employees.view', 'employees.edit',
    'departments.view', 'branches.view', 'shifts.view',
    'leaves.view', 'leaves.approve', 'leaves.reject',
    'attendance.view', 'attendance.edit',
    'attendance_corrections.view', 'attendance_corrections.approve', 'attendance_corrections.reject',
    'manual_attendance_requests.view', 'manual_attendance_requests.approve', 'manual_attendance_requests.reject',
    'reports.view', 'cameras.view', 'security.view',
    'exit_requests.view', 'exit_requests.approve',
  ],
}

// Valid username characters after normalization (lowercase, trimmed).
const USERNAME_REGEX = /^[a-z0-9_.\-]+$/

type RequestBody = {
  company_id?: unknown
  full_name?: unknown
  username?: unknown
  password?: unknown
  role_name?: unknown
  employee_number?: unknown
  department_id?: unknown
  branch_id?: unknown
  position?: unknown
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const {
    company_id,
    full_name,
    username: rawUsername,
    password,
    role_name,
    employee_number,
    department_id,
    branch_id,
    position,
  } = body

  // ── Input validation ──────────────────────────────────────────

  if (!company_id || typeof company_id !== 'string') {
    return jsonResponse({ error: 'company_id is required.' }, 400)
  }
  if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
    return jsonResponse({ error: 'full_name is required.' }, 400)
  }
  if (!rawUsername || typeof rawUsername !== 'string' || !rawUsername.trim()) {
    return jsonResponse({ error: 'username is required.' }, 400)
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return jsonResponse({ error: 'password must be at least 8 characters.' }, 400)
  }
  if (!role_name || typeof role_name !== 'string') {
    return jsonResponse({ error: 'role_name is required.' }, 400)
  }
  if (!ALLOWED_ROLE_NAMES.includes(role_name)) {
    return jsonResponse({
      error: `role_name must be one of: ${ALLOWED_ROLE_NAMES.join(', ')}. 'Owner' cannot be assigned via this flow.`,
    }, 400)
  }

  // Normalize username
  const username = rawUsername.trim().toLowerCase()
  if (!USERNAME_REGEX.test(username)) {
    return jsonResponse({
      error: 'Username may only contain lowercase letters, numbers, underscores, dots, and hyphens.',
    }, 400)
  }

  const internalEmail = `${username}@attendance.local`

  // ── Auth setup ────────────────────────────────────────────────

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // userClient: forwards caller's JWT so RLS helper functions resolve correctly
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  // adminClient: service-role — used only for privileged writes (auth.admin,
  // user_profiles, user_roles) and reads that bypass RLS for safety
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── Caller authentication ─────────────────────────────────────

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Invalid or expired session.' }, 401)
  }

  // ── Caller company check ──────────────────────────────────────

  const { data: callerCompanyId, error: companyError } = await userClient.rpc('current_user_company_id')
  if (companyError || !callerCompanyId) {
    return jsonResponse({ error: 'Failed to resolve caller company.' }, 403)
  }
  if (callerCompanyId !== company_id) {
    return jsonResponse({ error: 'company_id does not match the authenticated user\'s company.' }, 403)
  }

  // ── Permission checks ─────────────────────────────────────────

  const [{ data: canCreate, error: perm1Err }, { data: canManageRoles, error: perm2Err }] =
    await Promise.all([
      userClient.rpc('current_user_has_permission', { p_permission_key: 'employees.create' }),
      userClient.rpc('current_user_has_permission', { p_permission_key: 'roles.manage' }),
    ])

  if (perm1Err || perm2Err) {
    return jsonResponse({ error: 'Failed to verify permissions.' }, 500)
  }
  if (!canCreate) {
    return jsonResponse({ error: 'Permission denied: employees.create is required.' }, 403)
  }
  if (!canManageRoles) {
    return jsonResponse({ error: 'Permission denied: roles.manage is required to assign a role.' }, 403)
  }

  // ── Role lookup — with auto-seed for new companies ───────────
  // New companies created via create_company_for_owner only get an 'Owner'
  // role. HR / Branch Manager / Employee are seeded here on first use so
  // the admin does not need to manually seed them after every company setup.

  const { data: existingRole, error: roleLookupError } = await adminClient
    .from('roles')
    .select('id, name')
    .eq('company_id', company_id)
    .eq('name', role_name)
    .maybeSingle()

  if (roleLookupError) {
    return jsonResponse({ error: `Failed to look up role: ${roleLookupError.message}` }, 500)
  }

  let roleRow: { id: string; name: string } | null = existingRole as { id: string; name: string } | null

  if (!roleRow) {
    // Auto-seed the missing role for this company
    const { data: newRole, error: createRoleError } = await adminClient
      .from('roles')
      .insert({
        company_id,
        name: role_name,
        description: `${role_name} — auto-seeded`,
        is_system_role: true,
      })
      .select('id, name')
      .single()

    if (createRoleError || !newRole) {
      return jsonResponse({
        error: `Role '${role_name}' does not exist and could not be auto-created: ${createRoleError?.message ?? 'unknown'}`,
      }, 500)
    }

    // Assign the standard permissions for this role type
    const permKeys = DEFAULT_ROLE_PERMISSIONS[role_name] ?? []
    if (permKeys.length > 0) {
      const { data: permRows } = await adminClient
        .from('permissions')
        .select('id')
        .in('permission_key', permKeys)

      if (permRows && (permRows as { id: string }[]).length > 0) {
        await adminClient
          .from('role_permissions')
          .insert((permRows as { id: string }[]).map(p => ({
            role_id: (newRole as { id: string }).id,
            permission_id: p.id,
          })))
      }
    }

    roleRow = newRole as { id: string; name: string }
  }

  // ── Username uniqueness check ─────────────────────────────────

  const { data: existingProfile, error: usernameCheckError } = await adminClient
    .from('user_profiles')
    .select('id')
    .eq('company_id', company_id)
    .eq('username', username)
    .maybeSingle()

  if (usernameCheckError) {
    return jsonResponse({ error: `Failed to check username availability: ${usernameCheckError.message}` }, 500)
  }
  if (existingProfile) {
    return jsonResponse({ error: `Username '${username}' is already taken. Choose a different username.` }, 400)
  }

  // ── Branch validation ─────────────────────────────────────────

  const branchIdStr = (branch_id && typeof branch_id === 'string') ? branch_id : null

  if (branchIdStr) {
    const { data: branchRow } = await adminClient
      .from('branches')
      .select('id')
      .eq('id', branchIdStr)
      .eq('company_id', company_id)
      .maybeSingle()

    if (!branchRow) {
      return jsonResponse({ error: 'branch_id does not belong to this company.' }, 400)
    }
  }

  // ── Step 1: Create employee row ───────────────────────────────

  const employeeInsert: Record<string, unknown> = {
    company_id,
    full_name: full_name.trim(),
    status: 'active',
  }
  if (employee_number && typeof employee_number === 'string' && employee_number.trim()) {
    employeeInsert.employee_number = employee_number.trim()
  }
  if (department_id && typeof department_id === 'string') {
    employeeInsert.department_id = department_id
  }
  if (branchIdStr) {
    employeeInsert.branch_id = branchIdStr
  }
  if (position && typeof position === 'string' && position.trim()) {
    employeeInsert.position = position.trim()
  }

  const EMPLOYEE_COLUMNS =
    'id, company_id, branch_id, department_id, employee_number, full_name, position, hourly_rate, overtime_rate, weekly_days_off, daily_required_hours, status, hire_date, created_at, updated_at'

  const { data: newEmployee, error: empError } = await adminClient
    .from('employees')
    .insert(employeeInsert)
    .select(EMPLOYEE_COLUMNS)
    .single()

  if (empError || !newEmployee) {
    return jsonResponse({ error: `Failed to create employee record: ${empError?.message ?? 'unknown error'}` }, 500)
  }

  const employeeId = (newEmployee as { id: string }).id

  // ── Step 2: Create Supabase Auth user ─────────────────────────

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: internalEmail,
    password: password as string,
    email_confirm: true,
  })

  if (authError || !authData?.user) {
    // Cleanup: remove the employee row we just created
    await adminClient.from('employees').delete().eq('id', employeeId)
    return jsonResponse({
      error: `Failed to create login account: ${authError?.message ?? 'unknown error'}`,
    }, 500)
  }

  const newUserId = authData.user.id

  // ── Step 3: Create user_profiles row ─────────────────────────

  const { error: profileError } = await adminClient
    .from('user_profiles')
    .insert({
      id: newUserId,
      company_id,
      employee_id: employeeId,
      full_name: full_name.trim(),
      username,
      email: internalEmail,
      status: 'active',
    })

  if (profileError) {
    // Cleanup: delete auth user and employee row
    await adminClient.auth.admin.deleteUser(newUserId)
    await adminClient.from('employees').delete().eq('id', employeeId)
    return jsonResponse({ error: `Failed to create user profile: ${profileError.message}` }, 500)
  }

  // ── Step 4: Create user_roles row ─────────────────────────────

  const userRoleInsert: Record<string, unknown> = {
    user_id: newUserId,
    role_id: (roleRow as { id: string }).id,
  }

  // Branch scoping rules:
  //   Branch Manager → scoped to their assigned branch
  //   Employee       → scoped to their assigned branch (if any)
  //   HR             → company-wide (branch_id = null)
  if ((role_name === 'Branch Manager' || role_name === 'Employee') && branchIdStr) {
    userRoleInsert.branch_id = branchIdStr
  }

  const { error: rolesError } = await adminClient
    .from('user_roles')
    .insert(userRoleInsert)

  if (rolesError) {
    // Cleanup: delete user_profiles, auth user, and employee row
    await adminClient.from('user_profiles').delete().eq('id', newUserId)
    await adminClient.auth.admin.deleteUser(newUserId)
    await adminClient.from('employees').delete().eq('id', employeeId)
    return jsonResponse({ error: `Failed to assign role: ${rolesError.message}` }, 500)
  }

  // ── Success ───────────────────────────────────────────────────

  return jsonResponse({
    ok: true,
    employee: newEmployee,
    message: `Employee '${full_name.trim()}' created successfully with username '${username}'.`,
  })
})
