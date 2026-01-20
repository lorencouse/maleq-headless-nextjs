import { NextRequest, NextResponse } from 'next/server';
import { isValidEmail } from '@/lib/utils/stock-alerts';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productId, productName, email } = body;

    // Validate required fields
    if (!productId) {
      return NextResponse.json(
        { success: false, message: 'Product ID is required' },
        { status: 400 }
      );
    }

    if (!productName) {
      return NextResponse.json(
        { success: false, message: 'Product name is required' },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { success: false, message: 'Email is required' },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { success: false, message: 'Please enter a valid email address' },
        { status: 400 }
      );
    }

    // In production, integrate with your email service or database:
    // - Store subscription in database
    // - Set up webhook to trigger when product comes back in stock
    // - Send email notification when stock is restored

    // Example database integration (commented out):
    // await db.stockAlerts.create({
    //   data: {
    //     productId,
    //     productName,
    //     email,
    //     subscribedAt: new Date(),
    //     notified: false,
    //   },
    // });

    // For now, log the subscription
    console.log(
      `Stock alert subscription: ${email} for "${productName}" (${productId}) at ${new Date().toISOString()}`
    );

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return NextResponse.json({
      success: true,
      message: "You'll be notified when this product is back in stock!",
    });
  } catch (error) {
    console.error('Stock alert subscription error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to subscribe. Please try again.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const email = searchParams.get('email');

    if (!productId || !email) {
      return NextResponse.json(
        { success: false, message: 'Product ID and email are required' },
        { status: 400 }
      );
    }

    // In production, remove from database
    // await db.stockAlerts.delete({
    //   where: { productId_email: { productId, email } },
    // });

    console.log(`Stock alert unsubscribed: ${email} for product ${productId}`);

    return NextResponse.json({
      success: true,
      message: 'Stock alert removed',
    });
  } catch (error) {
    console.error('Stock alert unsubscribe error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to unsubscribe. Please try again.' },
      { status: 500 }
    );
  }
}
