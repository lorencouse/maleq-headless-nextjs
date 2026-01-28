'use client';

import { useState } from 'react';

interface Testimonial {
  id: number;
  name: string;
  location: string;
  rating: number;
  text: string;
  productType: string;
  verified: boolean;
}

const testimonials: Testimonial[] = [
  {
    id: 1,
    name: 'Michael R.',
    location: 'Austin, TX',
    rating: 5,
    text: 'Fast shipping and the packaging was completely discreet. No one would ever know what was inside. Product quality exceeded my expectations!',
    productType: 'Verified Buyer',
    verified: true,
  },
  {
    id: 2,
    name: 'James T.',
    location: 'Portland, OR',
    rating: 5,
    text: 'The guides on this site actually helped me make an informed decision. No pushy sales tactics, just honest information. Will definitely shop here again.',
    productType: 'Verified Buyer',
    verified: true,
  },
  {
    id: 3,
    name: 'David L.',
    location: 'Chicago, IL',
    rating: 5,
    text: 'Customer service was incredibly helpful when I had questions. They responded quickly and professionally. The product arrived in perfect condition.',
    productType: 'Verified Buyer',
    verified: true,
  },
  {
    id: 4,
    name: 'Chris M.',
    location: 'Denver, CO',
    rating: 5,
    text: 'Best prices I found online for premium brands. The quality guarantee gave me confidence to try something new. Very satisfied with my purchase.',
    productType: 'Verified Buyer',
    verified: true,
  },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <svg
          key={i}
          className={`w-4 h-4 ${i < rating ? 'text-yellow-400' : 'text-gray-300'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

export default function TestimonialsSection() {
  const [activeIndex, setActiveIndex] = useState(0);

  const nextTestimonial = () => {
    setActiveIndex((prev) => (prev + 1) % testimonials.length);
  };

  const prevTestimonial = () => {
    setActiveIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  return (
    <section className="bg-muted/30 py-8 sm:py-16 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-3">What Our Customers Say</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Real reviews from verified buyers who trust Male Q for quality and discretion
          </p>
        </div>

        {/* Desktop Grid */}
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.id}
              className="bg-card border border-border rounded-xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <StarRating rating={testimonial.rating} />
                {testimonial.verified && (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Verified
                  </span>
                )}
              </div>
              <p className="text-foreground/80 text-sm leading-relaxed mb-4">
                &ldquo;{testimonial.text}&rdquo;
              </p>
              <div className="border-t border-border pt-4">
                <p className="font-semibold text-foreground text-sm">{testimonial.name}</p>
                <p className="text-xs text-muted-foreground">{testimonial.location}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Mobile Carousel */}
        <div className="md:hidden">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <StarRating rating={testimonials[activeIndex].rating} />
              {testimonials[activeIndex].verified && (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Verified
                </span>
              )}
            </div>
            <p className="text-foreground/80 leading-relaxed mb-4">
              &ldquo;{testimonials[activeIndex].text}&rdquo;
            </p>
            <div className="border-t border-border pt-4">
              <p className="font-semibold text-foreground">{testimonials[activeIndex].name}</p>
              <p className="text-sm text-muted-foreground">{testimonials[activeIndex].location}</p>
            </div>
          </div>

          {/* Carousel Controls */}
          <div className="flex items-center justify-center gap-4 mt-6">
            <button
              onClick={prevTestimonial}
              className="p-2 rounded-full border border-border hover:bg-muted transition-colors cursor-pointer"
              aria-label="Previous testimonial"
            >
              <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex gap-2">
              {testimonials.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setActiveIndex(index)}
                  className={`w-2 h-2 rounded-full transition-colors cursor-pointer ${
                    index === activeIndex ? 'bg-primary' : 'bg-border'
                  }`}
                  aria-label={`Go to testimonial ${index + 1}`}
                />
              ))}
            </div>
            <button
              onClick={nextTestimonial}
              className="p-2 rounded-full border border-border hover:bg-muted transition-colors cursor-pointer"
              aria-label="Next testimonial"
            >
              <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Trust Stats */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div>
            <p className="text-3xl font-bold text-primary">10K+</p>
            <p className="text-sm text-muted-foreground">Happy Customers</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-primary">4.8</p>
            <p className="text-sm text-muted-foreground">Average Rating</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-primary">99%</p>
            <p className="text-sm text-muted-foreground">Satisfaction Rate</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-primary">24hr</p>
            <p className="text-sm text-muted-foreground">Avg. Ship Time</p>
          </div>
        </div>
      </div>
    </section>
  );
}
