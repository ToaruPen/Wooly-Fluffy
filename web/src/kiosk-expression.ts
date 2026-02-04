import type { ExpressionLabel } from "./components/VrmAvatar";

export const parseExpressionLabel = (value: unknown): ExpressionLabel => {
  if (value === "neutral" || value === "happy" || value === "sad" || value === "surprised") {
    return value;
  }
  return "neutral";
};
