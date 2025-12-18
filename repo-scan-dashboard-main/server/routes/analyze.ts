import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getRepository } from '../../src/lib/config.js';
import { jobManager } from '../../src/lib/jobs.js';
import { runAnalysis } from '../../src/lib/analyzer.js';
import type { AnalysisOptions } from '../../src/types/index.js';

export const analyzeRouter = Router();

// POST /api/analyze - Start a new analysis job
analyzeRouter.post('/', async (req, res) => {
  try {
    const { repoSlug, options } = req.body as {
      repoSlug: string;
      options: AnalysisOptions;
    };

    // Validate repo exists
    const repo = getRepository(repoSlug);
    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    // Check if repo is already being analyzed
    if (jobManager.isRepoRunning(repoSlug)) {
      return res.status(409).json({ error: 'Repository is already being analyzed' });
    }

    // Create job
    const jobId = uuidv4();
    jobManager.createJob({
      id: jobId,
      repoSlug,
      status: 'queued',
      mode: options.mode,
      options,
      logs: [],
    });

    // Start analysis in background
    runAnalysis(jobId, repoSlug, repo.repoUrl, options).catch((error: unknown) => {
      console.error('Analysis error:', error);
    });

    res.json({ jobId, status: 'queued' });
  } catch (error) {
    console.error('Error starting analysis:', error);
    res.status(500).json({ error: 'Failed to start analysis' });
  }
});
