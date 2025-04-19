import { SearchResultType } from '@/types';

// PagesPill component
const PagesPill = ({ totalPages }: { totalPages: number }) => {
  return (
    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-full">
      {totalPages} pages
    </div>
  );
};

// RelevancyInfo component
const RelevancyInfo = ({ totalPages, relevantPages }: { totalPages: number; relevantPages?: { startPage: number; endPage: number } }) => {
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
      <div className="text-sm text-gray-500 mt-2">
        All pages are relevant
      </div>
    );
  }

  return (
    <div className="text-sm text-gray-500 mt-2">
      {range} relevant pages from page {relevantPages.startPage} - {relevantPages.endPage}
    </div>
  );
};

// Individual search result component
const SearchResult = ({ title, description, image, totalPages, relevantPages }: SearchResultType) => {
  return (
    <div className="flex flex-col sm:flex-row border rounded-lg overflow-hidden mb-4 bg-white">
      <div className="w-full sm:w-1/4 relative">
        <div className="w-full h-[160px]">
          <img 
            src={image}
            alt={title}
            className="w-full h-full object-cover object-[top_left]"
          />
        </div>
        <PagesPill totalPages={totalPages} />
      </div>
      <div className="p-4 flex-1">
        <h3 className="font-medium text-base mb-2">{title}</h3>
        <p className="text-sm text-gray-600">{description}</p>
        <RelevancyInfo totalPages={totalPages} relevantPages={relevantPages} />
      </div>
    </div>
  );
};

// Search results container component
export const SearchResults = ({ results }: { results: SearchResultType[] }) => {
  return (
    <div>
      <h2 className="text-xl font-medium mb-4">Results</h2>
      <div>
        {results.map((result) => (
          <SearchResult
            key={result.id}
            {...result}
          />
        ))}
      </div>
    </div>
  );
};
