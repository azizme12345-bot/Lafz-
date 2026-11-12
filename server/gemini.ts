import { GoogleGenAI } from '@google/genai';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export function setCorsHeaders(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function handleApiError(err: unknown, res: any) {
  console.error('API Error:', err);
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  let rawMessage = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed.error && parsed.error.message) {
      rawMessage = parsed.error.message;
    }
  } catch {}

  const safeMessage = rawMessage.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED]');
  if (safeMessage.includes('API key not valid') || safeMessage.includes('API_KEY_INVALID')) {
    return res.status(503).json({ error: 'GEMINI_API_KEY is invalid.' });
  }

  return res.status(500).json({ error: safeMessage || 'Internal server error.' });
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || !apiKey.trim()) {
    throw new HttpError(503, 'GEMINI_API_KEY is not set on the server.');
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateWithFallback(
  ai: GoogleGenAI,
  params: { contents: any; config?: any }
) {
  const models = [
    process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite',
  ].filter((v, i, a) => a.indexOf(v) === i);

  let lastError: any = null;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });
      return { response, modelUsed: model };
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '');
      console.warn(`[Gemini] Model ${model} encountered issue:`, msg);
      if (
        msg.includes('503') ||
        msg.includes('404') ||
        msg.includes('high demand') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('NOT_FOUND')
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export async function translateText({
  text,
  source,
  target,
}: {
  text: string;
  source?: string;
  target: string;
}): Promise<string> {
  if (typeof text !== 'string' || !text.trim()) {
    throw new HttpError(400, 'Text is required.');
  }

  if (text.length > 2000) {
    throw new HttpError(400, 'Text exceeds 2000 characters limit.');
  }

  if (typeof target !== 'string' || !target.trim()) {
    throw new HttpError(400, 'Target language is required.');
  }

  const ai = getGeminiClient();
  const sourceLabel = source && source !== 'auto' ? source : 'auto-detected language';
  const prompt = `You are a professional translator. Translate the following text from ${sourceLabel} to ${target}. Return ONLY the direct translation, with no quotes, notes, preamble, or explanations.\n\n${text}`;

  const { response } = await generateWithFallback(ai, {
    contents: prompt,
  });

  const translation = response.text?.trim() ?? '';
  if (!translation) {
    throw new HttpError(502, 'The translation service returned an empty result.');
  }

  return translation;
}

export async function ocrImage({
  imageBase64,
  mimeType,
  language,
}: {
  imageBase64: string;
  mimeType: string;
  language?: string;
}): Promise<string> {
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    throw new HttpError(400, 'Image data (imageBase64) is required.');
  }

  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '').trim();
  const byteLength = Buffer.byteLength(cleanBase64, 'base64');
  if (byteLength > 4 * 1024 * 1024) {
    throw new HttpError(413, 'Image payload exceeds 4 MB limit.');
  }

  const cleanMime = (mimeType || 'image/jpeg').split(';')[0].trim().toLowerCase();
  const normalizedMime = cleanMime === 'image/jpg' ? 'image/jpeg' : cleanMime;
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];

  if (!allowedMimes.includes(normalizedMime)) {
    throw new HttpError(400, 'Invalid mimeType. Supported formats: image/jpeg, image/png, image/webp.');
  }

  const ai = getGeminiClient();
  const langHint = language && language !== 'auto' ? ` The text in the image is expected to be in ${language}.` : '';
  const prompt = `Extract and transcribe all readable text from this image exactly as written.${langHint} Preserve original paragraph breaks. Do NOT add preamble, summaries, commentary, or markdown formatting around the output. Return only the extracted text.`;

  const { response } = await generateWithFallback(ai, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: normalizedMime,
              data: cleanBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
  });

  const text = response.text?.trim() ?? '';
  if (!text) {
    throw new HttpError(422, 'No text was detected in this image.');
  }

  return text;
}

export async function transcribeAudio({
  audioBase64,
  mimeType,
  language,
}: {
  audioBase64: string;
  mimeType?: string;
  language?: string;
}): Promise<string> {
  if (typeof audioBase64 !== 'string' || !audioBase64.trim()) {
    throw new HttpError(400, 'Audio data (audioBase64) is required.');
  }

  const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '').trim();
  const byteLength = Buffer.byteLength(cleanBase64, 'base64');
  if (byteLength > 4 * 1024 * 1024) {
    throw new HttpError(413, 'Audio payload exceeds 4 MB limit.');
  }

  const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
  const ai = getGeminiClient();
  const langHint = language && language !== 'auto' ? ` The spoken language is ${language}.` : '';
  const prompt = `Transcribe the spoken words from this audio recording accurately.${langHint} Return only the direct verbatim transcription. Do not include timestamps, speaker labels, punctuation tags, or commentary.`;

  const { response } = await generateWithFallback(ai, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: cleanBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
  });

  const text = response.text?.trim() ?? '';
  if (!text) {
    throw new HttpError(422, 'No speech was detected in this audio recording.');
  }

  return text;
}
