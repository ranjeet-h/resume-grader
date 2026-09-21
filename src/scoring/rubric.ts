export const RUBRIC_VERSION = 'resume-match-v2';
export const SCORING_CONFIG_VERSION = 'resume-match-weights-v1';
export const LOCAL_LAYA_MODEL_BASE_ID = 'convaiinnovations/laya:typed-decisions';
export const LOCAL_LAYA_MODEL_REVISION = '1c5edc17a7acd8701df6fc341c0d179f1c62c982';
export const LOCAL_LAYA_MODEL_ID = `${LOCAL_LAYA_MODEL_BASE_ID}@${LOCAL_LAYA_MODEL_REVISION}`;
export const DEFAULT_MODEL_ID = LOCAL_LAYA_MODEL_ID;

export const SCORE_QUESTION_KEYS = [
  'requiredSkills',
  'relevantExperience',
  'seniority',
  'domainMatch',
] as const;

export const SCORE_CRITERIA = {
  requiredSkills: [
    'Almost no explicitly required skills are evidenced',
    'A minority of explicitly required skills are evidenced',
    'A meaningful subset of explicitly required skills is evidenced',
    'Most explicitly required skills are evidenced with credible experience',
    'Nearly all explicitly required skills are strongly evidenced with relevant experience',
  ],
  relevantExperience: [
    'Unrelated experience',
    'Weakly related experience',
    'Partially relevant experience',
    'Highly relevant experience',
    'Directly relevant and strong experience',
  ],
  seniority: [
    'Far below the expected level of responsibility',
    'Below the expected level of responsibility',
    'Approximately matches the expected level of responsibility',
    'Above the expected level while remaining relevant',
    'Strongly exceeds the expected level while remaining relevant',
  ],
  domainMatch: [
    'Unrelated domain experience',
    'Slightly related domain experience',
    'Some useful domain overlap',
    'Strong domain relevance',
    'Direct and extensive domain relevance',
  ],
} as const;

export const COMPOSITE_WEIGHTS = {
  requiredSkills: 0.35,
  relevantExperience: 0.3,
  seniority: 0.15,
  domainMatch: 0.1,
  mustHaves: 0.1,
} as const;

export const MATCHING_QUESTIONS = {
  requiredSkills: {
    type: 'score' as const,
    instructions:
      'How strongly does the resume demonstrate the technical skills explicitly required by the job description? Judge only evidence in the resume and the stated job requirements.',
    criteria: [...SCORE_CRITERIA.requiredSkills],
  },
  relevantExperience: {
    type: 'score' as const,
    instructions:
      'How relevant is the candidate’s demonstrated professional experience to the responsibilities in the job description? Judge demonstrated work, not inferred traits.',
    criteria: [...SCORE_CRITERIA.relevantExperience],
  },
  seniority: {
    type: 'score' as const,
    instructions:
      'How closely does the demonstrated level of responsibility match the seniority expected by the job description? Judge scope and responsibility, not age or years since graduation.',
    criteria: [...SCORE_CRITERIA.seniority],
  },
  domainMatch: {
    type: 'score' as const,
    instructions:
      'How relevant is the candidate’s industry, domain, and project experience to the job description? Judge only job-related evidence.',
    criteria: [...SCORE_CRITERIA.domainMatch],
  },
  mustHaves: {
    type: 'noul' as const,
    instructions:
      'Does the resume provide evidence that the candidate satisfies the explicit must-have requirements in the job description? Do not infer missing qualifications.',
    criteria: {
      true: 'The resume provides evidence for each explicit must-have requirement.',
      false: 'At least one explicit must-have requirement is unsupported by resume evidence.',
    },
  },
};

export type MatchingQuestionKey = keyof typeof MATCHING_QUESTIONS;
