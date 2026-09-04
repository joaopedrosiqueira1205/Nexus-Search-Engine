import express from "express";
import path from "path";
import { readFile } from "fs/promises";

const app = express();
const PORT = 3000;

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

app.use(express.json());

app.use(
  express.static(
    path.join(process.cwd(), "public")
  )
);

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
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .filter((word) => word.length >= 2);
}

async function loadIndex(): Promise<NexusIndex> {
  const file = await readFile(
    "data/index.json",
    "utf-8"
  );

  return JSON.parse(file) as NexusIndex;
}

/*
  BM25 considera:

  - frequência da palavra na página;
  - raridade da palavra no índice;
  - tamanho da página;
  - tamanho médio dos documentos.
*/

function calculateBm25Score(
  document: IndexedDocument,
  queryTerms: string[],
  documents: IndexedDocument[],
  averageDocumentLength: number
) {
  const k1 = 1.5;
  const b = 0.75;

  let score = 0;

  for (const term of queryTerms) {
    const frequency =
      document.terms[term] || 0;

    if (frequency === 0) {
      continue;
    }

    const documentsWithTerm =
      documents.filter(
        (item) =>
          (item.terms[term] || 0) > 0
      ).length;

    const inverseDocumentFrequency =
      Math.log(
        1 +
        (
          documents.length -
          documentsWithTerm +
          0.5
        ) /
        (
          documentsWithTerm +
          0.5
        )
      );

    const lengthNormalization =
      frequency +
      k1 *
      (
        1 -
        b +
        b *
        (
          document.wordCount /
          averageDocumentLength
        )
      );

    score +=
      inverseDocumentFrequency *
      (
        frequency *
        (k1 + 1)
      ) /
      lengthNormalization;
  }

  return score;
}

app.get(
  "/api/health",
  async (_req, res) => {
    try {
      const index = await loadIndex();

      res.json({
        name: "Nexus",
        status: "online",
        version: "0.7.0",
        ranking: "BM25",
        searchEngine: "Nexus Index",
        documents: index.totalDocuments,
        terms: index.totalTerms,
        indexVersion: index.version
      });
    } catch {
      res.status(500).json({
        name: "Nexus",
        status: "index-error"
      });
    }
  }
);

app.get(
  "/api/search",
  async (req, res) => {
    const query = String(
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
      const index = await loadIndex();
      const queryTerms = tokenize(query);

      const totalDocumentLength =
        index.documents.reduce(
          (total, document) =>
            total + document.wordCount,
          0
        );

      const averageDocumentLength =
        index.documents.length > 0
          ? totalDocumentLength /
            index.documents.length
          : 1;

      const results = index.documents
        .map((document) => {
          const score =
            calculateBm25Score(
              document,
              queryTerms,
              index.documents,
              averageDocumentLength
            );

          return {
            id: document.id,
            title: document.title,
            url: document.url,
            description:
              document.description,
            score: Number(
              score.toFixed(4)
            )
          };
        })
        .filter(
          (result) => result.score > 0
        )
        .sort(
          (a, b) => b.score - a.score
        )
        .slice(0, 20);

      res.json({
        engine: "Nexus",
        ranking: "BM25",
        query,
        total: results.length,
        results
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "O Nexus não conseguiu pesquisar o índice."
      });
    }
  }
);

app.listen(PORT, () => {
  console.log("");
  console.log("==============================");
  console.log("       NEXUS SEARCH 0.7");
  console.log("==============================");
  console.log("");
  console.log(
    `Servidor: http://localhost:${PORT}`
  );
  console.log(
    `Status: http://localhost:${PORT}/api/health`
  );
  console.log(
    "Ranking: BM25"
  );
  console.log("");
});