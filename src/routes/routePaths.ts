export const ROUTES = {
  CREATE_COMPANY: '/create-company',
  LOGIN: '/login',
  APP_HOME: '/app',
} as const

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES]
