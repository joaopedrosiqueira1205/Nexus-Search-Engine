import { readFile, writeFile } from "fs/promises";

// ==========================================
// NEXUS INDEXER 0.1
// ==========================================

type PageRecord = {
  id: string;
  url: string;
  title: string;
  description: string;
  text: string;
  links: string[];
  crawledAt: string;
};

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
// PALAVRAS MUITO COMUNS
// ==========================================

const stopWords = new Set([
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "para",
  "por",
  "com",
  "que",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "is",
  "for",
  "on",
  "with"
]);

// ==========================================
// NORMALIZAR TEXTO
// ==========================================

function normalizeText(text: string) {
  return text
    .toLowerCase()

    // Remove acentos.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

    // Mantém letras e números.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")

    // Remove espaços duplicados.
    .replace(/\s+/g, " ")

    .trim();
}

// ==========================================
// TRANSFORMAR TEXTO EM PALAVRAS
// ==========================================

function tokenize(text: string) {

  const normalized =
    normalizeText(text);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .filter((word) => {

      if (word.length < 2) {
        return false;
      }

      if (stopWords.has(word)) {
        return false;
      }

      return true;
    });
}

// ==========================================
// CONTAR PALAVRAS
// ==========================================

function countTerms(
  words: string[]
) {

  const terms:
    Record<string, number> = {};

  for (const word of words) {

    if (!terms[word]) {
      terms[word] = 0;
    }

    terms[word]++;
  }

  return terms;
}

// ==========================================
// CRIAR ÍNDICE
// ==========================================

async function buildIndex() {

  console.log("");
  console.log(
    "================================"
  );

  console.log(
    "       NEXUS INDEXER 0.1"
  );

  console.log(
    "================================"
  );

  console.log("");

  // ========================================
  // ABRIR PAGES.JSON
  // ========================================

  let pages: PageRecord[];

  try {

    const file =
      await readFile(
        "data/pages.json",
        "utf-8"
      );

    pages =
      JSON.parse(file);

  } catch (error) {

    console.error(
      "Não foi possível abrir data/pages.json"
    );

    console.error(error);

    return;
  }

  console.log(
    `Páginas encontradas: ${pages.length}`
  );

  console.log("");

  // ========================================
  // INDEXAR DOCUMENTOS
  // ========================================

  const documents:
    IndexedDocument[] = [];

  const allTerms =
    new Set<string>();

  for (const page of pages) {

    console.log(
      `Indexando: ${page.title}`
    );

    // O título aparece mais vezes
    // propositalmente.
    //
    // Isso fará palavras presentes
    // no título terem mais importância.

    const searchableText = `
      ${page.title}
      ${page.title}
      ${page.title}

      ${page.description}
      ${page.description}

      ${page.text}
    `;

    const words =
      tokenize(searchableText);

    const terms =
      countTerms(words);

    for (
      const term of Object.keys(terms)
    ) {
      allTerms.add(term);
    }

    documents.push({

      id:
        page.id,

      url:
        page.url,

      title:
        page.title,

      description:
        page.description,

      wordCount:
        words.length,

      terms:
        terms

    });

    console.log(
      `  Palavras: ${words.length}`
    );

    console.log(
      `  Termos únicos: ${Object.keys(terms).length}`
    );

    console.log("");
  }

  // ========================================
  // CRIAR ARQUIVO FINAL
  // ========================================

  const index:
    NexusIndex = {

    version:
      "0.1",

    createdAt:
      new Date().toISOString(),

    totalDocuments:
      documents.length,

    totalTerms:
      allTerms.size,

    documents:
      documents
  };

  // ========================================
  // SALVAR
  // ========================================

  await writeFile(
    "data/index.json",

    JSON.stringify(
      index,
      null,
      2
    ),

    "utf-8"
  );

  console.log(
    "================================"
  );

  console.log(
    "       ÍNDICE CRIADO"
  );

  console.log(
    "================================"
  );

  console.log("");

  console.log(
    `Documentos: ${documents.length}`
  );

  console.log(
    `Termos únicos: ${allTerms.size}`
  );

  console.log("");

  console.log(
    "Arquivo: data/index.json"
  );

  console.log("");
}

buildIndex();