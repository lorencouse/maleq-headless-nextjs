// Test database connection
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testConnection() {
  try {
    console.log('Testing database connection...');

    // Test connection
    await prisma.$connect();
    console.log('✅ Database connection successful!');

    // Check tables
    const manufacturerCount = await prisma.manufacturer.count();
    const productTypeCount = await prisma.productType.count();
    const productCount = await prisma.product.count();

    console.log('\n📊 Current database state:');
    console.log(`   Manufacturers: ${manufacturerCount}`);
    console.log(`   Product Types: ${productTypeCount}`);
    console.log(`   Products: ${productCount}`);

    if (productCount === 0) {
      console.log('\n⚠️  No products found. Run initial sync:');
      console.log('   1. Start dev server: bun dev');
      console.log('   2. Run sync: curl -X POST http://localhost:3000/api/admin/sync/full');
    } else {
      console.log('\n✅ Database is ready! Products are synced.');
    }

  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
