export type SubscriptionPlan = {
  id: string
  name: string
  description: string | null
  price: number | null
  max_employees: number | null
  max_branches: number | null
  max_cameras: number | null
  status: string
  created_at: string
  updated_at: string
}

export type PlanLimit = {
  id: string
  plan_id: string
  limit_key: string | null
  max_value: number | null
  name: string | null
  value: number | null
  min_value: number | null
  created_at: string
  updated_at: string
}

export type CompanySubscription = {
  id: string
  company_id: string
  plan_id: string | null
  status: string
  trial_ends_at: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

export type SubscriptionHistory = {
  id: string
  company_id: string
  subscription_id: string | null
  action: string
  old_plan_id: string | null
  new_plan_id: string | null
  old_status: string | null
  new_status: string | null
  changed_by: string | null
  notes: string | null
  created_at: string
}
