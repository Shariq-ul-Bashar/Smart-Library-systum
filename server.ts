import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './src/server/routes/auth.ts';
import { booksAndCirculationRouter } from './src/server/routes/books-and-circulation.ts';
import { orgAdminRouter } from './src/server/routes/org-admin.ts';
import { part2AdvancedRouter } from './src/server/routes/part2-advanced.ts';
import { platformRouter } from './src/server/routes/platform.ts';
import { studentsAndIdsRouter } from './src/server/routes/students-and-ids.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Mount QIVORA REST APIs (Part 1 + Part 2)
  app.use('/api', authRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api', orgAdminRouter);
  app.use('/api', studentsAndIdsRouter);
  app.use('/api', booksAndCirculationRouter);
  app.use('/api', part2AdvancedRouter);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'QIVORA — Smart Library Management System',
      tagline: 'Intelligence for Every Library.',
      timestamp: new Date().toISOString(),
    });
  });

  // Catch unmatched /api/* routes with JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`QIVORA server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
