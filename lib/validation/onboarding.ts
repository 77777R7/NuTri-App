import { z } from 'zod';
import {
  ADHERENCE_BLOCKER_OPTIONS,
  AGE_RANGE_OPTIONS,
  GOAL_OPTIONS,
  SEX_OPTIONS,
  SUPPLEMENT_EXPERIENCE_OPTIONS,
  TYPE_OPTIONS,
} from '@/lib/onboarding-v2';

export const profileSchema = z.object({
  height: z.number().min(120).max(240),
  weight: z.number().min(30).max(200),
  age: z.number().min(13).max(100),
  gender: z.enum(['Male', 'Female', 'Other', 'Prefer not to say']),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

export const GENDER_OPTIONS: ProfileFormValues['gender'][] = ['Male', 'Female', 'Other', 'Prefer not to say'];

export const dietSchema = z.object({
  diets: z.array(z.string()).min(1),
});

export type DietFormValues = z.infer<typeof dietSchema>;

export const activitySchema = z.object({
  activity: z.string().min(1),
});

export type ActivityFormValues = z.infer<typeof activitySchema>;

const locationField = z
  .string()
  .optional()
  .transform(value => {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : undefined;
  });

export const locationSchema = z.object({
  country: locationField,
  city: locationField,
});

export type LocationFormValues = z.infer<typeof locationSchema>;

export const goalsSchema = z.object({
  goals: z.array(z.string()).min(1),
});

export type GoalsFormValues = z.infer<typeof goalsSchema>;

export const ageRangeSchema = z.object({
  ageRange: z.enum(AGE_RANGE_OPTIONS),
});

export type AgeRangeFormValues = z.infer<typeof ageRangeSchema>;

export const sexSchema = z.object({
  sex: z.enum(SEX_OPTIONS),
});

export type SexFormValues = z.infer<typeof sexSchema>;

export const supplementExperienceSchema = z.object({
  supplementExperience: z.enum(SUPPLEMENT_EXPERIENCE_OPTIONS),
});

export type SupplementExperienceFormValues = z.infer<typeof supplementExperienceSchema>;

export const goalsV2Schema = z.object({
  goals: z.array(z.enum(GOAL_OPTIONS)).min(1),
});

export type GoalsV2FormValues = z.infer<typeof goalsV2Schema>;

export const preferredTypesSchema = z.object({
  preferredTypes: z.array(z.enum(TYPE_OPTIONS)).default([]),
});

export type PreferredTypesFormValues = z.infer<typeof preferredTypesSchema>;

export const adherenceBlockerSchema = z.object({
  adherenceBlocker: z.enum(ADHERENCE_BLOCKER_OPTIONS),
});

export type AdherenceBlockerFormValues = z.infer<typeof adherenceBlockerSchema>;

export const permissionPreferencesSchema = z.object({
  camera: z.boolean().default(false),
  notifications: z.boolean().default(false),
  photos: z.boolean().default(false),
});

export type PermissionPreferencesFormValues = z.infer<typeof permissionPreferencesSchema>;

export const privacySchema = z.object({
  agreed: z.literal(true),
  camera: z.boolean().optional(),
  notifications: z.boolean().optional(),
  photos: z.boolean().optional(),
});

export type PrivacyFormValues = z.infer<typeof privacySchema>;
