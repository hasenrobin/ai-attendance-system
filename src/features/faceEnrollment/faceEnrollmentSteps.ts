// Ordered guided-capture steps for the Face Enrollment wizard, and the
// approval thresholds that define "the system's decision".

import type { EnrollmentStepId, PoseId } from '../../types/faceEnrollment'

export type EnrollmentStepDefinition = {
  id: EnrollmentStepId
  /** i18n key for the short instruction shown above the camera. */
  titleKey: string
  /** i18n key for the longer helper text. */
  detailKey: string
  /** How long (ms) the condition must hold continuously before auto-advancing. */
  holdMs: number
}

export const ENROLLMENT_STEPS: EnrollmentStepDefinition[] = [
  { id: 'center', titleKey: 'faceEnrollment.step.center.title', detailKey: 'faceEnrollment.step.center.detail', holdMs: 700 },
  { id: 'right', titleKey: 'faceEnrollment.step.right.title', detailKey: 'faceEnrollment.step.right.detail', holdMs: 500 },
  { id: 'left', titleKey: 'faceEnrollment.step.left.title', detailKey: 'faceEnrollment.step.left.detail', holdMs: 500 },
  { id: 'up', titleKey: 'faceEnrollment.step.up.title', detailKey: 'faceEnrollment.step.up.detail', holdMs: 500 },
  { id: 'down', titleKey: 'faceEnrollment.step.down.title', detailKey: 'faceEnrollment.step.down.detail', holdMs: 500 },
  { id: 'blink', titleKey: 'faceEnrollment.step.blink.title', detailKey: 'faceEnrollment.step.blink.detail', holdMs: 0 },
  { id: 'profile-photo', titleKey: 'faceEnrollment.step.profilePhoto.title', detailKey: 'faceEnrollment.step.profilePhoto.detail', holdMs: 500 },
]

export const POSE_STEP_IDS: PoseId[] = ['center', 'right', 'left', 'up', 'down']

export function isPoseStep(id: EnrollmentStepId): id is PoseId {
  return (POSE_STEP_IDS as string[]).includes(id)
}

/**
 * The single place where "the system's decision" is defined. An enrollment
 * session is approved only if BOTH thresholds are met — owners/admins cannot
 * override this.
 */
export const APPROVAL_THRESHOLDS = {
  minQualityScore: 60,
  minLivenessScore: 60,
}
