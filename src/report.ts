export type ProblemType = 'video' | 'audio' | 'subtitles' | 'missing' | 'other';

export type ReportCandidate = {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year?: number;
  seerrMediaId?: number;
  onServer: boolean;
};

const ISSUE_TYPE: Record<ProblemType, number> = {
  video: 1,
  audio: 2,
  subtitles: 3,
  missing: 4,
  other: 4,
};

const PROBLEM_LABEL: Record<ProblemType, string> = {
  video: 'Video',
  audio: 'Audio',
  subtitles: 'Subtitles',
  missing: 'Missing episode',
  other: 'Other',
};

export function parseProblem(value: string | undefined): ProblemType | undefined {
  if (value === 'video' || value === 'audio' || value === 'subtitles' || value === 'missing' || value === 'other') {
    return value;
  }
  return undefined;
}

export function problemLabel(problem: ProblemType): string {
  return PROBLEM_LABEL[problem];
}

export function buildIssue(input: {
  problem: ProblemType;
  description: string;
  mediaId: number;
  reporter: string;
}): { issueType: number; message: string; mediaId: number } {
  return {
    issueType: ISSUE_TYPE[input.problem],
    mediaId: input.mediaId,
    message: `${PROBLEM_LABEL[input.problem]}\n${input.description.trim()}\n\nReported on Discord by ${input.reporter}`,
  };
}

export function chooseReportTarget(
  candidates: ReportCandidate[],
  query: string,
): { action: 'use'; candidate: ReportCandidate } | { action: 'choose'; candidates: ReportCandidate[] } | { action: 'none' } {
  const onServer = candidates.filter((candidate) => candidate.onServer && candidate.seerrMediaId);
  if (onServer.length === 0) return { action: 'none' };
  if (onServer.length === 1) return { action: 'use', candidate: onServer[0] };
  const needle = query.trim().toLowerCase();
  const exact = onServer.filter((candidate) => candidate.title.trim().toLowerCase() === needle);
  if (exact.length === 1) return { action: 'use', candidate: exact[0] };
  return { action: 'choose', candidates: onServer };
}
