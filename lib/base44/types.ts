export type Gender = 'male' | 'female' | 'non-binary' | 'prefer-not-to-say';
export type BodyType = 'ectomorph' | 'mesomorph' | 'endomorph' | 'not-sure';
export type HealthGoal =
  | 'weight-loss'
  | 'muscle-gain'
  | 'maintenance'
  | 'energy-boost'
  | 'better-sleep'
  | 'disease-management';
export type Timeline = '1-month' | '3-months' | '6-months' | '1-year' | 'no-rush';
export type DietaryPreference = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'keto' | 'paleo' | 'other';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced' | 'athlete';
export type CookingSkill = 'novice' | 'basic' | 'intermediate' | 'expert';

export type UserProfile = {
  id: string;
  age?: number;
  gender?: Gender | string;
  heightCm?: number;
  weightKg?: number;
  bodyType?: BodyType;
  goals?: string[];
  dietaryPreferences?: string[];
  dietaryRestrictions?: string[];
  fitnessLevel?: FitnessLevel;
  cookingSkills?: CookingSkill;
  activityLevel?: string;
  locationCountry?: string;
  locationCity?: string;
  onboardingCompleted?: boolean;
  updatedAt?: string;
  createdAt?: string;
  targetWeightKg?: number | null;
  user_email?: string;
  completed_steps?: number;
  location?: string;
  height_cm?: number;
  weight_kg?: number;
  body_type?: BodyType;
  health_goals?: HealthGoal[];
  target_weight_kg?: number | null;
  timeline?: Timeline;
  dietary_preference?: DietaryPreference;
  dietary_restrictions?: string[];
  allergies?: string[];
  fitness_level?: FitnessLevel;
  cooking_skills?: CookingSkill;
  consent_data_collection?: boolean;
  consent_notifications?: boolean;
  consent_third_party?: boolean;
};
