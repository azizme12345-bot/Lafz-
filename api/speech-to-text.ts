import { transcribeAudio, setCorsHeaders, handleApiError } from '../server/gemini.ts';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = await transcribeAudio({
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
      language: body.language,
    });
    return res.status(200).json({ text });
  } catch (err) {
    return handleApiError(err, res);
  }
}
