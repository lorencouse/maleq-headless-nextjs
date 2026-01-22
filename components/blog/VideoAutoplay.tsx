'use client';

import { useEffect } from 'react';

/**
 * VideoAutoplay Component
 *
 * Handles lazy loading and autoplay for videos in blog content.
 * Videos will:
 * - Load lazily when approaching the viewport
 * - Autoplay (muted) when visible
 * - Pause when scrolled out of view
 * - Loop continuously like GIFs
 */
export default function VideoAutoplay() {
  useEffect(() => {
    // Find all videos in the blog content
    const videos = document.querySelectorAll<HTMLVideoElement>(
      '.entry-content video, .blog-content video'
    );

    if (videos.length === 0) return;

    // Intersection Observer for lazy loading and autoplay
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target as HTMLVideoElement;

          if (entry.isIntersecting) {
            // Video is in viewport - ensure it plays
            video.muted = true; // Required for autoplay
            video.playsInline = true;
            video.loop = true;

            // Start loading if not already loaded
            if (video.preload === 'none') {
              video.preload = 'auto';
              video.load();
            }

            // Play when ready
            const playPromise = video.play();
            if (playPromise !== undefined) {
              playPromise.catch(() => {
                // Autoplay was prevented - this is fine, user can interact
                console.log('Video autoplay prevented by browser');
              });
            }

            // Mark as loaded for CSS transition
            video.setAttribute('data-loaded', 'true');
          } else {
            // Video is out of viewport - pause to save resources
            if (!video.paused) {
              video.pause();
            }
          }
        });
      },
      {
        // Start loading/playing when video is 100px from entering viewport
        rootMargin: '100px 0px',
        threshold: 0.1,
      }
    );

    // Set up each video
    videos.forEach((video) => {
      // Ensure required attributes for GIF-like behavior
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');

      // Remove controls for cleaner GIF-like appearance
      video.controls = false;
      video.removeAttribute('controls');

      // Set preload to none initially for lazy loading
      // (unless already has autoplay and is in viewport)
      if (!video.autoplay) {
        video.preload = 'none';
      }

      // Observe this video
      observer.observe(video);

      // Handle loadeddata event to mark as loaded
      video.addEventListener('loadeddata', () => {
        video.setAttribute('data-loaded', 'true');
      });
    });

    // Cleanup
    return () => {
      videos.forEach((video) => {
        observer.unobserve(video);
      });
      observer.disconnect();
    };
  }, []);

  // This component doesn't render anything - it just adds behavior
  return null;
}
