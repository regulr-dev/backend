import { createServer } from 'node:http';
import { app } from './app.js';
import { config } from './config.js';
import { useBlob } from './uploads.js';

// Standalone backend server: `npm run dev` locally or `npm start` in production.
// (Vercel serverless runs src/app.ts through api/index.js directly).

const httpServer = createServer(app);

httpServer.listen(config.port, () => {
  console.log(`Regulr Backend running on port ${config.port} (${config.publicUrl})`);
  console.log(`  Google Sign-In: ${config.googleClientId ? 'on' : 'off'} | Dev login: ${config.devLogin ? 'on' : 'off'}`);
  console.log(`  Google Wallet: ${config.googleWallet ? 'on' : 'off (web card only)'} | NTAG 424 keys: ${config.sun.metaKey ? 'on' : 'off'}`);
  console.log(`  Uploads: ${useBlob ? 'Vercel Blob' : 'local uploads/ folder'}`);
});
