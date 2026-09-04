import * as cheerio from "cheerio";
import {
  mkdir,
  readFile,
  writeFile
} from "fs/promises";
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

const USER_AGENT = "NexusSearchBot/0.2";
const MAX_PAGES_PER_SITE = 20;
const DELAY_MS = 1000;

const pages: PageRecord[] = [];
const visited = new Set<string>();

function wait(ms: number) {
  return new Promise<void>((resolve) =>
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
  return text.replace(/\s+/g, " ").trim();
}

function normalizeUrl(
  href: string,
  currentUrl: string
) {
  try {
    const url = new URL(href, currentUrl);

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

async function loadExistingPages() {
  try {
    const file = await readFile(
      "data/pages.json",
      "utf-8"
    );

    const existing =
      JSON.parse(file) as PageRecord[];

    for (const page of existing) {
      if (
        !pages.some(
          (item) => item.url === page.url
        )
      ) {
        pages.push(page);
      }
    }
  } catch {
    console.log(
      "Nenhum índice anterior encontrado."
    );
  }
}

async function crawlPage(
  url: string,
  allowedHost: string
) {
  console.log(`Visitando: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html"
      }
    });

    if (!response.ok) {
      console.log(
        `Ignorado: HTTP ${response.status}`
      );

      return [];
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      console.log("Ignorado: não é HTML.");
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $("script, style, noscript, svg").remove();

    const title =
      cleanText($("title").first().text()) ||
      "Sem título";

    const description = cleanText(
      $('meta[name="description"]')
        .attr("content") || ""
    );

    const text = cleanText(
      $("body").text()
    ).slice(0, 50000);

    const discoveredLinks: string[] = [];

    $("a[href]").each((_index, element) => {
      const href = $(element).attr("href");

      if (!href) {
        return;
      }

      const normalized =
        normalizeUrl(href, url);

      if (!normalized) {
        return;
      }

      const parsed = new URL(normalized);

      if (parsed.hostname !== allowedHost) {
        return;
      }

      if (
        !discoveredLinks.includes(normalized)
      ) {
        discoveredLinks.push(normalized);
      }
    });

    pages.push({
      id: createId(url),
      url,
      title,
      description,
      text,
      links: discoveredLinks,
      crawledAt: new Date().toISOString()
    });

    console.log(`Título: ${title}`);
    console.log(
      `Links: ${discoveredLinks.length}`
    );

    return discoveredLinks;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.log(`Erro: ${message}`);

    return [];
  }
}

async function startCrawler() {
  const startUrls = process.argv.slice(2);

  if (startUrls.length === 0) {
    console.log(
      "Informe pelo menos um site."
    );

    console.log(
      "Exemplo: npx tsx src/crawler.ts https://example.com"
    );

    return;
  }

  await loadExistingPages();

  const previousTotal = pages.length;

  console.log("");
  console.log("==============================");
  console.log("      NEXUS CRAWLER 0.2");
  console.log("==============================");
  console.log(
    `Páginas existentes: ${previousTotal}`
  );

  for (const input of startUrls) {
    let startUrl: URL;

    try {
      startUrl = new URL(input);

      if (
        startUrl.protocol !== "http:" &&
        startUrl.protocol !== "https:"
      ) {
        throw new Error(
          "Somente HTTP e HTTPS são aceitos."
        );
      }
    } catch {
      console.log(`URL inválida: ${input}`);
      continue;
    }

    const allowedHost = startUrl.hostname;
    const queue = [startUrl.toString()];
    let collected = 0;

    console.log("");
    console.log(
      `Coletando: ${startUrl.origin}`
    );

    while (
      queue.length > 0 &&
      collected < MAX_PAGES_PER_SITE
    ) {
      const currentUrl = queue.shift();

      if (
        !currentUrl ||
        visited.has(currentUrl)
      ) {
        continue;
      }

      visited.add(currentUrl);

      if (
        pages.some(
          (page) => page.url === currentUrl
        )
      ) {
        continue;
      }

      const totalBefore = pages.length;

      const links = await crawlPage(
        currentUrl,
        allowedHost
      );

      if (pages.length > totalBefore) {
        collected++;
      }

      for (const link of links) {
        if (
          !visited.has(link) &&
          !queue.includes(link) &&
          !pages.some(
            (page) => page.url === link
          )
        ) {
          queue.push(link);
        }
      }

      if (
        queue.length > 0 &&
        collected < MAX_PAGES_PER_SITE
      ) {
        await wait(DELAY_MS);
      }
    }
  }

  await mkdir("data", {
    recursive: true
  });

  await writeFile(
    "data/pages.json",
    JSON.stringify(pages, null, 2),
    "utf-8"
  );

  console.log("");
  console.log("==============================");
  console.log("      CRAWLER FINALIZADO");
  console.log("==============================");
  console.log(
    `Páginas anteriores: ${previousTotal}`
  );
  console.log(
    `Novas páginas: ${pages.length - previousTotal}`
  );
  console.log(
    `Total salvo: ${pages.length}`
  );
}

startCrawler();