import type { ExpressionLabel } from "./components/vrm-avatar";

export const parseExpressionLabel = (value: unknown): ExpressionLabel => {
  if (value === "neutral" || value === "happy" || value === "sad" || value === "surprised") {
    return value;
  }
  return "neutral";
};
