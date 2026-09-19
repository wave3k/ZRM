const chatScroll = document.getElementById("chat-scroll");
const welcome = document.getElementById("welcome");
const messagesEl = document.getElementById("messages");
const composer = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("btn-send");
const attachBtn = document.getElementById("btn-attach");
const fileInput = document.getElementById("file-input");
const attachmentsEl = document.getElementById("attachments");

const docCountEl = document.getElementById("doc-count");
const docListEl = document.getElementById("doc-list");
const drawer = document.getElementById("drawer");
const drawerBackdrop = document.getElementById("drawer-backdrop");
const dropzone = document.getElementById("dropzone");
const recentsEl = document.getElementById("recents");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const topbarTitle = document.getElementById("topbar-title");
const toastsEl = document.getElementById("toasts");

const sidebar = document.getElementById("sidebar");

let pendingFiles = [];
let stats = { indexed: false };
let conversations = loadConversations();
let currentId = null;
let chatMode = localStorage.getItem("zrm.mode") || "fast";
let chatModel = localStorage.getItem("zrm.model") || "fast";
let chatProvider = localStorage.getItem("zrm.provider") || "auto";

/* ---------------- utilities ---------------- */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, terms) {
  let out = escapeHtml(text);
  if (!terms || terms.length === 0) return out;
  const unique = [...new Set(terms.filter((t) => t.length >= 3))].sort(
    (a, b) => b.length - a.length,
  );
  for (const term of unique) {
    const re = new RegExp(`(\\p{L}*${escapeRegex(term)}\\p{L}*)`, "giu");
    out = out.replace(re, "<mark>$1</mark>");
  }
  return out;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function toast(message, variant = "") {
  const el = document.createElement("div");
  el.className = `toast ${variant}`;
  el.textContent = message;
  toastsEl.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 300);
  }, 3600);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  });
}

/* ---------------- conversations (localStorage) ---------------- */

const STORE_KEY = "zrm.conversations.v1";

function loadConversations() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveConversations() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(conversations.slice(0, 40)));
  } catch {
    /* ignore */
  }
}

function currentConversation() {
  return conversations.find((c) => c.id === currentId) || null;
}

function newConversation() {
  const conv = { id: Date.now().toString(36), title: "Nouveau chat", messages: [] };
  conversations.unshift(conv);
  currentId = conv.id;
  saveConversations();
  renderRecents();
  return conv;
}

function renderRecents() {
  if (conversations.length === 0) {
    recentsEl.innerHTML = '<p class="recent-empty">Aucune conversation</p>';
    return;
  }
  recentsEl.innerHTML = conversations
    .map(
      (c) =>
        `<button class="recent-item" data-conv="${c.id}">${escapeHtml(c.title)}</button>`,
    )
    .join("");
  recentsEl.querySelectorAll("[data-conv]").forEach((el) => {
    el.addEventListener("click", () => openConversation(el.dataset.conv));
  });
}

function openConversation(id) {
  currentId = id;
  const conv = currentConversation();
  if (!conv) return;
  topbarTitle.textContent = conv.title;
  messagesEl.innerHTML = "";
  welcome.style.display = conv.messages.length ? "none" : "flex";
  for (const m of conv.messages) {
    if (m.role === "user") {
      renderUserMessage(m.content, false);
    } else {
      renderAssistantMessage(m, false);
    }
  }
  scrollToBottom();
  closeMobileSidebar();
}

/* ---------------- render messages ---------------- */

function renderUserMessage(text, store = true) {
  welcome.style.display = "none";
  const el = document.createElement("div");
  el.className = "msg user";
  el.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
  messagesEl.appendChild(el);
  if (store) {
    const conv = currentConversation();
    if (conv) {
      conv.messages.push({ role: "user", content: text });
      if (conv.title === "Nouveau chat") {
        conv.title = text.slice(0, 42) + (text.length > 42 ? "…" : "");
        topbarTitle.textContent = conv.title;
        renderRecents();
      }
      saveConversations();
    }
  }
  scrollToBottom();
}

function renderAssistantMessage(data, store = true) {
  welcome.style.display = "none";
  const el = document.createElement("div");
  el.className = "msg assistant";

  const terms = data.terms || [];
  const lines = String(data.answer ?? data.content ?? "").split("\n").filter(Boolean);

  let bodyHtml = "";
  const bullets = lines.filter((l) => l.startsWith("• "));
  const paragraphs = lines.filter((l) => !l.startsWith("• "));

  if (bullets.length > 0) {
    bodyHtml += bullets
      .map(
        (l) =>
          `<span class="passage"><span class="passage-bullet">◆</span>${highlight(
            l.slice(2),
            terms,
          )}</span>`,
      )
      .join("");
  }
  if (paragraphs.length > 0) {
    bodyHtml += paragraphs.map((l) => highlight(l, terms)).join("<br>");
  }

  let sourcesHtml = "";
  if (data.citations && data.citations.length > 0) {
    sourcesHtml =
      `<div class="assistant-sources"><span class="sources-label">Sources</span>` +
      data.citations
        .map((c) => {
          const name = String(c).replace(/\s*\(.*\)$/, "");
          return `<a class="source-chip link" href="/doc/${encodeURIComponent(name)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="12" height="12" fill="none"><path d="M6 3h9l4 4v14H6z" stroke="currentColor" stroke-width="1.7"/></svg>${escapeHtml(
            c,
          )}</a>`;
        })
        .join("") +
      `</div>`;
  }

  const meta =
    data.elapsedMs !== undefined
      ? `<div class="assistant-meta">${data.citations?.length ?? 0} source(s) · ${(data.elapsedMs / 1000).toFixed(1)}s</div>`
      : `<div class="assistant-meta">Aucun document pertinent</div>`;

  el.innerHTML = `
    <div class="assistant-row">
      <div class="avatar">Z</div>
      <div class="assistant-body">
        <div class="assistant-text">${bodyHtml}</div>
        <div class="artifacts"></div>
        ${sourcesHtml}
        ${meta}
        <div class="assistant-actions">
          <button class="action-btn" data-copy title="Copier">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.7"/></svg>
          </button>
        </div>
      </div>
    </div>`;

  if (data.artifacts && data.artifacts.length > 0) {
    const box = el.querySelector(".artifacts");
    for (const artifact of data.artifacts) renderArtifact(box, artifact);
  }

  el.querySelector("[data-copy]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(String(data.answer || data.content || ""));
      toast("Réponse copiée");
    } catch {
      toast("Copie impossible", "error");
    }
  });

  messagesEl.appendChild(el);

  if (store) {
    const conv = currentConversation();
    if (conv) {
      conv.messages.push({
        role: "assistant",
        content: data.answer,
        citations: data.citations,
        terms,
        artifacts: data.artifacts,
        elapsedMs: data.elapsedMs,
        matches: data.matches,
      });
      saveConversations();
    }
  }
  scrollToBottom();
}

function renderTyping() {
  const el = document.createElement("div");
  el.className = "msg assistant";
  el.id = "typing";
  el.innerHTML = `
    <div class="assistant-row">
      <div class="avatar">Z</div>
      <div class="assistant-body"><span class="typing"><i></i><i></i><i></i></span></div>
    </div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function removeTyping() {
  document.getElementById("typing")?.remove();
}

/* ---------------- artifacts ---------------- */

function renderArtifact(container, artifact) {
  if (artifact.type === "html") {
    const block = document.createElement("div");
    block.className = "artifact";
    block.innerHTML = `
      <div class="artifact-head">
        <span class="artifact-title">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${escapeHtml(artifact.title || "Aperçu HTML")}
        </span>
        <span class="artifact-actions">
          <button class="artifact-btn" data-expand>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Plein écran
          </button>
          <button class="artifact-btn" data-open-tab>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M14 5h5v5M19 5l-7 7M9 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Nouvel onglet
          </button>
        </span>
      </div>
      <iframe class="artifact-frame" sandbox="allow-scripts allow-popups allow-forms" srcdoc="${escapeHtml(artifact.content)}"></iframe>`;

    const iframe = block.querySelector("iframe");
    block.querySelector("[data-expand]").addEventListener("click", () => {
      iframe.classList.toggle("expanded");
      iframe.style.height = iframe.classList.contains("expanded") ? "70vh" : "260px";
    });
    block.querySelector("[data-open-tab]").addEventListener("click", () => {
      const blob = new Blob([artifact.content], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
    });
    container.appendChild(block);
    return;
  }

  if (artifact.type === "chart") {
    const block = document.createElement("div");
    block.className = "artifact chart";
    block.innerHTML = `
      <div class="artifact-head">
        <span class="artifact-title">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          ${escapeHtml(artifact.title || artifact.spec.title || "Graphique")}
        </span>
        <span class="artifact-actions">
          <span class="artifact-src">${escapeHtml(artifact.spec.source || "")}</span>
        </span>
      </div>
      <div class="chart-body">${window.renderChart(artifact.spec)}</div>`;
    container.appendChild(block);
  }
}

/* ---------------- streaming ---------------- */

function createStreamingMessage() {
  welcome.style.display = "none";
  const el = document.createElement("div");
  el.className = "msg assistant";
  el.innerHTML = `
    <div class="assistant-row">
      <div class="avatar">Z</div>
      <div class="assistant-body">
        <div class="assistant-text"><span class="typing"><i></i><i></i><i></i></span></div>
        <div class="artifacts"></div>
        <div class="sources-slot"></div>
        <div class="assistant-meta"></div>
      </div>
    </div>`;
  messagesEl.appendChild(el);

  const textEl = el.querySelector(".assistant-text");
  const artifactsEl = el.querySelector(".artifacts");
  const sourcesEl = el.querySelector(".sources-slot");
  const metaEl = el.querySelector(".assistant-meta");

  let raw = "";
  let firstToken = true;

  return {
    el,
    append(text) {
      if (firstToken) {
        textEl.innerHTML = "";
        firstToken = false;
      }
      raw += text;
      textEl.innerHTML = highlight(raw, currentTerms);
      scrollToBottom();
    },
    setText(text) {
      raw = text;
      firstToken = false;
      textEl.innerHTML = highlight(text, currentTerms);
    },
    addArtifact(artifact) {
      renderArtifact(artifactsEl, artifact);
      scrollToBottom();
    },
    setSources(citations) {
      if (!citations || citations.length === 0) return;
      sourcesEl.innerHTML =
        `<div class="assistant-sources"><span class="sources-label">Sources</span>` +
        citations
          .map((c) => {
            const name = String(c).replace(/\s*\(.*\)$/, "");
            return `<a class="source-chip link" href="/doc/${encodeURIComponent(name)}" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none"><path d="M6 3h9l4 4v14H6z" stroke="currentColor" stroke-width="1.7"/></svg>${escapeHtml(c)}</a>`;
          })
          .join("") +
        `</div>`;
    },
    setMeta(text) {
      metaEl.textContent = text;
    },
    addActions() {
      const actions = document.createElement("div");
      actions.className = "assistant-actions";
      actions.innerHTML = `<button class="action-btn" data-copy title="Copier">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" stroke-width="1.7"/></svg>
      </button>`;
      actions.querySelector("[data-copy]").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(raw);
          toast("Réponse copiée");
        } catch {
          toast("Copie impossible", "error");
        }
      });
      el.querySelector(".assistant-body").appendChild(actions);
    },
    get text() {
      return raw;
    },
  };
}

let currentTerms = [];

async function ask(question) {
  if (!currentConversation()) newConversation();
  renderUserMessage(question);
  sendBtn.disabled = true;

  const stream = createStreamingMessage();
  const started = Date.now();
  let citations = [];
  let artifacts = [];

  if (chatMode === "llm") {
    if (isRemoteModel()) {
      stream.setMeta(`interrogation du serveur distant (${chatModel})…`);
    } else {
      stream.setMeta("chargement du modèle local… (peut prendre ~30 s)");
    }
  }

  const history = (currentConversation()?.messages || [])
    .slice(-4)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        mode: chatMode,
        model: chatModel,
        provider: isRemoteModel() ? "remote" : chatProvider,
        history,
      }),
    });

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      stream.setText(data.error || `Erreur ${res.status}`);
      stream.setMeta("");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (event.type === "token") {
          stream.append(event.text);
          if (chatMode === "llm") stream.setMeta("génération en cours…");
        } else if (event.type === "replace") {
          stream.setText(event.text);
        } else if (event.type === "artifact") {
          artifacts.push(event.artifact);
          stream.addArtifact(event.artifact);
        } else if (event.type === "sources") {
          citations = event.citations || [];
          stream.setSources(citations);
        } else if (event.type === "error") {
          stream.setText(event.message);
        } else if (event.type === "done") {
          /* fin */
        }
      }
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    stream.setMeta(
      `${citations.length} source(s) · ${artifacts.length} élément(s) · ${elapsed}s`,
    );
    stream.addActions();

    const conv = currentConversation();
    if (conv) {
      conv.messages.push({
        role: "assistant",
        content: stream.text,
        citations,
        artifacts,
        elapsedMs: Number(elapsed) * 1000,
      });
      saveConversations();
    }
  } catch (error) {
    stream.setText(`Erreur réseau : ${error.message}`);
    stream.setMeta("");
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ---------------- files ---------------- */

function addPendingFiles(files) {
  for (const file of files) {
    if (pendingFiles.some((f) => f.name === file.name && f.size === file.size))
      continue;
    pendingFiles.push(file);
  }
  renderAttachments();
}

function renderAttachments() {
  if (pendingFiles.length === 0) {
    attachmentsEl.classList.remove("has-items");
    attachmentsEl.innerHTML = "";
    return;
  }
  attachmentsEl.classList.add("has-items");
  attachmentsEl.innerHTML = pendingFiles
    .map(
      (f, i) =>
        `<span class="attachment">
          <span class="attachment-name">${escapeHtml(f.name)}</span>
          <button type="button" class="attachment-remove" data-remove="${i}" title="Retirer">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </span>`,
    )
    .join("");
  attachmentsEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingFiles.splice(Number(btn.dataset.remove), 1);
      renderAttachments();
    });
  });
}

async function uploadFile(file) {
  const res = await fetch("/api/documents/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `échec pour ${file.name}`);
  return data;
}

async function submitWithFiles() {
  const files = [...pendingFiles];
  for (const file of files) {
    try {
      await uploadFile(file);
    } catch (error) {
      toast(error.message, "error");
    }
  }
  const ok = files.length > 0;
  pendingFiles = [];
  renderAttachments();

  if (ok) {
    setStatus("busy", "indexation…");
    try {
      const res = await fetch("/api/ingest", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "indexation échouée");
      toast(`${data.chunks} passage(s) indexé(s) depuis ${data.files} fichier(s)`);
      await refreshStats();
      await loadDocuments();
    } catch (error) {
      toast(error.message, "error");
      setStatus("off", "index indisponible");
    }
  }

  const question = input.value.trim();
  if (question) {
    input.value = "";
    autoGrow();
    await ask(question);
  } else if (ok) {
    const conv = currentConversation() || newConversation();
    const fileNames = files.map((f) => f.name).join(", ");
    renderUserMessage(`Ajout de document(s) : ${fileNames}`);
    renderAssistantMessage({
      answer: `Prêt. ${files.length} document(s) importé(s) et indexé(s). Pose une question sur leur contenu.`,
      citations: [],
      terms: [],
      elapsedMs: 0,
      matches: 0,
    });
  }
}

/* ---------------- documents ---------------- */

async function loadDocuments() {
  try {
    const res = await fetch("/api/documents");
    const data = await res.json();
    const docs = data.documents || [];
    docCountEl.textContent = docs.length;

    if (docs.length === 0) {
      docListEl.innerHTML =
        '<p class="doc-empty">Aucun document. Importe un fichier pour commencer.</p>';
      return;
    }

    docListEl.innerHTML = docs
      .map(
        (d) =>
          `<div class="doc-item">
            <span class="doc-icon"><svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M6 3h9l4 4v14H6z" stroke="currentColor" stroke-width="1.6"/><path d="M15 3v4h4" stroke="currentColor" stroke-width="1.6"/></svg></span>
            <div class="doc-info">
              <div class="doc-name">${escapeHtml(d.name)}</div>
              <div class="doc-size">${formatSize(d.size)}</div>
            </div>
            <span class="doc-tag ${d.indexed ? "indexed" : ""}">${d.indexed ? "indexé" : "non indexé"}</span>
            <button class="doc-del" data-del="${escapeHtml(d.name)}" title="Supprimer">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>`,
      )
      .join("");

    docListEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => deleteDocument(btn.dataset.del));
    });
  } catch {
    docListEl.innerHTML = '<p class="doc-empty">Erreur de chargement.</p>';
  }
}

async function deleteDocument(name) {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "suppression échouée");
    toast(`Supprimé : ${name}`);
    await loadDocuments();
    await fetch("/api/ingest", { method: "POST" });
    await refreshStats();
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---------------- status / stats ---------------- */

function setStatus(kind, label) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = label;
}

async function refreshStats() {
  try {
    const res = await fetch("/api/stats");
    stats = await res.json();
    if (stats.indexed) {
      setStatus("", `${stats.chunks} passages · ${stats.documents} docs`);
    } else {
      setStatus("off", "aucun index");
    }
  } catch {
    setStatus("off", "hors ligne");
  }
}

/* ---------------- drawer ---------------- */

function openDrawer() {
  drawer.classList.add("open");
  drawerBackdrop.classList.add("open");
  loadDocuments();
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawerBackdrop.classList.remove("open");
}

/* ---------------- mobile sidebar ---------------- */

function closeMobileSidebar() {
  document.body.classList.remove("sidebar-open");
}

/* ---------------- events ---------------- */

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitWithFiles();
});

input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}

attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  addPendingFiles(fileInput.files);
  fileInput.value = "";
});

document.getElementById("btn-new").addEventListener("click", () => {
  newConversation();
  messagesEl.innerHTML = "";
  topbarTitle.textContent = "Nouveau chat";
  welcome.style.display = "flex";
  input.focus();
  closeMobileSidebar();
});

document.getElementById("btn-docs").addEventListener("click", openDrawer);
document.querySelector("[data-open-docs]").addEventListener("click", openDrawer);
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

document.getElementById("btn-reindex").addEventListener("click", async () => {
  setStatus("busy", "indexation…");
  try {
    const res = await fetch("/api/ingest", { method: "POST" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "échec");
    toast(`${data.chunks} passage(s) indexé(s) en ${data.elapsedMs} ms`);
    await refreshStats();
    await loadDocuments();
  } catch (error) {
    toast(error.message, "error");
    setStatus("off", "erreur");
  }
});

document.querySelector("[data-scroll-bottom]").addEventListener("click", () => {
  scrollToBottom();
  closeMobileSidebar();
});

document
  .getElementById("btn-toggle-sidebar")
  .addEventListener("click", () => document.body.classList.toggle("sidebar-hidden"));

document
  .getElementById("btn-mobile-menu")
  .addEventListener("click", () => document.body.classList.toggle("sidebar-open"));

document
  .getElementById("sidebar-backdrop")
  .addEventListener("click", closeMobileSidebar);

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  addPendingFiles(e.dataTransfer.files);
  toast(`${e.dataTransfer.files.length} fichier(s) prêt(s) à importer`);
  closeDrawer();
  input.focus();
});

document.addEventListener("click", (e) => {
  const sugg = e.target.closest("[data-suggest]");
  if (sugg) {
    input.value = sugg.dataset.suggest;
    autoGrow();
    input.focus();
  }
});

/* ---------------- mode / modele ---------------- */

const modeSwitch = document.getElementById("mode-switch");
const modelSelect = document.getElementById("model-select");
const speedHint = document.getElementById("speed-hint");

let modelCatalog = { local: [], remote: [], remoteStatus: { reachable: false } };

function selectedModelInfo() {
  return (
    modelCatalog.remote.find((m) => m.id === chatModel) ||
    modelCatalog.local.find((m) => m.id === chatModel) ||
    null
  );
}

function isRemoteModel() {
  return Boolean(modelCatalog.remote.find((m) => m.id === chatModel));
}

function updateSpeedHint() {
  if (chatMode !== "llm") {
    speedHint.textContent = "instantané";
    speedHint.className = "speed-hint ok";
    return;
  }

  if (isRemoteModel()) {
    const fast = /1\.5b|0\.5b|1b|3b|mini|small/i.test(chatModel);
    speedHint.textContent = fast ? "distant · rapide" : "distant";
    speedHint.className = "speed-hint ok";
    return;
  }

  const info = selectedModelInfo();
  speedHint.textContent = info
    ? "local · ~1 mot/s sur cette machine"
    : "modèle non disponible";
  speedHint.className = "speed-hint warn";
}

function renderModelSelect() {
  const options = [];

  if (modelCatalog.remote.length > 0) {
    options.push('<optgroup label="Distant (VPS)">');
    for (const m of modelCatalog.remote) {
      options.push(`<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)} — distant</option>`);
    }
    options.push("</optgroup>");
  }

  const downloadedLocal = modelCatalog.local.filter((m) => m.downloaded);
  if (downloadedLocal.length > 0) {
    options.push('<optgroup label="Local">');
    for (const m of downloadedLocal) {
      options.push(
        `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)} — local</option>`,
      );
    }
    options.push("</optgroup>");
  }

  modelSelect.innerHTML = options.join("") || '<option value="">aucun modèle</option>';

  const exists = [...modelSelect.options].some((o) => o.value === chatModel);
  if (!exists) {
    chatModel = modelCatalog.remote[0]?.id || downloadedLocal[0]?.id || "";
    localStorage.setItem("zrm.model", chatModel);
  }
  modelSelect.value = chatModel;
}

async function refreshModels() {
  try {
    const res = await fetch("/api/models");
    const data = await res.json();
    modelCatalog = {
      local: data.local || [],
      remote: data.remote || [],
      remoteStatus: data.remoteStatus || { reachable: false },
    };
    renderModelSelect();
    updateSpeedHint();

    const hasAny =
      modelCatalog.local.some((m) => m.downloaded) || modelCatalog.remote.length > 0;
    modeSwitch.querySelectorAll(".mode-btn").forEach((btn) => {
      if (btn.dataset.mode === "llm") btn.disabled = !hasAny;
    });

    if (!hasAny) {
      speedHint.textContent = "aucun modèle";
      speedHint.className = "speed-hint warn";
    }
  } catch {
    /* ignore */
  }
}

function applyMode() {
  modeSwitch.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === chatMode);
  });
  modelSelect.style.display = chatMode === "llm" ? "" : "none";
  updateSpeedHint();
}

modeSwitch.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    chatMode = btn.dataset.mode;
    localStorage.setItem("zrm.mode", chatMode);
    applyMode();
    if (chatMode === "llm") {
      if (isRemoteModel()) {
        toast(`Discussion via le serveur distant (${chatModel})`);
      } else {
        toast("Mode Discussion local : ~1 mot/s sur cette machine");
        fetch("/api/models/warmup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "local", model: chatModel }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.ok) toast(`Modèle prêt (${(d.elapsedMs / 1000).toFixed(1)}s)`);
            else toast(d.error || "Échec du chargement", "error");
          })
          .catch(() => {});
      }
    }
  });
});

modelSelect.addEventListener("change", () => {
  chatModel = modelSelect.value;
  localStorage.setItem("zrm.model", chatModel);
  updateSpeedHint();
  toast(`Modèle : ${chatModel}`);
});

/* ---------------- reglages ---------------- */

const settingsDrawer = document.getElementById("settings");
const settingsBackdrop = document.getElementById("settings-backdrop");
const cfgProvider = document.getElementById("cfg-provider");
const cfgUrl = document.getElementById("cfg-url");
const cfgKey = document.getElementById("cfg-key");
const cfgStatus = document.getElementById("cfg-status");
const cfgModels = document.getElementById("cfg-models");

function setCfgStatus(text, kind = "") {
  cfgStatus.textContent = text;
  cfgStatus.className = `settings-status ${kind}`;
}

function openSettings() {
  settingsDrawer.classList.add("open");
  settingsBackdrop.classList.add("open");
  closeDrawer();

  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      cfgProvider.value = cfg.provider || "auto";
      cfgUrl.value = cfg.remote?.url || "";
      cfgKey.value = cfg.remote?.apiKey === "***" ? "" : cfg.remote?.apiKey || "";
      cfgKey.placeholder = cfg.remote?.apiKey === "***" ? "•••••• (déjà définie)" : "laisser vide si aucun auth";
    })
    .catch(() => {});

  renderSettingsModels();
}

function closeSettings() {
  settingsDrawer.classList.remove("open");
  settingsBackdrop.classList.remove("open");
}

function renderSettingsModels() {
  const rows = [];

  for (const m of modelCatalog.remote) {
    rows.push(
      `<div class="settings-model"><span class="dot remote"></span>${escapeHtml(m.label)}<span class="meta">distant</span></div>`,
    );
  }
  for (const m of modelCatalog.local) {
    rows.push(
      `<div class="settings-model"><span class="dot local"></span>${escapeHtml(m.label)}<span class="meta">${m.downloaded ? "téléchargé" : "non téléchargé"}</span></div>`,
    );
  }

  cfgModels.innerHTML =
    rows.join("") ||
    '<p class="field-hint">Aucun modèle détecté. Ouvre le tunnel SSH ou lance <code>npm run model:download</code>.</p>';
}

document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("settings-close").addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);

document.getElementById("cfg-test").addEventListener("click", async () => {
  setCfgStatus("Test en cours…", "busy");
  try {
    const res = await fetch("/api/remote/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: cfgUrl.value.trim(), apiKey: cfgKey.value.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      setCfgStatus(
        `✓ Connecté (${data.kind}, ${data.models} modèle(s), ${data.latencyMs} ms)`,
        "ok",
      );
      await refreshModels();
      renderSettingsModels();
    } else {
      setCfgStatus(`✗ ${data.error}`, "err");
    }
  } catch (error) {
    setCfgStatus(`✗ ${error.message}`, "err");
  }
});

document.getElementById("cfg-save").addEventListener("click", async () => {
  setCfgStatus("Enregistrement…", "busy");
  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: cfgProvider.value,
        remote: { url: cfgUrl.value.trim(), apiKey: cfgKey.value.trim() },
      }),
    });
    const data = await res.json();
    if (data.ok) {
      setCfgStatus("✓ Enregistré", "ok");
      toast("Réglages enregistrés");
      await refreshModels();
      renderSettingsModels();
    } else {
      setCfgStatus(`✗ ${data.error || "échec"}`, "err");
    }
  } catch (error) {
    setCfgStatus(`✗ ${error.message}`, "err");
  }
});

document.getElementById("cfg-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(
      document.getElementById("cfg-tunnel").textContent,
    );
    toast("Commande copiée");
  } catch {
    toast("Copie impossible", "error");
  }
});

/* ---------------- init ---------------- */

applyMode();
refreshModels();

const SUGGESTIONS = [
  "Résume le contenu de mes documents",
  "Quelles sont les informations importantes ?",
  "Quels chiffres puis-je trouver ?",
  "Ajoute un document puis interroge-le",
];

function renderWelcomeSuggestions() {
  const box = document.createElement("div");
  box.className = "suggestions";
  box.innerHTML = SUGGESTIONS.map(
    (s) =>
      `<button class="suggestion" data-suggest="${escapeHtml(s)}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        ${escapeHtml(s)}
      </button>`,
  ).join("");
  welcome.querySelector(".welcome-inner").appendChild(box);
}

renderWelcomeSuggestions();
renderRecents();
refreshStats();
loadDocuments();
input.focus();
