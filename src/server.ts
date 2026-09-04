import express from "express";
import fs from "node:fs";
import path from "node:path";

type Document = {
  url: string;
  title: string;
  description?: string;
  content?: string;
  terms?: string[];
};

const app = express();
const PORT = 3000;
const INDEX_FILE = path.join(process.cwd(), "data", "index.json");

const requests = new Map<string, { count: number; start: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const MAX_QUERY_LENGTH = 200;

function loadDocuments(): Document[] {
  if (!fs.existsSync(INDEX_FILE)) return [];

  const data = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));

  if (Array.isArray(data)) return data;
  return data.documents || [];
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function bm25(
  document: Document,
  queryTerms: string[],
  documents: Document[]
): number {
  const text = [
    document.title,
    document.description || "",
    document.content || ""
  ].join(" ");

  const terms = normalize(text);
  const averageLength =
    documents.reduce((sum, item) => {
      const itemText = [
        item.title,
        item.description || "",
        item.content || ""
      ].join(" ");
      return sum + normalize(itemText).length;
    }, 0) / Math.max(documents.length, 1);

  const k1 = 1.5;
  const b = 0.75;
  const length = terms.length;

  let score = 0;

  for (const queryTerm of queryTerms) {
    const frequency = terms.filter(term => term === queryTerm).length;
    if (frequency === 0) continue;

    const containing = documents.filter(item => {
      const itemText = [
        item.title,
        item.description || "",
        item.content || ""
      ].join(" ");

      return normalize(itemText).includes(queryTerm);
    }).length;

    const idf = Math.log(
      1 + (documents.length - containing + 0.5) / (containing + 0.5)
    );

    const part =
      (frequency * (k1 + 1)) /
      (frequency + k1 * (1 - b + b * (length / averageLength)));

    score += idf * part;
  }

  return score;
}

function createSnippet(document: Document, queryTerms: string[]): string {
  const text = document.content || document.description || "Sem descrição.";
  const lower = text.toLowerCase();

  const position = queryTerms
    .map(term => lower.indexOf(term.toLowerCase()))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0];

  if (position === undefined) {
    return text.slice(0, 280);
  }

  const start = Math.max(0, position - 100);
  const snippet = text.slice(start, start + 280);

  return `${start > 0 ? "... " : ""}${snippet}${
    start + 280 < text.length ? " ..." : ""
  }`;
}

app.use(express.static(path.join(process.cwd(), "public")));

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = requests.get(ip);

  if (!current || now - current.start > WINDOW_MS) {
    requests.set(ip, { count: 1, start: now });
    return next();
  }

  current.count++;

  if (current.count > MAX_REQUESTS) {
    return res.status(429).json({
      error: "Muitas requisições. Tente novamente em alguns segundos."
    });
  }

  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "online",
    version: "0.9.0",
    ranking: "BM25",
    security: "rate limit ativo",
    documents: loadDocuments().length
  });
});

app.get("/api/search", (req, res) => {
  const query = String(req.query.q || "")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);

  if (!query) {
    return res.json({
      query: "",
      results: [],
      total: 0
    });
  }

  const documents = loadDocuments();
  const queryTerms = normalize(query);

  const results = documents
    .map(document => ({
      url: document.url,
      title: document.title,
      description: createSnippet(document, queryTerms),
      score: bm25(document, queryTerms, documents)
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(result => ({
      ...result,
      score: Number(result.score.toFixed(4))
    }));

  res.json({
    query,
    ranking: "BM25",
    total: results.length,
    results
  });
});

app.listen(PORT, () => {
  console.log("==============================");
  console.log("       NEXUS SEARCH 0.9");
  console.log("==============================");
  console.log(`Servidor: http://localhost:${PORT}`);
  console.log(`Status: http://localhost:${PORT}/api/health`);
  console.log("Ranking: BM25");
  console.log("Segurança: rate limit ativo");
});