import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

type Page = {
  url: string;
  title: string;
  text: string;
  description: string;
};

type RobotsRules = {
  disallow: string[];
};

const DATA_FILE = path.join(process.cwd(), "data", "pages.json");
const USER_AGENT = "NexusSearchBot/1.0";
const MAX_PAGES_PER_SITE = Number(process.env.MAX_PAGES_PER_SITE) || 40;
const DELAY_MS = Number(process.env.CRAWL_DELAY_MS) || 500;

const robotsCache = new Map<string, RobotsRules>();

function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function loadPages(): Page[] {
  if (!fs.existsSync(DATA_FILE)) return [];

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function savePages(pages: Page[]) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(pages, null, 2));
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    url.hash = "";

    const blockedExtensions =
      /\.(jpg|jpeg|png|gif|svg|webp|ico|pdf|zip|rar|mp3|mp4|avi|css|js|json|xml)$/i;

    if (blockedExtensions.test(url.pathname)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

async function loadRobots(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const rules: RobotsRules = { disallow: [] };

  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      robotsCache.set(origin, rules);
      return rules;
    }

    const content = await response.text();
    const lines = content.split(/\r?\n/);

    let applies = false;

    for (const originalLine of lines) {
      const line = originalLine.split("#")[0].trim();
      if (!line) continue;

      const separator = line.indexOf(":");
      if (separator < 0) continue;

      const field = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();

      if (field === "user-agent") {
        applies =
          value === "*" ||
          value.toLowerCase() === USER_AGENT.toLowerCase();
      }

      if (applies && field === "disallow" && value) {
        rules.disallow.push(value);
      }
    }
  } catch {
    console.log(`Não foi possível ler robots.txt de ${origin}`);
  }

  robotsCache.set(origin, rules);
  return rules;
}

async function allowedByRobots(urlValue: string): Promise<boolean> {
  const url = new URL(urlValue);
  const rules = await loadRobots(url.origin);

  return !rules.disallow.some(rule => {
    if (rule === "/") return true;
    return url.pathname.startsWith(rule);
  });
}

async function crawlSite(startUrl: string): Promise<Page[]> {
  const normalizedStart = normalizeUrl(startUrl);

  if (!normalizedStart) {
    console.log(`URL inicial inválida: ${startUrl}`);
    return [];
  }

  const start = new URL(normalizedStart);
  const queue = [normalizedStart];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const pages: Page[] = [];

  while (queue.length > 0 && pages.length < MAX_PAGES_PER_SITE) {
    const currentUrl = queue.shift()!;

    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    if (!(await allowedByRobots(currentUrl))) {
      console.log(`Bloqueado por robots.txt: ${currentUrl}`);
      continue;
    }

    try {
      console.log(`Visitando: ${currentUrl}`);

      const response = await fetch(currentUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000)
      });

      if (!response.ok) {
        console.log(`HTTP ${response.status}: ${currentUrl}`);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("text/html")) {
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      $("script, style, noscript, svg").remove();

      const finalUrl = normalizeUrl(response.url) || currentUrl;
      const title = $("title").first().text().replace(/\s+/g, " ").trim();
      const description =
        $('meta[name="description"]').attr("content")?.trim() ||
        $('meta[property="og:description"]').attr("content")?.trim() ||
        "";

      const text = $("body").text().replace(/\s+/g, " ").trim();

      if (title && text.length >= 50) {
        pages.push({
          url: finalUrl,
          title,
          description,
          text
        });

        console.log(`Indexável: ${title}`);
      }

      $("a[href]").each((_, element) => {
        const href = $(element).attr("href");
        if (!href) return;

        const absolute = normalizeUrl(new URL(href, finalUrl).href);
        if (!absolute) return;

        const target = new URL(absolute);

        if (
          target.origin === start.origin &&
          !visited.has(absolute) &&
          !queued.has(absolute)
        ) {
          queue.push(absolute);
          queued.add(absolute);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      console.log(`Erro em ${currentUrl}: ${message}`);
    }

    await sleep(DELAY_MS);
  }

  return pages;
}

async function main() {
  const urls = process.argv.slice(2);

  if (urls.length === 0) {
    console.log("Nenhum site informado.");
    console.log("Use: npm run build-index");
    return;
  }

  const existing = loadPages();
  const pageMap = new Map(existing.map(page => [page.url, page]));

  console.log("==============================");
  console.log("      NEXUS CRAWLER 1.0");
  console.log("==============================");
  console.log(`Limite por site: ${MAX_PAGES_PER_SITE}`);
  console.log(`Intervalo: ${DELAY_MS} ms`);
  console.log(`Páginas existentes: ${existing.length}`);

  let collected = 0;

  for (const url of urls) {
    console.log(`\nColetando: ${url}`);

    const pages = await crawlSite(url);

    for (const page of pages) {
      pageMap.set(page.url, page);
      collected++;
    }
  }

  const allPages = [...pageMap.values()];
  savePages(allPages);

  console.log("\n==============================");
  console.log("      CRAWLER FINALIZADO");
  console.log("==============================");
  console.log(`Páginas processadas: ${collected}`);
  console.log(`Total salvo: ${allPages.length}`);
}

main().catch(error => {
  console.error("Crawler interrompido:", error);
  process.exit(1);
});