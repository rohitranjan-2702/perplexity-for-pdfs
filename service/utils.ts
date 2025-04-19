import * as compromiseModule from "compromise";
import * as crypto from "crypto";
import { Redis } from "ioredis";

// Use the default export from the compromise module
const nlp = compromiseModule.default;

/**
 * Context information that affects embedding results
 */
interface ContextOptions {
  /** Optional user identifier for personalized embeddings */
  userId?: string;
  /** Language of the query */
  language?: string;
  /** Domain or topic area of the query */
  domain?: string;
  /** Any filters applied to the document collection */
  filters?: Record<string, any> | string;
  /** Time window in hours for temporal context */
  timeWindow?: number;
}

/**
 * Configuration options for semantic key creation
 */
interface SemanticKeyOptions {
  /** Contextual information that affects embedding results */
  context?: ContextOptions;
  /** Whether to use NLP for semantic keying */
  useSemanticKey?: boolean;
  /** Version of semantic algorithm (for cache invalidation) */
  semanticVersion?: number;
}

/**
 * Interface for cache implementations
 */
interface CacheInterface<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  has?(key: string): Promise<boolean>;
}

/**
 * Result from the embedding retrieval function
 */
interface EmbeddingResult<T> {
  /** The actual embedding data */
  embedding: number[];
  /** Where the embedding came from (cache or generated) */
  source: "cache" | "generated";
  /** The cache key used */
  cacheKey: string;
  /** Time taken to generate the embedding (only present for generated embeddings) */
  generationTime?: number;
}

/**
 * Semantic elements extracted from a query
 */
interface SemanticObject {
  entities: string[];
  nouns: string[];
  verbs: string[];
  questionType: string;
  isNegative: boolean;
  version: number;
}

/**
 * Configuration options for Redis cache
 */
interface RedisCacheOptions {
  /** Default TTL for cache entries in seconds */
  defaultTTL?: number;
  /** Key prefix to use for all Redis keys */
  keyPrefix?: string;
  /** Whether to compress values before storing (useful for large embeddings) */
  compress?: boolean;
}

/**
 * Creates a production-ready cache key for RAG queries using Compromise.js for semantic analysis
 *
 * @param query - The user query text to create a cache key for
 * @param options - Configuration options for key creation
 * @returns A normalized cache key that groups semantically similar queries
 */
export function createSemanticCacheKey(
  query: string,
  options: SemanticKeyOptions = {}
): string {
  // Default options
  const { context = {}, useSemanticKey = true, semanticVersion = 1 } = options;

  // Basic query normalization
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");

  // Create base query key depending on whether semantic analysis is enabled
  let querySignature: string;

  if (useSemanticKey) {
    // Parse the query with compromise
    const doc = nlp(normalizedQuery);

    // Extract semantic elements that define the query's meaning
    const entities = doc.topics().out("array") as string[];
    const nouns = doc.nouns().out("array") as string[];
    const verbs = doc.verbs().out("array") as string[];
    const questions = doc.questions().out("array").length > 0;
    const isNegative = doc.has("#Negative");

    // Extract the question type (who, what, where, when, why, how)
    let questionType = "";
    if (questions) {
      if (doc.has("who")) questionType = "who";
      else if (doc.has("what")) questionType = "what";
      else if (doc.has("where")) questionType = "where";
      else if (doc.has("when")) questionType = "when";
      else if (doc.has("why")) questionType = "why";
      else if (doc.has("how")) questionType = "how";
    }

    // Build semantic object
    const semanticObject: SemanticObject = {
      entities: entities.slice(0, 3), // Limit to top 3 entities
      nouns: nouns.slice(0, 5), // Limit to top 5 nouns
      verbs: verbs.slice(0, 3), // Limit to top 3 verb roots
      questionType,
      isNegative,
      version: semanticVersion, // Include version for future cache invalidation
    };

    // Sort arrays for consistent ordering
    semanticObject.entities.sort();
    semanticObject.nouns.sort();
    semanticObject.verbs.sort();

    // Create a hash of the semantic object
    const semanticString = JSON.stringify(semanticObject);
    querySignature = crypto
      .createHash("sha256")
      .update(semanticString)
      .digest("hex")
      .substring(0, 16); // Use first 16 chars for readability
  } else {
    // Simple hash of normalized query when not using semantic analysis
    querySignature = crypto
      .createHash("sha256")
      .update(normalizedQuery)
      .digest("hex")
      .substring(0, 16);
  }

  // Process context information if provided
  let contextSignature = "";
  if (Object.keys(context).length > 0) {
    // Extract and normalize context values
    const {
      userId = "",
      language = "en",
      domain = "general",
      filters = {},
      timeWindow = 0,
    } = context;

    // Create context object
    const contextObj = {
      userId,
      language,
      domain,
      filters:
        typeof filters === "object"
          ? JSON.stringify(Object.entries(filters).sort())
          : filters,
      timeWindow: Math.floor(timeWindow / 24), // Convert to days for less granularity
    };

    // Hash the context object
    const contextString = JSON.stringify(contextObj);
    contextSignature = crypto
      .createHash("md5")
      .update(contextString)
      .digest("hex")
      .substring(0, 8); // Use first 8 chars for context hash
  }

  // Build final key with appropriate prefix
  const keyPrefix = useSemanticKey ? "sem" : "txt";
  const key = contextSignature
    ? `${keyPrefix}_${querySignature}_ctx${contextSignature}`
    : `${keyPrefix}_${querySignature}`;

  return key;
}

/**
 * Redis implementation of CacheInterface for storing embeddings
 */
export class RedisEmbeddingCache<T> implements CacheInterface<T> {
  private client: Redis;
  private options: RedisCacheOptions;

  /**
   * Create a new Redis embedding cache
   *
   * @param redisClient - Existing Redis client or connection options
   * @param options - Cache configuration options
   */
  constructor(redisClient: Redis, options: RedisCacheOptions = {}) {
    this.client = redisClient;
    this.options = {
      defaultTTL: 86400, // 24 hours default TTL
      keyPrefix: "emb:",
      compress: false,
      ...options,
    };
  }

  /**
   * Get full Redis key with prefix
   * @param key - Base cache key
   * @returns Prefixed Redis key
   */
  private getRedisKey(key: string): string {
    return `${this.options.keyPrefix}${key}`;
  }

  /**
   * Retrieve an embedding from Redis cache
   *
   * @param key - Cache key to retrieve
   * @returns The cached embedding or null if not found
   */
  async get(key: string): Promise<T | null> {
    const redisKey = this.getRedisKey(key);
    const data = await this.client.get(redisKey);

    if (!data) {
      return null;
    }

    try {
      // Parse the stored JSON data
      const parsed = JSON.parse(data);

      // Handle compressed data if needed
      if (this.options.compress && parsed.compressed) {
        // In a real implementation, decompress the data here
        // For example with zlib:
        // const decompressed = zlib.inflateSync(Buffer.from(parsed.data, 'base64')).toString();
        // return JSON.parse(decompressed);

        // For now we'll just return the data
        return parsed.data as T;
      }

      return parsed.data as T;
    } catch (error) {
      console.error("Error parsing cached embedding:", error);
      return null;
    }
  }

  /**
   * Store an embedding in Redis cache
   *
   * @param key - Cache key to store under
   * @param value - Embedding data to store
   * @param ttl - Time-to-live in seconds (optional, uses defaultTTL if not specified)
   */
  async set(key: string, value: T, ttl?: number): Promise<void> {
    const redisKey = this.getRedisKey(key);
    const expiryTime = ttl || this.options.defaultTTL;

    try {
      let dataToStore: any = { data: value };

      // Handle compression if enabled
      if (this.options.compress) {
        // In a real implementation, compress the data here
        // For example with zlib:
        // const compressed = zlib.deflateSync(JSON.stringify(value)).toString('base64');
        // dataToStore = { data: compressed, compressed: true };

        // For now we'll just mark it as compressed
        dataToStore.compressed = true;
      }

      // Store with expiration
      await this.client.set(redisKey, JSON.stringify(dataToStore));
      if (expiryTime) {
        await this.client.expire(redisKey, expiryTime);
      }
    } catch (error) {
      console.error("Error storing embedding in cache:", error);
      throw error;
    }
  }

  /**
   * Check if a key exists in the cache
   *
   * @param key - Cache key to check
   * @returns True if the key exists
   */
  async has(key: string): Promise<boolean> {
    const redisKey = this.getRedisKey(key);
    const exists = await this.client.exists(redisKey);
    return exists === 1;
  }

  /**
   * Delete a key from the cache
   *
   * @param key - Cache key to delete
   * @returns True if the key was deleted
   */
  async delete(key: string): Promise<boolean> {
    const redisKey = this.getRedisKey(key);
    const deleted = await this.client.del(redisKey);
    return deleted === 1;
  }

  /**
   * Set TTL for an existing key
   *
   * @param key - Cache key to update
   * @param ttl - New TTL in seconds
   * @returns True if the TTL was updated
   */
  async updateTTL(key: string, ttl: number): Promise<boolean> {
    const redisKey = this.getRedisKey(key);
    const updated = await this.client.expire(redisKey, ttl);
    return updated === 1;
  }
}

/**
 * Retrieves or generates an embedding using semantic caching
 *
 * @param query - The user query
 * @param context - User/session context information
 * @param cache - Cache implementation (must have get, set methods)
 * @param embeddingFunction - Function to generate embedding if cache miss
 * @param options - Additional options
 * @returns The embedding result with metadata
 */
export async function getEmbeddingWithCache<T>(
  query: string,
  context: ContextOptions = {},
  cache: CacheInterface<T>,
  embeddingFunction: (query: string, context: ContextOptions) => Promise<T>,
  options: SemanticKeyOptions = {}
): Promise<EmbeddingResult<T>> {
  if (!query || typeof query !== "string") {
    throw new Error("Query must be a non-empty string");
  }

  if (
    !cache ||
    typeof cache.get !== "function" ||
    typeof cache.set !== "function"
  ) {
    throw new Error("Cache must implement get and set methods");
  }

  if (!embeddingFunction || typeof embeddingFunction !== "function") {
    throw new Error("Embedding function is required");
  }

  // Generate cache key
  const cacheKey = createSemanticCacheKey(query, {
    context,
    ...options,
  });

  // Check cache first
  const cachedResult = await cache.get(cacheKey);
  if (cachedResult !== null) {
    console.log("Cache hit", cacheKey);
    return {
      embedding: cachedResult as number[],
      source: "cache",
      cacheKey,
    };
  }

  // Generate new embedding on cache miss
  const startTime = Date.now();
  const embedding = await embeddingFunction(query, context);
  const duration = Date.now() - startTime;

  // Cache the result (with optional TTL handled by cache implementation)
  await cache.set(cacheKey, embedding, 60 * 60 * 1); // 1 hour

  return {
    embedding: embedding as number[],
    source: "generated",
    cacheKey,
    generationTime: duration,
  };
}

/**
 * Example usage with Redis
 */
export async function createRedisEmbeddingCache() {
  // Example Redis client setup
  const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  });

  // Create cache adapter
  const embeddingCache = new RedisEmbeddingCache(redis, {
    keyPrefix: "rag:emb:",
    defaultTTL: 60 * 60 * 24 * 7, // 1 week
    compress: true, // Enable for large embeddings
  });

  return embeddingCache;
}

/**
 * Example usage
 */
export async function exampleUsage() {
  // Create Redis cache
  const cache = await createRedisEmbeddingCache();

  // Mock embedding function - replace with your actual embedding generation logic
  const generateEmbedding = async (
    query: string,
    context: ContextOptions
  ): Promise<number[]> => {
    // Simulate API call to embedding service
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Return mock embedding vector
    return Array.from({ length: 384 }, () => Math.random() - 0.5);
  };

  // Example context
  const userContext = {
    userId: "user-123",
    language: "en",
    domain: "finance",
  };

  // Get embedding with caching
  const result = await getEmbeddingWithCache(
    "mango fruit",
    userContext,
    cache,
    generateEmbedding,
    { useSemanticKey: true }
  );

  console.log(`Embedding from ${result.source}`);
  if (result.generationTime) {
    console.log(`Generation took ${result.generationTime}ms`);
  }

  console.log(result);
  return result;
}
/**
 * Configuration options for Pinecone storage
 */
interface PineconeStorageOptions {
  /** Namespace to use for vector storage */
  namespace?: string;
  /** Metadata to store alongside the embedding */
  metadata?: Record<string, any>;
  /** ID to use for the vector (if not provided, one will be generated) */
  id?: string;
}

/**
 * Stores an embedding in Pinecone vector database
 *
 * @param embedding - The embedding vector to store
 * @param pineconeIndex - The Pinecone index instance
 * @param options - Configuration options for storage
 * @returns The ID of the stored vector
 */
export async function storeEmbeddingToPinecone(
  embedding: number[],
  pineconeIndex: any, // Using 'any' for flexibility with different Pinecone client versions
  options: PineconeStorageOptions = {}
): Promise<string> {
  const { namespace = "", metadata = {}, id = crypto.randomUUID() } = options;

  try {
    // Prepare the upsert object
    const upsertRequest = {
      vectors: [
        {
          id,
          values: embedding,
          metadata,
        },
      ],
      namespace,
    };

    // Upsert the vector to Pinecone
    await pineconeIndex.upsert(upsertRequest);

    return id;
  } catch (error) {
    console.error("Error storing embedding to Pinecone:", error);
    throw new Error(
      `Failed to store embedding in Pinecone: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
