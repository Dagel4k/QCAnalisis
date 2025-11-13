import { AnalysisJob } from '@/types';
import { EventEmitter } from 'events';

class JobManager extends EventEmitter {
  private jobs: Map<string, AnalysisJob> = new Map();
  private runningJobs: Set<string> = new Set();
  private queue: string[] = [];

  createJob(job: AnalysisJob): AnalysisJob {
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.emit('job:created', job);
    this.processQueue();
    return job;
  }

  getJob(id: string): AnalysisJob | undefined {
    return this.jobs.get(id);
  }

  updateJob(id: string, updates: Partial<AnalysisJob>): void {
    const job = this.jobs.get(id);
    if (job) {
      Object.assign(job, updates);
      this.jobs.set(id, job);
      this.emit('job:updated', job);
    }
  }

  addLog(id: string, log: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.logs.push(log);
      this.emit('job:log', { id, log });
    }
  }

  setJobRunning(id: string): void {
    this.updateJob(id, {
      status: 'running',
      startedAt: new Date(),
    });
    this.runningJobs.add(id);
  }

  setJobSucceeded(id: string): void {
    this.updateJob(id, {
      status: 'succeeded',
      finishedAt: new Date(),
    });
    this.runningJobs.delete(id);
    this.processQueue();
  }

  setJobFailed(id: string, error: string): void {
    this.updateJob(id, {
      status: 'failed',
      error,
      finishedAt: new Date(),
    });
    this.runningJobs.delete(id);
    this.processQueue();
  }

  isRepoRunning(repoSlug: string): boolean {
    for (const jobId of this.runningJobs) {
      const job = this.jobs.get(jobId);
      if (job?.repoSlug === repoSlug) {
        return true;
      }
    }
    return false;
  }

  private processQueue(): void {
    // Simple queue: one job at a time per repo
    // Can be extended to support more complex logic
    this.emit('queue:updated');
  }

  getJobsByRepo(repoSlug: string): AnalysisJob[] {
    return Array.from(this.jobs.values())
      .filter(job => job.repoSlug === repoSlug)
      .sort((a, b) => {
        const aTime = a.startedAt?.getTime() || 0;
        const bTime = b.startedAt?.getTime() || 0;
        return bTime - aTime;
      });
  }
}

export const jobManager = new JobManager();
