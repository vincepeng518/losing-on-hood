import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

function loadJsonFile(filePath: string): any | null {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content) {
        return JSON.parse(content);
      }
    }
  } catch (err) {
    console.warn(`[API] Failed to parse ${filePath}:`, err);
  }
  return null;
}

function getPaperStateData(): any {
  const dataPath = path.resolve(process.cwd(), 'paper_data/paper_state.json');
  const tradePath = path.resolve(process.cwd(), 'paper_trade/paper_state.json');
  
  if (fs.existsSync(dataPath)) {
    const data = loadJsonFile(dataPath);
    if (data && typeof data === 'object') return data;
  }
  if (fs.existsSync(tradePath)) {
    const data = loadJsonFile(tradePath);
    if (data && typeof data === 'object') return data;
  }
  return {
    start_equity: 100.0,
    cash_usd: 100.0,
    positions: {},
    closed: [],
    agent_log: [],
  };
}

function getLiveStateData(): any {
  const rootLive = path.resolve(process.cwd(), 'state.json');
  const archiveLive = path.resolve(process.cwd(), 'paper_data/live_archive_old_strategy.json');
  const dataLive = path.resolve(process.cwd(), 'paper_data/state.json');

  if (fs.existsSync(rootLive)) {
    const data = loadJsonFile(rootLive);
    if (data && typeof data === 'object') return data;
  }
  if (fs.existsSync(archiveLive)) {
    const data = loadJsonFile(archiveLive);
    if (data && typeof data === 'object') return data;
  }
  if (fs.existsSync(dataLive)) {
    const data = loadJsonFile(dataLive);
    if (data && typeof data === 'object') return data;
  }
  return {
    start_equity: 110.0,
    cash_usd: 110.0,
    equity_usd: 110.0,
    positions: {},
    closed: [],
    agent_log: [],
  };
}

function apiPlugin() {
  const handler = (req: any, res: any, next: any) => {
    const rawUrl = req.url || '';
    const pathname = rawUrl.split('?')[0].replace(/\/+$/, '') || '/';

    if (pathname === '/api/health') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.end(JSON.stringify({ status: 'ok', port: 3000 }));
      return;
    }
    if (pathname === '/api/state') {
      const data = getPaperStateData();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.end(JSON.stringify(data));
      return;
    }
    if (pathname === '/api/live') {
      const data = getLiveStateData();
      if (!data._onchain_usd && data.equity_usd) {
        data._onchain_usd = data.equity_usd;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.end(JSON.stringify(data));
      return;
    }
    next();
  };

  return {
    name: 'api-endpoints',
    configureServer(server: any) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    apiPlugin(),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
  },
});
