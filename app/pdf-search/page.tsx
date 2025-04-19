"use client";

import { useState } from "react";
import { SearchBar } from "@/components/SearchBar";
import { PDFSearchResults } from "@/components/PDFSearchResults";
import { processQuery, PDFSearchResult } from "@/actions/search";

export default function PDFSearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<
    {
      title: string;
      url: string;
      snippet: string;
      totalPages?: number;
      relevantPages?: { startPage: number; endPage: number };
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!searchQuery.trim()) return;

    try {
      setIsSearching(true);
      setError(null);

      // Add to search history if not already present
      if (!searchHistory.includes(searchQuery)) {
        setSearchHistory((prev) => [searchQuery, ...prev.slice(0, 4)]);
      }

      try {
        // Call the processQuery function (server action)
        const searchResults = await processQuery(searchQuery);
        const formattedResults = searchResults.map((result, index) => {
          // Extract metadata from the document using the correct structure
          const metadata = result.metadata;
          const totalPagesCount = metadata["pdf.totalPages"] || 0;
          const currentPage = metadata["loc.pageNumber"] || 1;
          const pdfUrl = metadata.pdfUrl || metadata.source || "";

          // Create a title from the URL if no title is available
          const fileName = pdfUrl.split("/").pop() || "Document";
          const title = fileName.replace(/\.pdf$/i, "").replace(/-|_/g, " ");

          // For demo purposes, create relevantPages for some results
          let relevantPages;
          if (index % 3 !== 0) {
            // Skip every third item to show "checking relevancy" state
            // Use the actual page info if available
            const startPage = currentPage;
            // Create a reasonable range based on current page, making sure we don't exceed total pages
            const endPage = Math.min(
              totalPagesCount,
              startPage + Math.floor(Math.random() * 5)
            );
            relevantPages = { startPage, endPage };
          }

          return {
            title: title,
            url: pdfUrl,
            snippet: result.pageContent,
            totalPages: totalPagesCount,
            relevantPages: relevantPages,
          };
        });

        setResults(formattedResults);
      } catch (err) {
        console.error("Search error:", err);
        setError(
          "An error occurred while processing the search. Please try again."
        );
      } finally {
        setIsSearching(false);
      }
    } catch (err) {
      setError("An unexpected error occurred");
      setIsSearching(false);
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col items-center w-full sm:w-3/4 max-w-full mx-auto pt-6">
      <div className="w-full px-4 relative">
        <h1 className="text-2xl font-semibold mb-4">PDF Search</h1>

        <form onSubmit={handleSearch} className="w-full">
          <div className="flex flex-col gap-2">
            <div className="flex items-stretch">
              <div className="flex-1">
                <SearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search for PDF content..."
                  history={searchHistory}
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="ml-4 px-6 h-12 bg-blue-600 text-white rounded-lg font-medium disabled:bg-blue-300 disabled:cursor-not-allowed"
              >
                {isSearching ? "Searching..." : "Search"}
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
            {error}
          </div>
        )}

        {isSearching ? (
          <div className="mt-8 flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="mt-4 text-gray-600">Searching for relevant PDFs...</p>
          </div>
        ) : (
          <>
            <PDFSearchResults results={results} />

            {searchHistory.length > 0 && !results.length && (
              <div className="mt-8">
                <h2 className="text-xl font-medium mb-4">Recent Searches</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {searchHistory.map((query, index) => (
                    <div
                      key={index}
                      className="p-3 bg-gray-50 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-100"
                      onClick={() => {
                        setSearchQuery(query);
                        handleSearch(new Event("submit") as any);
                      }}
                    >
                      {query}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
