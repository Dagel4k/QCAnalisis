import express from 'express';
import cors from 'cors';
import path from 'path';
import { reposRouter } from './routes/repos';
import { analyzeRouter } from './routes/analyze';
import { jobsRouter } from './routes/jobs';
import { branchesRouter } from './routes/branches';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/repos', reposRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/branches', branchesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
