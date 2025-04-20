"use client";

import { useEffect, useState } from "react";
import { SearchBar } from "@/components/SearchBar";
import { PDFSearchResults } from "@/components/PDFSearchResults";
import {
  processQuery,
  PDFSearchResult,
  getRecentSearches,
} from "@/actions/search";

interface PDFResultProps {
  title: string;
  url: string;
  snippet: string;
  totalPages?: number;
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
  thumbnail?: string;
}

export default function PDFSearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<PDFResultProps[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  // Load recent searches from server when component mounts
  useEffect(() => {
    const loadRecentSearches = async () => {
      try {
        const recentSearches = await getRecentSearches(5);
        if (recentSearches.length > 0) {
          setSearchHistory(recentSearches);
        }
      } catch (err) {
        console.error("Error loading recent searches:", err);
      }
    };

    loadRecentSearches();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!searchQuery.trim()) return;

    try {
      setIsSearching(true);
      setError(null);

      try {
        // Call the processQuery function (server action)
        const searchResults = await processQuery(searchQuery);

        // After search completes, refresh the recent searches list
        const recentSearches = await getRecentSearches(5);
        setSearchHistory(recentSearches);

        if (searchResults.length === 0) {
          setResults([]);
          return;
        }

        // Map the results to the format expected by PDFSearchResults
        const formattedResults = searchResults.map(
          (result: PDFSearchResult) => {
            // Find the highest page number for totalPages
            const pageNumbers = result.relevantPages.map(
              (page) => page.pageNumber
            );
            const maxPage = Math.max(...pageNumbers);

            // Use totalPages from the first page's metadata if available
            const totalPages = result.relevantPages[0]?.totalPages || maxPage;

            return {
              title: result.title,
              url: result.pdfUrl,
              snippet: result.snippet,
              thumbnail: result.thumbnail,
              totalPages,
              relevantPages: result.relevantPages,
            };
          }
        );

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
