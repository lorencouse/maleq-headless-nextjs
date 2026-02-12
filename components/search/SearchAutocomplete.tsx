'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

type SearchMode = 'products' | 'articles';

interface ProductSuggestion {
  id: string;
  name: string;
  slug: string;
  price: string | null;
  image: string | null;
}

interface CategorySuggestion {
  id: string;
  name: string;
  slug: string;
}

interface PostSuggestion {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  image: string | null;
  category: string | null;
}

interface BlogCategorySuggestion {
  id: string;
  name: string;
  slug: string;
}

interface SearchAutocompleteProps {
  onClose?: () => void;
  autoFocus?: boolean;
  /** Default search mode to pre-select */
  defaultMode?: SearchMode;
  /** Additional CSS classes for the container */
  className?: string;
  /** Whether to persist search term from URL params */
  persistFromUrl?: boolean;
}

interface SearchResultRowProps {
  href: string;
  title: string;
  subtitle?: string | null;
  image?: string | null;
  isSelected: boolean;
  onClick: () => void;
  type: 'product' | 'article';
}

function SearchResultRow({
  href,
  title,
  subtitle,
  image,
  isSelected,
  onClick,
  type,
}: SearchResultRowProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`w-full items-center gap-2 px-1 py-1.5 rounded transition-colors ${
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'text-foreground hover:bg-muted'
      }`}
    >
      <div className='flex flex-row gap-4 my-1'>
        <div className='w-12 h-12 rounded bg-muted shrink-0 overflow-hidden'>
          {image ? (
            <Image
              src={image}
              alt={title}
              width={50}
              height={50}
              className='w-full h-full object-cover'
            />
          ) : (
            <div className='w-full h-full flex items-center justify-center text-muted-foreground'>
              {type === 'product' ? (
                <svg
                  className='w-4 h-4'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
                  />
                </svg>
              ) : (
                <svg
                  className='w-4 h-4'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z'
                  />
                </svg>
              )}
            </div>
          )}
        </div>
        <div className='flex flex-col'>
          <span className='flex-1 text-md truncate'>{title}</span>
          {subtitle && (
            <span className='text-xs text-muted-foreground shrink-0'>
              {subtitle}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function SearchAutocomplete({
  onClose,
  autoFocus = false,
  defaultMode = 'products',
  className,
  persistFromUrl = false,
}: SearchAutocompleteProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize query from URL params if persistFromUrl is enabled
  const initialQuery = persistFromUrl ? (searchParams.get('q') || '') : '';
  const [query, setQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<SearchMode>(defaultMode);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [categories, setCategories] = useState<CategorySuggestion[]>([]);
  const [posts, setPosts] = useState<PostSuggestion[]>([]);
  const [blogCategories, setBlogCategories] = useState<
    BlogCategorySuggestion[]
  >([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Load recent searches from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('recentSearches');
    if (saved) {
      setRecentSearches(JSON.parse(saved));
    }
  }, []);

  // Sync query with URL params when they change (for persistFromUrl mode)
  useEffect(() => {
    if (persistFromUrl) {
      const urlQuery = searchParams.get('q') || '';
      setQuery(urlQuery);
    }
  }, [searchParams, persistFromUrl]);

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Clear results when switching modes
  useEffect(() => {
    setProducts([]);
    setCategories([]);
    setPosts([]);
    setBlogCategories([]);
    setSuggestions([]);
    setSelectedIndex(-1);
  }, [searchMode]);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setProducts([]);
      setCategories([]);
      setPosts([]);
      setBlogCategories([]);
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        if (searchMode === 'products') {
          const response = await fetch(
            `/api/search?q=${encodeURIComponent(query)}&limit=5`,
          );
          const data = await response.json();
          setProducts(data.products || []);
          setCategories(data.categories || []);
          setSuggestions(data.suggestions || []);
          setPosts([]);
          setBlogCategories([]);
        } else {
          const response = await fetch(
            `/api/blog/search?q=${encodeURIComponent(query)}&limit=5`,
          );
          const data = await response.json();
          setPosts(data.posts || []);
          setBlogCategories(data.categories || []);
          setSuggestions(data.suggestions || []);
          setProducts([]);
          setCategories([]);
        }
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, searchMode]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Save search to recent
  const saveRecentSearch = useCallback(
    (term: string) => {
      const updated = [term, ...recentSearches.filter((s) => s !== term)].slice(
        0,
        5,
      );
      setRecentSearches(updated);
      localStorage.setItem('recentSearches', JSON.stringify(updated));
    },
    [recentSearches],
  );

  // Handle search submit
  const handleSearch = (searchTerm?: string) => {
    const term = searchTerm || query;
    if (term.trim()) {
      saveRecentSearch(term.trim());
      const url = searchMode === 'products'
        ? `/shop?q=${encodeURIComponent(term.trim())}`
        : `/guides?q=${encodeURIComponent(term.trim())}`;
      setIsOpen(false);
      setQuery('');
      onClose?.();
      // Use window.location for hard navigation to ensure fresh data
      // router.push can use cached data when navigating to the same route
      window.location.href = url;
    }
  };

  // Get total items for keyboard navigation
  const getTotalItems = () => {
    if (searchMode === 'products') {
      return products.length + categories.length;
    }
    return posts.length + blogCategories.length;
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = getTotalItems();

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          if (searchMode === 'products') {
            if (selectedIndex < products.length) {
              router.push(`/product/${products[selectedIndex].slug}`);
              onClose?.();
            } else {
              const categoryIndex = selectedIndex - products.length;
              router.push(
                `/sex-toys/${categories[categoryIndex].slug}`,
              );
              onClose?.();
            }
          } else {
            if (selectedIndex < posts.length) {
              router.push(`/guides/${posts[selectedIndex].slug}`);
              onClose?.();
            } else {
              const categoryIndex = selectedIndex - posts.length;
              router.push(
                `/guides/category/${blogCategories[categoryIndex].slug}`,
              );
              onClose?.();
            }
          }
        } else {
          handleSearch();
        }
        break;
      case 'Escape':
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  // Clear recent search
  const clearRecentSearch = (term: string) => {
    const updated = recentSearches.filter((s) => s !== term);
    setRecentSearches(updated);
    localStorage.setItem('recentSearches', JSON.stringify(updated));
  };

  const hasResults =
    searchMode === 'products'
      ? products.length > 0 || categories.length > 0
      : posts.length > 0 || blogCategories.length > 0;

  const showDropdown =
    isOpen && (query.length >= 2 || recentSearches.length > 0);

  const dynamicPlaceholder = searchMode === 'products' ? 'Search products...' : 'Search articles...';

  return (
    <div ref={containerRef} className={`relative w-full ${className || ''}`}>
      {/* Search Input */}
      <div className='relative'>
        <input
          ref={inputRef}
          type='text'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={dynamicPlaceholder}
          spellCheck={true}
          autoComplete="off"
          autoCorrect="on"
          className='w-full pl-10 pr-4 py-2.5 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground'
        />
        <svg
          className='absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
          />
        </svg>
        {isLoading && (
          <div className='absolute right-3 top-1/2 -translate-y-1/2'>
            <svg
              className='animate-spin h-5 w-5 text-muted-foreground'
              viewBox='0 0 24 24'
            >
              <circle
                className='opacity-25'
                cx='12'
                cy='12'
                r='10'
                stroke='currentColor'
                strokeWidth='4'
                fill='none'
              />
              <path
                className='opacity-75'
                fill='currentColor'
                d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
              />
            </svg>
          </div>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className='absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden'>
          {/* Search Mode Toggle */}
          <div className='p-2 border-b border-border'>
            <div className='flex gap-1 p-1 bg-muted rounded-md'>
              <button
                onClick={() => setSearchMode('products')}
                className={`flex-1 px-3 py-2.5 min-h-[44px] text-sm font-medium rounded transition-colors ${
                  searchMode === 'products'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Products
              </button>
              <button
                onClick={() => setSearchMode('articles')}
                className={`flex-1 px-3 py-2.5 min-h-[44px] text-sm font-medium rounded transition-colors ${
                  searchMode === 'articles'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Articles
              </button>
            </div>
          </div>

          {/* Recent Searches */}
          {query.length < 2 && recentSearches.length > 0 && (
            <div className='p-2'>
              <p className='text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-1'>
                Recent Searches
              </p>
              <div>
                {recentSearches.map((term) => (
                  <div
                    key={term}
                    className='flex items-center justify-between group'
                  >
                    <button
                      onClick={() => handleSearch(term)}
                      className='flex items-center gap-2 flex-1 px-2 py-2.5 min-h-[44px] text-sm text-foreground hover:bg-muted rounded transition-colors'
                    >
                      <svg
                        className='w-4 h-4 text-muted-foreground flex-shrink-0'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='truncate'>{term}</span>
                    </button>
                    <button
                      onClick={() => clearRecentSearch(term)}
                      className='p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity'
                    >
                      <svg
                        className='w-4 h-4'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M6 18L18 6M6 6l12 12'
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search Results */}
          {query.length >= 2 && (
            <>
              {/* Products Mode Results */}
              {searchMode === 'products' && (
                <>
                  {/* Categories */}
                  {categories.length > 0 && (
                    <div className='p-2 border-b border-border'>
                      <p className='text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-1'>
                        Categories
                      </p>
                      <div>
                        {categories.map((category, index) => (
                          <Link
                            key={category.id}
                            href={`/sex-toys/${category.slug}`}
                            onClick={() => {
                              setIsOpen(false);
                              onClose?.();
                            }}
                            className={`flex items-center gap-2 px-1 py-1 text-sm rounded transition-colors ${
                              selectedIndex === products.length + index
                                ? 'bg-primary/10 text-primary'
                                : 'text-foreground hover:bg-muted'
                            }`}
                          >
                            <svg
                              className='w-4 h-4 text-muted-foreground flex-shrink-0'
                              fill='none'
                              stroke='currentColor'
                              viewBox='0 0 24 24'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z'
                              />
                            </svg>
                            <span className='truncate'>{category.name}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Products */}
                  {products.length > 0 && (
                    <div className='p-2'>
                      <p className='text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-1'>
                        Products
                      </p>
                      {products.map((product, index) => (
                        <SearchResultRow
                          key={product.id}
                          href={`/product/${product.slug}`}
                          title={product.name}
                          subtitle={product.price}
                          image={product.image}
                          isSelected={selectedIndex === index}
                          onClick={() => {
                            setIsOpen(false);
                            onClose?.();
                          }}
                          type='product'
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Articles Mode Results */}
              {searchMode === 'articles' && (
                <>
                  {/* Blog Categories */}
                  {blogCategories.length > 0 && (
                    <div className='p-2 border-b border-border'>
                      <p className='text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-1'>
                        Categories
                      </p>
                      <div>
                        {blogCategories.map((category, index) => (
                          <Link
                            key={category.id}
                            href={`/guides/category/${category.slug}`}
                            onClick={() => {
                              setIsOpen(false);
                              onClose?.();
                            }}
                            className={`flex items-center gap-2 px-1 py-1 text-sm rounded transition-colors ${
                              selectedIndex === posts.length + index
                                ? 'bg-primary/10 text-primary'
                                : 'text-foreground hover:bg-muted'
                            }`}
                          >
                            <svg
                              className='w-4 h-4 text-muted-foreground flex-shrink-0'
                              fill='none'
                              stroke='currentColor'
                              viewBox='0 0 24 24'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z'
                              />
                            </svg>
                            <span className='truncate'>{category.name}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Posts */}
                  {posts.length > 0 && (
                    <div className='p-2'>
                      <p className='text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 px-1'>
                        Articles
                      </p>
                      {posts.map((post, index) => (
                        <SearchResultRow
                          key={post.id}
                          href={`/guides/${post.slug}`}
                          title={post.title}
                          subtitle={post.category}
                          image={post.image}
                          isSelected={selectedIndex === index}
                          onClick={() => {
                            setIsOpen(false);
                            onClose?.();
                          }}
                          type='article'
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* No Results */}
              {!hasResults && !isLoading && (
                <div className='p-4 text-center'>
                  <p className='text-sm text-muted-foreground'>
                    No {searchMode === 'products' ? 'products' : 'articles'}{' '}
                    found for &quot;{query}&quot;
                  </p>
                  {/* Did you mean? suggestions */}
                  {suggestions.length > 0 && (
                    <p className='text-sm text-muted-foreground mt-2'>
                      Did you mean:{' '}
                      {suggestions.map((suggestion, index) => (
                        <span key={suggestion}>
                          <button
                            onClick={() => {
                              setQuery(suggestion);
                              handleSearch(suggestion);
                            }}
                            className='font-medium text-primary hover:text-primary/80 underline'
                          >
                            {suggestion}
                          </button>
                          {index < suggestions.length - 1 && ', '}
                        </span>
                      ))}
                      ?
                    </p>
                  )}
                </div>
              )}

              {/* View All Results */}
              {hasResults && (
                <div className='p-2 border-t border-border'>
                  <button
                    onClick={() => handleSearch()}
                    className='w-full py-1.5 text-sm text-primary hover:text-primary-hover font-medium transition-colors'
                  >
                    View all {searchMode === 'products' ? 'product' : 'article'}{' '}
                    results for &quot;{query}&quot;
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
