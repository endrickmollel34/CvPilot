import type { DefaultJobOptions } from 'bullmq';

// Privacy P1 — BullMQ/Redis job retention. Before this, no queue set
// removeOnComplete/removeOnFail anywhere, so BullMQ's own default applied:
// every completed and failed job is kept in Redis FOREVER (removed only by
// an explicit queue.clean()/obliterate() call, which this codebase never
// makes). One queue's payload — 'cover-letter' (job name 'generate-letter',
// see CoverLetterJobData) — carries real job-application content
// (jobTitle, companyName, jobDescription, the pasted job posting text), so
// unbounded retention there was an unbounded personal/job-data retention
// gap in Redis, independent of — and outliving — anything the app-level
// CV/CoverLetter/Analysis/Tailoring deletion work already fixed in
// Postgres/R2. The other three queues (cv-parsing, cv-analysis,
// cv-tailoring) only ever carry internal UUIDs (cvId/analysisId/
// tailoringId), so this is a smaller concern there, but one consistent
// policy is applied everywhere rather than special-casing.
//
// removeOnComplete/removeOnFail: true — not an age/count KeepJobs object.
// BullMQ's age-based cleanup is LAZY: an expired job is only actually
// evicted once a LATER job of the same kind (completed or failed) finishes
// past the age threshold (see bullmq's own KeepJobs doc comment) — there is
// no background timer. For a low-volume queue (this product's actual
// traffic — Free plan: 2 analyses, 1 cover letter per month), especially
// 'cover-letter', a failed job's full jobDescription/companyName payload
// could sit in Redis far longer than any configured age if no subsequent
// job of that same queue+outcome happens to finish afterward. That is not
// an acceptable privacy posture for a payload containing real job-
// application text, so age/count retention was replaced with `true`:
// BullMQ removes the job immediately once it reaches its terminal state
// (completed, or failed after all configured attempts are exhausted) —
// no dependency on a later job arriving to trigger the sweep. This applies
// only to the two TERMINAL states; a job that is waiting, active, delayed,
// or retrying is never touched by this option — see each service's
// process() catch block, none of which sets a BullMQ `attempts` option
// (default 1), so "failed" here already means "will not retry".
//
// Nothing in this codebase reads completed/failed BullMQ job history for
// anything (verified: no getJob/getState/QueueEvents/FlowProducer/jobId
// dedup, no Bull Board or other admin tooling). Final status and results
// are always read from the corresponding Postgres row (AnalysisEntity/
// CoverLetterEntity/TailoringEntity/CvEntity) via the app's own
// findOneForUser()/listForUser() methods, and the two SSE "status" streams
// (AnalysisService/CoverLetterService.statusStream) are backed by an
// in-process EventEmitter2 event fired from inside process() itself, never
// by BullMQ job state — so removing a job from Redis the instant it
// finishes discards nothing the application, its polling, or its SSE
// streams depend on.
export const QUEUE_JOB_RETENTION: Pick<DefaultJobOptions, 'removeOnComplete' | 'removeOnFail'> = {
  removeOnComplete: true,
  removeOnFail: true,
};
