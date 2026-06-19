import { supabase } from '../../lib/supabase'
import type { AppUserProfile } from '../../types/auth'
import type { Company, CompanySettings } from '../../types/company'

type GetCurrentUserCompanyResult = {
  profile: AppUserProfile | null
  company: Company | null
  settings: CompanySettings | null
  error: string | null
}

export async function getCurrentUserCompany(userId: string): Promise<GetCurrentUserCompanyResult> {
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, company_id, employee_id, full_name, email, status, is_platform_admin')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    return { profile: null, company: null, settings: null, error: profileError?.message ?? 'Profile not found.' }
  }

  if (!profile.company_id) {
    return { profile: profile as AppUserProfile, company: null, settings: null, error: null }
  }

  const [{ data: company, error: companyError }, { data: settings, error: settingsError }] =
    await Promise.all([
      supabase
        .from('companies')
        .select('id, name, status, subscription_status, created_at, updated_at')
        .eq('id', profile.company_id)
        .single(),
      supabase
        .from('company_settings')
        .select('id, company_id, timezone, currency, language, attendance_mode, security_mode, allow_multi_branch_attendance, allow_emergency_mode, require_owner_approval_for_emergency, default_grace_minutes, default_paid_temporary_leave_minutes, created_at, updated_at')
        .eq('company_id', profile.company_id)
        .single(),
    ])

  if (companyError) {
    return { profile: profile as AppUserProfile, company: null, settings: null, error: companyError.message }
  }

  return {
    profile: profile as AppUserProfile,
    company: company as Company,
    settings: settingsError ? null : (settings as CompanySettings),
    error: null,
  }
}

type UpdatableSettings = Partial<Pick<CompanySettings,
  | 'timezone'
  | 'currency'
  | 'language'
  | 'attendance_mode'
  | 'security_mode'
  | 'allow_multi_branch_attendance'
  | 'allow_emergency_mode'
  | 'require_owner_approval_for_emergency'
  | 'default_grace_minutes'
  | 'default_paid_temporary_leave_minutes'
>>

type UpdateSettingsResult = {
  data: CompanySettings | null
  error: string | null
}

export async function updateCompanySettings(
  companyId: string,
  updates: UpdatableSettings,
): Promise<UpdateSettingsResult> {
  const { data, error } = await supabase
    .from('company_settings')
    .update(updates)
    .eq('company_id', companyId)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as CompanySettings, error: null }
}

type UpdateCompanyParams = Partial<Pick<Company, 'name'>>

type UpdateCompanyResult = {
  data: Company | null
  error: string | null
}

export async function updateCompany(
  companyId: string,
  updates: UpdateCompanyParams,
): Promise<UpdateCompanyResult> {
  const { data, error } = await supabase
    .from('companies')
    .update(updates)
    .eq('id', companyId)
    .select('id, name, status, subscription_status, created_at, updated_at')
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Company, error: null }
}
