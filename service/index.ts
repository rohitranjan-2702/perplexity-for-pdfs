import dotenv from "dotenv";
import { GoogleSearchAPI } from "./google-search";
import readline from "readline";
import { DocumentArray, PDFProcessor } from "./pdf-processor";
import { createSemanticCacheKey } from "./utils";
import { redis } from "./redis-client";
import { cacheConfig } from "./constants";

interface Result {
  pdfUrl: string;
  title: string;
  snippet: string;
  thumbnail: string;
  relevantPages: {
    pageNumber: number;
    pageContent: string;
    score: number;
    metadata: {
      "loc.lines.from": number;
      "loc.lines.to": number;
      "loc.pageNumber": number;
    };
  }[];
}

dotenv.config();

const googleSearchAPI = new GoogleSearchAPI(
  process.env.GOOGLE_API_KEY!,
  process.env.GOOGLE_SEARCH_ENGINE_ID
);
const pdfProcessor = new PDFProcessor();

async function processQuery(query: string): Promise<any[]> {
  const validPDFs = await searchAndValidatePDFs(query);
  if (!validPDFs) {
    console.log("No valid PDFs found");
    return [];
  }

  const pdfs = validPDFs.map((pdf) => ({
    url: pdf.link,
    title: pdf.title,
    snippet: pdf.snippet,
    thumbnail: pdf.pagemap?.cse_thumbnail?.[0]?.src ?? "",
  }));

  const semanticQueryKey = createSemanticCacheKey(query);
  const queryCache = await redis.get(`query:${semanticQueryKey}`);
  // assuming that the pdfs are not changed (we can adjust ttl if needed), we can return the cached query
  if (queryCache) {
    console.log(`cache hit ${semanticQueryKey}`);
    return JSON.parse(queryCache);
  }

  console.log(`Processing ${pdfs.length} PDFs`);

  // TODO: save query and pdfs to db

  const results = await Promise.all(
    pdfs.map((pdf) => pdfProcessor.processPdf(pdf, query))
  );

  const serializedResults = results.map((result) => serializeResults(result));

  // store results in redis and cleanup memory
  Promise.all([
    console.log(`caching query ${semanticQueryKey}`),
    redis.set(
      `query:${semanticQueryKey}`,
      JSON.stringify(serializedResults),
      "EX",
      cacheConfig.query.ttl
    ),
    pdfProcessor.cleanupMemory(),
  ]);

  return serializedResults;
}

function serializeResults(results: DocumentArray): Result {
  const relevantPages: Result["relevantPages"] = results
    .map((result) => {
      return {
        pageNumber: result.metadata["loc.pageNumber"] as number,
        pageContent: result.pageContent,
        metadata: result.metadata,
        score: result.score,
      };
    })
    .sort((a, b) => a.pageNumber - b.pageNumber);

  return {
    pdfUrl: results[0].metadata.pdfUrl,
    title: results[0].title,
    snippet: results[0].snippet,
    thumbnail: results[0].thumbnail,
    relevantPages,
  };
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
  const results = await processQuery(query);
  const end = Date.now();
  console.log(results);
  console.log(`Time taken: ${end - start}ms`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error);
});
