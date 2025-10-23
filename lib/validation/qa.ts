import { z } from 'zod';

export const demographicsSchema = z.object({
  age: z.number().min(13, 'Age must be at least 13').max(120, 'Age must be less than 120'),
  gender: z.enum(['Male', 'Female', 'Other', 'Prefer not to say'], {
    required_error: 'Please select a gender',
  }),
});

export type DemographicsFormValues = z.infer<typeof demographicsSchema>;

export const physicalStatsSchema = z.object({
  weight: z.number().optional(),
  weightUnit: z.enum(['kg', 'lbs']),
  height: z.number().optional(),
  heightUnit: z.enum(['cm', 'ft']),
});

export type PhysicalStatsFormValues = z.infer<typeof physicalStatsSchema>;

export const healthGoalsSchema = z.object({
  healthGoals: z.array(z.string()).min(1, 'Select at least one health goal'),
});

export type HealthGoalsFormValues = z.infer<typeof healthGoalsSchema>;

export const dietarySchema = z.object({
  dietaryRestrictions: z.array(z.string()),
});

export type DietaryFormValues = z.infer<typeof dietarySchema>;

export const experienceSchema = z.object({
  experienceLevel: z.string().min(1, 'Please select an experience level'),
});

export type ExperienceFormValues = z.infer<typeof experienceSchema>;

export const privacySchema = z.object({
  notifyReminders: z.boolean(),
  notifyEffectiveness: z.boolean(),
  notifyResearch: z.boolean(),
  notifyPriceDrops: z.boolean(),
  notifyInteractions: z.boolean(),
  privacyAnalytics: z.boolean(),
  privacyPersonalization: z.boolean(),
  privacyThirdParty: z.boolean(),
});

export type PrivacyFormValues = z.infer<typeof privacySchema>;

