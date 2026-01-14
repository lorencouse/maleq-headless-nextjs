# Server Database Setup Instructions

## Option 1: Using phpMyAdmin (Easiest)

1. **Log into phpMyAdmin** for your `products` database
2. **Click on the "SQL" tab**
3. **Copy the entire contents** of `setup-database.sql`
4. **Paste into the SQL query box**
5. **Click "Go"**
6. **Done!** You should see 6 tables created

## Option 2: Via SSH (If deploying Next.js to server)

### Step 1: SSH into your server
```bash
ssh your-username@staging.maleq.com
```

### Step 2: Navigate to your Next.js project directory
```bash
cd /path/to/your/nextjs/project
```

### Step 3: Create .env file with database credentials
```bash
nano .env
```

Add this line:
```
DATABASE_URL="mysql://maleqdb:Sandcatsma2025**@localhost:3306/products"
```

Save and exit (Ctrl+X, Y, Enter)

### Step 4: Install dependencies (if not already done)
```bash
npm install
```

### Step 5: Run Prisma migration
```bash
npx prisma migrate deploy
```

Or if you prefer to use the dev migration:
```bash
npx prisma migrate dev
```

## Verify Tables Were Created

### Via phpMyAdmin:
- Click on the `products` database in the left sidebar
- You should see 6 tables:
  - Manufacturer
  - Product
  - ProductImage
  - ProductType
  - StockHistory
  - SyncLog

### Via SSH:
```bash
mysql -u maleqdb -p products -e "SHOW TABLES;"
```

You should see all 6 tables listed.

## Next Steps

Once tables are created:
1. Test the Williams Trading API sync
2. Import initial product data
3. Deploy your Next.js application

## Database Access Info

- **Database Name:** products
- **Username:** maleqdb
- **Password:** Sandcatsma2025**
- **Host:** localhost (when on server) or staging.maleq.com (remote)
- **Port:** 3306
