// ============================================================================
// POST /camera-cloud-adapter
//
// "Final Cloud Camera Integration Phase" -- vendor-agnostic dispatcher for
// the EZVIZ / IMOU / Hikvision / Dahua cloud adapters (./adapters/*).
//
// Actions (JSON body, all require company_id matching the caller's company):
//   - save_credentials  { vendor: 'ezviz'|'imou', app_key, app_secret }
//       Requires cameras.manage. Upserts camera_cloud_accounts, then calls
//       adapter.connect() to validate the credentials immediately.
//   - validate_device   { camera_id, vendor, device_id }
//       Requires cameras.manage (called when saving a camera's connection
//       settings). Confirms the device exists in the vendor cloud account
//       and reports online/offline.
//   - get_live_stream   { camera_id, vendor, device_id }
//       Requires cameras.view or cameras.manage. Returns a freshly-fetched
//       HLS URL -- never persisted (EZVIZ/IMOU stream URLs embed short-lived
//       tokens).
//   - health_check      { camera_id, vendor, device_id }
//       Requires cameras.view or cameras.manage. Lightweight online/offline
//       check used by useCameraHealthMonitor.
//
// Auth model:
//   - The caller's Supabase session JWT (Authorization header) is forwarded
//     to an anon-key client so current_user_company_id() /
//     current_user_has_permission() (which rely on auth.uid()) resolve
//     correctly via PostgREST RPC.
//   - A service-role client performs all camera_cloud_accounts /cameras
//     reads/writes, bypassing RLS by design (mirrors attendance-ingest) --
//     this is the only place app_key/app_secret/access_token are ever read.
//
// Security: app_key, app_secret, access_token, and token_expires_at never
// appear in any response body. Responses only ever contain status strings,
// error messages, device metadata, and (for get_live_stream) a short-lived
// stream URL.
// ============================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { ezvizAdapter } from './adapters/ezvizAdapter.ts'
import { imouAdapter } from './adapters/imouAdapter.ts'
import { hikvisionAdapter } from './adapters/hikvisionAdapter.ts'
import { dahuaAdapter } from './adapters/dahuaAdapter.ts'
import type { AdapterStatus, CloudAccount, CloudAdapter, CloudVendor } from './adapters/types.ts'

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

const ADAPTERS: Record<CloudVendor, CloudAdapter> = {
  ezviz: ezvizAdapter,
  imou: imouAdapter,
  hikvision: hikvisionAdapter,
  dahua: dahuaAdapter,
}

// EZVIZ/IMOU AppKey+AppSecret never expire; only the access token does.
// Re-authenticate slightly before the cached token actually expires.
const TOKEN_REFRESH_SAFETY_MARGIN_MS = 5 * 60_000

const CLOUD_VENDORS: CloudVendor[] = ['ezviz', 'imou', 'hikvision', 'dahua']

function isCloudVendor(value: unknown): value is CloudVendor {
  return typeof value === 'string' && (CLOUD_VENDORS as string[]).includes(value)
}

type RequestPayload = {
  action?: string
  company_id?: string
  vendor?: string
  camera_id?: string
  device_id?: string
  app_key?: string
  app_secret?: string
}

type CameraRow = {
  id: string
  company_id: string
  connection_mode: string | null
  vendor: string | null
  cloud_device_id: string | null
}

// ── Shared helpers ──────────────────────────────────────────────────────

async function loadCamera(adminClient: SupabaseClient, companyId: string, cameraId: string): Promise<CameraRow | null> {
  const { data, error } = await adminClient
    .from('cameras')
    .select('id, company_id, connection_mode, vendor, cloud_device_id')
    .eq('id', cameraId)
    .maybeSingle()

  if (error || !data || data.company_id !== companyId) return null
  return data as CameraRow
}

async function loadAccount(adminClient: SupabaseClient, companyId: string, vendor: CloudVendor): Promise<CloudAccount> {
  const empty: CloudAccount = {
    id: null,
    company_id: companyId,
    vendor,
    app_key: null,
    app_secret: null,
    access_token: null,
    token_expires_at: null,
  }

  // hikvision/dahua never have a camera_cloud_accounts row (CHECK constraint
  // only allows ezviz/imou) -- adapters for these vendors ignore the account.
  if (vendor === 'hikvision' || vendor === 'dahua') return empty

  const { data } = await adminClient
    .from('camera_cloud_accounts')
    .select('id, company_id, vendor, app_key, app_secret, access_token, token_expires_at')
    .eq('company_id', companyId)
    .eq('vendor', vendor)
    .maybeSingle()

  if (!data) return empty
  return data as CloudAccount
}

async function persistAccountStatus(
  adminClient: SupabaseClient,
  account: CloudAccount,
  status: 'token_valid' | 'token_invalid' | 'not_configured',
  accessToken: string | null,
  tokenExpiresAt: string | null,
  lastError: string | null,
): Promise<void> {
  if (!account.id) return // hikvision/dahua synthetic accounts have no row

  await adminClient
    .from('camera_cloud_accounts')
    .update({
      status,
      access_token: accessToken,
      token_expires_at: tokenExpiresAt,
      last_error: lastError,
      last_validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id)
}

type EnsureTokenResult = { ok: true; account: CloudAccount } | { ok: false; status: AdapterStatus; error: string }

// Ensures account.access_token is present and not close to expiry, calling
// adapter.connect() (and persisting the result) if needed.
async function ensureToken(adminClient: SupabaseClient, adapter: CloudAdapter, account: CloudAccount): Promise<EnsureTokenResult> {
  if (!account.app_key || !account.app_secret) {
    return {
      ok: false,
      status: 'credentials_required',
      error: `${account.vendor.toUpperCase()} credentials are not configured for this company. Open Cloud Camera Integrations and save an AppKey/AppSecret.`,
    }
  }

  const expiresAtMs = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0
  if (account.access_token && expiresAtMs - Date.now() > TOKEN_REFRESH_SAFETY_MARGIN_MS) {
    return { ok: true, account }
  }

  const connectResult = await adapter.connect(account)
  if (!connectResult.ok) {
    await persistAccountStatus(adminClient, account, connectResult.status === 'credentials_required' ? 'not_configured' : 'token_invalid', null, null, connectResult.error)
    return { ok: false, status: connectResult.status, error: connectResult.error }
  }

  await persistAccountStatus(adminClient, account, 'token_valid', connectResult.accessToken, connectResult.tokenExpiresAt, null)
  return {
    ok: true,
    account: { ...account, access_token: connectResult.accessToken, token_expires_at: connectResult.tokenExpiresAt },
  }
}

// ── Action handlers ────────────────────────────────────────────────────

async function handleSaveCredentials(adminClient: SupabaseClient, payload: RequestPayload): Promise<Response> {
  const { company_id, vendor, app_key, app_secret } = payload

  if (vendor !== 'ezviz' && vendor !== 'imou') {
    return jsonResponse({ error: 'vendor must be "ezviz" or "imou". Hikvision/Dahua are Partner Access Required and have no credential storage.' }, 400)
  }
  if (!app_key?.trim() || !app_secret?.trim()) {
    return jsonResponse({ error: 'app_key and app_secret are required.' }, 400)
  }

  const { data: existing } = await adminClient
    .from('camera_cloud_accounts')
    .select('id')
    .eq('company_id', company_id!)
    .eq('vendor', vendor)
    .maybeSingle()

  const baseRow = {
    company_id,
    vendor,
    app_key: app_key.trim(),
    app_secret: app_secret.trim(),
    access_token: null,
    token_expires_at: null,
    status: 'credentials_saved',
    last_error: null,
    last_validated_at: null,
    updated_at: new Date().toISOString(),
  }

  let accountId: string
  if (existing) {
    accountId = existing.id as string
    const { error } = await adminClient.from('camera_cloud_accounts').update(baseRow).eq('id', accountId)
    if (error) return jsonResponse({ error: `Failed to save credentials: ${error.message}` }, 500)
  } else {
    const { data: inserted, error } = await adminClient.from('camera_cloud_accounts').insert(baseRow).select('id').single()
    if (error || !inserted) return jsonResponse({ error: `Failed to save credentials: ${error?.message ?? 'unknown error'}` }, 500)
    accountId = inserted.id as string
  }

  const account: CloudAccount = {
    id: accountId,
    company_id: company_id!,
    vendor,
    app_key: baseRow.app_key,
    app_secret: baseRow.app_secret,
    access_token: null,
    token_expires_at: null,
  }

  const connectResult = await ADAPTERS[vendor].connect(account)

  if (connectResult.ok) {
    await persistAccountStatus(adminClient, account, 'token_valid', connectResult.accessToken, connectResult.tokenExpiresAt, null)
    return jsonResponse({ ok: true, status: 'token_valid', error: null })
  }

  const persistedStatus = connectResult.status === 'credentials_required' ? 'not_configured' : 'token_invalid'
  await persistAccountStatus(adminClient, account, persistedStatus, null, null, connectResult.error)
  return jsonResponse({ ok: false, status: connectResult.status, error: connectResult.error })
}

async function handleValidateDevice(adminClient: SupabaseClient, payload: RequestPayload): Promise<Response> {
  const { company_id, camera_id, vendor, device_id } = payload
  if (!camera_id || !isCloudVendor(vendor) || !device_id) {
    return jsonResponse({ error: 'camera_id, vendor, and device_id are required.' }, 400)
  }

  const camera = await loadCamera(adminClient, company_id!, camera_id)
  if (!camera) return jsonResponse({ error: 'Camera not found for this company.' }, 404)

  const adapter = ADAPTERS[vendor]
  const account = await loadAccount(adminClient, company_id!, vendor)

  if (vendor === 'hikvision' || vendor === 'dahua') {
    return jsonResponse(await adapter.validateDevice(account, device_id))
  }

  const ensured = await ensureToken(adminClient, adapter, account)
  if (!ensured.ok) return jsonResponse({ ok: false, status: ensured.status, error: ensured.error })

  const result = await adapter.validateDevice(ensured.account, device_id)
  if (!result.ok && result.status === 'token_invalid') {
    await persistAccountStatus(adminClient, ensured.account, 'token_invalid', null, null, result.error)
  }
  return jsonResponse(result)
}

async function handleGetLiveStream(adminClient: SupabaseClient, payload: RequestPayload): Promise<Response> {
  const { company_id, camera_id, vendor, device_id } = payload
  if (!camera_id || !isCloudVendor(vendor) || !device_id) {
    return jsonResponse({ error: 'camera_id, vendor, and device_id are required.' }, 400)
  }

  const camera = await loadCamera(adminClient, company_id!, camera_id)
  if (!camera) return jsonResponse({ error: 'Camera not found for this company.' }, 404)

  const adapter = ADAPTERS[vendor]
  const account = await loadAccount(adminClient, company_id!, vendor)

  if (vendor === 'hikvision' || vendor === 'dahua') {
    return jsonResponse(await adapter.getLiveStream(account, device_id))
  }

  const ensured = await ensureToken(adminClient, adapter, account)
  if (!ensured.ok) return jsonResponse({ ok: false, status: ensured.status, error: ensured.error })

  const result = await adapter.getLiveStream(ensured.account, device_id)
  if (!result.ok && result.status === 'token_invalid') {
    await persistAccountStatus(adminClient, ensured.account, 'token_invalid', null, null, result.error)
  }
  return jsonResponse(result)
}

async function handleHealthCheck(adminClient: SupabaseClient, payload: RequestPayload): Promise<Response> {
  const { company_id, camera_id, vendor, device_id } = payload
  if (!camera_id || !isCloudVendor(vendor) || !device_id) {
    return jsonResponse({ error: 'camera_id, vendor, and device_id are required.' }, 400)
  }

  const camera = await loadCamera(adminClient, company_id!, camera_id)
  if (!camera) return jsonResponse({ error: 'Camera not found for this company.' }, 404)

  const adapter = ADAPTERS[vendor]
  const account = await loadAccount(adminClient, company_id!, vendor)

  if (vendor === 'hikvision' || vendor === 'dahua') {
    return jsonResponse(await adapter.healthCheck(account, device_id))
  }

  const ensured = await ensureToken(adminClient, adapter, account)
  if (!ensured.ok) return jsonResponse({ ok: false, status: ensured.status, error: ensured.error })

  const result = await adapter.healthCheck(ensured.account, device_id)
  if (!result.ok && result.status === 'token_invalid') {
    await persistAccountStatus(adminClient, ensured.account, 'token_invalid', null, null, result.error)
  }
  return jsonResponse(result)
}

// ── Dispatcher ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405)
  }

  let payload: RequestPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const { action, company_id } = payload
  if (!action || !company_id) {
    return jsonResponse({ error: 'action and company_id are required.' }, 400)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Forwards the caller's JWT so current_user_company_id() /
  // current_user_has_permission() (auth.uid()-based) resolve via PostgREST.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  // Service-role client: the only place app_key/app_secret/access_token are
  // ever read or written. RLS bypass by design (mirrors attendance-ingest).
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Invalid or expired session.' }, 401)
  }

  const { data: callerCompanyId, error: companyError } = await userClient.rpc('current_user_company_id')
  if (companyError || !callerCompanyId) {
    return jsonResponse({ error: 'Failed to resolve the authenticated user\'s company.' }, 403)
  }
  if (callerCompanyId !== company_id) {
    return jsonResponse({ error: 'company_id does not match the authenticated user\'s company.' }, 403)
  }

  if (action === 'save_credentials') {
    const { data: canManage } = await userClient.rpc('current_user_has_permission', { p_permission_key: 'cameras.manage' })
    if (!canManage) return jsonResponse({ error: 'Permission denied: cameras.manage is required.' }, 403)
    return handleSaveCredentials(adminClient, payload)
  }

  const [{ data: canView }, { data: canManage }] = await Promise.all([
    userClient.rpc('current_user_has_permission', { p_permission_key: 'cameras.view' }),
    userClient.rpc('current_user_has_permission', { p_permission_key: 'cameras.manage' }),
  ])
  if (!canView && !canManage) {
    return jsonResponse({ error: 'Permission denied: cameras.view is required.' }, 403)
  }

  switch (action) {
    case 'validate_device':
      return handleValidateDevice(adminClient, payload)
    case 'get_live_stream':
      return handleGetLiveStream(adminClient, payload)
    case 'health_check':
      return handleHealthCheck(adminClient, payload)
    default:
      return jsonResponse({ error: `Unknown action "${action}".` }, 400)
  }
})
