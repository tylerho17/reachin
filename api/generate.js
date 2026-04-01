const RATE_LIMIT = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;

const ipMap = new Map();

function getRateLimitKey(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    'unknown'
  );
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    ipMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getRateLimitKey(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: 'Daily limit reached. You can generate 10 emails per day for free.'
    });
  }

  const { linkedinText, profile } = req.body;

  if (!linkedinText || linkedinText.trim().length < 50) {
    return res.status(400).json({ error: 'LinkedIn text too short. Paste more of their profile.' });
  }

  const systemPrompt = `You are an expert at writing cold networking emails for investment banking students. 
You write emails that are casual but sharp — confident, human, not stiff or template-sounding.
You always respond with valid JSON only, no markdown, no explanation.`;

  const userPrompt = `Extract info from this LinkedIn profile text and write a cold networking email.

LINKEDIN PROFILE TEXT:
${linkedinText.slice(0, 3000)}

STUDENT SENDING THE EMAIL:
- Name: ${profile.name || 'a student'}
- Year: ${profile.year || 'sophomore'}
- School: ${profile.school || 'their university'}
- Major: ${profile.major || 'Business'}
- Experience: ${profile.exp || 'interested in investment banking'}
- Goal: ${profile.goal || 'break into investment banking'}
- Personal details / interests: ${profile.extras || 'none listed'}


EMAIL RULES:
Write exactly 2 paragraphs structured like this:

Start with "Hi [recipient first name]," on its own line, then a blank line.

PARAGRAPH 1 (2 sentences — about the student):
- Sentence 1: "My name is [name], and I'm a [year] at [school] majoring in [major]."
- Sentence 2: One sentence about their experience and what specifically draws them to banking or their focus area. Make it substantive, not generic. Reference actual internships if listed.

PARAGRAPH 2 (2 sentences — about the recipient):
- Sentence 1: Reference something specific from their LinkedIn — their firm, career path, specific group, school, or background. Show you actually read it. Start with "I came across your background" or similar.
- Sentence 2: What you'd specifically love to hear from them — about breaking in, their path, their group, their transition. Make it feel like a real question, not a blanket ask.

CLOSING (2 lines):
- "I'd really appreciate the chance to connect if you'd be open to it."
- "Best," then the student's first name on the next line.

TONE: Professional but warm. Sounds like a sharp, self-aware student. Not stiff, not casual. Close to investment banking communication style.
LENGTH: 80-120 words. No filler. No flattery. No "I hope this finds you well."
SUBJECT LINE: Short and specific. Reference their firm or a detail from their background.

Respond ONLY with this JSON:
{"subject": "...", "body": "...", "recipientName": "...", "recipientFirm": "...", "recipientTitle": "..."}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 600
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('OpenAI error:', err);
      return res.status(500).json({ error: 'AI service error. Try again.' });
    }

    const data = await response.json();
    const raw = data.choices[0].message.content.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
