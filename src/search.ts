import { readFile } from "fs/promises";

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

async function search(query: string) {
  const file = await readFile(
    "data/index.json",
    "utf-8"
  );

  const index: NexusIndex =
    JSON.parse(file);

  const queryTerms =
    tokenize(query);

  const results =
    index.documents
      .map((document) => {

        let score = 0;

        for (const term of queryTerms) {
          const frequency =
            document.terms[term] || 0;

          score += frequency;
        }

        return {
          title: document.title,
          url: document.url,
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
      );

  return results;
}

async function main() {
  const query =
    process.argv
      .slice(2)
      .join(" ")
      .trim();

  if (!query) {
    console.log("");
    console.log(
      "Digite uma pesquisa."
    );
    console.log("");
    console.log(
      'Exemplo: npx tsx src/search.ts "example domain"'
    );
    return;
  }

  console.log("");
  console.log(
    "================================"
  );
  console.log(
    "       NEXUS SEARCH 0.1"
  );
  console.log(
    "================================"
  );
  console.log("");

  console.log(
    `Pesquisa: ${query}`
  );

  const results =
    await search(query);

  console.log("");

  if (
    results.length === 0
  ) {
    console.log(
      "Nenhum resultado encontrado."
    );
    return;
  }

  results.forEach(
    (result, index) => {

      console.log(
        `${index + 1}. ${result.title}`
      );

      console.log(
        result.url
      );

      console.log(
        `Score: ${result.score}`
      );

      if (
        result.description
      ) {
        console.log(
          result.description
        );
      }

      console.log("");
    }
  );
}

main();