export const ROUTES = {
  CREATE_COMPANY: '/create-company',
  LOGIN: '/login',
  APP_HOME: '/app',
  ADMIN_HOME: '/admin',
} as const

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES]
