const API = "http://localhost:3001"; // proxy

// --- state ---
let chats = JSON.parse(localStorage.getItem("chats") || "[]");
let activeId = localStorage.getItem("activeId") || null;
let aborter = null;

function save() {
  localStorage.setItem("chats", JSON.stringify(chats));
  localStorage.setItem("activeId", activeId || "");
}

function newChat(name) {
  const chat = {
    id: crypto.randomUUID(),
    title: name || `Chat ${chats.length + 1}`,
    pinned: false,
    messages: []
  };
  chats.push(chat);
  activeId = chat.id;
  save();
  render();
}

function getActive() {
  return chats.find(c => c.id === activeId) || chats[0];
}

function sortChats(list) {
  return [...list].sort((a,b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

// --- UI refs ---
const chatList = document.getElementById("chatList");
const messagesEl = document.getElementById("messages");
const titleEl = document.getElementById("chatTitle");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const stopBtn = document.getElementById("stopBtn");
const newBtn = document.getElementById("newChat");
const searchEl = document.getElementById("search");
const healthEl = document.getElementById("health");

// --- render ---
function render() {
  if (!chats.length) newChat("Chat 1");
  const q = (searchEl.value || "").toLowerCase();

  const filtered = chats.filter(c => {
    if (!q) return true;
    if (c.title.toLowerCase().includes(q)) return true;
    return c.messages.some(m => m.content.toLowerCase().includes(q));
  });

  const sorted = sortChats(filtered);
  const active = getActive();
  if (!activeId) activeId = active.id;

  // sidebar list
  chatList.innerHTML = "";
  sorted.forEach(chat => {
    const row = document.createElement("div");
    row.className = "chatRow" + (chat.id === activeId ? " active" : "");
    row.onclick = () => { activeId = chat.id; save(); render(); };

    const star = document.createElement("span");
    star.className = "star";
    star.textContent = chat.pinned ? "★" : "☆";
    star.onclick = (e) => {
      e.stopPropagation();
      chat.pinned = !chat.pinned;
      save(); render();
    };

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = chat.title;
    name.ondblclick = (e) => {
      e.stopPropagation();
      const n = prompt("Rename chat:", chat.title);
      if (n && n.trim()) { chat.title = n.trim(); save(); render(); }
    };

    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "✕";
    x.onclick = (e) => {
      e.stopPropagation();
      if (!confirm("Delete this chat?")) return;
      chats = chats.filter(c => c.id !== chat.id);
      if (activeId === chat.id) activeId = chats[0]?.id || null;
      save(); render();
    };

    row.append(star, name, x);
    chatList.appendChild(row);
  });

  // messages
  titleEl.textContent = active.title;
  messagesEl.innerHTML = "";
  active.messages.forEach(m => {
    const row = document.createElement("div");
    row.className = "msgRow " + (m.sender === "user" ? "user" : "ai");

    const bubble = document.createElement("div");
    bubble.className = "bubble " + (m.sender === "user" ? "user" : "ai");
    bubble.textContent = m.content;

    row.appendChild(bubble);
    messagesEl.appendChild(row);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(sender, content) {
  const chat = getActive();
  chat.messages.push({ id: crypto.randomUUID(), sender, content });
  save();
  render();
}

function updateLastAssistant(appendText) {
  const chat = getActive();
  const last = [...chat.messages].reverse().find(m => m.sender === "assistant");
  if (!last) return;
  last.content += appendText;
  save();
  // no full render for every token? keep it simple:
  render();
}

// --- streaming ---
async function send() {
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage("user", text);
  inputEl.value = "";
  stopBtn.disabled = false;

  addMessage("assistant", ""); // placeholder

  aborter = new AbortController();

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, model: "llama3", memory: [] }),
      signal: aborter.signal
    });

    if (!res.ok || !res.body) {
      updateLastAssistant(`\n\n[Error: ${res.status}]`);
      stopBtn.disabled = true;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      updateLastAssistant(decoder.decode(value, { stream: true }));
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      updateLastAssistant(`\n\n[Error: ${e}]`);
    } else {
      updateLastAssistant("\n\n[Cancelled]");
    }
  } finally {
    stopBtn.disabled = true;
    aborter = null;
  }
}

function stop() {
  if (aborter) aborter.abort();
}

// --- health ---
async function health() {
  try {
    const r = await fetch(`${API}/health`);
    const j = await r.json();
    healthEl.textContent = j.ok ? "● Ollama OK" : "● Ollama offline";
  } catch {
    healthEl.textContent = "● Proxy offline";
  }
}

// events
newBtn.onclick = () => newChat();
sendBtn.onclick = send;
stopBtn.onclick = stop;
searchEl.oninput = render;

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

if (!chats.length) newChat("Chat 1");
render();
health();
setInterval(health, 5000);

