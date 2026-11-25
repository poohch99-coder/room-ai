const rateLimitMap = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 간단한 IP 기반 호출 제한 (1시간당 최대 10회)
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const userLog = (rateLimitMap.get(ip) || []).filter((t) => now - t < windowMs);

  if (userLog.length >= 10) {
    return res.status(429).json({
      error: '무료 체험 한도(시간당 10회)를 초과했습니다. 잠시 후 다시 시도해주세요.'
    });
  }
  userLog.push(now);
  rateLimitMap.set(ip, userLog);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.' });
  }

  try {
    const { imageBase64, style } = req.body;
    if (!imageBase64 || !style) {
      return res.status(400).json({ error: '이미지와 스타일 정보가 필요합니다.' });
    }

    const base64Data = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;

    const prompt =
      style === 'practical'
        ? `Redesign this exact room into a highly practical, storage-maximized Korean studio interior. Keep the exact room architecture, window positions, walls, and camera angle, but aggressively replace cluttered or wasted furniture with floor-to-ceiling modular built-in cabinets, sleek wall-mounted floating shelves, an under-bed storage platform, and a compact wall-aligned desk setup. Clear the central floor pathway for maximum movement efficiency. Bright neutral daylight lighting, clean white and light birch wood tones, organized storage boxes, ultra-realistic architectural interior photography.`
        : `Redesign this exact room into a warm, emotional, cozy aesthetic Korean studio interior. Keep the exact room architecture, window positions, walls, and camera angle, while transforming the atmosphere with warm 2700K indirect LED mood lighting, a stylish floor lamp, soft linen curtains, warm oak wood textures, a textured cream rug, indoor foliage plants, framed wall art, and cozy hotel-style bedding. Soft golden hour ambiance, ultra-realistic architectural interior photography.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ['IMAGE']
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API Error:', data);
      return res.status(response.status).json({
        error: data?.error?.message || 'AI 이미지 생성 중 오류가 발생했습니다.'
      });
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.data);

    if (!imagePart) {
      return res.status(500).json({ error: 'AI가 이미지를 반환하지 못했습니다. 다른 사진으로 시도해주세요.' });
    }

    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    return res.status(200).json({
      resultImage: `data:${mimeType};base64,${imagePart.inlineData.data}`
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '서버 처리 중 오류가 발생했습니다.' });
  }
}