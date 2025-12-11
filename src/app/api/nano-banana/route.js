import { NextResponse } from 'next/server';

const MODEL_NAME = 'gemini-3-pro-image-preview';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;

// Very simple in-memory, per-IP render counter.
// This resets whenever the server restarts and is only
// meant as a basic safety valve, not a strong quota system.
const MAX_RENDERS_PER_IP = 10;
const ipUsage = new Map();

function getClientKey(request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  // Fallback: this will group all "unknown" users together,
  // but that's acceptable for a very basic limiter.
  return 'unknown';
}

export async function GET(request) {
  const key = getClientKey(request);
  const used = ipUsage.get(key) ?? 0;
  const remaining = Math.max(0, MAX_RENDERS_PER_IP - used);

  return NextResponse.json({
    limit: MAX_RENDERS_PER_IP,
    used,
    remaining,
  });
}

export async function POST(request) {
  try {
    const key = getClientKey(request);
    const usedSoFar = ipUsage.get(key) ?? 0;
    const remainingBefore = Math.max(0, MAX_RENDERS_PER_IP - usedSoFar);

    if (remainingBefore <= 0) {
      console.warn('[nano-banana] Render limit reached for key', key);
      return NextResponse.json(
        {
          error:
            'Render limit reached for this browser. Please come back later or restart the server.',
          limit: MAX_RENDERS_PER_IP,
          used: usedSoFar,
          remaining: 0,
        },
        { status: 429 }
      );
    }

    const { imageData, prompt } = (await request.json()) || {};

    if (!imageData || typeof imageData !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field `imageData`.' },
        { status: 400 }
      );
    }

    console.log('[nano-banana] Incoming request');

    const apiKey =
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_API_KEY;

    if (!apiKey) {
      console.error(
        '[nano-banana] Missing Google Generative AI API key environment variable.'
      );
      return NextResponse.json(
        { error: 'Server is not configured with a Google Generative AI API key.' },
        { status: 500 }
      );
    }

    const commaIndex = imageData.indexOf(',');
    const base64Data =
      commaIndex >= 0 ? imageData.slice(commaIndex + 1) : imageData;

    const mimeMatch = imageData.match(/^data:(.*?);base64,/);
    const mimeType = mimeMatch?.[1] || 'image/png';

    // Fallback prompt (original version)
    const FALLBACK_PROMPT =
      'A photorealistic aerial architectural visualization strictly adhering to the geometry provided in the input. \
1. Building: The basic building massing models must be rendered as fully realized structures while maintaining their exact volumetric shape, roofline, and footprint from the input. Do not alter the structural form. Apply realistic materials. \
2. Immediate Surroundings: The area surrounding the building is to be rendered as a neat residential yard, featuring a manicured lawn and low pathways. \
3. Environment: visually separating the house from the open fields. Transform the remaining flat satellite base imagery outside of the yard boundary into high-fidelity 3D landscape textures, featuring volumetric grass, detailed tilled soil, and roads. Clear, natural daylight with sharp, realistic shadow casting and strong ambient occlusion to firmly ground the buildings onto the terrain topography. Highly detailed render, ultra-sharp, crisp detail, 8k resolution, drone photography style.';

    const effectivePrompt =
      'Photorealistic aerial architectural visualization. Preserve the spatial layout, composition, and geographic positions from the input image. \
\
1. BUILDING: Render the 3D building massing model as a fully realized structure. Maintain its exact volumetric shape, roofline, footprint, and position from the input. Apply realistic facade materials, windows, doors, and roofing textures. Do not alter the structural form or location. \
\
2. IMMEDIATE SURROUNDINGS: Add a neat residential yard around the building with manicured lawn, small pathways, and low shrubs. This yard should visually separate the house from the surrounding landscape. \
\
3. ENVIRONMENT: Replace all flat 2D satellite imagery with fully rendered 3D elements while keeping their positions. Flat tree blobs must become detailed 3D trees with volumetric canopies and visible branches. Flat grass areas must become lush volumetric grass fields. Blurry roads must become textured 3D roads with depth. Other buildings visible in the satellite image must be rendered as 3D structures. Transform the entire scene from a flat aerial photo into a photorealistic 3D render - every element should look three-dimensional, not flat. Maintain approximate positions of all features. \
\
4. LIGHTING & QUALITY: Clear natural daylight. Sharp, realistic shadow casting. Strong ambient occlusion to ground buildings onto terrain. 8K resolution, ultra-sharp, crisp detail, tack-sharp focus throughout. Drone photography style. \
';

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: effectivePrompt,
            },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    };

    console.log('[nano-banana] Gemini request payload summary', {
      model: MODEL_NAME,
      mimeType,
      prompt: effectivePrompt,
      imageBytes: base64Data.length,
      imagePreview: base64Data.slice(0, 64),
    });

    const apiUrl = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text().catch(() => '');
      console.error(
        '[nano-banana] Gemini HTTP error',
        geminiResponse.status,
        errorText
      );
      return NextResponse.json(
        { error: 'Gemini HTTP error', status: geminiResponse.status },
        { status: 502 }
      );
    }

    const json = await geminiResponse.json();
    const candidates = json?.candidates ?? [];
    const parts = candidates[0]?.content?.parts ?? [];

    const imagePart = parts.find(
      (part) => part.inlineData && part.inlineData.data
    );

    if (!imagePart) {
      console.error('[nano-banana] No inlineData image returned', json);
      return NextResponse.json(
        { error: 'Gemini did not return an image.' },
        { status: 502 }
      );
    }

    const outMimeType = imagePart.inlineData.mimeType || 'image/png';
    const outBase64 = imagePart.inlineData.data;
    const dataUri = `data:${outMimeType};base64,${outBase64}`;

    const newUsed = usedSoFar + 1;
    ipUsage.set(key, newUsed);
    const remainingAfter = Math.max(0, MAX_RENDERS_PER_IP - newUsed);

    return NextResponse.json({
      imageUrl: dataUri,
      limit: MAX_RENDERS_PER_IP,
      used: newUsed,
      remaining: remainingAfter,
    });
  } catch (error) {
    console.error('[nano-banana] Failed to generate image with Gemini', error);
    return NextResponse.json(
      { error: 'Failed to generate image with Gemini.' },
      { status: 500 }
    );
  }
}

