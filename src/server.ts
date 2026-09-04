import express from "express";
import fs from "node:fs";
import path from "node:path";

type IndexedDocument = {
  url: string;
  title: string;
  description?: string;
  content?: string;
};

type PreparedDocument = IndexedDocument & {
  length: number;
  frequencies: Map<string, number>;
  titleTerms: Set<string>;
};

type SearchResult = {
  url: string;
  title: string;
  description: string;
  score: number;
};

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const INDEX_FILE = path.join(process.cwd(), "data", "index.json");
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS_PER_PAGE = 50;
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 60;
const CACHE_MAX_SIZE = 100;

const requests = new Map<
  string,
  { count: number; start: number }
>();

const searchCache = new Map<string, SearchResult[]>();

let documents: PreparedDocument[] = [];
let documentFrequency = new Map<string, number>();
let postings = new Map<string, Set<number>>();
let averageDocumentLength = 1;
let indexModifiedTime = 0;

app.set("trust proxy", 1);

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(term => term.length > 1);
}

function loadIndex(): void {
  if (!fs.existsSync(INDEX_FILE)) {
    documents = [];
    documentFrequency = new Map();
    postings = new Map();
    averageDocumentLength = 1;
    return;
  }

  const raw = JSON.parse(
    fs.readFileSync(INDEX_FILE, "utf-8")
  );

  const sourceDocuments: IndexedDocument[] =
    Array.isArray(raw) ? raw : raw.documents || [];

  documentFrequency = new Map();
  postings = new Map();

  documents = sourceDocuments.map((document, index) => {
    const text = [
      document.title,
      document.description || "",
      document.content || ""
    ].join(" ");

    const terms = normalize(text);
    const frequencies = new Map<string, number>();

    for (const term of terms) {
      frequencies.set(
        term,
        (frequencies.get(term) || 0) + 1
      );
    }

    for (const term of frequencies.keys()) {
      documentFrequency.set(
        term,
        (documentFrequency.get(term) || 0) + 1
      );

      if (!postings.has(term)) {
        postings.set(term, new Set());
      }

      postings.get(term)!.add(index);
    }

    return {
      ...document,
      length: terms.length,
      frequencies,
      titleTerms: new Set(normalize(document.title))
    };
  });

  const totalLength = documents.reduce(
    (sum, document) => sum + document.length,
    0
  );

  averageDocumentLength =
    totalLength / Math.max(documents.length, 1);

  indexModifiedTime = fs.statSync(INDEX_FILE).mtimeMs;
  searchCache.clear();

  console.log(
    `Índice carregado: ${documents.length} documentos`
  );
}

function refreshIndexIfNeeded(): void {
  if (!fs.existsSync(INDEX_FILE)) return;

  const modifiedTime = fs.statSync(INDEX_FILE).mtimeMs;

  if (modifiedTime !== indexModifiedTime) {
    loadIndex();
  }
}

function calculateBM25(
  document: PreparedDocument,
  queryTerms: string[]
): number {
  const k1 = 1.5;
  const b = 0.75;
  let score = 0;

  for (const term of queryTerms) {
    const frequency = document.frequencies.get(term) || 0;
    if (frequency === 0) continue;

    const containingDocuments =
      documentFrequency.get(term) || 0;

    const idf = Math.log(
      1 +
        (documents.length - containingDocuments + 0.5) /
          (containingDocuments + 0.5)
    );

    const normalization =
      frequency +
      k1 *
        (1 -
          b +
          b *
            (document.length /
              Math.max(averageDocumentLength, 1)));

    let termScore =
      idf * ((frequency * (k1 + 1)) / normalization);

    if (document.titleTerms.has(term)) {
      termScore *= 2;
    }

    score += termScore;
  }

  return score;
}

function createSnippet(
  document: IndexedDocument,
  queryTerms: string[]
): string {
  const text =
    document.content ||
    document.description ||
    "Sem descrição disponível.";

  const lowerText = text.toLowerCase();

  const positions = queryTerms
    .map(term => lowerText.indexOf(term))
    .filter(position => position >= 0)
    .sort((a, b) => a - b);

  const position = positions[0] ?? 0;
  const start = Math.max(0, position - 100);
  const snippet = text
    .slice(start, start + 300)
    .replace(/\s+/g, " ")
    .trim();

  return `${start > 0 ? "... " : ""}${snippet}${
    start + 300 < text.length ? " ..." : ""
  }`;
}

function search(query: string): SearchResult[] {
  const queryTerms = [...new Set(normalize(query))];

  if (queryTerms.length === 0) return [];

  const cacheKey = queryTerms.join(" ");
  const cached = searchCache.get(cacheKey);

  if (cached) return cached;

  const candidateIndexes = new Set<number>();

  for (const term of queryTerms) {
    const termPostings = postings.get(term);

    if (!termPostings) continue;

    for (const index of termPostings) {
      candidateIndexes.add(index);
    }
  }

  const results = [...candidateIndexes]
    .map(index => {
      const document = documents[index];
      const score = calculateBM25(
        document,
        queryTerms
      );

      return {
        url: document.url,
        title: document.title,
        description: createSnippet(
          document,
          queryTerms
        ),
        score: Number(score.toFixed(4))
      };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score);

  if (searchCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = searchCache.keys().next().value;

    if (oldestKey !== undefined) {
      searchCache.delete(oldestKey);
    }
  }

  searchCache.set(cacheKey, results);
  return results;
}

app.use(express.static(
  path.join(process.cwd(), "public")
));

app.use("/api", (req, res, next) => {
  const ip =
    req.ip ||
    req.socket.remoteAddress ||
    "unknown";

  const now = Date.now();
  const current = requests.get(ip);

  if (
    !current ||
    now - current.start > RATE_LIMIT_WINDOW
  ) {
    requests.set(ip, {
      count: 1,
      start: now
    });

    return next();
  }

  current.count++;

  if (current.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error:
        "Muitas requisições. Aguarde um minuto e tente novamente."
    });
  }

  next();
});

app.get("/api/health", (_req, res) => {
  refreshIndexIfNeeded();

  res.json({
    status: "online",
    version: "1.0.0",
    ranking: "BM25 otimizado",
    security: "rate limit ativo",
    cache: "ativo",
    documents: documents.length,
    terms: documentFrequency.size
  });
});

app.get("/api/search", (req, res) => {
  const startedAt = performance.now();

  refreshIndexIfNeeded();

  const query = String(req.query.q || "")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);

  const requestedPage = Number(req.query.page);
  const requestedLimit = Number(req.query.limit);

  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0
      ? requestedPage
      : 1;

  const limit =
    Number.isInteger(requestedLimit) &&
    requestedLimit > 0
      ? Math.min(
          requestedLimit,
          MAX_RESULTS_PER_PAGE
        )
      : 20;

  if (!query) {
    return res.status(400).json({
      error: "Informe uma pesquisa usando o parâmetro q."
    });
  }

  const allResults = search(query);
  const total = allResults.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const results = allResults.slice(
    start,
    start + limit
  );

  res.json({
    query,
    ranking: "BM25 otimizado",
    page,
    limit,
    total,
    totalPages,
    responseTimeMs: Number(
      (performance.now() - startedAt).toFixed(2)
    ),
    results
  });
});

loadIndex();

app.listen(PORT, "0.0.0.0", () => {
  console.log("==============================");
  console.log("       NEXUS SEARCH 1.0");
  console.log("==============================");
  console.log(`Servidor: http://localhost:${PORT}`);
  console.log(`Documentos: ${documents.length}`);
  console.log(`Termos: ${documentFrequency.size}`);
  console.log("Ranking: BM25 otimizado");
  console.log("Cache: ativo");
  console.log("Paginação: ativa");
});