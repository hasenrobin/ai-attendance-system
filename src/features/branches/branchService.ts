import { supabase } from '../../lib/supabase'
import type { Branch } from '../../types/company'

type BranchResult = {
  data: Branch | null
  error: string | null
}

type BranchListResult = {
  data: Branch[]
  error: string | null
}

export async function getBranches(companyId: string): Promise<BranchListResult> {
  const { data, error } = await supabase
    .from('branches')
    .select('id, company_id, name, address, phone, status, created_at, updated_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Branch[], error: null }
}

type CreateBranchParams = {
  company_id: string
  name: string
  address?: string
  phone?: string
}

export async function createBranch(params: CreateBranchParams): Promise<BranchResult> {
  const { data, error } = await supabase
    .from('branches')
    .insert({ ...params, status: 'active' })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Branch, error: null }
}

type UpdateBranchParams = Partial<Pick<Branch, 'name' | 'address' | 'phone' | 'status'>>

export async function updateBranch(
  branchId: string,
  updates: UpdateBranchParams,
): Promise<BranchResult> {
  const { data, error } = await supabase
    .from('branches')
    .update(updates)
    .eq('id', branchId)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Branch, error: null }
}

export async function deactivateBranch(branchId: string): Promise<BranchResult> {
  const { data, error } = await supabase
    .from('branches')
    .update({ status: 'inactive' })
    .eq('id', branchId)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Branch, error: null }
}
