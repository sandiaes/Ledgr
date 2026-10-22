import type { IsoDate } from '@ledgr/core';
import type { Issue, JobName, JobRunRecord, JobsDb } from '../db';
import { HttpError, ProviderError, type HttpOptions } from '../http';
import type { ProviderRegistry } from '../providers';
import { RestDbError } from '../rest-db';

export interface JobContext {
  db: JobsDb;
  http: HttpOptions;
  providers: ProviderRegistry;
  /** The run's date (UTC). Daily jobs value and fetch up to the day before. */
  today: IsoDate;
  trigger: 'cron' | 'script';
  staleAfterDays: number;
  caMaxAgeDays: number;
  now: () => Date;
}

export interface JobOutcome {
  status: 'ok' | 'partial' | 'failed';
  counts: Record<string, number>;
  issues: Issue[];
}

const MAX_ISSUES = 200;

/** Collects issues, keeping at most 200 (the rest are counted in issues_dropped). */
export class IssueLog {
  readonly issues: Issue[] = [];
  dropped = 0;
  add(issue: Issue): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push(issue);
    else this.dropped++;
  }
}

/** An error as an issue: its class and status only, never its message text. */
export function errorIssue(e: unknown, extra: Omit<Issue, 'code'> = {}): Issue {
  if (e instanceof HttpError)
    return { ...extra, code: 'http_error', provider: e.provider, status: e.status };
  if (e instanceof ProviderError) return { ...extra, code: e.code, provider: e.provider };
  if (e instanceof RestDbError) return { ...extra, code: 'db_error', status: e.status };
  return { ...extra, code: e instanceof Error ? e.name : 'error' };
}

/** Runs a job and records it in job_runs. A failure to record never hides the outcome. */
export async function runRecorded(
  ctx: JobContext,
  job: JobName,
  fn: () => Promise<JobOutcome>,
): Promise<JobRunRecord> {
  const startedAt = ctx.now().toISOString();
  let outcome: JobOutcome;
  try {
    outcome = await fn();
  } catch (e) {
    outcome = { status: 'failed', counts: {}, issues: [errorIssue(e)] };
  }
  const run: JobRunRecord = {
    job,
    trigger: ctx.trigger,
    startedAt,
    finishedAt: ctx.now().toISOString(),
    ...outcome,
  };
  try {
    await ctx.db.recordRun(run);
  } catch (e) {
    run.issues = [...run.issues, { ...errorIssue(e), code: 'job_run_not_recorded' }];
  }
  return run;
}
