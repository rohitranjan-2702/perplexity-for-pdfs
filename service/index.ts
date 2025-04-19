import dotenv from "dotenv";
import { GoogleSearchAPI } from "./google-search";
import readline from "readline";
import { PDFProcessor } from "./pdf-processor";
import { createSemanticCacheKey } from "./utils";
import { redis } from "./redis-client";
import { cacheConfig } from "./constants";

dotenv.config();

const googleSearchAPI = new GoogleSearchAPI(
  process.env.GOOGLE_API_KEY!,
  process.env.GOOGLE_SEARCH_ENGINE_ID
);

async function processQuery(query: string) {
  const validPDFs = await searchAndValidatePDFs(query);
  if (!validPDFs) {
    console.log("No valid PDFs found");
    return;
  }

  const pdfs = validPDFs.map((pdf) => ({
    url: pdf.link,
    title: pdf.title,
    snippet: pdf.snippet,
  }));

  const semanticQueryKey = createSemanticCacheKey(query);

  console.log(`Processing ${pdfs.length} PDFs`);

  // TODO: save query and pdfs to db

  const pdfProcessor = new PDFProcessor();
  const results = await Promise.all(
    pdfs.map((pdf) => pdfProcessor.processPdf(pdf.url, query, semanticQueryKey))
  );

  // store results in redis and cleanup memory
  Promise.all([
    redis.set(
      semanticQueryKey,
      JSON.stringify(results),
      "EX",
      cacheConfig.query.ttl
    ),
    pdfProcessor.cleanupMemory(),
  ]);

  console.log(results.length);
  const docs = results.flat();
  console.log(docs);
}

async function searchAndValidatePDFs(query: string) {
  try {
    const searchResults = await googleSearchAPI.searchPDFs(query, 3); // FIXME keep this low for now
    const validPDFs = await googleSearchAPI.validatePDFResults(searchResults);

    console.log(
      `Found ${searchResults.length} results, ${validPDFs.length} valid PDFs`
    );
    return validPDFs;
  } catch (error) {
    console.error("Error in search and validate workflow:", error);
  }
}

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const getUserQuery = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question("Enter your query: ", (query: string) => {
        resolve(query);
        rl.close();
      });
    });
  };

  const query = await getUserQuery();

  const start = Date.now();
  await processQuery(query);
  const end = Date.now();
  console.log(`Time taken: ${end - start}ms`);
}

main().catch((error) => {
  console.error("Error:", error);
});
