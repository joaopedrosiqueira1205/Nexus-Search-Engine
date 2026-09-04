import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SITES_FILE = path.join(process.cwd(), "sites.txt");

function loadSites(): string[] {
  const commandSites = process.argv.slice(2);
  let fileSites: string[] = [];

  if (fs.existsSync(SITES_FILE)) {
    fileSites = fs
      .readFileSync(SITES_FILE, "utf-8")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));
  }

  const sites = [...new Set([...fileSites, ...commandSites])];

  return sites.filter(site => {
    try {
      const url = new URL(site);

      return (
        url.protocol === "http:" ||
        url.protocol === "https:"
      );
    } catch {
      console.log(`URL inválida ignorada: ${site}`);
      return false;
    }
  });
}

function runScript(script: string, args: string[] = []) {
  const tsxCli = path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );

  const result = spawnSync(
    process.execPath,
    [tsxCli, script, ...args],
    {
      stdio: "inherit",
      shell: false
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Falha ao executar ${script}`);
  }
}

function main() {
  const sites = loadSites();

  if (sites.length === 0) {
    console.log("Nenhum site encontrado.");
    console.log("Adicione endereços no arquivo sites.txt.");
    process.exit(1);
  }

  console.log("==============================");
  console.log("       NEXUS BUILD 1.0");
  console.log("==============================");
  console.log(`Sites iniciais: ${sites.length}`);

  for (const site of sites) {
    console.log(`- ${site}`);
  }

  try {
    console.log("\nIniciando crawler...");
    runScript("src/crawler.ts", sites);

    console.log("\nIniciando indexador...");
    runScript("src/indexer.ts");

    console.log("\n==============================");
    console.log("       BUILD FINALIZADO");
    console.log("==============================");
    console.log("Crawler: OK");
    console.log("Indexador: OK");
    console.log("Arquivos atualizados:");
    console.log("data/pages.json");
    console.log("data/index.json");
  } catch (error) {
    console.error("\nBUILD INTERROMPIDO");
    console.error(
      error instanceof Error
        ? error.message
        : error
    );

    process.exit(1);
  }
}

main();