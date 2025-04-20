import axios from "axios";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf";
import { createWorker, Worker } from "tesseract.js";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import * as stream from "stream";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";
import dotenv from "dotenv";
import { Document } from "@langchain/core/documents";
import { createSemanticCacheKey } from "./utils";
import { redis } from "./redis-client";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import { cacheConfig } from "./constants";

dotenv.config();

const pipeline = promisify(stream.pipeline);
const embeddings = new GoogleGenerativeAIEmbeddings({
  model: process.env.EMBEDDING_MODEL || "text-embedding-004", // 768 dimensions
  taskType: TaskType.RETRIEVAL_DOCUMENT,
  title: "Document title",
  apiKey: process.env.GEMINI_API_KEY,
});

const memoryVectorStore = new MemoryVectorStore(embeddings);

interface PageData {
  pageNumber: number;
  text: string;
  vector: number[] | null;
}

export interface DocumentArray
  extends Array<{
    pageContent: string;
    metadata: {
      "loc.lines.from": number;
      "loc.lines.to": number;
      "loc.pageNumber": number;
      "pdf.totalPages": number;
      pdfUrl: string;
      source: string;
    };
    score: number;
    thumbnail: string;
    title: string;
    snippet: string;
  }> {}

interface PDF {
  url: string;
  title: string;
  snippet: string;
  thumbnail: string;
}

// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || "",
});

// Get or create index
const pineconeIndex = pinecone.Index(
  process.env.PINECONE_INDEX || "pdf-embeddings"
);

export class PDFProcessor {
  private ocrWorker: Worker | null = null;

  constructor() {
    // this.initOCRWorker();
  }

  private async initOCRWorker(): Promise<void> {
    this.ocrWorker = await createWorker("eng");
  }

  private async serializeDocuments(
    documents: [Document, number][],
    pdf: PDF
  ): Promise<DocumentArray> {
    return documents.map(([doc, score]) => ({
      pageContent: doc.pageContent,
      metadata: {
        "loc.lines.from": doc.metadata.loc.lines.from,
        "loc.lines.to": doc.metadata.loc.lines.to,
        "loc.pageNumber": doc.metadata.loc.pageNumber,
        "pdf.totalPages": doc.metadata.pdf.totalPages,
        pdfUrl: doc.metadata.pdfUrl,
        source: doc.metadata.source,
      },
      score: score,
      thumbnail: pdf.thumbnail,
      title: pdf.title,
      snippet: pdf.snippet,
    }));
  }

  public async processPdf(pdf: PDF, query: string): Promise<DocumentArray> {
    // check if pdf is there in pinecone -> this will help us not process the same pdf again
    const pdfEmbedding = await this.retrievePdfEmbeddings(pdf.url, query);
    if (pdfEmbedding.length > 0) {
      console.log(`[PDF-PROCESSOR] docs found in pinecone ${pdf.url}`);

      return this.serializeDocuments(pdfEmbedding, pdf);
    }

    // load pdf from url
    const docs = await this.loadPdfFromUrl(pdf.url);
    const relevantPages = await this.findRelevantPages(docs, query, pdf.url);

    // Store pdf embeddings in pinecone asynchronously
    this.storePdfEmbeddings(pdf.url, docs).catch((err) =>
      console.error(
        `[PDF-PROCESSOR] Failed to store embeddings for ${pdf.url}:`,
        err
      )
    );

    return this.serializeDocuments(relevantPages, pdf);
  }

  public async loadPdfFromUrl(pdfUrl: string): Promise<Document[]> {
    try {
      const cacheKey = `pdf:${pdfUrl}`;
      const cachedDocs = await redis.get(cacheKey);

      if (cachedDocs) {
        console.log(`[PDF-PROCESSOR] cache hit ${cacheKey}`);
        return JSON.parse(cachedDocs);
      }

      console.log(`[PDF-PROCESSOR] processing pdf ${pdfUrl}`);
      const response = await fetch(pdfUrl);
      const blob = await response.blob();
      const loader = new WebPDFLoader(blob, {
        splitPages: true,
      });
      const docs = await loader.load();
      if (docs.length === 0) {
        throw new Error(`Failed to load PDF from URL: ${pdfUrl}`);
      }

      if (docs.length < 50) {
        // Cache the processed documents
        // await redis.set(
        //   cacheKey,
        //   JSON.stringify(docs),
        //   "EX",
        //   cacheConfig.pdf.ttl
        // );
      }

      return docs;
    } catch (error: any) {
      console.error(
        `[PDF-PROCESSOR] Error loading PDF from URL: ${error.message}`
      );
      throw new Error(`Failed to load PDF from URL: ${error.message}`);
    }
  }

  // TODO: ocr worker
  public async downloadAndExtract(pdfUrl: string): Promise<PageData[]> {
    const cacheKey = `pdf:${pdfUrl}`;
    const cachedContent = await redis.get(cacheKey);

    if (cachedContent) {
      return JSON.parse(cachedContent);
    }

    try {
      // Create temp directory if it doesn't exist
      const tempDir = path.join(__dirname, "../temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Download PDF
      const tempFilePath = path.join(tempDir, `${Date.now()}.pdf`);
      const response = await axios({
        method: "get",
        url: pdfUrl,
        responseType: "stream",
      });

      await pipeline(response.data, fs.createWriteStream(tempFilePath));

      // Use PDFLoader to extract text
      const loader = new PDFLoader(tempFilePath, {
        splitPages: true,
      });
      const docs = await loader.load();

      // Convert to PageData format
      const pages: PageData[] = docs.map((doc, index) => {
        // Get page number from metadata or use index+1
        const pageNumber = doc.metadata.loc?.pageNumber || index + 1;

        return {
          pageNumber:
            typeof pageNumber === "string" ? parseInt(pageNumber) : pageNumber,
          text: doc.pageContent,
          vector: null,
        };
      });

      // Clean up
      fs.unlinkSync(tempFilePath);

      // Cache the extracted content
      await redis.set(
        cacheKey,
        JSON.stringify(pages),
        "EX",
        cacheConfig.pdf.ttl
      );

      return pages;
    } catch (error: any) {
      console.error("Error downloading or processing PDF:", error);
      throw new Error(`Failed to process PDF: ${error.message}`);
    }
  }

  public async findRelevantPages(
    documents: Document[],
    query: string,
    pdfUrl: string
  ): Promise<[Document<Record<string, any>>, number][]> {
    try {
      // process large pdfs in chunks
      if (documents.length > 50) {
        console.log(
          `[PDF-PROCESSOR] processing large pdf ${pdfUrl} with ${documents.length} pages`
        );

        const chunks = [];
        for (let i = 0; i < documents.length; i += 50) {
          chunks.push(documents.slice(i, i + 50));
        }

        console.log(`[PDF-PROCESSOR] created ${chunks.length} chunks`);

        const results: [Document<Record<string, any>>, number][] = [];
        await Promise.all(
          chunks.map(async (chunk) => {
            // recursively process chunks
            const result = await this.findRelevantPages(chunk, query, pdfUrl);
            results.push(...result);
          })
        );
        return results;
      }

      // store pdf embeddings in memory
      await this.storePdfEmbeddings(pdfUrl, documents, true);

      // retrieve pdf embeddings from memory
      const pdfEmbeddings = await this.retrievePdfEmbeddings(
        pdfUrl,
        query,
        true
      );

      return pdfEmbeddings;
    } catch (error: any) {
      console.error("Error finding relevant pages:", error);
      throw new Error(`Failed to find relevant pages: ${error.message}`);
    }
  }

  public async cleanup(): Promise<void> {
    if (this.ocrWorker) {
      await this.ocrWorker.terminate();
      this.ocrWorker = null;
    }
  }

  // node_modules/.pnpm/@langchain+core@0.3.44_openai@4.93.0_ws@8.18.1_zod@3.24.2_/node_modules/@langchain/core/dist/vectorstores.cjs -> not implemented
  public async cleanupMemory(): Promise<void> {
    // await memoryVectorStore.delete({});
    console.log("cleanup");
  }

  /**
   * Stores PDF embeddings in Pinecone for future retrieval
   * @param pdfUrl URL of the PDF
   * @param documents Documents extracted from the PDF
   * @returns true if successful
   */
  public async storePdfEmbeddings(
    pdfUrl: string,
    documents: Document[],
    storeInMemory: boolean = false
  ): Promise<boolean> {
    try {
      console.log(`[PDF-PROCESSOR] Storing embeddings for PDF: ${pdfUrl}`);

      // Use the text splitter to chunk documents
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const chunks = await splitter.splitDocuments(documents);

      // Add the PDF URL to all chunk metadata
      const chunksWithMetadata = chunks.map((chunk) => {
        return {
          ...chunk,
          metadata: {
            ...chunk.metadata,
            pdfUrl, // Store the URL to allow retrieval by URL
            source: pdfUrl,
          },
        };
      });

      if (storeInMemory) {
        await memoryVectorStore.addDocuments(chunksWithMetadata);
        console.log(
          `[PDF-PROCESSOR] Successfully stored ${chunks.length} chunks for PDF: ${pdfUrl} in memory`
        );
        return true;
      } else {
        await PineconeStore.fromDocuments(chunksWithMetadata, embeddings, {
          pineconeIndex,
          namespace: "pdf-documents",
        });
        console.log(
          `[PDF-PROCESSOR] Successfully stored ${chunks.length} chunks for PDF: ${pdfUrl} in pinecone`
        );
        return true;
      }
    } catch (error: any) {
      console.error(
        `[PDF-PROCESSOR] Error storing PDF embeddings in Pinecone:`,
        error
      );
      return false;
    }
  }

  /**
   * Retrieves PDF documents from Pinecone by URL
   * @param pdfUrl URL of the PDF to retrieve
   * @param query Optional query for similarity search
   * @returns Documents from the specified PDF, optionally filtered by relevance to query
   */
  public async retrievePdfEmbeddings(
    pdfUrl: string,
    query: string,
    storeInMemory: boolean = false
  ): Promise<[Document, number][]> {
    try {
      // Setup metadata filtering for the URL
      const filter = {
        pdfUrl: { $eq: pdfUrl },
      };

      if (storeInMemory) {
        console.log(
          `[PDF-PROCESSOR] Retrieving PDF documents from memory for URL: ${pdfUrl}`
        );
        return await memoryVectorStore.similaritySearchWithScore(
          query,
          5,
          (doc) => doc.metadata.pdfUrl === pdfUrl
        );
      }

      console.log(
        `[PDF-PROCESSOR] Retrieving PDF documents from Pinecone for URL: ${pdfUrl}`
      );

      // Create vector store
      const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
        pineconeIndex,
        namespace: "pdf-documents",
      });

      if (query) {
        // If query provided, perform similarity search with metadata filter
        const results = await vectorStore.similaritySearchWithScore(
          query,
          10,
          filter
        );
        console.log(
          `[PDF-PROCESSOR] Found ${results.length} relevant chunks for query "${query}" in PDF: ${pdfUrl}`
        );
        return results;
      } else {
        // If no query, retrieve all documents for the PDF URL using metadata filter
        // Note: This might be implementation-specific depending on your Pinecone setup
        const results = await vectorStore.similaritySearchWithScore(
          "",
          100,
          filter
        );
        console.log(
          `[PDF-PROCESSOR] Retrieved ${results.length} chunks for PDF: ${pdfUrl}`
        );
        return results;
      }
    } catch (error: any) {
      console.error(
        `[PDF-PROCESSOR] Error retrieving PDF from Pinecone:`,
        error
      );
      return [];
    }
  }

  /**
   * Process a PDF and store its embeddings in Pinecone
   * @param pdfUrl URL of the PDF to process and store
   * @returns true if successful
   */
  public async processPdfForPinecone(pdfUrl: string): Promise<boolean> {
    try {
      // Load the PDF
      const docs = await this.loadPdfFromUrl(pdfUrl);

      // Store in Pinecone
      return await this.storePdfEmbeddings(pdfUrl, docs, false);
    } catch (error: any) {
      console.error(
        `[PDF-PROCESSOR] Error processing PDF for Pinecone:`,
        error
      );
      return false;
    }
  }
}
