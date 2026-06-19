export type EmployeeTransfer = {
  id: string
  company_id: string
  employee_id: string
  from_branch_id: string | null
  to_branch_id: string
  transferred_by: string | null
  transfer_date: string
  reason: string | null
  created_at: string
}
