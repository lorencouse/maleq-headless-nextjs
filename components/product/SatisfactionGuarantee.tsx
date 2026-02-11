import Link from 'next/link';

interface SatisfactionGuaranteeProps {
  variant?: 'default' | 'compact';
  className?: string;
}

export default function SatisfactionGuarantee({
  variant = 'default',
  className = '',
}: SatisfactionGuaranteeProps) {
  // if (variant === 'compact') {
  //   return (
  //     <div
  //       className={`flex items-center gap-3 p-3 bg-green-600 rounded-lg border border-green-200 dark:border-green-800 select-none ${className}`}
  //     >
  //       <div className='flex-shrink-0'>
  //         <svg
  //           className='w-8 h-8 text-white'
  //           fill='none'
  //           stroke='currentColor'
  //           viewBox='0 0 24 24'
  //           strokeWidth={1.5}
  //         >
  //           <path
  //             strokeLinecap='round'
  //             strokeLinejoin='round'
  //             d='M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z'
  //           />
  //         </svg>
  //       </div>
  //       <div>
  //         <p className='font-semibold text-white text-sm'>
  //           30-Day Satisfaction Guarantee
  //         </p>
  //         <p className='text-xs text-white'>
  //           Not happy? We&apos;ll make it right.
  //         </p>
  //       </div>
  //     </div>
  //   );
  // }

  // Default full version
  return (
    <div
      className={`p-6 bg-success/10  rounded-xl border border-success/20 select-none ${className}`}
    >
      <div className='flex items-start gap-4'>
        <div className='flex-shrink-0 w-14 h-14 rounded-full bg-success/10 flex items-center justify-center'>
          <svg
            className='w-8 h-8 text-success'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
            strokeWidth={1.5}
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              d='M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z'
            />
          </svg>
        </div>
        <div className='flex-1'>
          <h3 className='font-bold text-foreground text-lg mb-1'>
            30-Day Satisfaction Guarantee
          </h3>
          <p className='text-success/80  text-sm mb-3'>
            We stand behind every product we sell. If you&apos;re not completely
            satisfied with your purchase, contact us within 30 days for a
            hassle-free return or exchange.
          </p>
          <ul className='space-y-1.5 text-sm text-success/80 '>
            <li className='flex items-center gap-2'>
              <svg
                className='w-4 h-4 flex-shrink-0'
                fill='currentColor'
                viewBox='0 0 20 20'
              >
                <path
                  fillRule='evenodd'
                  d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                  clipRule='evenodd'
                />
              </svg>
              Easy returns, credits, and exchanges
            </li>
            <li className='flex items-center gap-2'>
              <svg
                className='w-4 h-4 flex-shrink-0'
                fill='currentColor'
                viewBox='0 0 20 20'
              >
                <path
                  fillRule='evenodd'
                  d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                  clipRule='evenodd'
                />
              </svg>
              Defective items replaced free
            </li>
            <li className='flex items-center gap-2'>
              <svg
                className='w-4 h-4 flex-shrink-0'
                fill='currentColor'
                viewBox='0 0 20 20'
              >
                <path
                  fillRule='evenodd'
                  d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                  clipRule='evenodd'
                />
              </svg>
              Fast customer support
            </li>
          </ul>
          <Link
            href='/returns'
            className='inline-flex items-center gap-1 mt-3 text-sm font-medium text-success hover:text-foreground transition-colors'
          >
            View return policy
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
                d='M9 5l7 7-7 7'
              />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
