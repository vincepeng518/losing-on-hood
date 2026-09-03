import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import path from 'path';

function apiPlugin() {
  return {
    name: 'api-endpoints',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/api/health') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ok', port: 3000 }));
          return;
        }
        if (req.url === '/api/state') {
          const filePath = path.resolve(process.cwd(), 'paper_trade/paper_state.json');
          const data = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '{}';
          res.setHeader('Content-Type', 'application/json');
          res.end(data);
          return;
        }
        if (req.url === '/api/live') {
          const filePath = path.resolve(process.cwd(), 'state.json');
          const data = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '{}';
          res.setHeader('Content-Type', 'application/json');
          res.end(data);
          return;
        }
        next();
      });
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
