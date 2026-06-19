import { supabase } from '../../lib/supabase'
import type { AuditLog } from '../../types/audit'

const AUDIT_COLUMNS =
  'id, company_id, branch_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, created_at'

// ── Shared return shapes ───────────────────────────────────────

type AuditLogResult     = { data: AuditLog | null; error: string | null }
type AuditLogListResult = { data: AuditLog[];       error: string | null }

// ── Audit Logs ─────────────────────────────────────────────────

type GetAuditLogsParams = {
  companyId: string
  branchId?: string
  userId?: string
  entityType?: string
  entityId?: string
  action?: string
  dateFrom?: string
  dateTo?: string
}

export async function getAuditLogs(params: GetAuditLogsParams): Promise<AuditLogListResult> {
  let query = supabase
    .from('audit_logs')
    .select(AUDIT_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.branchId)    query = query.eq('branch_id', params.branchId)
  if (params.userId)      query = query.eq('user_id', params.userId)
  if (params.entityType)  query = query.eq('entity_type', params.entityType)
  if (params.entityId)    query = query.eq('entity_id', params.entityId)
  if (params.action)      query = query.eq('action', params.action)
  if (params.dateFrom)    query = query.gte('created_at', params.dateFrom)
  if (params.dateTo)      query = query.lte('created_at', params.dateTo)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as AuditLog[], error: null }
}

type CreateAuditLogParams = {
  action: string
  entity_type: string
  company_id?: string
  branch_id?: string
  user_id?: string
  entity_id?: string
  old_values?: unknown
  new_values?: unknown
  ip_address?: string
  user_agent?: string
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<AuditLogResult> {
  const { data, error } = await supabase
    .from('audit_logs')
    .insert(params)
    .select(AUDIT_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as AuditLog, error: null }
}
