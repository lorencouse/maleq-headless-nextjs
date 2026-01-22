import Link from 'next/link';
import BlogCard from '@/components/blog/BlogCard';
import { Post } from '@/lib/types/wordpress';

interface GuideSectionsProps {
  malePosts?: Post[];
  femalePosts?: Post[];
}

export default function GuideSections({ malePosts = [], femalePosts = [] }: GuideSectionsProps) {
  return (
    <div className="space-y-16">
      {/* Mr. Q Section - Male Guides */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Intro */}
          <div className="lg:w-1/3 lg:sticky lg:top-24">
            <div className="bg-gradient-to-br from-blue-500/10 to-indigo-500/10 rounded-2xl p-6 border border-blue-500/20">
              <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">Mr. Q</h3>
              <p className="text-muted-foreground mb-4">
                Expert guides for men covering sex toys, techniques, and health topics.
                Unsponsored reviews you can trust.
              </p>
              <Link
                href="/blog/category/male"
                className="inline-flex items-center gap-2 text-blue-500 font-semibold hover:text-blue-600 transition-colors"
              >
                View All Male Guides
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Posts grid */}
          <div className="lg:w-2/3">
            {malePosts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {malePosts.slice(0, 4).map((post) => (
                  <BlogCard key={post.id} post={post} />
                ))}
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-8 text-center">
                <p className="text-muted-foreground">Guides coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Miss Q Section - Female Guides */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row-reverse gap-8 items-start">
          {/* Intro */}
          <div className="lg:w-1/3 lg:sticky lg:top-24">
            <div className="bg-gradient-to-br from-pink-500/10 to-rose-500/10 rounded-2xl p-6 border border-pink-500/20">
              <div className="w-16 h-16 bg-pink-500/20 rounded-2xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-2">Miss Q</h3>
              <p className="text-muted-foreground mb-4">
                In-depth guides for women on toys, pleasure, and wellness.
                Honest reviews to help you explore confidently.
              </p>
              <Link
                href="/blog/category/female"
                className="inline-flex items-center gap-2 text-pink-500 font-semibold hover:text-pink-600 transition-colors"
              >
                View All Female Guides
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Posts grid */}
          <div className="lg:w-2/3">
            {femalePosts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {femalePosts.slice(0, 4).map((post) => (
                  <BlogCard key={post.id} post={post} />
                ))}
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-8 text-center">
                <p className="text-muted-foreground">Guides coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
