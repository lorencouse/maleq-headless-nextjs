import Link from 'next/link';
import Image from 'next/image';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className='bg-gray-900 text-gray-300'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12'>
        <div className='grid grid-cols-1 md:grid-cols-4 gap-8'>
          {/* About */}
          <div>
            <h3 className='text-white text-lg font-semibold mb-4'>Maleq</h3>
            <p className='text-sm'>
              Your trusted online store for quality products and engaging
              content.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className='text-white text-sm font-semibold mb-4'>
              Quick Links
            </h4>
            <ul className='space-y-2'>
              <li>
                <Link
                  href='/shop'
                  className='text-sm hover:text-white transition-colors'
                >
                  Shop
                </Link>
              </li>
              <li>
                <Link
                  href='/blog'
                  className='text-sm hover:text-white transition-colors'
                >
                  Blog
                </Link>
              </li>
              <li>
                <Link
                  href='/about'
                  className='text-sm hover:text-white transition-colors'
                >
                  About Us
                </Link>
              </li>
              <li>
                <Link
                  href='/contact'
                  className='text-sm hover:text-white transition-colors'
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Customer Service */}
          <div>
            <h4 className='text-white text-sm font-semibold mb-4'>
              Customer Service
            </h4>
            <ul className='space-y-2'>
              <li>
                <Link
                  href='/shipping'
                  className='text-sm hover:text-white transition-colors'
                >
                  Shipping Info
                </Link>
              </li>
              <li>
                <Link
                  href='/returns'
                  className='text-sm hover:text-white transition-colors'
                >
                  Returns
                </Link>
              </li>
              <li>
                <Link
                  href='/faq'
                  className='text-sm hover:text-white transition-colors'
                >
                  FAQ
                </Link>
              </li>
              <li>
                <Link
                  href='/privacy'
                  className='text-sm hover:text-white transition-colors'
                >
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <h4 className='text-white text-sm font-semibold mb-4'>
              Newsletter
            </h4>
            <p className='text-sm mb-4'>
              Subscribe to get updates on new products and blog posts.
            </p>
            <form className='flex'>
              <input
                type='email'
                placeholder='Your email'
                className='flex-1 px-3 py-2 bg-gray-800 text-white text-sm rounded-l focus:outline-none focus:ring-2 focus:ring-blue-600'
              />
              <button className='px-4 py-2 bg-blue-600 text-white text-sm rounded-r hover:bg-blue-700 transition-colors'>
                Subscribe
              </button>
            </form>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className='flex justify-center items-center content-center border-t border-gray-800 mt-8 pt-8 text-sm text-center'>
          <Image
            src='/images/MQ-logo.png'
            alt='Maleq'
            width={40}
            height={40}
            className='inline-block'
          />
          <p>&copy; {currentYear} Maleq. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
