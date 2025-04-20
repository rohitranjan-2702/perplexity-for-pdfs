"use server";

import { cacheConfig } from "@/service/constants";
import { GoogleSearchAPI } from "@/service/google-search";
import { PDFProcessor } from "@/service/pdf-processor";
import { redis } from "@/service/redis-client";
import { createSemanticCacheKey } from "@/service/utils";
import dotenv from "dotenv";
import { DocumentArray } from "@/service/pdf-processor";

dotenv.config();

const googleSearchAPI = new GoogleSearchAPI(
  process.env.GOOGLE_API_KEY!,
  process.env.GOOGLE_SEARCH_ENGINE_ID
);
const pdfProcessor = new PDFProcessor();

export interface PDFSearchResult {
  pdfUrl: string;
  title: string;
  snippet: string;
  thumbnail: string;
  relevantPages: {
    pageNumber: number;
    pageContent: string;
    score: number;
    totalPages: number;
    metadata: {
      "loc.lines.from": number;
      "loc.lines.to": number;
      "loc.pageNumber": number;
    };
  }[];
}

export async function processQuery(query: string): Promise<PDFSearchResult[]> {
  // Add query to recent searches
  await addToRecentSearches(query);

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

/**
 * Retrieves recent search queries from Redis
 * @param limit Maximum number of recent searches to return
 * @returns Array of recent search queries
 */
export async function getRecentSearches(limit: number = 5): Promise<string[]> {
  try {
    const recentSearchesKey = "recent_searches";
    const recentSearches = await redis.lrange(recentSearchesKey, 0, limit - 1);
    return recentSearches;
  } catch (error) {
    console.error("Error retrieving recent searches:", error);
    return [];
  }
}

/**
 * Adds a search query to the recent searches list in Redis
 * @param query The search query to add
 */
async function addToRecentSearches(query: string): Promise<void> {
  try {
    const recentSearchesKey = "recent_searches";
    // Remove the query if it already exists to avoid duplicates
    await redis.lrem(recentSearchesKey, 0, query);
    // Add the query to the beginning of the list
    await redis.lpush(recentSearchesKey, query);
    // Trim the list to maintain a maximum size
    await redis.ltrim(recentSearchesKey, 0, 9); // Keep only the 10 most recent searches
  } catch (error) {
    console.error("Error adding to recent searches:", error);
  }
}

function serializeResults(results: DocumentArray): PDFSearchResult {
  const relevantPages: PDFSearchResult["relevantPages"] = results
    .map((result) => {
      return {
        pageNumber: result.metadata["loc.pageNumber"] as number,
        pageContent: result.pageContent,
        totalPages: result.metadata["pdf.totalPages"] as number,
        score: result.score,
        metadata: result.metadata,
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
