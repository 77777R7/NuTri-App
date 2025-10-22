import { z } from 'zod';

export const profileSchema = z.object({
  height: z.number().min(120).max(250),
  weight: z.number().min(30).max(300),
  age: z.number().min(13).max(120),
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
  goals: z.array(z.string()).min(1).max(3),
});

export type GoalsFormValues = z.infer<typeof goalsSchema>;

export const privacySchema = z.object({
  agreed: z.literal(true),
  camera: z.boolean().optional(),
  notifications: z.boolean().optional(),
  photos: z.boolean().optional(),
});

export type PrivacyFormValues = z.infer<typeof privacySchema>;
