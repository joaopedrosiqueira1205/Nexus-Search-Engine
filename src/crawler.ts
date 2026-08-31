import * as cheerio from "cheerio";
import { mkdir, writeFile } from "fs/promises";
import { createHash } from "crypto";

type PageRecord = {
  id: string;
  url: string;
  title: string;
  description: string;
  text: string;
  links: string[];
  crawledAt: string;
};

const USER_AGENT = "NexusSearchBot/0.1";

const MAX_PAGES = 20;

const DELAY_MS = 1000;

const pages: PageRecord[] = [];

const visited = new Set<string>();

function wait(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function createId(url: string) {
  return createHash("sha256")
    .update(url)
    .digest("hex")
    .slice(0, 16);
}

function cleanText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(
  href: string,
  currentUrl: string
) {
  try {
    const url = new URL(
      href,
      currentUrl
    );

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    url.hash = "";

    return url.toString();

  } catch {
    return null;
  }
}

async function crawlPage(
  url: string,
  allowedHost: string
) {

  console.log("");
  console.log("Visitando:");
  console.log(url);

  try {

    const response = await fetch(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html"
        }
      }
    );

    if (!response.ok) {
      console.log(
        `Ignorado: HTTP ${response.status}`
      );

      return [];
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes("text/html")
    ) {
      console.log(
        "Ignorado: não é HTML."
      );

      return [];
    }

    const html =
      await response.text();

    const $ =
      cheerio.load(html);

    // Remove elementos que não ajudam
    // na pesquisa.

    $("script").remove();
    $("style").remove();
    $("noscript").remove();
    $("svg").remove();

    const title =
      cleanText(
        $("title").first().text()
      ) || "Sem título";

    const description =
      cleanText(
        $(
          'meta[name="description"]'
        ).attr("content") || ""
      );

    const text =
      cleanText(
        $("body").text()
      ).slice(
        0,
        50000
      );

    const discoveredLinks:
      string[] = [];

    $("a[href]").each(
      (_index, element) => {

        const href =
          $(element).attr("href");

        if (!href) {
          return;
        }

        const normalized =
          normalizeUrl(
            href,
            url
          );

        if (!normalized) {
          return;
        }

        try {

          const parsed =
            new URL(normalized);

          // Por enquanto o crawler
          // fica somente no site inicial.
          if (
            parsed.hostname !==
            allowedHost
          ) {
            return;
          }

          if (
            !discoveredLinks.includes(
              normalized
            )
          ) {
            discoveredLinks.push(
              normalized
            );
          }

        } catch {
          return;
        }
      }
    );

    pages.push({
      id: createId(url),
      url,
      title,
      description,
      text,
      links: discoveredLinks,
      crawledAt:
        new Date().toISOString()
    });

    console.log(
      `Título: ${title}`
    );

    console.log(
      `Texto: ${text.length} caracteres`
    );

    console.log(
      `Links encontrados: ${discoveredLinks.length}`
    );

    return discoveredLinks;

  } catch (error: any) {

    console.log(
      "Erro ao visitar página:"
    );

    console.log(
      error?.message ||
      String(error)
    );

    return [];
  }
}

async function startCrawler() {

  const startUrl =
    process.argv[2];

  if (!startUrl) {

    console.log("");
    console.log(
      "Você precisa informar um site."
    );

    console.log("");
    console.log(
      "Exemplo:"
    );

    console.log(
      "npx tsx src/crawler.ts https://example.com"
    );

    return;
  }

  let parsedStart: URL;

  try {

    parsedStart =
      new URL(startUrl);

  } catch {

    console.log(
      "URL inválida."
    );

    return;
  }

  const allowedHost =
    parsedStart.hostname;

  const queue: string[] = [
    parsedStart.toString()
  ];

  console.log("");
  console.log(
    "================================"
  );

  console.log(
    "       NEXUS CRAWLER 0.1"
  );

  console.log(
    "================================"
  );

  console.log("");

  console.log(
    `Site: ${parsedStart.origin}`
  );

  console.log(
    `Limite: ${MAX_PAGES} páginas`
  );

  console.log("");

  while (
    queue.length > 0 &&
    pages.length < MAX_PAGES
  ) {

    const currentUrl =
      queue.shift();

    if (!currentUrl) {
      continue;
    }

    if (
      visited.has(currentUrl)
    ) {
      continue;
    }

    visited.add(currentUrl);

    const newLinks =
      await crawlPage(
        currentUrl,
        allowedHost
      );

    for (
      const link of newLinks
    ) {

      if (
        !visited.has(link) &&
        !queue.includes(link)
      ) {
        queue.push(link);
      }
    }

    if (
      pages.length <
      MAX_PAGES
    ) {
      await wait(DELAY_MS);
    }
  }

  await mkdir(
    "data",
    {
      recursive: true
    }
  );

  await writeFile(
    "data/pages.json",
    JSON.stringify(
      pages,
      null,
      2
    ),
    "utf-8"
  );

  console.log("");
  console.log(
    "================================"
  );

  console.log(
    "       CRAWLER FINALIZADO"
  );

  console.log(
    "================================"
  );

  console.log("");

  console.log(
    `Páginas salvas: ${pages.length}`
  );

  console.log(
    "Arquivo: data/pages.json"
  );

  console.log("");
}

startCrawler();