"use server";

import { cacheConfig } from "@/service/constants";
import { GoogleSearchAPI } from "@/service/google-search";
import { PDFProcessor } from "@/service/pdf-processor";
import { redis } from "@/service/redis-client";
import { createSemanticCacheKey } from "@/service/utils";
import dotenv from "dotenv";

dotenv.config();

const googleSearchAPI = new GoogleSearchAPI(
  process.env.GOOGLE_API_KEY!,
  process.env.GOOGLE_SEARCH_ENGINE_ID
);

export interface PDFSearchResult {
  pageContent: string;
  metadata: Record<string, any>;
  score: number;
  title?: string;
  url?: string;
  snippet?: string;
  thumbnail?: string;
}

export async function processQuery(query: string): Promise<PDFSearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  try {
    const validPDFs = await searchAndValidatePDFs(query);
    if (!validPDFs || validPDFs.length === 0) {
      console.log("No valid PDFs found");
      return [];
    }

    const semanticQueryKey = createSemanticCacheKey(query);

    const pdfs = validPDFs.map((pdf) => ({
      url: pdf.link,
      title: pdf.title,
      snippet: pdf.snippet,
      thumbnail: pdf.pagemap?.cse_thumbnail?.[0]?.src,
    }));

    console.log(`Processing ${pdfs.length} PDFs`);

    const pdfProcessor = new PDFProcessor();
    try {
      const results = await Promise.all(
        pdfs.map((pdf) =>
          pdfProcessor.processPdf(pdf.url, query, semanticQueryKey)
        )
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

      // Convert Document objects to plain serializable objects
      const serializableResults = results.flat().map(([doc, score]) => {
        // Add null checks for metadata
        if (!doc || !doc.metadata) {
          console.error(
            "[PDF-PROCESSOR] Document or metadata is undefined",
            doc
          );
          return {
            pageContent: doc?.pageContent || "",
            metadata: {},
            score: score || 0,
            title: "Unknown Document",
            url: "",
            snippet: "",
          };
        }

        const pdfUrl = doc.metadata.pdfUrl || doc.metadata.source || "";
        const pdf = pdfs.find((p) => p.url === pdfUrl);

        return {
          pageContent: doc.pageContent,
          metadata: { ...doc.metadata }, // Create a plain copy of metadata
          score: score,
          thumbnail: pdf?.thumbnail,
          snippet: pdf?.snippet,
          title: pdf?.title,
          url: pdf?.url || pdfUrl,
        };
      });

      return serializableResults;
    } catch (processingError) {
      console.error("Error processing PDFs:", processingError);
      return [];
    }
  } catch (error) {
    console.error("Error in processQuery:", error);
    return [];
  }
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
    return [];
  }
}
