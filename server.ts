import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/translate', async (req, res) => {
    try {
      const { text, source, target } = req.body ?? {};
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text is required.' });
      }
      if (typeof target !== 'string' || !target.trim()) {
        return res.status(400).json({ error: 'Target language is required.' });
      }

      const ai = getGenAI();
      if (!ai) {
        return res.status(503).json({ error: 'Translation service is not connected yet.' });
      }

      const sourceLabel = source && source !== 'auto' ? source : 'auto-detected language';
      const prompt = `Translate the following text from ${sourceLabel} to ${target}. Return only the translated text with no extra commentary, quotes, or explanations.\n\n${text}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });

      const translation = response.text?.trim() ?? '';
      if (!translation) {
        return res.status(502).json({ error: 'The translation service returned an empty result.' });
      }

      return res.json({ translation });
    } catch (err) {
      console.error('Translation error:', err);
      return res.status(500).json({ error: 'Translation service encountered an error.' });
    }
  });

  app.post('/api/ocr', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Image file is required.' });
      }

      const ai = getGenAI();
      if (!ai) {
        return res.status(503).json({ error: 'Image OCR service is not connected yet.' });
      }

      const language = typeof req.body?.language === 'string' ? req.body.language : 'auto';
      const langHint = language && language !== 'auto' ? ` The text is primarily in ${language}.` : '';
      const base64Data = req.file.buffer.toString('base64');

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: req.file.mimetype || 'image/png',
                  data: base64Data,
                },
              },
              {
                text: `Extract all visible text from this image.${langHint} Return only the extracted text, preserving line breaks, with no extra commentary.`,
              },
            ],
          },
        ],
      });

      const text = response.text?.trim() ?? '';
      if (!text) {
        return res.status(422).json({ error: 'No text was detected in this image.' });
      }

      return res.json({ text });
    } catch (err) {
      console.error('OCR error:', err);
      return res.status(500).json({ error: 'OCR service encountered an error.' });
    }
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
    console.log(`LAFZ Translation server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
