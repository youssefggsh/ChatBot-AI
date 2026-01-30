import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json({ limit: "2mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Serve the website from /public
app.use(express.static(path.join(__dirname, "public")));

// Health check for Ollama
app.get("/health", async (req, res) => {
  try {
    const r = await fetch("http://127.0.0.1:11434/");
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Streaming chat proxy (Ollama -> browser)
app.post("/api/chat", async (req, res) => {
  const { prompt, model = "llama3", memory = [] } = req.body || {};
  const fullPrompt = memory?.length
    ? `Chat memory:\n${memory.map(m => `- ${m}`).join("\n")}\n\nUser:\n${prompt}`
    : prompt;

  try {
    const ollamaRes = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: fullPrompt, stream: true })
    });

    if (!ollamaRes.ok || !ollamaRes.body) {
      const txt = await ollamaRes.text().catch(() => "");
      return res.status(500).json({ error: "Ollama error", details: txt });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        try {
          const obj = JSON.parse(line);
          if (obj.response) res.write(obj.response);
          if (obj.done) {
            res.end();
            return;
          }
        } catch {
          // ignore malformed chunk
        }
      }
    }

    res.end();
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Fallback to index.html (so refresh works)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Website running: http://192.168.0.140:${PORT}`);
});
