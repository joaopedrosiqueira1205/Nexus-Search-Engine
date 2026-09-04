import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

type Page = {
  url: string;
  title: string;
  text: string;
  description: string;
};

const DATA_FILE = path.join(process.cwd(), "data", "pages.json");
const MAX_PAGES_PER_SITE = 20;
const USER_AGENT = "NexusSearchBot/1.0";

function loadPages(): Page[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function savePages(pages: Page[]) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(pages, null, 2));
}

async function allowedByRobots(url: string): Promise<boolean> {
  try {
    const target = new URL(url);
    const robotsUrl = `${target.origin}/robots.txt`;

    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT }
    });

    if (!response.ok) return true;

    const robots = await response.text();
    const lines = robots.split(/\r?\n/);

    let applies = false;

    for (const line of lines) {
      const [field, value] = line.split(":").map(item => item.trim());

      if (field?.toLowerCase() === "user-agent") {
        applies = value === "*" || value === USER_AGENT;
      }

      if (
        applies &&
        field?.toLowerCase() === "disallow" &&
        value &&
        target.pathname.startsWith(value)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return true;
  }
}

async function crawlSite(startUrl: string, existing: Page[]): Promise<Page[]> {
  const start = new URL(startUrl);
  const queue = [start.href];
  const visited = new Set<string>();
  const collected: Page[] = [];

  while (queue.length > 0 && collected.length < MAX_PAGES_PER_SITE) {
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
        headers: { "User-Agent": USER_AGENT }
      });

      if (!response.ok) continue;

      const html = await response.text();
      const $ = cheerio.load(html);

      const title = $("title").first().text().trim() || currentUrl;
      const description =
        $('meta[name="description"]').attr("content")?.trim() || "";
      const text = $("body").text().replace(/\s+/g, " ").trim();

      const page: Page = {
        url: currentUrl,
        title,
        text,
        description
      };

      if (
        !existing.some(item => item.url === currentUrl) &&
        !collected.some(item => item.url === currentUrl)
      ) {
        collected.push(page);
        console.log(`Título: ${title}`);
      }

      $("a[href]").each((_, element) => {
        const href = $(element).attr("href");
        if (!href) return;

        try {
          const absolute = new URL(href, currentUrl);

          if (
            absolute.origin === start.origin &&
            ["http:", "https:"].includes(absolute.protocol) &&
            !visited.has(absolute.href)
          ) {
            queue.push(absolute.href);
          }
        } catch {
          // Link inválido ignorado
        }
      });
    } catch {
      console.log(`Erro ao acessar: ${currentUrl}`);
    }
  }

  return collected;
}

async function main() {
  const urls = process.argv.slice(2);

  if (urls.length === 0) {
    console.log("Uso: npx tsx src/crawler.ts https://example.org");
    return;
  }

  const existing = loadPages();
  const newPages: Page[] = [];

  for (const url of urls) {
    console.log(`\nColetando: ${url}`);
    const pages = await crawlSite(url, [...existing, ...newPages]);
    newPages.push(...pages);
  }

  const allPages = [...existing, ...newPages];
  savePages(allPages);

  console.log("\n==============================");
  console.log("      CRAWLER FINALIZADO");
  console.log("==============================");
  console.log(`Páginas anteriores: ${existing.length}`);
  console.log(`Novas páginas: ${newPages.length}`);
  console.log(`Total salvo: ${allPages.length}`);
}

main();