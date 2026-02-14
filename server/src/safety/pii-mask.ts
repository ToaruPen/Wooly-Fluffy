const maskLikelyEmail = (text: string): string =>
  text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");

const maskLikelyPhone = (text: string): string =>
  text.replace(/\b0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/g, "[phone]");

export const maskLikelyPii = (text: string): string => {
  const masked = maskLikelyPhone(maskLikelyEmail(text));
  return masked;
};
