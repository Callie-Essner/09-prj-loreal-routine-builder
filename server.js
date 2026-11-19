const express = require('express');
const path = require('path');

try {
  process.loadEnvFile();
} catch {
  // .env file is optional when variables are set in the environment
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

app.use(express.json());
app.use(express.static(__dirname, { dotfiles: 'ignore' }));

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'A non-empty messages array is required.' });
  }

  const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  try {
    if (workerUrl) {
      const workerResponse = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      const rawText = await workerResponse.text();
      let workerData = null;

      try {
        workerData = JSON.parse(rawText);
      } catch {
        workerData = null;
      }

      if (!workerResponse.ok) {
        return res.status(workerResponse.status).json({
          error:
            (typeof workerData?.error === 'string' && workerData.error) ||
            workerData?.error?.message ||
            'Worker request failed.',
        });
      }

      if (workerData) {
        return res.json(workerData);
      }

      return res.json({
        choices: [{ message: { role: 'assistant', content: rawText } }],
      });
    }

    if (openaiApiKey) {
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1',
          messages,
        }),
      });

      const openaiData = await openaiResponse.json();
      if (!openaiResponse.ok) {
        return res.status(openaiResponse.status).json({
          error: openaiData?.error?.message || 'OpenAI API request failed.',
        });
      }

      return res.json(openaiData);
    }

    return res.status(503).json({
      error:
        'Cloudflare Worker URL is not configured yet. Update CLOUDFLARE_WORKER_URL in script.js (or set CLOUDFLARE_WORKER_URL / OPENAI_API_KEY in your server environment).',
    });
  } catch (err) {
    console.error('Error in /api/chat:', err);
    return res.status(500).json({ error: 'Failed to contact the routine advisor service.' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
