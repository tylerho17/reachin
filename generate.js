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

EMAIL RULES:
1. Sentence 1: Who I am — name, year, school. One line.
2. Sentence 2: My most relevant experience or what I'm focused on. One line.
3. Sentence 3: Something specific about THEM pulled from their profile — their school, career path, firm, deal, group, or background. Make it genuine, not flattering. Show you actually read it.
4. Sentence 4: Casual, human reason for reaching out. Why them specifically.
5. Sentence 5: Open-ended, low-pressure ask — "would love to connect if you're open to it" style. No specific times or dates.

TONE: Casual but sharp. Like a confident student, not a robot. No "I hope this email finds you well." No "I came across your profile." Just start naturally.
LENGTH: Under 120 words total. Sign off with just the student's first name.
SUBJECT LINE: Short, specific, not generic. Reference their firm or background.

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
