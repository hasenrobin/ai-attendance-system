export type BranchScopeContext = {
  currentBranch: { id: string } | null
  isCompanyWide: boolean
  allowedBranchIds: string[]
}

/**
 * Whether an item belonging to `branchId` should be visible given the current
 * branch scope. Used for entities that always belong to exactly one branch
 * (employees, departments, leaves, cameras, etc).
 *
 * - If a specific branch is selected, only items in that branch match.
 * - Otherwise (no branch selected): company-wide users see everything,
 *   branch-scoped users see only items in one of their allowed branches.
 */
export function isBranchInScope(branchId: string | null, scope: BranchScopeContext): boolean {
  if (scope.currentBranch) return branchId === scope.currentBranch.id
  if (scope.isCompanyWide) return true
  return branchId !== null && scope.allowedBranchIds.includes(branchId)
}

/**
 * Like `isBranchInScope`, but for entities where `branch_id === null` means
 * "applies company-wide" (e.g. payroll periods, security events). Company-wide
 * items remain visible to company-wide users (preserving existing behavior)
 * but are hidden from branch-scoped users.
 */
export function isBranchOrGlobalInScope(branchId: string | null, scope: BranchScopeContext): boolean {
  if (branchId === null) return scope.isCompanyWide
  return isBranchInScope(branchId, scope)
}
