import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { atsRowsToInputs, computeAtsMetrics } from './benchmarks/ats.js';
import { pairKey, writeBenchmarkReport } from './benchmarks/common.js';
import {
  computeRoleRadarMetrics,
  joinRoleRadarLabels,
  sampleRoleRadarPairs,
  selectDefaultBenchmarkJob,
} from './benchmarks/role-radar.js';
import {
  buildVanetikRankingRows,
  buildVanetikReportSections,
  computeVanetikMetrics,
  vanetikRankingsCsv,
} from './benchmarks/vanetik.js';
import { ensureOutputDirectories, loadConfig } from './config.js';
import { loadAtsValidationDataset, writeNormalizedAts } from './datasets/ats-score.js';
import { hashLocalMatchInputs, loadLocalResumes } from './datasets/custom.js';
import { findKagglePdfFiles, loadKaggleDataset, writeNormalizedKaggle } from './datasets/kaggle.js';
import { extractPdfText, tokenJaccard } from './datasets/pdf.js';
import { loadRoleRadarDataset, writeNormalizedRoleRadar } from './datasets/role-radar.js';
import { hashFiles, stableSeededSample } from './datasets/shared.js';
import { loadVanetikDataset, toVanetikPairs } from './datasets/vanetik.js';
import type { CandidateInput, CandidateMatchResult, JobInput } from './domain/types.js';
import { candidateInputSchema, jobInputSchema } from './domain/types.js';
import { spearmanCorrelation } from './metrics/core.js';
import type { BatchRunResult } from './pipeline/batch-runner.js';
import { runBatch } from './pipeline/batch-runner.js';
import { EvaluationCache } from './pipeline/cache.js';
import { classifyError } from './providers/errors.js';
import type { CandidateEvaluator } from './providers/evaluator.js';
import { createLocalLayaEvaluator } from './providers/laya-local.js';
import {
  projectModelPreflight,
  REQUIRED_MODEL_PREFLIGHT_SIZE,
  writeModelPreflightReport,
} from './providers/model-preflight.js';
import { writeJsonReport } from './reports/json.js';
import { writeMarkdownReport } from './reports/markdown.js';
import { writeRankingFiles } from './reports/ranking.js';

const execFileAsync = promisify(execFile);

const config = loadConfig();
const program = new Command();
program
  .name('laya-resume-matcher')
  .description('CLI for resume and job-description matching evaluation');

program
  .command('laya:smoke')
  .description('Score a small synthetic sample through local Laya')
  .option('--count <number>', 'number of synthetic evaluations, up to ten', parsePositiveInteger, 1)
  .action(async (options: { count: number }) => {
    if (options.count > REQUIRED_MODEL_PREFLIGHT_SIZE)
      throw new RangeError('The live smoke sample is limited to ten evaluations');
    const fixtures = Array.from({ length: options.count }, (_, index) => {
      const fixture = fixtureInput();
      fixture.candidate.id = `smoke-candidate-${index + 1}`;
      fixture.candidate.resumeText += `\nSample profile ${index + 1}.`;
      return fixture;
    });
    const run = await executeBatch({
      dataset: 'synthetic-local-laya-smoke',
      datasetVersionOrHash: 'synthetic-fixture-v1',
      pairs: fixtures,
      noCache: true,
    });
    const usage = run.results.map((result) => ({
      candidateId: result.candidateId,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      costUsd: result.usage?.costUsd ?? null,
    }));
    console.log(
      JSON.stringify(
        {
          model: run.manifest.model,
          evaluations: run.results.length,
          failed: run.failures.length,
          usage,
          inputTokens: run.manifest.totalInputTokens,
          outputTokens: run.manifest.totalOutputTokens,
          providerReportedCostUsd: run.manifest.providerReportedCostUsd ?? 0,
          elapsedMs: run.manifest.elapsedMs,
          runDirectory: run.runDir,
        },
        null,
        2,
      ),
    );
  });

program
  .command('match')
  .description('Rank local PDF or TXT resumes against one local JSON job description')
  .requiredOption('--job <path>', 'path to a JSON job description')
  .requiredOption('--resumes <directory>', 'directory containing PDF or TXT resumes')
  .option(
    '--limit <number>',
    'maximum resumes to score; defaults to every resume',
    parsePositiveInteger,
  )
  .option('--seed <number>', 'seed used when --limit selects a sample', parseInteger, 42)
  .option('--dry-run', 'extract and validate inputs without loading or running the model')
  .option('--no-cache', 'bypass the local model-result cache')
  .action(
    async (options: {
      job: string;
      resumes: string;
      limit?: number;
      seed: number;
      dryRun?: boolean;
      cache?: boolean;
    }) => {
      const jobFile = path.resolve(options.job);
      const resumesDirectory = path.resolve(options.resumes);
      const job = jobInputSchema.parse(JSON.parse(await readFile(jobFile, 'utf8'))) as JobInput;
      const allResumes = await loadLocalResumes(resumesDirectory);
      const selected =
        options.limit === undefined
          ? allResumes
          : stableSeededSample(allResumes, options.limit, options.seed);

      if (options.dryRun) {
        console.log(
          JSON.stringify(
            {
              dryRun: true,
              job: { id: job.id, title: job.title ?? null },
              resumesDiscovered: allResumes.length,
              resumesSelected: selected.length,
              selectedCandidateIds: selected.map(({ candidate }) => candidate.id),
              filesWithEmbeddedPdfText: selected.filter((resume) => resume.pageCount !== undefined)
                .length,
              ocrApplied: false,
              provider: config.provider,
              model: config.model,
              noModelCallsMade: true,
            },
            null,
            2,
          ),
        );
        return;
      }

      const datasetVersionOrHash = await hashLocalMatchInputs(jobFile, selected);
      const pairs = selected.map(({ candidate }) => ({ job, candidate }));
      const run = await executeBatch({
        dataset: 'local-resume-match',
        datasetVersionOrHash,
        jobId: job.id,
        pairs,
        noCache: options.cache === false,
      });
      const rankings = await writeRankingFiles(config.outputDir, run.runId, run.results);
      const privateInputMapPath = path.join(rankings.directory, 'input-files.private.json');
      await writeFile(
        privateInputMapPath,
        `${JSON.stringify(
          {
            warning: 'Contains local source filenames. Keep private and do not publish.',
            jobFile: path.relative(config.rootDir, jobFile),
            candidates: selected.map(({ candidate, relativePath, pageCount }) => ({
              candidateId: candidate.id,
              file: relativePath,
              ...(pageCount === undefined ? {} : { pageCount }),
            })),
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      const report = await writeBenchmarkReport({
        outputRoot: config.outputDir,
        title: 'Local Resume Match Ranking',
        run,
        datasetDescription: `Local evaluation of ${run.results.length} PDF or TXT resumes against one job description. Resume text and source filenames are excluded from published ranking artifacts.`,
        metrics: {
          selectedCandidates: selected.length,
          successfulCandidates: run.results.length,
          failedCandidates: run.failures.length,
          scoreScale: 'Laya rubric score 0-100; not a calibrated probability',
          selectedJob: { id: job.id, title: job.title ?? null },
          rankingCsv: path.relative(config.rootDir, rankings.csvPath),
        },
        extraSections: [
          {
            heading: 'Ranking artifacts',
            content: codeBlock({
              csv: path.relative(config.rootDir, rankings.csvPath),
              top20: path.relative(config.rootDir, rankings.markdownPath),
              allResults: path.relative(config.rootDir, rankings.allPath),
            }),
          },
        ],
        knownLimitations: [
          'This model and score aggregation are experimental and have not been validated for employment decisions.',
          'Scores are rubric scores, not calibrated match probabilities or hiring recommendations.',
          'Resume text is processed locally and redaction uses heuristics; inspect the privacy documentation before using real candidate data.',
          'PDF extraction reads embedded text only; scanned PDFs require OCR outside this tool.',
          'Every result requires human review. Do not automatically reject, rank out, or select candidates using this output.',
        ],
      });
      console.log(
        JSON.stringify(
          {
            runId: run.runId,
            model: run.manifest.model,
            device: run.results[0]?.providerMetadata?.['device'] ?? null,
            scored: run.results.length,
            failed: run.failures.length,
            scoreScale: '0-100 rubric score, not a probability',
            rankings: {
              csv: path.relative(config.rootDir, rankings.csvPath),
              all: path.relative(config.rootDir, rankings.allPath),
              top20: path.relative(config.rootDir, rankings.markdownPath),
            },
            privateInputMap: path.relative(config.rootDir, privateInputMapPath),
            reports: {
              markdown: path.relative(config.rootDir, report.markdownPath),
              json: path.relative(config.rootDir, report.jsonPath),
            },
          },
          null,
          2,
        ),
      );
    },
  );

program
  .command('data:role-radar')
  .description('Validate and normalize the local Role Radar JSON files')
  .action(async () => {
    await ensureOutputDirectories(config);
    const data = await loadRoleRadarDataset(config.rawDir);
    const output = path.join(config.normalizedDir, 'role-radar.json');
    await writeNormalizedRoleRadar(data, output);
    console.log(
      JSON.stringify(
        {
          datasetVersionOrHash: data.datasetVersionOrHash,
          jobs: data.jobs.length,
          candidates: data.candidates.length,
          phase2Pairs: data.phase2Pairs.length,
          phase2Labels: data.phase2Labels.length,
          phase3Pairs: data.phase3Pairs.length,
          phase3Labels: data.phase3Labels.length,
          goldLabels: data.goldLabels.length,
          unresolvedPairs: data.issues.length,
          output,
        },
        null,
        2,
      ),
    );
  });

program
  .command('data:vanetik')
  .description('Normalize the downloaded public Vanetik/Kogan human-ranking dataset')
  .action(async () => {
    await ensureOutputDirectories(config);
    const source = path.join(config.rawDir, 'vanetik-vacancy-resume');
    const output = path.join(config.normalizedDir, 'vanetik.json');
    const script = path.resolve('python/prepare_vanetik.py');
    const { stdout } = await execFileAsync(
      'uv',
      [
        'run',
        '--project',
        'python',
        '--locked',
        'python',
        script,
        '--source',
        source,
        '--output',
        output,
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 },
    );
    process.stdout.write(stdout);
  });

program
  .command('data:ats')
  .description('Validate and normalize the local ATS Score validation CSV')
  .action(async () => {
    await ensureOutputDirectories(config);
    const dataset = await loadAtsValidationDataset(config.rawDir);
    const output = path.join(config.normalizedDir, 'ats-validation.json');
    await writeNormalizedAts(dataset, output);
    console.log(
      JSON.stringify(
        {
          datasetVersionOrHash: dataset.datasetVersionOrHash,
          loadedRows: dataset.rows.length,
          malformedRows: dataset.issues.length,
          issues: dataset.issues.slice(0, 20),
          output,
        },
        null,
        2,
      ),
    );
  });

program
  .command('data:kaggle')
  .description('Validate and normalize the local Kaggle Resume.csv')
  .action(async () => {
    await ensureOutputDirectories(config);
    const dataset = await loadKaggleDataset(config.rawDir);
    const output = path.join(config.normalizedDir, 'kaggle-resumes.json');
    await writeNormalizedKaggle(dataset, output);
    console.log(
      JSON.stringify(
        {
          datasetVersionOrHash: dataset.datasetVersionOrHash,
          loadedResumes: dataset.rows.length,
          malformedRows: dataset.issues.length,
          issues: dataset.issues.slice(0, 20),
          output,
        },
        null,
        2,
      ),
    );
  });

program
  .command('benchmark:select-jd')
  .description('Choose the job with the most resolved Role Radar labels')
  .action(async () => {
    const data = await loadRoleRadarDataset(config.rawDir);
    const selected = selectDefaultBenchmarkJob(data);
    const job = data.jobs.find((item) => item.id === selected.jobId);
    console.log(
      JSON.stringify(
        {
          jobId: selected.jobId,
          title: job?.title,
          roleFamily: job?.roleFamily,
          labeledProfiles: selected.labelCount,
          datasetVersionOrHash: data.datasetVersionOrHash,
          unresolvedPairRows: data.issues.length,
        },
        null,
        2,
      ),
    );
  });

program
  .command('benchmark:gold')
  .description(
    'Run Laya and deterministic baseline metrics on the Role Radar human-reviewed gold set',
  )
  .option('--limit <number>', 'maximum human-reviewed pairs to score', parsePositiveInteger, 10)
  .option('--seed <number>', 'sampling seed', parseInteger, 42)
  .option('--no-cache', 'bypass the local model-result cache')
  .action(async (options: { limit: number; seed: number; cache?: boolean }) => {
    const data = await loadRoleRadarDataset(config.rawDir);
    const joined = joinRoleRadarLabels(data, data.goldLabels);
    const sampled = sampleRoleRadarPairs(joined.pairs, options.limit, options.seed);
    const run = await executeBatch({
      dataset: 'role-radar-gold',
      datasetVersionOrHash: data.datasetVersionOrHash,
      pairs: sampled.map((pair) => pair.input),
      noCache: options.cache === false,
    });
    const metrics = computeRoleRadarMetrics(run.results, sampled);
    const labelsByPair = new Map(
      sampled.flatMap((pair) =>
        pair.label.composite === undefined
          ? []
          : [[pairKey(pair.input.job.id, pair.input.candidate.id), pair.label.composite] as const],
      ),
    );
    const disagreement = confidenceExamples(run.results, labelsByPair);
    await writeBenchmarkReport({
      outputRoot: config.outputDir,
      title: 'Role Radar Human Gold Benchmark',
      run,
      datasetDescription: `Seeded sample of ${sampled.length} from ${joined.pairs.length} human-reviewed Role Radar gold pairs; seed ${options.seed}.`,
      metrics: {
        ...metrics,
        requestedSampleSize: options.limit,
        actualSampleSize: sampled.length,
        unresolvedGoldPairs: joined.unresolvedCount,
        datasetSourceIssueCount: data.issues.length,
      },
      extraSections: [
        {
          heading: 'Lowest-confidence examples',
          content: codeBlock(disagreement.lowestConfidence),
        },
        { heading: 'Largest disagreements', content: codeBlock(disagreement.largestDisagreements) },
      ],
      knownLimitations: [
        `Scores measure agreement with ${joined.pairs.length} resolved human-reviewed pairs, not hiring outcomes.`,
        'The gold set spans multiple jobs; ranking metrics exclude jobs with only one labeled candidate.',
        'Role Radar composite labels include location, while the Laya composite does not; composite errors are not a like-for-like rubric comparison.',
        'No rubric tuning is performed from these results.',
        'Any unresolved or malformed source rows are counted in the report and are not silently benchmarked.',
      ],
    });
    printRunPaths(run);
  });

program
  .command('benchmark:vanetik')
  .description(
    'Score the 30 human-ranked resumes against the five public vacancies with local Laya',
  )
  .option('--no-cache', 'bypass the local model-result cache')
  .action(async (options: { cache?: boolean }) => {
    const dataset = await loadVanetikDataset(path.join(config.normalizedDir, 'vanetik.json'));
    const pairs = toVanetikPairs(dataset);
    const run = await executeBatch({
      dataset: 'vanetik-human-ranked',
      datasetVersionOrHash: dataset.datasetVersionOrHash,
      pairs,
      noCache: options.cache === false,
    });
    const metrics = computeVanetikMetrics(run.results, dataset);
    const rankings = buildVanetikRankingRows(run.results, dataset);
    const reportPaths = await writeBenchmarkReport({
      outputRoot: config.outputDir,
      title: 'Vanetik/Kogan Human Vacancy Ranking Benchmark',
      run,
      datasetDescription: `Local evaluation of ${dataset.candidates.length} anonymized resumes across ${dataset.jobs.length} vacancies; labels are two human rankings of vacancies within each resume.`,
      metrics,
      extraSections: buildVanetikReportSections(run.results, dataset),
      knownLimitations: [
        'The human task ranks five vacancies for each resume; it is not a direct human ranking of candidates for one vacancy.',
        'This is a small 30-resume, five-software-vacancy sample, and its ordinal labels are not calibrated match probabilities or percentages.',
        `${dataset.nonStrictRankingRows.length} human annotation rows contain tied or repeated rank positions; ties receive half credit in pairwise metrics.`,
        'Inter-annotator agreement is reported because the human reference labels are not perfectly consistent.',
        'Laya scores are rubric scores for human review and must not be used to automatically hire or reject candidates.',
        `The source dataset is published under ${dataset.sourceLicense}; retain its attribution and license terms.`,
      ],
    });
    const csvPath = path.join(
      path.dirname(reportPaths.markdownPath),
      'vacancy-candidate-rankings.csv',
    );
    await writeFile(csvPath, vanetikRankingsCsv(rankings), 'utf8');
    console.log(
      JSON.stringify(
        {
          runId: run.runId,
          scoredPairs: run.results.length,
          failedPairs: run.failures.length,
          report: reportPaths,
          vacancyCandidateRankingsCsv: csvPath,
        },
        null,
        2,
      ),
    );
  });

program
  .command('benchmark:role-radar')
  .description('Run a deterministic stratified Role Radar labeled-pair benchmark')
  .option('--limit <number>', 'maximum labeled pairs', parsePositiveInteger, 1000)
  .option('--seed <number>', 'sampling seed', parseInteger, 42)
  .option('--no-cache', 'bypass the local model-result cache')
  .action(async (options: { limit: number; seed: number; cache?: boolean }) => {
    const data = await loadRoleRadarDataset(config.rawDir);
    const joined = joinRoleRadarLabels(data, data.phase3Labels);
    const sampled = sampleRoleRadarPairs(joined.pairs, options.limit, options.seed);
    const run = await executeBatch({
      dataset: 'role-radar-phase3',
      datasetVersionOrHash: data.datasetVersionOrHash,
      pairs: sampled.map((pair) => pair.input),
      noCache: options.cache === false,
    });
    const metrics = computeRoleRadarMetrics(run.results, sampled);
    await writeBenchmarkReport({
      outputRoot: config.outputDir,
      title: 'Role Radar Labeled-Pair Benchmark',
      run,
      datasetDescription: `Stratified sample seed ${options.seed}; labels are partly model-generated/deterministic, not fully human-reviewed.`,
      metrics: {
        ...metrics,
        requestedLimit: options.limit,
        sampledPairs: sampled.length,
        unresolvedLabelJoins: joined.unresolvedCount,
        sourceJoinIssues: data.issues.length,
      },
      knownLimitations: [
        'The labels are not a complete Cartesian product and are only a secondary benchmark.',
        'Some dimension labels are generated or rule-based; this is not a human accuracy estimate.',
        'Sampling uses role family, seniority, and low/middle/high composite score strata where those fields exist.',
      ],
    });
    printRunPaths(run);
  });

program
  .command('benchmark:ats')
  .description('Score a deterministic sample of ATS Score validation pairs')
  .option('--limit <number>', 'maximum validation rows', parsePositiveInteger, 500)
  .option('--seed <number>', 'sampling seed', parseInteger, 42)
  .option('--no-cache', 'bypass the local model-result cache')
  .action(async (options: { limit: number; seed: number; cache?: boolean }) => {
    const dataset = await loadAtsValidationDataset(config.rawDir);
    const sampled = stableSeededSample(dataset.rows, options.limit, options.seed);
    const run = await executeBatch({
      dataset: 'ats-score-validation',
      datasetVersionOrHash: dataset.datasetVersionOrHash,
      pairs: atsRowsToInputs(sampled),
      noCache: options.cache === false,
    });
    const metrics = computeAtsMetrics(sampled, run.results);
    await writeBenchmarkReport({
      outputRoot: config.outputDir,
      title: 'Resume ATS Score Validation Benchmark',
      run,
      datasetDescription: `Algorithmically labeled validation split; deterministic sample seed ${options.seed}.`,
      metrics: {
        ...metrics,
        requestedLimit: options.limit,
        sampledRows: sampled.length,
        malformedRows: dataset.issues.length,
        malformedRowExamples: dataset.issues.slice(0, 20),
      },
      knownLimitations: [
        'ATS scores are algorithmic semantic-similarity labels, not human ground truth.',
        'Classification uses the brief’s thresholds: below 40, 40 through 70 inclusive, and above 70.',
        'Malformed rows are reported and excluded from scoring; they are not silently discarded.',
      ],
    });
    printRunPaths(run);
  });

program
  .command('rank:role-radar')
  .description('Rank Role Radar profiles against one selected job')
  .option('--job-id <id>', 'job ID; defaults to the job with the most phase3 labels')
  .option('--limit <number>', 'maximum number of profiles', parsePositiveInteger, 640)
  .option('--no-cache', 'bypass the local model-result cache')
  .action(async (options: { jobId?: string; limit: number; cache?: boolean }) => {
    const data = await loadRoleRadarDataset(config.rawDir);
    const defaultJob = selectDefaultBenchmarkJob(data);
    const jobId = options.jobId ?? defaultJob.jobId;
    const job = data.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Job ID ${jobId} was not found in the Role Radar dataset`);
    const candidates = data.candidates.slice(0, options.limit);
    const run = await executeBatch({
      dataset: 'role-radar-ranking-demo',
      datasetVersionOrHash: data.datasetVersionOrHash,
      jobId,
      pairs: candidates.map((candidate) => ({ job, candidate })),
      noCache: options.cache === false,
    });
    const paths = await writeRankingFiles(config.outputDir, run.runId, run.results);
    const metrics = {
      rankedCandidates: run.results.length,
      failedCandidates: run.failures.length,
      selectedJob: { id: job.id, title: job.title, roleFamily: job.roleFamily },
      groundTruthCoverageForSelectedJob: data.phase3Labels.filter((pair) => pair.jobId === jobId)
        .length,
    };
    const reportPaths = await writeBenchmarkReport({
      outputRoot: config.outputDir,
      title: 'Role Radar Candidate Ranking Demo',
      run,
      datasetDescription: `All loaded candidate profiles ranked against job ${job.id}; this full ranking does not imply labels for every candidate.`,
      metrics,
      extraSections: [{ heading: 'Ranking artifacts', content: codeBlock(paths) }],
      knownLimitations: [
        'Ranking is an aid for human review and must not be used to automatically reject or hire candidates.',
        'Only the top 20 and low-ranked candidates should be manually reviewed before drawing conclusions.',
        'Candidate IDs and scores are exported; resume text and protected personal information are not.',
      ],
    });
    console.log(
      JSON.stringify({ runId: run.runId, rankings: paths, reports: reportPaths }, null, 2),
    );
  });

program
  .command('benchmark:kaggle')
  .description('Parse Kaggle resumes/PDFs and run an optional throughput-scoring batch')
  .option('--limit <number>', 'number of text resumes to process', parsePositiveInteger, 500)
  .option('--seed <number>', 'sampling seed', parseInteger, 42)
  .option('--pdf-count <number>', 'maximum matched PDFs to parse', parseNonnegativeInteger, 100)
  .option('--job-file <path>', 'job JSON file; defaults to the committed throughput fixture')
  .option('--no-cache', 'bypass the local model-result cache')
  .action(
    async (options: {
      limit: number;
      seed: number;
      pdfCount: number;
      jobFile?: string;
      cache?: boolean;
    }) => {
      const dataset = await loadKaggleDataset(config.rawDir);
      const sampled = stableSeededSample(dataset.rows, options.limit, options.seed);
      const guardedFullRun = options.limit >= 500;
      if (guardedFullRun && sampled.length < options.limit) {
        throw new Error(
          `Requested ${options.limit} resumes but only ${sampled.length} valid local resumes were loaded; no model evaluations were sent.`,
        );
      }
      if (guardedFullRun && options.cache === false) {
        throw new Error(
          '--no-cache cannot be used for a 500+ resume run because it would repeat the ten local-model preflight evaluations.',
        );
      }
      const pdfMap = await findKagglePdfFiles(dataset.pdfRoot);
      const pdfCandidates = sampled
        .flatMap((row) => {
          const pdf = pdfMap.get(row.id);
          return pdf ? [{ row, pdf }] : [];
        })
        .slice(0, options.pdfCount);
      const pdfResults = [] as Array<Record<string, unknown>>;
      const similarities: number[] = [];
      for (const { row, pdf } of pdfCandidates) {
        try {
          const parsed = await extractPdfText(pdf);
          const similarity = tokenJaccard(parsed.text, row.resumeText);
          if (similarity !== null) similarities.push(similarity);
          pdfResults.push({
            id: row.id,
            status: parsed.status,
            pageCount: parsed.pageCount,
            similarity,
          });
        } catch (error) {
          pdfResults.push({
            id: row.id,
            status: 'parse_failed',
            error: classifyError(error).errorType,
          });
        }
      }
      const jobFile = options.jobFile
        ? path.resolve(options.jobFile)
        : path.join(config.rootDir, 'data', 'fixtures', 'kaggle-throughput-job.json');
      const job = jobInputSchema.parse(
        JSON.parse(await readFile(jobFile, 'utf8')) as unknown,
      ) as JobInput;
      const runDatasetVersionOrHash = await hashFiles([
        dataset.csvPath,
        jobFile,
        ...pdfCandidates.map(({ pdf }) => pdf),
      ]);
      const candidates: CandidateInput[] = sampled.map((row) =>
        candidateInputSchema.parse({
          id: row.id,
          resumeText: row.resumeText,
          source: 'kaggle',
          metadata: { sourceRow: row.sourceRow },
        }),
      );
      const pairs = candidates.map((candidate) => ({ job, candidate }));
      const run = await executeBatch({
        dataset: 'kaggle-resume-throughput',
        datasetVersionOrHash: runDatasetVersionOrHash,
        jobId: job.id,
        pairs,
        noCache: options.cache === false,
      });
      const statusCounts = pdfResults.reduce<Record<string, number>>((counts, item) => {
        const status = String(item['status']);
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      }, {});
      const reportPaths = await writeBenchmarkReport({
        outputRoot: config.outputDir,
        title: 'Kaggle Resume Ingestion and Throughput Benchmark',
        run,
        datasetDescription: `Local Kaggle resume CSV, sample seed ${options.seed}; category labels are not match ground truth.`,
        metrics: {
          requestedResumeCount: options.limit,
          loadedResumeCount: dataset.rows.length,
          sampledResumeCount: sampled.length,
          malformedRows: dataset.issues.length,
          pdfFilesFound: pdfMap.size,
          matchedPdfsSelected: pdfCandidates.length,
          requestedPdfCount: options.pdfCount,
          pdfParseStatuses: statusCounts,
          pdfTextSimilarityToResumeStr: similarities.length
            ? {
                comparedCount: similarities.length,
                mean: similarities.reduce((sum, value) => sum + value, 0) / similarities.length,
                min: Math.min(...similarities),
                max: Math.max(...similarities),
              }
            : null,
          pdfExamples: pdfResults.slice(0, 20),
          layaSuccessRate:
            run.manifest.candidateCount > 0
              ? run.manifest.successfulCount / run.manifest.candidateCount
              : null,
          modelPreflightReport: run.manifest.modelPreflightReportPath ?? null,
          providerReportedCostUsd: run.manifest.providerReportedCostUsd ?? 0,
          jobFile: path.relative(config.rootDir, jobFile),
        },
        knownLimitations: [
          'Kaggle category is a resume classification label and is not used as match ground truth.',
          'Scanned and unreadable PDFs are reported as requires_ocr or parse_failed; this pipeline does not run OCR.',
          'PDF coverage is limited to sampled resume IDs with a corresponding local PDF.',
        ],
      });
      console.log(
        JSON.stringify(
          { runId: run.runId, reports: reportPaths, pdfsParsed: pdfCandidates.length },
          null,
          2,
        ),
      );
    },
  );

program
  .command('benchmark:pdf-sample')
  .description('Score up to ten locally stored Kaggle PDF resumes against one job description')
  .option(
    '--limit <number>',
    'number of PDF resumes to score, maximum ten',
    parsePositiveInteger,
    10,
  )
  .option('--seed <number>', 'sampling seed', parseInteger, 42)
  .option('--job-file <path>', 'job JSON file; defaults to the Synechron full-stack fixture')
  .option('--no-cache', 'bypass the local model-result cache')
  .action(async (options: { limit: number; seed: number; jobFile?: string; cache?: boolean }) => {
    if (options.limit > 10) throw new RangeError('PDF sample is limited to ten resumes');
    const pdfRoot = path.join(config.rawDir, 'kaggle-resumes', 'data');
    const pdfMap = await findKagglePdfFiles(pdfRoot);
    if (pdfMap.size < options.limit) {
      throw new Error(
        `Requested ${options.limit} PDF resumes but found ${pdfMap.size} under ${pdfRoot}; no model evaluations were sent.`,
      );
    }
    const selected = stableSeededSample([...pdfMap.entries()], options.limit, options.seed);
    const jobFile = options.jobFile
      ? path.resolve(options.jobFile)
      : path.join(config.rootDir, 'data', 'fixtures', 'synechron-fullstack-job.json');
    const job = jobInputSchema.parse(
      JSON.parse(await readFile(jobFile, 'utf8')) as unknown,
    ) as JobInput;
    const pairs: Array<{ job: JobInput; candidate: CandidateInput }> = [];
    const pdfDetails: Array<{
      id: string;
      category: string;
      file: string;
      pageCount: number;
      extractedCharacters: number;
    }> = [];
    for (const [id, pdf] of selected) {
      const parsed = await extractPdfText(pdf);
      if (parsed.status !== 'parsed') {
        throw new Error(
          `PDF ${id} has no usable embedded text (${parsed.status}); no model evaluations were sent.`,
        );
      }
      const category = path.basename(path.dirname(pdf));
      const candidate = candidateInputSchema.parse({
        id,
        resumeText: parsed.text,
        source: 'kaggle',
        metadata: { datasetCategory: category, sourceFile: path.relative(config.rootDir, pdf) },
      });
      pairs.push({ job, candidate });
      pdfDetails.push({
        id,
        category,
        file: path.relative(config.rootDir, pdf),
        pageCount: parsed.pageCount,
        extractedCharacters: parsed.text.length,
      });
    }
    const datasetVersionOrHash = await hashFiles([jobFile, ...selected.map(([, pdf]) => pdf)]);
    const run = await executeBatch({
      dataset: 'kaggle-pdf-fullstack-sample',
      datasetVersionOrHash,
      jobId: job.id,
      pairs,
      noCache: options.cache === false,
    });
    const resultById = new Map(run.results.map((result) => [result.candidateId, result]));
    const perResume = pdfDetails.flatMap((pdf) => {
      const result = resultById.get(pdf.id);
      return result
        ? [
            {
              candidateId: pdf.id,
              datasetCategory: pdf.category,
              pdf: pdf.file,
              pageCount: pdf.pageCount,
              extractedCharacters: pdf.extractedCharacters,
              compositeScore: result.compositeScore,
              dimensions: {
                requiredSkills: resultDimension(result, 'requiredSkills'),
                relevantExperience: resultDimension(result, 'relevantExperience'),
                seniority: resultDimension(result, 'seniority'),
                domainMatch: resultDimension(result, 'domainMatch'),
                mustHaves: result.dimensions.mustHaves.probability,
              },
              confidence: result.aggregateConfidence ?? null,
              truncation: result.providerMetadata?.['truncation'] ?? null,
              chunking: result.providerMetadata?.['chunking'] ?? null,
              inputTokens: result.usage?.inputTokens ?? null,
              latencyMs: result.latencyMs,
            },
          ]
        : [];
    });
    const categoryGroups = new Map<string, typeof perResume>();
    for (const result of perResume) {
      const group = categoryGroups.get(result.datasetCategory) ?? [];
      group.push(result);
      categoryGroups.set(result.datasetCategory, group);
    }
    const categorySummary = Object.fromEntries(
      [...categoryGroups.entries()].map(([category, entries]) => [
        category,
        {
          count: entries.length,
          meanCompositeScore: mean(entries.map((entry) => entry.compositeScore)),
          meanRequiredSkills: mean(
            entries.map((entry) => entry.dimensions.requiredSkills.normalizedPercent),
          ),
          meanRelevantExperience: mean(
            entries.map((entry) => entry.dimensions.relevantExperience.normalizedPercent),
          ),
          meanSeniority: mean(entries.map((entry) => entry.dimensions.seniority.normalizedPercent)),
          meanDomainMatch: mean(
            entries.map((entry) => entry.dimensions.domainMatch.normalizedPercent),
          ),
          meanMustHaves: mean(entries.map((entry) => entry.dimensions.mustHaves)),
        },
      ]),
    );
    const reportPaths = await writeBenchmarkReport({
      outputRoot: config.outputDir,
      title: 'Laya Full-Stack Match on Ten PDF Resumes',
      run,
      datasetDescription: `Seed ${options.seed}; up to ten public Kaggle PDF resume examples matched to a paraphrased Synechron full-stack job posting. Dataset categories are selection metadata, not match labels.`,
      metrics: {
        requestedPdfCount: options.limit,
        selectedPdfCount: selected.length,
        parsedPdfCount: pdfDetails.length,
        scoredCount: run.results.length,
        job: { id: job.id, title: job.title, location: job.location },
        categorySummary,
        perResume,
      },
      knownLimitations: [
        'This is a local technical and qualitative check, not a labeled accuracy benchmark; no ground-truth fit judgments exist for these PDF/JD pairs.',
        'The dataset category describes the resume example and is not a resume-to-job relevance label.',
        'Resume examples were scraped from a public resume-example site; the source identifies the Kaggle dataset as CC0. Outputs include IDs and scores, not resume text or names.',
        'The full extracted resume is scored in overlapping windows. Per-window probability distributions are combined by a token-coverage-weighted mean; this experimental aggregation has not been calibrated against resume/JD labels.',
      ],
    });
    console.log(
      JSON.stringify(
        {
          runId: run.runId,
          scored: run.results.length,
          failed: run.failures.length,
          device: run.results[0]?.providerMetadata?.['device'] ?? null,
          categorySummary,
          perResume,
          reports: reportPaths,
        },
        null,
        2,
      ),
    );
  });

program
  .command('benchmark:stability')
  .description('Repeat Laya scoring on a fixed Role Radar sample with cache bypassed')
  .option('--pairs <number>', 'number of fixed pairs', parsePositiveInteger, 50)
  .option('--runs <number>', 'number of repeated runs', parsePositiveInteger, 3)
  .action(async (options: { pairs: number; runs: number }) => {
    const data = await loadRoleRadarDataset(config.rawDir);
    const joined = joinRoleRadarLabels(data, data.phase3Labels);
    const sample = sampleRoleRadarPairs(joined.pairs, options.pairs, 42);
    const runs: BatchRunResult[] = [];
    for (let index = 0; index < options.runs; index += 1) {
      runs.push(
        await executeBatch({
          dataset: `role-radar-stability-${index + 1}`,
          datasetVersionOrHash: data.datasetVersionOrHash,
          pairs: sample.map((pair) => pair.input),
          noCache: true,
        }),
      );
    }
    const base = runs[0]?.results ?? [];
    const maps = runs.map(
      (run) =>
        new Map(run.results.map((result) => [pairKey(result.jobId, result.candidateId), result])),
    );
    const differences: number[] = [];
    const rankCorrelations: number[] = [];
    for (const map of maps.slice(1)) {
      const joinedResults = base.flatMap((first) => {
        const other = map.get(pairKey(first.jobId, first.candidateId));
        return other ? [{ first, other }] : [];
      });
      if (joinedResults.length > 0) {
        differences.push(
          ...joinedResults.map(({ first, other }) =>
            Math.abs(first.compositeScore - other.compositeScore),
          ),
        );
        const correlation = spearmanCorrelation(
          joinedResults.map(({ first }) => first.compositeScore),
          joinedResults.map(({ other }) => other.compositeScore),
        );
        if (correlation !== null) rankCorrelations.push(correlation);
      }
    }
    const reportDir = path.join(
      config.outputDir,
      'reports',
      runs[0]?.runId ?? `stability-${Date.now()}`,
    );
    const stability = {
      fixedPairCount: sample.length,
      runCount: runs.length,
      meanAbsoluteScoreDifference: differences.length
        ? differences.reduce((sum, value) => sum + value, 0) / differences.length
        : null,
      spearmanAgainstFirstRun: rankCorrelations.length
        ? rankCorrelations.reduce((sum, value) => sum + value, 0) / rankCorrelations.length
        : null,
      runIds: runs.map((run) => run.runId),
      noCache: true,
    };
    await writeJsonReport(reportDir, stability);
    await writeMarkdownReport(reportDir, {
      title: 'Laya Stability Benchmark',
      sections: [{ heading: 'Results', content: codeBlock(stability) }],
    });
    console.log(JSON.stringify({ stability, reportDir }, null, 2));
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

type ExecuteBatchInput = {
  dataset: string;
  datasetVersionOrHash: string;
  pairs: Array<{ job: JobInput; candidate: CandidateInput }>;
  jobId?: string;
  noCache: boolean;
  maxRetries?: number;
};

async function executeBatch(input: ExecuteBatchInput): Promise<BatchRunResult> {
  await ensureOutputDirectories(config);
  const evaluator = await createLocalLayaEvaluator(config);
  try {
    return await executeBatchWithEvaluator(input, evaluator);
  } finally {
    await evaluator.close?.();
  }
}

async function executeBatchWithEvaluator(
  input: ExecuteBatchInput,
  evaluator: CandidateEvaluator,
): Promise<BatchRunResult> {
  const cache = new EvaluationCache(config.cacheDir, config.model);
  let preflightRun: BatchRunResult | undefined;
  let preflightReportPath: string | undefined;
  let preflightProjection: ReturnType<typeof projectModelPreflight> | undefined;

  if (input.pairs.length >= 500) {
    if (input.noCache) {
      throw new Error(
        '--no-cache cannot be used for 500+ runs because it would repeat the ten model preflight evaluations.',
      );
    }
    const samplePairs = input.pairs.slice(0, REQUIRED_MODEL_PREFLIGHT_SIZE);
    preflightRun = await runBatch({
      dataset: `${input.dataset}-model-preflight`,
      datasetVersionOrHash: input.datasetVersionOrHash,
      ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      pairs: samplePairs,
      evaluator,
      outputRoot: config.outputDir,
      noCache: true,
      concurrency: 1,
      maxRetries: 0,
      stopOnFailure: true,
    });
    let reason: string | undefined;
    if (
      preflightRun.results.length !== REQUIRED_MODEL_PREFLIGHT_SIZE ||
      preflightRun.failures.length > 0
    ) {
      const cause = preflightRun.failures.find((failure) => failure.attempts > 0);
      reason = cause?.message ?? 'The ten-call sample did not complete successfully.';
    } else {
      try {
        preflightProjection = projectModelPreflight(
          preflightRun.results,
          input.pairs.length,
          config.model,
        );
      } catch (error) {
        reason =
          error instanceof Error ? error.message : 'Local model usage could not be verified.';
      }
    }
    preflightReportPath = await writeModelPreflightReport({
      outputDir: config.outputDir,
      provider: config.provider,
      model: config.model,
      dataset: input.dataset,
      targetCount: input.pairs.length,
      results: preflightRun.results,
      failures: preflightRun.failures,
      ...(preflightProjection === undefined ? {} : { projection: preflightProjection }),
      ...(reason === undefined ? {} : { reason }),
    });
    console.log(
      JSON.stringify(
        { modelPreflight: preflightProjection ?? null, reportPath: preflightReportPath },
        null,
        2,
      ),
    );
    if (reason || !preflightProjection) {
      throw new Error(
        `${reason ?? 'The selected provider could not be verified.'} Full run was not started. Preflight report: ${preflightReportPath}`,
      );
    }
    for (const pair of samplePairs) {
      const result = preflightRun.results.find(
        (item) => item.candidateId === pair.candidate.id && item.jobId === pair.job.id,
      );
      if (!result)
        throw new Error(
          'A successful model preflight result could not be matched to its input pair.',
        );
      await cache.set(pair, result);
    }
  }

  const run = await runBatch({
    dataset: input.dataset,
    datasetVersionOrHash: input.datasetVersionOrHash,
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    pairs: input.pairs,
    evaluator,
    outputRoot: config.outputDir,
    cache,
    noCache: input.noCache,
    concurrency: 1,
    maxRetries: 0,
    stopOnFailure: true,
    onProgress: ({ completed, total, successful, failed, cached }) => {
      if (completed === total || completed % Math.max(1, Math.ceil(total / 20)) === 0) {
        process.stderr.write(
          `\r${completed}/${total} complete · ${successful} succeeded · ${failed} failed · ${cached} cached`,
        );
        if (completed === total) process.stderr.write('\n');
      }
    },
  });
  if (preflightRun && preflightProjection && preflightReportPath) {
    run.manifest.liveRequestCount += preflightRun.manifest.liveRequestCount;
    run.manifest.cachedCount = Math.max(0, run.manifest.cachedCount - preflightRun.results.length);
    run.manifest.elapsedMs += preflightRun.manifest.elapsedMs;
    run.manifest.providerReportedCostUsd =
      (run.manifest.providerReportedCostUsd ?? 0) + preflightProjection.observedCostUsd;
    run.manifest.modelPreflightReportPath = path.relative(config.rootDir, preflightReportPath);
  }
  const failure = run.failures.find((item) => item.attempts > 0);
  if (failure) {
    throw new Error(
      `${failure.message} Stopped without retry or paid-model fallback. Partial run: ${run.runDir}`,
    );
  }
  return run;
}

function fixtureInput(): { job: JobInput; candidate: CandidateInput } {
  return {
    job: {
      id: 'smoke-job',
      title: 'Senior TypeScript Backend Engineer',
      seniority: 'Senior individual contributor',
      description: [
        'Required skills: TypeScript, Node.js, PostgreSQL, REST API design, automated testing.',
        'Responsibilities: build and operate backend services, review code, improve reliability.',
        'Must-have: professional TypeScript backend experience.',
      ].join('\n'),
    },
    candidate: {
      id: 'smoke-candidate',
      source: 'custom',
      resumeText: [
        'Backend Engineer',
        'Professional experience building TypeScript and Node.js services with PostgreSQL.',
        'Designed REST APIs, wrote automated tests, reviewed code, and improved service reliability.',
      ].join('\n'),
    },
  };
}

function confidenceExamples(
  results: Parameters<typeof computeRoleRadarMetrics>[0],
  labels: ReadonlyMap<string, number>,
): { lowestConfidence: unknown[]; largestDisagreements: unknown[] } {
  const matched = results.flatMap((result) => {
    const actual = labels.get(pairKey(result.jobId, result.candidateId));
    return actual === undefined ? [] : [{ result, actual }];
  });
  return {
    lowestConfidence: [...matched]
      .filter(({ result }) => result.aggregateConfidence !== undefined)
      .sort((a, b) => a.result.aggregateConfidence! - b.result.aggregateConfidence!)
      .slice(0, 10)
      .map(({ result }) => ({
        candidateId: result.candidateId,
        jobId: result.jobId,
        confidence: result.aggregateConfidence,
      })),
    largestDisagreements: [...matched]
      .sort(
        (a, b) =>
          Math.abs(b.result.compositeScore - b.actual) -
          Math.abs(a.result.compositeScore - a.actual),
      )
      .slice(0, 10)
      .map(({ result, actual }) => ({
        candidateId: result.candidateId,
        jobId: result.jobId,
        layaScore: result.compositeScore,
        labelScore: actual,
        absoluteDifference: Math.abs(result.compositeScore - actual),
      })),
  };
}

function resultDimension(
  result: CandidateMatchResult,
  key: 'requiredSkills' | 'relevantExperience' | 'seniority' | 'domainMatch',
): { scoreOnFive: number; normalizedPercent: number; confidence: number | null } {
  const dimension = result.dimensions[key];
  return {
    scoreOnFive: dimension.rawScore,
    normalizedPercent: dimension.normalizedScore * 100,
    confidence: dimension.confidence ?? null,
  };
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function printRunPaths(run: BatchRunResult): void {
  console.log(
    JSON.stringify({ runId: run.runId, runDirectory: run.runDir, manifest: run.manifest }, null, 2),
  );
}

function codeBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('Expected a positive integer');
  return parsed;
}

function parseNonnegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Expected a nonnegative integer');
  return parsed;
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error('Expected an integer');
  return parsed;
}
