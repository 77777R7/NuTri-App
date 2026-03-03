import { isNutritionLabelLikeIngredientName } from "@/shared/scan/nutritionLabelLikeLexicon";

export const isNutritionLabelLikeIngredient = (name?: string | null): boolean => {
  return isNutritionLabelLikeIngredientName(name);
};
