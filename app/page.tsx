'use client'

import { GradeDropdown, Grade } from '@/components/GradeDropdown';
import { SearchBar } from '@/components/SearchBar';
import { useState } from 'react';
import { SearchResults } from '@/components/SearchResults';
import { SearchResultType } from '@/types';

// Fixture data for search results
const searchResults: SearchResultType[] = [
  {
    id: 0,
    title: "Advanced Multiplication Practice: 3-Digit Numbers",
    description: "Detailed worksheets focusing on advanced multiplication techniques for 3-digit numbers. Perfect for students looking to strengthen their multiplication skills.",
    image: "https://images.twinkl.co.uk/tw1n/image/private/s--iB_aQ8je--/e_sharpen:100,q_auto:eco,w_1260/image_repo/e5/55/t2-m-1457-long-multiplication-practice-3-digits-x-2-digits_ver_3.jpeg",
    totalPages: 15
  },
  {
    id: 1,
    title: "Thanksgiving-Themed 2-Digit Multiplication Worksheets",
    description: "Engaging Thanksgiving-themed worksheets for practicing 2-digit by 2-digit multiplication. Includes fun coloring activities to make learning multiplication more enjoyable.",
    image: "https://ecdn.teacherspayteachers.com/thumbitem/THANKSGIVING-Multiplication-Coloring-Worksheets-2-DIGIT-X-2-DIGIT-4998456-1572905399/original-4998456-4.jpg",
    totalPages: 24,
    relevantPages: { startPage: 3, endPage: 10 }
  },
  {
    id: 2,
    title: "Long Multiplication Practice: 3-Digits by 2-Digits",
    description: "Comprehensive practice worksheets for mastering long multiplication with 3-digit by 2-digit numbers. Includes step-by-step examples and practice problems.",
    image: "https://images.twinkl.co.uk/tw1n/image/private/t_630/image_repo/62/d0/T2-M-1457-Long-Multiplication-Practice-3-Digits-x-2-Digits.jpg",
    totalPages: 18,
    relevantPages: { startPage: 1, endPage: 18 }
  },
];

export default function Home() {
  const [selectedGrade, setSelectedGrade] = useState<Grade>(Grade.ALL);
  const [searchQuery, setSearchQuery] = useState("Volcanoes");
  
  // Mock search history data
  const searchHistory = [
    "Volcanoes",
    "Earthquakes",
    "Plate Tectonics",
    "Natural Disasters",
    "Geology Basics"
  ];

  return (
    <div className="flex flex-col items-center w-full sm:w-3/4 max-w-full mx-auto pt-6">
      <div className="w-full px-4 relative">
        <h1 className="text-2xl font-semibold mb-4">PDF Search</h1>
        {/* Search bar and grade dropdown container */}
        <div className="flex flex-col gap-2">
          <div className="flex items-stretch">
            <div className="flex-1">
              <SearchBar 
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search..."
                history={searchHistory}
              />
            </div>
            <div className="ml-4 relative z-10 h-12">
              <GradeDropdown value={selectedGrade} onChange={setSelectedGrade} />
            </div>
          </div>
        </div>
      </div>
      
      {/* Search results section */}
      <div className="w-full px-4 mt-6">
        <SearchResults results={searchResults} />
      </div>
    </div>
  );
}