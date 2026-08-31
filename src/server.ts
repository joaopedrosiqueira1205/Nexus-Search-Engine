import express from "express";
import path from "path";
import { readFile } from "fs/promises";

const app = express();
const PORT = 3000;

// ==========================================
// TIPOS DO ÍNDICE
// ==========================================

type IndexedDocument = {
  id: string;
  url: string;
  title: string;
  description: string;
  wordCount: number;
  terms: Record<string, number>;
};

type NexusIndex = {
  version: string;
  createdAt: string;
  totalDocuments: number;
  totalTerms: number;
  documents: IndexedDocument[];
};

// ==========================================
// CONFIGURAÇÃO
// ==========================================

app.use(express.json());

app.use(
  express.static(
    path.join(process.cwd(), "public")
  )
);

// ==========================================
// NORMALIZAÇÃO
// ==========================================

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string) {
  return normalizeText(text)
    .split(" ")
    .filter((word) => word.length >= 2);
}

// ==========================================
// CARREGAR ÍNDICE
// ==========================================

async function loadIndex(): Promise<NexusIndex> {

  const file = await readFile(
    "data/index.json",
    "utf-8"
  );

  return JSON.parse(file);
}

// ==========================================
// RANKING
// ==========================================

function calculateScore(
  document: IndexedDocument,
  queryTerms: string[]
) {

  let score = 0;

  for (const term of queryTerms) {

    const frequency =
      document.terms[term] || 0;

    score += frequency;
  }

  return score;
}

// ==========================================
// STATUS
// ==========================================

app.get(
  "/api/health",
  async (_req, res) => {

    try {

      const index =
        await loadIndex();

      res.json({
        name: "Nexus",
        status: "online",
        version: "0.6.0",
        searchEngine:
          "Nexus Index",
        documents:
          index.totalDocuments,
        terms:
          index.totalTerms,
        indexVersion:
          index.version
      });

    } catch {

      res.status(500).json({
        name: "Nexus",
        status: "index-error"
      });
    }
  }
);

// ==========================================
// PESQUISA
// ==========================================

app.get(
  "/api/search",
  async (req, res) => {

    const query =
      String(
        req.query.q || ""
      ).trim();

    if (!query) {

      res.status(400).json({
        error:
          "Digite algo para pesquisar."
      });

      return;
    }

    try {

      const index =
        await loadIndex();

      const queryTerms =
        tokenize(query);

      const results =
        index.documents
          .map((document) => {

            const score =
              calculateScore(
                document,
                queryTerms
              );

            return {
              id:
                document.id,

              title:
                document.title,

              url:
                document.url,

              description:
                document.description,

              score
            };
          })
          .filter(
            (result) =>
              result.score > 0
          )
          .sort(
            (a, b) =>
              b.score - a.score
          )
          .slice(0, 20);

      res.json({
        engine:
          "Nexus",

        query,

        total:
          results.length,

        results
      });

    } catch (error: any) {

      console.error(error);

      res.status(500).json({
        error:
          "O Nexus não conseguiu pesquisar o índice.",

        details:
          error?.message ||
          String(error)
      });
    }
  }
);

// ==========================================
// INICIAR SERVIDOR
// ==========================================

app.listen(
  PORT,
  () => {

    console.log("");
    console.log(
      "================================"
    );

    console.log(
      "       NEXUS SEARCH 0.6"
    );

    console.log(
      "================================"
    );

    console.log("");

    console.log(
      `Servidor: http://localhost:${PORT}`
    );

    console.log(
      `Status: http://localhost:${PORT}/api/health`
    );

    console.log(
      `Pesquisa: http://localhost:${PORT}/api/search?q=example+domain`
    );

    console.log("");
    console.log(
      "Motor: NEXUS INDEX"
    );

    console.log("");
  }
);