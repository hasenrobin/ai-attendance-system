import { supabase } from '../../lib/supabase'
import type {
  SubscriptionPlan,
  PlanLimit,
  CompanySubscription,
  SubscriptionHistory,
} from '../../types/subscription'

const PLAN_COLUMNS =
  'id, name, description, price, max_employees, max_branches, max_cameras, status, created_at, updated_at'

const PLAN_LIMIT_COLUMNS =
  'id, plan_id, limit_key, max_value, name, value, min_value, created_at, updated_at'

const SUBSCRIPTION_COLUMNS =
  'id, company_id, plan_id, status, trial_ends_at, start_date, end_date, created_at, updated_at'

const HISTORY_COLUMNS =
  'id, company_id, subscription_id, action, old_plan_id, new_plan_id, old_status, new_status, changed_by, notes, created_at'

// ── Shared return shapes ───────────────────────────────────────

type PlanResult         = { data: SubscriptionPlan | null;    error: string | null }
type PlanListResult     = { data: SubscriptionPlan[];          error: string | null }
type LimitListResult    = { data: PlanLimit[];                 error: string | null }
type SubResult          = { data: CompanySubscription | null; error: string | null }
type HistoryResult      = { data: SubscriptionHistory | null; error: string | null }
type HistoryListResult  = { data: SubscriptionHistory[];       error: string | null }

// ── Subscription Plans ─────────────────────────────────────────

export async function getSubscriptionPlans(): Promise<PlanListResult> {
  const { data, error } = await supabase
    .from('subscription_plans')
    .select(PLAN_COLUMNS)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as SubscriptionPlan[], error: null }
}

export async function getSubscriptionPlan(planId: string): Promise<PlanResult> {
  const { data, error } = await supabase
    .from('subscription_plans')
    .select(PLAN_COLUMNS)
    .eq('id', planId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as SubscriptionPlan, error: null }
}

// ── Plan Limits ────────────────────────────────────────────────

export async function getPlanLimits(planId: string): Promise<LimitListResult> {
  const { data, error } = await supabase
    .from('plan_limits')
    .select(PLAN_LIMIT_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as PlanLimit[], error: null }
}

// ── Company Subscriptions ──────────────────────────────────────

export async function getCompanySubscription(companyId: string): Promise<SubResult> {
  const { data, error } = await supabase
    .from('company_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('company_id', companyId)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanySubscription, error: null }
}

type CreateCompanySubscriptionParams = {
  company_id: string
  status: string
  plan_id?: string
  trial_ends_at?: string
  start_date?: string
  end_date?: string
}

export async function createCompanySubscription(
  params: CreateCompanySubscriptionParams,
): Promise<SubResult> {
  const { data, error } = await supabase
    .from('company_subscriptions')
    .insert(params)
    .select(SUBSCRIPTION_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanySubscription, error: null }
}

type UpdateCompanySubscriptionParams = Partial<Pick<CompanySubscription,
  | 'plan_id'
  | 'status'
  | 'trial_ends_at'
  | 'start_date'
  | 'end_date'
>>

export async function updateCompanySubscription(
  subscriptionId: string,
  updates: UpdateCompanySubscriptionParams,
): Promise<SubResult> {
  const { data, error } = await supabase
    .from('company_subscriptions')
    .update(updates)
    .eq('id', subscriptionId)
    .select(SUBSCRIPTION_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanySubscription, error: null }
}

// ── Subscription History ───────────────────────────────────────

export async function getSubscriptionHistory(companyId: string): Promise<HistoryListResult> {
  const { data, error } = await supabase
    .from('subscription_history')
    .select(HISTORY_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as SubscriptionHistory[], error: null }
}

type CreateSubscriptionHistoryParams = {
  company_id: string
  action: string
  subscription_id?: string
  old_plan_id?: string
  new_plan_id?: string
  old_status?: string
  new_status?: string
  changed_by?: string
  notes?: string
}

export async function createSubscriptionHistory(
  params: CreateSubscriptionHistoryParams,
): Promise<HistoryResult> {
  const { data, error } = await supabase
    .from('subscription_history')
    .insert(params)
    .select(HISTORY_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as SubscriptionHistory, error: null }
}
