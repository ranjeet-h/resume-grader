import path from 'node:path';
import {
  type CandidateInput,
  candidateInputSchema,
  type JobInput,
  jobInputSchema,
} from '../domain/types.js';
import { normalizeJobDescription } from '../normalization/jd.js';
import { normalizeCandidate } from '../normalization/resume.js';
import {
  asArray,
  asRecord,
  getNumber,
  getString,
  getStringArray,
  hashFiles,
  readJson,
} from './shared.js';
import type { BenchmarkLabel, RoleRadarData, RoleRadarPair } from './types.js';

const SOURCE_FILENAMES = [
  'scraped_jobs.json',
  'synthetic_profiles.json',
  'phase2_pairs.json',
  'phase2_labels.json',
  'phase3_pairs.json',
  'phase3_labels.json',
  'gold_labels.json',
] as const;

export async function loadRoleRadarDataset(rawDir: string): Promise<RoleRadarData> {
  const datasetDir = path.join(rawDir, 'role-radar');
  const filePaths = SOURCE_FILENAMES.map((filename) => path.join(datasetDir, filename));
  const [
    jobsUnknown,
    profilesUnknown,
    phase2PairsUnknown,
    phase2LabelsUnknown,
    phase3PairsUnknown,
    phase3LabelsUnknown,
    goldUnknown,
  ] = await Promise.all(filePaths.map(readJson));

  const jobs = asArray(jobsUnknown, SOURCE_FILENAMES[0]).map((value, index) =>
    parseJob(value, index),
  );
  const candidates = asArray(profilesUnknown, SOURCE_FILENAMES[1]).map((value, index) =>
    parseCandidate(value, index),
  );
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const jobIds = new Set(jobs.map((job) => job.id));

  const parsedFiles = [
    parsePairFile(phase2PairsUnknown, SOURCE_FILENAMES[2], candidateIds, jobIds, false),
    parsePairFile(phase2LabelsUnknown, SOURCE_FILENAMES[3], candidateIds, jobIds, true),
    parsePairFile(phase3PairsUnknown, SOURCE_FILENAMES[4], candidateIds, jobIds, false),
    parsePairFile(phase3LabelsUnknown, SOURCE_FILENAMES[5], candidateIds, jobIds, true),
    parsePairFile(goldUnknown, SOURCE_FILENAMES[6], candidateIds, jobIds, true),
  ];
  const phase2Pairs = parsedFiles[0]!.rows;
  const phase2Labels = parsedFiles[1]!.rows;
  const phase3Pairs = parsedFiles[2]!.rows;
  const phase3Labels = parsedFiles[3]!.rows;
  const goldLabels = parsedFiles[4]!.rows;

  return {
    jobs,
    candidates,
    phase2Pairs,
    phase2Labels,
    phase3Pairs,
    phase3Labels,
    goldLabels,
    datasetVersionOrHash: await hashFiles(filePaths),
    sourceFiles: filePaths,
    issues: parsedFiles.flatMap((file) => file.issues),
  };
}

export async function writeNormalizedRoleRadar(
  data: RoleRadarData,
  outputPath: string,
): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        datasetVersionOrHash: data.datasetVersionOrHash,
        jobs: data.jobs,
        candidates: data.candidates,
        phase2Pairs: data.phase2Pairs,
        phase2Labels: data.phase2Labels,
        phase3Pairs: data.phase3Pairs,
        phase3Labels: data.phase3Labels,
        goldLabels: data.goldLabels,
        issues: data.issues,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

function parseJob(value: unknown, index: number): JobInput {
  const row = asRecord(value);
  if (!row) throw new Error(`Role Radar job row ${index + 1} must be an object`);
  const id = getString(row, ['id', 'job_id']);
  const description = getString(row, ['description', 'job_description', 'text']);
  if (!id || !description)
    throw new Error(`Role Radar job row ${index + 1} is missing id or description`);
  const job: JobInput = {
    id,
    description,
    title: getString(row, ['title', 'job_title']) ?? `Job ${id}`,
  };
  const location = getString(row, ['location']);
  const seniority = getString(row, ['seniority_level', 'seniority']);
  const roleFamily = getString(row, ['role_family_hint', 'role_family', 'job_function']);
  if (location) job.location = location;
  if (seniority) job.seniority = seniority;
  if (roleFamily) job.roleFamily = roleFamily;
  return normalizeJobDescription(jobInputSchema.parse(job));
}

function parseCandidate(value: unknown, index: number): CandidateInput {
  const row = asRecord(value);
  if (!row) throw new Error(`Role Radar profile row ${index + 1} must be an object`);
  const id = getString(row, ['profile_id', 'candidate_id', 'id']);
  if (!id) throw new Error(`Role Radar profile row ${index + 1} is missing profile_id`);

  const resumeText =
    getString(row, ['resumeText', 'resume_text', 'resume', 'Resume_str', 'text']) ??
    profileToText(row);
  const candidate: CandidateInput = {
    id,
    resumeText,
    source: 'role-radar',
    metadata: {
      roleFamily: getString(row, ['role_family', 'role_family_hint']),
      synthetic: row['synthetic'],
    },
  };
  return normalizeCandidate(candidateInputSchema.parse(candidate));
}

function profileToText(row: Record<string, unknown>): string {
  const sections: string[] = [];
  const add = (label: string, keys: readonly string[]): void => {
    const values = getStringArray(row, keys);
    if (values.length > 0) sections.push(`${label}: ${values.join(', ')}`);
  };
  add('Target roles', ['roles', 'target_roles', 'role_preferences']);
  add('Primary skills', ['skills_primary', 'primary_skills', 'skills']);
  add('Additional skills', ['skills_secondary', 'secondary_skills']);
  add('Relevant domains', ['domains', 'industries']);
  add('Seniority level', ['seniority', 'seniority_level']);
  add('Career intent', ['career_intent']);
  return sections.join('\n');
}

function parsePairFile(
  value: unknown,
  source: string,
  candidateIds: Set<string>,
  jobIds: Set<string>,
  hasLabels: boolean,
): { rows: RoleRadarPair[]; issues: Array<{ sourceRow: number; reason: string }> } {
  const rows: RoleRadarPair[] = [];
  const issues: Array<{ sourceRow: number; reason: string }> = [];
  asArray(value, source).forEach((item, index) => {
    const row = asRecord(item);
    if (!row) throw new Error(`${source} row ${index + 1} must be an object`);
    const pairId = getString(row, ['pair_id', 'id']) ?? `${source}:${index + 1}`;
    const explicitCandidateId = getString(row, ['candidate_id', 'profile_id', 'candidateId']);
    const explicitJobId = getString(row, ['job_id', 'jobId']);
    const resolved = resolvePairIds(
      pairId,
      explicitCandidateId,
      explicitJobId,
      candidateIds,
      jobIds,
    );
    if (!resolved) {
      issues.push({
        sourceRow: index + 1,
        reason: `could not resolve candidate/job IDs from pair ${pairId}`,
      });
      return;
    }
    const pair: RoleRadarPair = {
      pairId,
      candidateId: resolved.candidateId,
      jobId: resolved.jobId,
    };
    const roleFamily = getString(row, ['role_family', 'role_family_hint']);
    const seniority = getString(row, ['seniority', 'seniority_level']);
    if (roleFamily) pair.roleFamily = roleFamily;
    if (seniority) pair.seniority = seniority;
    if (hasLabels) {
      const label = parseLabel(row);
      if (Object.keys(label).length > 0) pair.label = label;
    }
    rows.push(pair);
  });
  return { rows, issues };
}

function resolvePairIds(
  pairId: string,
  explicitCandidateId: string | undefined,
  explicitJobId: string | undefined,
  candidateIds: Set<string>,
  jobIds: Set<string>,
): { candidateId: string; jobId: string } | undefined {
  if (explicitCandidateId && explicitJobId) {
    if (!candidateIds.has(explicitCandidateId) || !jobIds.has(explicitJobId)) return undefined;
    return { candidateId: explicitCandidateId, jobId: explicitJobId };
  }

  const candidates = [...candidateIds].sort((a, b) => b.length - a.length);
  for (const candidateId of candidates) {
    const prefix = `${candidateId}_`;
    if (!pairId.startsWith(prefix)) continue;
    const jobId = pairId.slice(prefix.length);
    if (jobIds.has(jobId)) return { candidateId, jobId };
  }
  const separator = pairId.indexOf('_');
  if (separator < 1) return undefined;
  const candidateId = pairId.slice(0, separator);
  const jobId = pairId.slice(separator + 1);
  if (candidateIds.has(candidateId) && jobIds.has(jobId)) return { candidateId, jobId };
  return undefined;
}

function parseLabel(row: Record<string, unknown>): BenchmarkLabel {
  const label: BenchmarkLabel = {};
  const keys = {
    skills: ['skills', 'skills_score'],
    seniority: ['seniority', 'seniority_score'],
    domain: ['domain', 'domain_score'],
    location: ['location', 'location_score'],
    composite: ['composite', 'composite_score', 'score'],
  } as const;
  const skills = getNumber(row, keys.skills);
  const seniority = getNumber(row, keys.seniority);
  const domain = getNumber(row, keys.domain);
  const location = getNumber(row, keys.location);
  const composite = getNumber(row, keys.composite);
  if (skills !== undefined) label.skills = skills;
  if (seniority !== undefined) label.seniority = seniority;
  if (domain !== undefined) label.domain = domain;
  if (location !== undefined) label.location = location;
  if (composite !== undefined) label.composite = composite;
  const source = getString(row, ['label_source', 'source']);
  const reasoning = getString(row, ['reasoning']);
  if (source) label.source = source;
  if (reasoning) label.reasoning = reasoning;
  return label;
}
