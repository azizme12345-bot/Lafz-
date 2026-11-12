import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  translateText,
  ocrImage,
  transcribeAudio,
  setCorsHeaders,
  handleApiError,
  GEMINI_MODEL,
} from './server/gemini.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

async function startServer() {
  const app = express();

  // Support up to 10MB payloads for base64 image and audio
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // CORS and OPTIONS handling for /api routes
  app.use('/api', (req, res, next) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // POST /api/translate
  app.post('/api/translate', async (req, res) => {
    try {
      const { text, source, target } = req.body ?? {};
      const translation = await translateText({ text, source, target });
      return res.status(200).json({ translation });
    } catch (err) {
      return handleApiError(err, res);
    }
  });

  // POST /api/ocr
  app.post('/api/ocr', async (req, res) => {
    try {
      const { imageBase64, mimeType, language } = req.body ?? {};
      const text = await ocrImage({ imageBase64, mimeType, language });
      return res.status(200).json({ text });
    } catch (err) {
      return handleApiError(err, res);
    }
  });

  // POST /api/speech-to-text
  app.post('/api/speech-to-text', async (req, res) => {
    try {
      const { audioBase64, mimeType, language } = req.body ?? {};
      const text = await transcribeAudio({ audioBase64, mimeType, language });
      return res.status(200).json({ text });
    } catch (err) {
      return handleApiError(err, res);
    }
  });

  // Health/status endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      model: GEMINI_MODEL,
      hasKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
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
    console.log(`LAFZ Translation server listening on http://0.0.0.0:${PORT} (model: ${GEMINI_MODEL})`);
  });
}

startServer();
