import { useState } from "react";

interface PDFResultProps {
  title: string;
  url: string;
  snippet: string;
  totalPages?: number;
  relevantPages?: { startPage: number; endPage: number };
  thumbnail?: string;
}

// PagesPill component
const PagesPill = ({ totalPages }: { totalPages: number }) => {
  return (
    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-full">
      {totalPages} pages
    </div>
  );
};

// RelevancyInfo component
const RelevancyInfo = ({
  totalPages,
  relevantPages,
}: {
  totalPages?: number;
  relevantPages?: { startPage: number; endPage: number };
}) => {
  if (!totalPages) return null;

  if (!relevantPages) {
    return (
      <div className="flex items-center gap-1 text-sm text-gray-500 mt-2">
        <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        <span>Checking relevancy</span>
      </div>
    );
  }

  const range = relevantPages.endPage - relevantPages.startPage + 1;
  if (range === totalPages) {
    return (
      <div className="text-sm text-gray-500 mt-2">All pages are relevant</div>
    );
  }

  return (
    <div className="text-sm text-gray-500 mt-2">
      {range} relevant pages from page {relevantPages.startPage} -{" "}
      {relevantPages.endPage}
    </div>
  );
};

const PDFResult = ({
  title,
  url,
  snippet,
  totalPages = 0,
  relevantPages,
  thumbnail,
}: PDFResultProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);

  // Generate a thumbnail based on PDF URL
  const generateThumbnail = (pdfUrl: string) => {
    // If we have a thumbnail URL from the API, use it
    if (thumbnail) {
      return thumbnail;
    }

    if (thumbnailError) {
      // Fallback to placeholder if PDF preview fails
      const colors = ["e5e7eb", "dbeafe", "fef3c7", "dcfce7", "f5d0fe"];
      const colorIndex =
        pdfUrl.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) %
        colors.length;
      const bgColor = colors[colorIndex];
      return `https://placehold.co/400x300/${bgColor}/64748b?text=PDF`;
    }

    // Use PDF Embed from Mozilla's pdfjs (open source viewer)
    const encodedUrl = encodeURIComponent(pdfUrl);
    return `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodedUrl}#page=1&view=FitH`;
  };

  return (
    <div className="flex flex-col sm:flex-row border rounded-lg overflow-hidden mb-4 bg-white">
      <div className="w-full sm:w-1/4 relative">
        <div className="w-full h-[160px] overflow-hidden">
          {!thumbnailError ? (
            <iframe
              src={generateThumbnail(url)}
              className="w-full h-[400px] scale-[1.7] origin-top-left"
              onError={() => setThumbnailError(true)}
              title={`Preview of ${title}`}
            />
          ) : (
            <img
              src={generateThumbnail(url)}
              alt={title}
              className="w-full h-full object-cover"
            />
          )}
        </div>
        {totalPages > 0 && <PagesPill totalPages={totalPages} />}
      </div>
      <div className="p-4 flex-1">
        <h3 className="font-medium text-lg mb-2">{title}</h3>
        <p className="text-sm text-gray-600 line-clamp-2">{snippet}</p>
        <RelevancyInfo totalPages={totalPages} relevantPages={relevantPages} />

        <div className="mt-4 flex gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 bg-blue-50 text-blue-600 text-sm rounded-md hover:bg-blue-100"
          >
            View PDF
          </a>
        </div>
      </div>
    </div>
  );
};

export interface PDFSearchResultsProps {
  results: PDFResultProps[];
  isLoading?: boolean;
}

export const PDFSearchResults = ({
  results,
  isLoading = false,
}: PDFSearchResultsProps) => {
  if (isLoading) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
        <p className="mt-4 text-gray-600">Processing PDFs...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="mt-8">
      <h2 className="text-xl font-medium mb-4">Results</h2>
      <div>
        {results.map((result, index) => (
          <PDFResult key={index} {...result} />
        ))}
      </div>
    </div>
  );
};
