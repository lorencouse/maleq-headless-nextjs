import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { checkRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { extractAuthToken } from '@/lib/api/auth-token';

const WOOCOMMERCE_URL = process.env.WOOCOMMERCE_URL || process.env.NEXT_PUBLIC_WORDPRESS_API_URL?.replace('/graphql', '');

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB
const TARGET_SIZE = 650;
const WEBP_QUALITY = 90;

function getUploadRateLimitKey(request: NextRequest): string {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const userAgent = (request.headers.get('user-agent') || 'na').slice(0, 64);
  return `avatar-upload:${ip}:${userAgent}`;
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = checkRateLimit(getUploadRateLimitKey(request), RATE_LIMITS.form);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId) || parsedUserId <= 0) {
      return NextResponse.json(
        { error: 'Invalid user ID' },
        { status: 400 }
      );
    }

    const tokenData = extractAuthToken(request);
    if (!tokenData) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (tokenData.userId !== parsedUserId) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.' },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Convert file to buffer for processing
    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Process image with sharp: resize to 650x650 and convert to WebP
    const processedBuffer = await sharp(inputBuffer)
      .resize(TARGET_SIZE, TARGET_SIZE, {
        fit: 'cover',
        position: 'center',
      })
      .webp({
        quality: WEBP_QUALITY,
        effort: 6,
      })
      .toBuffer();

    // Create a new File object with the processed WebP image
    const uint8Array = new Uint8Array(processedBuffer);
    const processedBlob = new Blob([uint8Array], { type: 'image/webp' });
    const processedFile = new File(
      [processedBlob],
      `avatar-${userId}.webp`,
      { type: 'image/webp' }
    );

    // Forward auth token and processed image to WordPress custom endpoint
    const wpFormData = new FormData();
    wpFormData.append('file', processedFile);
    wpFormData.append('user_id', String(parsedUserId));

    const response = await fetch(`${WOOCOMMERCE_URL}/wp-json/maleq/v1/upload-avatar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.rawToken}`,
      },
      body: wpFormData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to upload avatar');
    }

    return NextResponse.json({
      success: true,
      avatarUrl: data.avatar_url,
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload avatar' },
      { status: 500 }
    );
  }
}
