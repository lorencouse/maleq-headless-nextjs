import React from 'react';

// SVG Icon Components for categories
export const CategoryIcons = {
  // Vibrators - lightning bolt for power/vibration
  vibrator: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),

  // Dildos - elongated shape
  dildo: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m0-18c-2 0-3.5 1.5-3.5 3.5S10 10 12 10s3.5-2 3.5-3.5S14 3 12 3z" />
    </svg>
  ),

  // Anal - target/bullseye
  anal: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  ),

  // Masturbators - hand
  masturbator: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075-5.925v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0v3.75m-9.15-3.75v6a9 9 0 0018 0V9m-18 0v-.375c0-1.036.84-1.875 1.875-1.875h.375A3.75 3.75 0 006 10.5v1.875" />
    </svg>
  ),

  // Lubricants - droplet
  lubricant: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21c-4.418 0-8-3.134-8-7 0-3.866 8-11 8-11s8 7.134 8 11c0 3.866-3.582 7-8 7z" />
    </svg>
  ),

  // Bondage - lock/chains
  bondage: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  ),

  // Lingerie - heart
  lingerie: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </svg>
  ),

  // Couples - two people
  couples: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),

  // For Women - female symbol
  forWomen: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <circle cx="12" cy="8" r="5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 13v8m-3 -3h6" />
    </svg>
  ),

  // For Men - male symbol
  forMen: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <circle cx="10" cy="14" r="5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 9.5L19 5m0 0h-5m5 0v5" />
    </svg>
  ),

  // Cock Rings - ring shape
  cockRing: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  ),

  // Health & Beauty - sparkles
  healthBeauty: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  ),

  // Party & Games - gift/party
  partyGames: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),

  // Role Play - mask/theater
  rolePlay: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
    </svg>
  ),

  // Prostate - crosshair/target
  prostate: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="7" />
      <path strokeLinecap="round" d="M12 5v2m0 10v2m7-7h-2M7 12H5" />
    </svg>
  ),

  // Bullets & Eggs - small oval
  bullet: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <ellipse cx="12" cy="12" rx="4" ry="6" />
      <path strokeLinecap="round" d="M12 6v-3m0 18v-3" />
    </svg>
  ),

  // Rabbit Style - bunny ears
  rabbit: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 3c0 3-2 6-2 9m8-9c0 3 2 6 2 9M7 12a5 5 0 0010 0m-5 9v-5" />
      <circle cx="12" cy="14" r="4" />
    </svg>
  ),

  // Strap-ons - harness shape
  strapon: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-6-6h12M6 12a6 6 0 1012 0 6 6 0 00-12 0z" />
    </svg>
  ),

  // Whips & Paddles - feather/whip
  whip: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  ),

  // Nipple Play - star burst
  nipple: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  ),

  // Cuffs - handcuffs/restraints
  cuffs: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <circle cx="7" cy="12" r="4" />
      <circle cx="17" cy="12" r="4" />
      <path strokeLinecap="round" d="M11 12h2" />
    </svg>
  ),

  // Pumps - air pump
  pump: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l-4-4m4 4l4-4M6 8.25h12" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </svg>
  ),

  // Condoms - shield/protection
  condom: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  ),

  // Candles - flame
  candle: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
    </svg>
  ),

  // Massage - hands
  massage: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
    </svg>
  ),

  // Eco-Friendly - leaf
  eco: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c.132 0 .263 0 .393.014a7.5 7.5 0 017.92 5.721A7.5 7.5 0 0112 21a7.5 7.5 0 01-8.313-12.265A7.5 7.5 0 0112 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m0-9c-3.5 0-6-2.5-6-6" />
    </svg>
  ),

  // Kits/Sets - box with items
  kit: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),

  // G-Spot - target with G
  gspot: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 10c0-1.1-.9-2-2-2s-2 .9-2 2v4c0 1.1.9 2 2 2h1" />
    </svg>
  ),

  // Stockings - leg
  stockings: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 4v16m8-16v16M8 12h8M6 4h4m4 0h4" />
    </svg>
  ),

  // Pills/Supplements - pill capsule
  pills: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H12m7.5 0H12" />
    </svg>
  ),

  // Hygiene - water drops
  hygiene: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21c-4.418 0-8-3.134-8-7 0-3.866 8-11 8-11s8 7.134 8 11c0 3.866-3.582 7-8 7z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18c-2.209 0-4-1.567-4-3.5S10 10 12 10s4 2.933 4 4.5-1.791 3.5-4 3.5z" />
    </svg>
  ),

  // Books/Media - book
  books: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),

  // Underwear - brief shape
  underwear: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v4c0 4-3 8-8 8s-8-4-8-8V6z" />
      <path strokeLinecap="round" d="M4 6c2 0 4 2 8 2s6-2 8-2" />
    </svg>
  ),

  // Clitoral - waves/pulse
  clitoral: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5M3.75 12c2-3 4-4 6-4s4 4 6 4 4-4 6-4M3.75 12c2 3 4 4 6 4s4-4 6-4 4 4 6 4" />
    </svg>
  ),

  // Oral - lips
  oral: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18c4 0 7-2 7-6s-3-6-7-6-7 2-7 6 3 6 7 6z" />
      <path strokeLinecap="round" d="M8 12h8" />
    </svg>
  ),

  // Beads - string of beads
  beads: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <circle cx="6" cy="12" r="3" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="18" cy="12" r="3" />
      <path strokeLinecap="round" d="M3 12h18" />
    </svg>
  ),

  // Wand
  wand: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 11l10 10M21 11l-10 10" />
    </svg>
  ),

  // Default/Generic - grid
  default: (
    <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
};

// Category to icon and gradient mapping
export const categoryConfig: Record<string, { icon: React.ReactNode; gradient: string }> = {
  // Main categories
  'vibrators': { gradient: 'from-pink-500 to-rose-600', icon: CategoryIcons.vibrator },
  'rechargeable-vibrators': { gradient: 'from-pink-500 to-rose-600', icon: CategoryIcons.vibrator },
  'classic-vibrators': { gradient: 'from-pink-400 to-rose-500', icon: CategoryIcons.vibrator },
  'rabbit-style-vibrators': { gradient: 'from-pink-500 to-fuchsia-600', icon: CategoryIcons.rabbit },
  'g-spot-rabbit-style': { gradient: 'from-pink-500 to-fuchsia-600', icon: CategoryIcons.rabbit },

  'dildos-dongs': { gradient: 'from-indigo-500 to-indigo-700', icon: CategoryIcons.dildo },
  'dildos-dongs-realistic': { gradient: 'from-indigo-500 to-purple-600', icon: CategoryIcons.dildo },
  'realistic-small-medium': { gradient: 'from-indigo-400 to-indigo-600', icon: CategoryIcons.dildo },
  'realistic-large': { gradient: 'from-indigo-600 to-purple-700', icon: CategoryIcons.dildo },
  'realistic': { gradient: 'from-indigo-500 to-indigo-700', icon: CategoryIcons.dildo },
  'unnatural-dildos-dongs': { gradient: 'from-violet-500 to-purple-700', icon: CategoryIcons.dildo },

  'anal-toys': { gradient: 'from-purple-500 to-purple-700', icon: CategoryIcons.anal },
  'small-medium-butt-plugs': { gradient: 'from-purple-400 to-purple-600', icon: CategoryIcons.anal },
  'prostate-massagers-p-spot-stimulators': { gradient: 'from-purple-500 to-indigo-600', icon: CategoryIcons.prostate },
  'prostate-massagers': { gradient: 'from-purple-500 to-indigo-600', icon: CategoryIcons.prostate },
  'anal-trainer-kits': { gradient: 'from-purple-400 to-purple-600', icon: CategoryIcons.kit },
  'anal-beads': { gradient: 'from-purple-500 to-fuchsia-600', icon: CategoryIcons.beads },
  't-plugs': { gradient: 'from-purple-500 to-purple-700', icon: CategoryIcons.anal },
  'probes-sticks-rods': { gradient: 'from-purple-600 to-indigo-700', icon: CategoryIcons.anal },

  'masturbators': { gradient: 'from-blue-500 to-blue-700', icon: CategoryIcons.masturbator },
  'masturbation-sleeves': { gradient: 'from-blue-500 to-blue-700', icon: CategoryIcons.masturbator },
  'masturbators-porn-star': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.masturbator },
  'pussy': { gradient: 'from-blue-400 to-blue-600', icon: CategoryIcons.masturbator },
  'pussy-ass': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.masturbator },

  'lubricants': { gradient: 'from-cyan-500 to-teal-600', icon: CategoryIcons.lubricant },
  'water-based': { gradient: 'from-cyan-400 to-cyan-600', icon: CategoryIcons.lubricant },
  'silicone-based': { gradient: 'from-teal-500 to-teal-700', icon: CategoryIcons.lubricant },
  'flavored': { gradient: 'from-cyan-500 to-emerald-600', icon: CategoryIcons.lubricant },
  'anal-lubes-lotions-sprays-creams': { gradient: 'from-teal-500 to-cyan-600', icon: CategoryIcons.lubricant },
  'gels': { gradient: 'from-cyan-400 to-teal-500', icon: CategoryIcons.lubricant },
  'oils': { gradient: 'from-amber-500 to-orange-600', icon: CategoryIcons.lubricant },
  'creams': { gradient: 'from-cyan-400 to-cyan-600', icon: CategoryIcons.lubricant },
  'lotions': { gradient: 'from-teal-400 to-cyan-500', icon: CategoryIcons.lubricant },

  'bondage-fetish-kink': { gradient: 'from-red-500 to-red-700', icon: CategoryIcons.bondage },
  'bondage-kits-kinky-sets': { gradient: 'from-red-500 to-rose-700', icon: CategoryIcons.kit },
  'bondage-restraints': { gradient: 'from-red-600 to-red-800', icon: CategoryIcons.bondage },
  'whips-paddles-ticklers': { gradient: 'from-red-500 to-orange-600', icon: CategoryIcons.whip },
  'nipple-play': { gradient: 'from-rose-500 to-pink-600', icon: CategoryIcons.nipple },
  'cuffs': { gradient: 'from-red-500 to-red-700', icon: CategoryIcons.cuffs },
  'body-harnesses': { gradient: 'from-red-600 to-rose-700', icon: CategoryIcons.bondage },

  'lingerie-clothing': { gradient: 'from-fuchsia-500 to-fuchsia-700', icon: CategoryIcons.lingerie },
  'stockings-pantyhose-garters': { gradient: 'from-fuchsia-400 to-pink-600', icon: CategoryIcons.stockings },
  'pasties-accessories': { gradient: 'from-pink-500 to-fuchsia-600', icon: CategoryIcons.lingerie },
  'sexy-costume-accessories': { gradient: 'from-fuchsia-500 to-purple-600', icon: CategoryIcons.lingerie },
  'mens-underwear': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.underwear },
  'womens-underwear': { gradient: 'from-pink-500 to-rose-600', icon: CategoryIcons.underwear },
  'mens-fetish-wear': { gradient: 'from-zinc-600 to-zinc-800', icon: CategoryIcons.underwear },

  'sextoys-for-couples': { gradient: 'from-amber-500 to-orange-600', icon: CategoryIcons.couples },
  'couples-cock-rings': { gradient: 'from-amber-500 to-orange-600', icon: CategoryIcons.cockRing },
  'sensual-kits': { gradient: 'from-amber-400 to-orange-500', icon: CategoryIcons.kit },

  'sextoys-for-women': { gradient: 'from-pink-500 to-rose-600', icon: CategoryIcons.forWomen },
  'clitoral': { gradient: 'from-pink-400 to-rose-500', icon: CategoryIcons.clitoral },
  'g-spot': { gradient: 'from-pink-500 to-fuchsia-600', icon: CategoryIcons.gspot },
  'g-spot-1': { gradient: 'from-pink-500 to-fuchsia-600', icon: CategoryIcons.gspot },
  'g-spot-clit-stimulators': { gradient: 'from-pink-500 to-rose-600', icon: CategoryIcons.gspot },
  'clit-cuddlers': { gradient: 'from-pink-400 to-rose-500', icon: CategoryIcons.clitoral },
  'vibrating-bullets-eggs': { gradient: 'from-pink-500 to-fuchsia-600', icon: CategoryIcons.bullet },
  'bullets-eggs': { gradient: 'from-pink-400 to-rose-500', icon: CategoryIcons.bullet },

  'sextoys-for-men': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.forMen },
  'mens-cock-ball-gear': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.cockRing },
  'cock-rings': { gradient: 'from-blue-500 to-indigo-700', icon: CategoryIcons.cockRing },
  'love-rings': { gradient: 'from-blue-400 to-blue-600', icon: CategoryIcons.cockRing },
  'classic-cock-rings': { gradient: 'from-blue-500 to-blue-700', icon: CategoryIcons.cockRing },
  'adjustable-versatile-cock-rings': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.cockRing },
  'gentlemen-cock-rings': { gradient: 'from-blue-600 to-indigo-700', icon: CategoryIcons.cockRing },
  'cock-ring-trios': { gradient: 'from-blue-500 to-blue-700', icon: CategoryIcons.cockRing },
  'sleeves-rings': { gradient: 'from-blue-400 to-indigo-600', icon: CategoryIcons.cockRing },
  'male-extensions': { gradient: 'from-blue-500 to-blue-700', icon: CategoryIcons.forMen },
  'penis-extensions': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.forMen },
  'male-pumps': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.pump },
  'penis-pumps': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.pump },

  'health-beauty': { gradient: 'from-emerald-500 to-teal-600', icon: CategoryIcons.healthBeauty },
  'erotic-body-lotions': { gradient: 'from-emerald-400 to-teal-500', icon: CategoryIcons.massage },
  'massage-lotions-creams': { gradient: 'from-emerald-500 to-cyan-600', icon: CategoryIcons.massage },
  'body-massagers': { gradient: 'from-emerald-500 to-teal-600', icon: CategoryIcons.massage },
  'magic-wands-body-massagers': { gradient: 'from-purple-500 to-fuchsia-600', icon: CategoryIcons.wand },
  'hygiene-intimate-care': { gradient: 'from-cyan-500 to-teal-600', icon: CategoryIcons.hygiene },
  'desensitizing': { gradient: 'from-teal-500 to-cyan-600', icon: CategoryIcons.healthBeauty },
  'oral-products': { gradient: 'from-rose-400 to-pink-500', icon: CategoryIcons.oral },

  'party-games-gifts-supplies': { gradient: 'from-yellow-500 to-amber-600', icon: CategoryIcons.partyGames },
  'adult-party-supplies': { gradient: 'from-yellow-500 to-orange-500', icon: CategoryIcons.partyGames },
  'adult-party-games': { gradient: 'from-amber-500 to-yellow-600', icon: CategoryIcons.partyGames },
  'x-rated-adult-games': { gradient: 'from-red-500 to-orange-600', icon: CategoryIcons.partyGames },
  'adult-gags-gifts-and-novelties': { gradient: 'from-yellow-500 to-amber-600', icon: CategoryIcons.partyGames },
  'for-the-bachelorette-party': { gradient: 'from-pink-500 to-fuchsia-600', icon: CategoryIcons.partyGames },
  'for-the-bachelor-party': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.partyGames },

  'naughty-role-play': { gradient: 'from-violet-500 to-purple-700', icon: CategoryIcons.rolePlay },
  'strap-ons-harnesses': { gradient: 'from-indigo-500 to-violet-600', icon: CategoryIcons.strapon },
  'eco-friendly-sex-toys': { gradient: 'from-green-500 to-emerald-600', icon: CategoryIcons.eco },
  'condoms': { gradient: 'from-blue-500 to-cyan-600', icon: CategoryIcons.condom },
  'candles': { gradient: 'from-orange-500 to-amber-600', icon: CategoryIcons.candle },
  'sex-pills': { gradient: 'from-blue-500 to-indigo-600', icon: CategoryIcons.pills },
  'meds-supplements': { gradient: 'from-green-500 to-teal-600', icon: CategoryIcons.pills },
};

// Default config for categories not in the list
export const defaultCategoryConfig = {
  gradient: 'from-zinc-600 to-zinc-800',
  icon: CategoryIcons.default,
};

// Helper to get category config
export function getCategoryConfig(slug: string) {
  return categoryConfig[slug] || defaultCategoryConfig;
}

// Category slug to image filename mapping
// Images are stored on the WP backend at /wp-content/uploads/images/product-categories/
export const categoryImages: Record<string, string> = {
  // Anal toys
  'anal-beads': 'anal-beads.webp',
  'classic-anal-beads': 'anal-beads.webp',
  'vibrating-anal-beads': 'anal-beads.webp',
  'glass-anal-beads': 'glass-anal-beads.webp',
  'anal-trainer-kits': 'anal-trainer-kits.webp',
  'anal-vibrators': 'anal-vibrators.webp',
  'anal-lubes-lotions-sprays-creams': 'anal-lubes-lotions-and-sprays.webp',
  'inflatable-butt-plugs': 'inflatable-butt-plugs.webp',
  'small-medium-butt-plugs': 'inflatable-butt-plugs.webp',
  'big-butt-plugs': 'large-hube-butt-plugs.webp',
  'huge-butt-plugs': 'large-hube-butt-plugs.webp',
  'large-huge-butt-plugs': 'large-hube-butt-plugs.webp',
  'enemas-douches': 'anal-douches-enemas.webp',
  'anal-douches-enemas': 'anal-douches-enemas.webp',
  'anal-douches-enemas-hygiene': 'anal-douches-enemas.webp',
  'hygiene-intimate-care': 'anal-douches-enemas.webp',

  // Prostate
  'prostate-massagers': 'prostate-masagers.webp',
  'prostate-massagers-p-spot-stimulators': 'prostate-masagers-and-p-spot-stimulators.webp',

  // Cock rings
  'cock-rings': 'classic-cock-rings.webp',
  'classic-cock-rings': 'classic-cock-rings.webp',
  'adjustable-cock-rings': 'adjustable-and-versitile-cock-rings.webp',
  'adjustable-versatile-cock-rings': 'adjustable-and-versitile-cock-rings.webp',
  'cock-ring-trios': 'cock-ring-trios.webp',
  'cock-ring-sets': 'cock-ring-trios.webp',
  'stimulating-cock-rings': 'stimulating-cock-rings.webp',
  'double-penetration-cock-rings': 'double-penetration-cock-rings.webp',
  'sleeves-rings': 'cock-sleeves.webp',

  // Penis pumps
  'penis-pumps': 'penis-pumps.webp',
  'male-pumps': 'penis-pumps.webp',

  // Penis extensions & sleeves
  'penis-extensions': 'penis-extensions.webp',
  'male-extensions': 'penis-extensions.webp',
  'penis-sleeves': 'penis-sleves.webp',

  // Bondage
  'body-harnesses': 'body-harnesses.webp',

  // Men's wear
  'mens-underwear': 'mens-underwaer.webp',

  // Lubricants & massage
  'massage-lotions-creams': 'massage-lotions-and-creams.webp',
  'erotic-body-lotions': 'massage-lotions-and-creams.webp',
};

// Helper to get category image URL
// Checks static mapping first, then falls back to WP image URL
export function getCategoryImage(slug: string, wpImageUrl?: string | null): string | null {
  const filename = categoryImages[slug];
  if (filename) {
    const baseUrl = process.env.NEXT_PUBLIC_IMAGE_BASE_URL || 'https://wp.maleq.com';
    return `${baseUrl}/wp-content/uploads/images/product-categories/${filename}`;
  }
  return wpImageUrl || null;
}
