'use client';

import { ReactNode } from 'react';

interface CheckoutLayoutProps {
  formSection: ReactNode;
  summarySection: ReactNode;
}

export default function CheckoutLayout({ formSection, summarySection }: CheckoutLayoutProps) {
  return (
    <div className="lg:grid lg:grid-cols-12 lg:gap-8">
      {/* Form Section - Left side */}
      <div className="lg:col-span-7 xl:col-span-8">
        {formSection}
      </div>

      {/* Summary Section - Right side */}
      <div className="lg:col-span-5 xl:col-span-4 mt-8 lg:mt-0">
        {summarySection}
      </div>
    </div>
  );
}
