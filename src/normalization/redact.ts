const NON_JOB_TERMS =
  /\b(?:date of birth|born on|marital status|religion|race|ethnicity|political affiliation|medical condition|disability status|salary expectation|expected salary|expected ctc)\b\s*[:=-]?[^\n]*/gi;

const NAME_LIKE_HEADER_EXCLUSIONS =
  /\b(?:resume|curriculum vitae|engineer|developer|designer|manager|analyst|architect|consultant|experience|skills|profile|objective|education|contact)\b/i;

export function redactSensitiveResumeText(text: string): string {
  let output = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[REDACTED_IMAGE]')
    .replace(/<img\b[^>]*>/gi, '[REDACTED_IMAGE]')
    .replace(/^\s*(?:photo|photograph|picture|profile image)\s*[:=-].*$/gim, '[REDACTED_IMAGE]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[^\s)]+/gi, '[REDACTED_PROFILE_URL]')
    .replace(
      /\b(?:dob|date of birth|birth date|age|gender|sex|marital status|religion|race|ethnicity|political affiliation|medical information|disability|home address|street address|address|current location|location|salary expectation|expected salary|expected ctc)\s*[:=-][^\n]*/gi,
      '[REDACTED_PERSONAL_FIELD]',
    )
    .replace(NON_JOB_TERMS, '[REDACTED_PERSONAL_FIELD]');

  output = output.replace(/(?<!\w)\+?\d[\d .()-]{7,}\d(?!\w)/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return match;
    if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(match.trim())) return match;
    return '[REDACTED_PHONE]';
  });

  const lines = output.split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex >= 0) {
    const firstLine = lines[firstContentIndex]?.trim() ?? '';
    const words = firstLine.split(/[\s|,]+/).filter(Boolean);
    const headerLooksLikeName =
      words.length >= 2 &&
      words.length <= 5 &&
      firstLine.length <= 64 &&
      !NAME_LIKE_HEADER_EXCLUSIONS.test(firstLine) &&
      !/[@\d:]/.test(firstLine);
    if (headerLooksLikeName) lines[firstContentIndex] = '[REDACTED_NAME]';
  }

  return lines.join('\n').trim();
}
