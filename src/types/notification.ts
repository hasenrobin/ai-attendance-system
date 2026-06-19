export type Notification = {
  id: string
  company_id: string | null
  branch_id: string | null
  user_id: string | null
  type: string
  title: string
  message: string | null
  is_read: boolean
  created_at: string
}
