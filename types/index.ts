export type SearchResultType = {
  id: number;
  title: string;
  description: string;
  image: string;
  totalPages: number;
  relevantPages?: {
    startPage: number;
    endPage: number;
  };
};

// Google Search API response interfaces
export interface GoogleSearchResult {
  kind: string;
  title: string;
  htmlTitle: string;
  link: string;
  displayLink: string;
  snippet: string;
  htmlSnippet: string;
  formattedUrl: string;
  htmlFormattedUrl: string;
  pagemap?: {
    cse_thumbnail?: Array<{
      src: string;
      width: string;
      height: string;
    }>;
    metatags?: Array<Record<string, string>>;
  };
}

export interface GoogleSearchResponse {
  kind: string;
  url: {
    type: string;
    template: string;
  };
  queries: {
    request: Array<{
      title: string;
      totalResults: string;
      searchTerms: string;
      count: number;
      startIndex: number;
      inputEncoding: string;
      outputEncoding: string;
      safe: string;
      cx: string;
    }>;
    nextPage?: Array<{
      title: string;
      totalResults: string;
      searchTerms: string;
      count: number;
      startIndex: number;
      inputEncoding: string;
      outputEncoding: string;
      safe: string;
      cx: string;
    }>;
  };
  context: {
    title: string;
  };
  searchInformation: {
    searchTime: number;
    formattedSearchTime: string;
    totalResults: string;
    formattedTotalResults: string;
  };
  items: GoogleSearchResult[];
}

// PDF Processing interfaces
export interface PageContent {
  pageNumber: number;
  text: string;
  vector?: number[] | null;
}

export interface RelevantPageContent {
  pageNumber: number;
  text: string;
  maxSimilarity: number;
}

// LLM Service interfaces
export interface RelevantContent {
  relevantContent: string;
  confidence: number;
  reasoning: string;
}

export interface ProcessedResult {
  title: string;
  url: string;
  relevantPages: number[];
  relevantContent: RelevantContent;
  confidence?: number;
  relevanceScore?: number;
  reasoning?: string;
}

export interface RankingResult {
  originalIndex: number;
  relevanceScore: number;
  reasoning: string;
}

// Socket.io event interfaces
export interface SearchUpdateBase {
  searchId: string;
  status: string;
  message: string;
}

export interface SearchingUpdate extends SearchUpdateBase {
  status: "searching";
}

export interface FoundDocumentsUpdate extends SearchUpdateBase {
  status: "found_documents";
  results: Array<{
    title: string;
    url: string;
  }>;
}

export interface ProcessingDocumentUpdate extends SearchUpdateBase {
  status: "processing_document";
  currentDocument: string;
}

export interface DocumentProcessedUpdate extends SearchUpdateBase {
  status: "document_processed";
  newResult: ProcessedResult;
}

export interface DocumentErrorUpdate extends SearchUpdateBase {
  status: "document_error";
  error: string;
}

export interface CompletedUpdate extends SearchUpdateBase {
  status: "completed";
  finalResults: ProcessedResult[];
}

export interface ErrorUpdate extends SearchUpdateBase {
  status: "error";
  error: string;
}

export interface CachedResultsUpdate extends SearchUpdateBase {
  status: "cached_results";
  results: ProcessedResult[];
}

export type SearchUpdate =
  | SearchingUpdate
  | FoundDocumentsUpdate
  | ProcessingDocumentUpdate
  | DocumentProcessedUpdate
  | DocumentErrorUpdate
  | CompletedUpdate
  | ErrorUpdate
  | CachedResultsUpdate;

// Server endpoints
export interface SearchRequest {
  query: string;
  sessionId: string;
}

export interface SearchResponse {
  searchId: string;
}

// Cache service
export interface CacheService {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttl?: number): boolean;
  del(key: string): boolean;
  flush(): void;
}
