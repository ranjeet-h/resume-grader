import { describe, expect, it } from 'vitest';
import { normalizeJobDescription, normalizeText } from '../../src/normalization/jd.js';
import { redactSensitiveResumeText } from '../../src/normalization/redact.js';
import { normalizeResumeText } from '../../src/normalization/resume.js';

describe('text normalization and redaction', () => {
  it('normalizes Unicode, line endings, invisible marks, and whitespace deterministically', () => {
    expect(normalizeText('  Café\r\n\tRequired\u200B skill\u00A0\n\n\nMust-have  ')).toBe(
      'Café\nRequired skill\n\nMust-have',
    );
  });

  it('preserves job description sections while normalizing text', () => {
    expect(
      normalizeJobDescription({
        id: 'j1',
        description: ' Requirements:\r\n TypeScript  \n\n Responsibilities: Build APIs ',
      }).description,
    ).toBe('Requirements:\nTypeScript\n\nResponsibilities: Build APIs');
  });

  it('removes page markers and repeated headers while retaining unique work history', () => {
    expect(
      normalizeResumeText(
        'Header\nPage 1 of 3\nBuilt API\nHeader\nPage 2 of 3\nLed team\nHeader\nPage 3 of 3',
      ),
    ).toBe('Built API\nLed team');
  });

  it('redacts direct identifiers and non-job personal fields', () => {
    const redacted = redactSensitiveResumeText(
      'Alex Person\nDOB: 01/02/1990\nalex@example.com\n+1 (415) 555-0100\nTypeScript engineer',
    );
    expect(redacted).not.toContain('Alex Person');
    expect(redacted).not.toContain('01/02/1990');
    expect(redacted).not.toContain('alex@example.com');
    expect(redacted).not.toContain('415');
    expect(redacted).toContain('TypeScript engineer');
  });
});
