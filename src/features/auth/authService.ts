import { supabase } from '../../lib/supabase'

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return { data, error }
}

type SignUpParams = {
  companyName: string
  ownerFullName: string
  email: string
  password: string
}

type SignUpResult =
  | { data: { user: unknown; company: unknown }; error: null; needsEmailConfirmation: false }
  | { data: null; error: { message: string; code?: string }; needsEmailConfirmation: false }
  | { data: null; error: null; needsEmailConfirmation: true }

export async function signUpAndCreateCompany(params: SignUpParams): Promise<SignUpResult> {
  const { companyName, ownerFullName, email, password } = params

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password })

  if (signUpError) {
    return { data: null, error: { message: signUpError.message, code: signUpError.code }, needsEmailConfirmation: false }
  }

  // Supabase returns session: null when "Confirm email" is enabled.
  // In that case auth.uid() inside the RPC would be NULL → raises exception.
  // Never call the RPC without a confirmed session.
  if (!signUpData.session) {
    return { data: null, error: null, needsEmailConfirmation: true }
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('create_company_for_owner', {
    p_company_name: companyName,
    p_owner_full_name: ownerFullName,
  })

  if (rpcError) {
    return {
      data: null,
      error: { message: rpcError.message, code: (rpcError as { code?: string }).code },
      needsEmailConfirmation: false,
    }
  }

  return { data: { user: signUpData.user, company: rpcData }, error: null, needsEmailConfirmation: false }
}
