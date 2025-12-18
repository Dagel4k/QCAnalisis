import { Router } from 'express';
import { jobManager } from '../../src/lib/jobs.js';
import { cancelAnalysis } from '../../src/lib/analyzer.js';
import type { AnalysisJob } from '../../src/types/index.js';

export const jobsRouter = Router();

// GET /api/jobs/:id/status - Get job status
jobsRouter.get('/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const job = jobManager.getJob(id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(job);
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// GET /api/jobs/:id/stream - SSE stream for job logs
jobsRouter.get('/:id/stream', (req, res) => {
  const { id } = req.params;
  const job = jobManager.getJob(id);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send existing logs
  for (const log of job.logs) {
    res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
  }
  
  // Listen for new logs
  const logHandler = ({ id: jobId, log }: { id: string; log: string }) => {
    if (jobId === id) {
      res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
    }
  };
  
  const updateHandler = (updatedJob: AnalysisJob) => {
    if (updatedJob.id === id) {
      res.write(`data: ${JSON.stringify({ type: 'job', data: {
        id: updatedJob.id,
        status: updatedJob.status,
        progress: updatedJob.progress ?? null,
        phase: updatedJob.phase ?? null,
      } })}\n\n`);
      
      // Close stream when job is finished
      if (updatedJob.status === 'succeeded' || updatedJob.status === 'failed') {
        res.end();
      }
    }
  };
  
  jobManager.on('job:log', logHandler);
  jobManager.on('job:updated', updateHandler);
  
  // Cleanup on client disconnect
  req.on('close', () => {
    jobManager.off('job:log', logHandler);
    jobManager.off('job:updated', updateHandler);
    res.end();
  });
});

// POST /api/jobs/:id/cancel - cancel a running job
jobsRouter.post('/:id/cancel', (req, res) => {
  const { id } = req.params;
  const job = jobManager.getJob(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'running') return res.status(409).json({ error: 'Job is not running' });

  const ok = cancelAnalysis(id);
  if (!ok) return res.status(500).json({ error: 'Failed to cancel job' });
  return res.json({ ok: true });
});

// GET /api/jobs/repo/:slug - Get all jobs for a repo
jobsRouter.get('/repo/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const jobs = jobManager.getJobsByRepo(slug);
    res.json(jobs);
  } catch (error) {
    console.error('Error getting repo jobs:', error);
    res.status(500).json({ error: 'Failed to get repo jobs' });
  }
});
