// services/google-search.ts
import axios from "axios";
import { GoogleSearchResponse, GoogleSearchResult } from "../types";
import { redis } from "./redis-client";
import { cacheConfig } from "./constants";

const GOOGLE_SEARCH_API_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

const result = {
  kind: "customsearch#result",
  title: "Provisional Funding Algorithm",
  htmlTitle: "Provisional Funding <b>Algorithm</b>",
  link: "https://www.cda-amc.ca/sites/default/files/2024-03/ph0044-colorectal-cancer-draft-rapid-algorithm-report_0.pdf",
  displayLink: "www.cda-amc.ca",
  snippet:
    "Provisional funding algorithms may contain drugs that are under consideration for funding. 39. Algorithms will not be dynamically updated by CADTH following ...",
  htmlSnippet:
    "Provisional funding <b>algorithms</b> may contain drugs that are under consideration for funding. 39. <b>Algorithms</b> will not be dynamically updated by CADTH following&nbsp;...",
  formattedUrl:
    "https://www.cda-amc.ca/.../ph0044-colorectal-cancer-draft-rapid-algorithm-...",
  htmlFormattedUrl:
    "https://www.cda-amc.ca/.../ph0044-colorectal-cancer-draft-rapid-<b>algorithm</b>-...",
  pagemap: { metatags: [Array] },
  mime: "application/pdf",
  fileFormat: "PDF/Adobe Acrobat",
};

export class GoogleSearchAPI {
  private apiKey: string;
  private searchEngineId: string;

  constructor(apiKey: string, searchEngineId?: string) {
    this.apiKey = apiKey;
    this.searchEngineId =
      searchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID || "";

    if (!this.apiKey) {
      throw new Error("Google API key is required");
    }

    if (!this.searchEngineId) {
      throw new Error("Google Search Engine ID is required");
    }
  }

  public async search(
    query: string,
    limit: number = 10
  ): Promise<GoogleSearchResult[]> {
    const cacheKey = `google:${query}:${limit}`;
    const cachedResults = await redis.get(cacheKey);

    if (cachedResults) {
      console.log(`[GOOGLE-SEARCH] Cache hit ${cacheKey}`);
      return JSON.parse(cachedResults);
    }

    try {
      console.log(`[GOOGLE-SEARCH] Searching for ${query}`);
      const response = await axios.get<GoogleSearchResponse>(
        GOOGLE_SEARCH_API_ENDPOINT,
        {
          params: {
            key: this.apiKey,
            cx: this.searchEngineId,
            q: query,
            num: limit,
            fileType: "pdf",
          },
        }
      );

      const results = response.data.items || [];

      // Cache the results
      await redis.set(
        cacheKey,
        JSON.stringify(results),
        "EX",
        cacheConfig.googleSearch.ttl
      );

      return results;
    } catch (error: any) {
      if (error.response && error.response.data) {
        console.error("Google Search API error:", error.response.data);
      } else {
        console.error("Google Search error:", error.message);
      }

      throw new Error(`Google Search failed: ${error.message}`);
    }
  }

  // Method to search specifically for PDFs
  public async searchPDFs(
    query: string,
    limit: number = 10
  ): Promise<GoogleSearchResult[]> {
    // Make sure query includes PDF filter
    let pdfQuery = query;
    if (!pdfQuery.includes("filetype:pdf")) {
      pdfQuery = `${query} filetype:pdf`;
    }

    return this.search(pdfQuery, limit);
  }

  // Method to validate PDF URLs from search results
  public async validatePDFResults(
    results: GoogleSearchResult[]
  ): Promise<GoogleSearchResult[]> {
    const validResults: GoogleSearchResult[] = [];

    for (const result of results) {
      try {
        // Check if the URL is accessible and is a PDF
        const response = await axios.head(result.link, {
          timeout: 5000,
          validateStatus: (status) => status === 200,
        });

        const contentType = response.headers["content-type"];
        if (contentType && contentType.includes("application/pdf")) {
          validResults.push(result);
        }
      } catch (error) {
        console.warn(`Invalid PDF URL: ${result.link}`);
        // Skip this result
      }
    }

    return validResults;
  }
}
