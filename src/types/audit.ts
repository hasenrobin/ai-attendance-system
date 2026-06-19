export type AuditLog = {
  id: string
  company_id: string | null
  branch_id: string | null
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  old_values: unknown | null
  new_values: unknown | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}
