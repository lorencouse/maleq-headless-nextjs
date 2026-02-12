import Link from 'next/link';
import Image from 'next/image';
import NewsletterSignup from '@/components/newsletter/NewsletterSignup';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className='bg-card border-t border-border text-muted-foreground transition-colors' role="contentinfo" aria-label="Site footer">
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12'>
        <div className='grid grid-cols-1 md:grid-cols-4 gap-8'>
          {/* About */}
          <div>
            <h3 className='text-foreground text-lg font-semibold mb-4'>
              Male Q
            </h3>
            <p className='text-sm'>
              Your trusted online store for quality products and engaging
              content.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className='text-foreground text-sm font-semibold mb-4'>
              Quick Links
            </h4>
            <ul className='space-y-1'>
              <li>
                <Link
                  href='/shop'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  Shop
                </Link>
              </li>
              <li>
                <Link
                  href='/guides'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  Guides
                </Link>
              </li>
              <li>
                <Link
                  href='/about'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  About Us
                </Link>
              </li>
              <li>
                <Link
                  href='/contact'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Customer Service */}
          <div>
            <h4 className='text-foreground text-sm font-semibold mb-4'>
              Customer Service
            </h4>
            <ul className='space-y-1'>
              <li>
                <Link
                  href='/shipping'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  Shipping Info
                </Link>
              </li>
              <li>
                <Link
                  href='/returns'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  Returns
                </Link>
              </li>
              <li>
                <Link
                  href='/faq'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  FAQ
                </Link>
              </li>
              <li>
                <Link
                  href='/privacy'
                  className='inline-block py-2 text-sm hover:text-primary transition-colors'
                >
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <NewsletterSignup
              source="footer"
              variant="inline"
              showTitle
              showDescription
              title="Newsletter"
              description="Subscribe to get updates on new products and blog posts."
            />
          </div>
        </div>

        {/* Bottom Bar */}
        <div className='flex justify-center items-center gap-3 border-t border-border mt-8 pt-8 text-sm text-center'>
          <Image
            src='/images/MQ-logo.png'
            alt='Male Q'
            width={40}
            height={40}
            className='inline-block'
          />
          <p>&copy; {currentYear} Male Q. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
