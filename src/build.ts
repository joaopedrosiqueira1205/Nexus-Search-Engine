import { spawn } from "child_process";

const targetUrl = process.argv[2];

if (!targetUrl) {
  console.log("");
  console.log("Uso:");
  console.log("npx tsx src/build.ts https://example.com");
  console.log("");
  process.exit(1);
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    console.log("");
    console.log("================================");
    console.log(`Executando: ${command} ${args.join(" ")}`);
    console.log("================================");
    console.log("");

    const child = spawn(
      command,
      args,
      {
        stdio: "inherit",
        shell: true
      }
    );

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Processo terminou com código ${code}`
          )
        );
      }
    });
  });
}

async function build() {
  console.log("");
  console.log("================================");
  console.log("       NEXUS BUILD 0.1");
  console.log("================================");
  console.log("");
  console.log(`Site: ${targetUrl}`);

  try {
    await run(
      "npx",
      [
        "tsx",
        "src/crawler.ts",
        targetUrl
      ]
    );

    await run(
      "npx",
      [
        "tsx",
        "src/indexer.ts"
      ]
    );

    console.log("");
    console.log("================================");
    console.log("       BUILD FINALIZADO");
    console.log("================================");
    console.log("");
    console.log("Crawler: OK");
    console.log("Indexador: OK");
    console.log("");
    console.log("Arquivos atualizados:");
    console.log("data/pages.json");
    console.log("data/index.json");
    console.log("");

  } catch (error: any) {
    console.error("");
    console.error("BUILD FALHOU");
    console.error(
      error?.message || error
    );
    console.error("");

    process.exit(1);
  }
}

build();