export function excludeReviewCode(codes: string[], code: string): string[] {
  return codes.includes(code) ? codes : [...codes, code];
}

export function restoreReviewCode(codes: string[], code: string): string[] {
  return codes.filter((candidate) => candidate !== code);
}
