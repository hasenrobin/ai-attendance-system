import { supabase } from '../../lib/supabase'
import type { Notification } from '../../types/notification'

const NOTIFICATION_COLUMNS =
  'id, company_id, branch_id, user_id, type, title, message, is_read, created_at'

// ── Shared return shapes ───────────────────────────────────────

type NotificationResult     = { data: Notification | null; error: string | null }
type NotificationListResult = { data: Notification[];       error: string | null }
type DeleteResult           = { data: null;                 error: string | null }

// ── Notifications ──────────────────────────────────────────────

export async function getUserNotifications(userId: string): Promise<NotificationListResult> {
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Notification[], error: null }
}

type GetCompanyNotificationsParams = {
  companyId: string
  branchId?: string
  type?: string
  isRead?: boolean
}

export async function getCompanyNotifications(
  params: GetCompanyNotificationsParams,
): Promise<NotificationListResult> {
  let query = supabase
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: false })

  if (params.branchId !== undefined) query = query.eq('branch_id', params.branchId)
  if (params.type !== undefined)     query = query.eq('type', params.type)
  if (params.isRead !== undefined)   query = query.eq('is_read', params.isRead)

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Notification[], error: null }
}

type CreateNotificationParams = {
  type: string
  title: string
  company_id?: string
  branch_id?: string
  user_id?: string
  message?: string
}

export async function createNotification(
  params: CreateNotificationParams,
): Promise<NotificationResult> {
  const { data, error } = await supabase
    .from('notifications')
    .insert({ is_read: false, ...params })
    .select(NOTIFICATION_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Notification, error: null }
}

export async function markNotificationAsRead(
  notificationId: string,
): Promise<NotificationResult> {
  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .select(NOTIFICATION_COLUMNS)
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Notification, error: null }
}

export async function markAllUserNotificationsAsRead(
  userId: string,
): Promise<NotificationListResult> {
  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)
    .select(NOTIFICATION_COLUMNS)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as Notification[], error: null }
}

export async function deleteNotification(notificationId: string): Promise<DeleteResult> {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId)

  if (error) return { data: null, error: error.message }
  return { data: null, error: null }
}
