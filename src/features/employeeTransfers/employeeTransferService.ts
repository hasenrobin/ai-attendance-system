import { supabase } from '../../lib/supabase'
import type { EmployeeTransfer } from '../../types/employeeTransfer'

const TRANSFER_COLUMNS =
  'id, company_id, employee_id, from_branch_id, to_branch_id, transferred_by, transfer_date, reason, created_at'

// ── Shared return shapes ───────────────────────────────────────

type TransferResult     = { data: EmployeeTransfer | null; error: string | null }
type TransferListResult = { data: EmployeeTransfer[];       error: string | null }

// ── Employee Transfer History ──────────────────────────────────

export async function getEmployeeTransferHistory(
  employeeId: string,
): Promise<TransferListResult> {
  const { data, error } = await supabase
    .from('employee_transfer_history')
    .select(TRANSFER_COLUMNS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as EmployeeTransfer[], error: null }
}

export async function getCompanyTransferHistory(
  companyId: string,
): Promise<TransferListResult> {
  const { data, error } = await supabase
    .from('employee_transfer_history')
    .select(TRANSFER_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as EmployeeTransfer[], error: null }
}

type CreateEmployeeTransferParams = {
  company_id: string
  employee_id: string
  to_branch_id: string
  from_branch_id?: string
  transferred_by?: string
  transfer_date?: string
  reason?: string
}

export async function createEmployeeTransfer(
  params: CreateEmployeeTransferParams,
): Promise<TransferResult> {
  const { data, error } = await supabase
    .from('employee_transfer_history')
    .insert(params)
    .select(TRANSFER_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as EmployeeTransfer, error: null }
}
