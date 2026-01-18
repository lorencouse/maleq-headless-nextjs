# Local Database Setup Guide

This guide walks you through setting up a local database clone for faster bulk imports.

## Prerequisites

1. **MySQL installed locally**
   ```bash
   # Check if MySQL is installed
   mysql --version

   # If not installed on macOS:
   brew install mysql
   brew services start mysql
   ```

2. **SSH access to your remote server**

3. **Remote database credentials**

## Setup Steps

### 1. Configure Database Scripts

Edit both scripts with your actual credentials:

**scripts/db-clone-from-remote.sh:**
```bash
REMOTE_HOST="your-server.com"           # Your server domain/IP
REMOTE_USER="your-ssh-username"         # SSH username
REMOTE_DB_NAME="your_wordpress_db"      # Remote DB name
REMOTE_DB_USER="your_db_username"       # Remote DB user
REMOTE_DB_PASS="your_db_password"       # Remote DB password
```

**scripts/db-push-to-remote.sh:**
```bash
# Same values as above
```

### 2. Make Scripts Executable

```bash
chmod +x scripts/db-clone-from-remote.sh
chmod +x scripts/db-push-to-remote.sh
```

### 3. Clone Database from Remote

```bash
./scripts/db-clone-from-remote.sh
```

This will:
- Export remote database via SSH
- Create local database named `maleq_local`
- Import data to local MySQL
- Update WordPress URLs to localhost

### 4. Update Environment Variables

Create `.env.local` for local database work:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your values.

### 5. Run Your Imports Locally

Now your import scripts will run against the local database (much faster!):

```bash
# Import all products without images (very fast locally)
bun scripts/import-products.ts --skip-images

# Or with a limit for testing
bun scripts/import-products.ts --skip-images --limit 100
```

### 6. Push Changes Back to Remote

When your imports are complete:

```bash
./scripts/db-push-to-remote.sh
```

This will:
- Backup remote database first (safety!)
- Export local database
- Update URLs back to production
- Upload to remote server

## Workflow Summary

```
┌─────────────────┐
│ Remote Database │
└────────┬────────┘
         │ 1. Clone
         ▼
┌─────────────────┐
│ Local Database  │ ← 2. Run imports here (FAST!)
└────────┬────────┘
         │ 3. Push
         ▼
┌─────────────────┐
│ Remote Database │
└─────────────────┘
```

## Tips

1. **Always clone first** - Start with fresh remote data
2. **Test with limits** - Use `--limit 10` to test before full import
3. **Backup before push** - The push script auto-backs up, but be careful
4. **Images later** - Skip images during bulk import, add them after with `scripts/import-images.ts`

## Troubleshooting

### Can't connect to MySQL
```bash
# Start MySQL service
brew services start mysql

# Or manually
mysql.server start
```

### SSH connection fails
```bash
# Test SSH connection
ssh your-user@your-server.com

# If using SSH key
ssh -i ~/.ssh/your-key your-user@your-server.com
```

### Permission denied on scripts
```bash
chmod +x scripts/db-clone-from-remote.sh
chmod +x scripts/db-push-to-remote.sh
```

### Want to see what changed?
```bash
# Compare local vs remote
# (after clone, before push)
mysqldump -u root maleq_local | diff - backups/remote-backup-[timestamp].sql
```

## Safety Notes

⚠️ **The push script OVERWRITES the remote database**
- It creates a backup first, but be careful
- Test thoroughly with local database before pushing
- Consider pushing during off-peak hours

## Alternative: Test Push to Staging First

If you have a staging server, update `db-push-to-remote.sh` to push there first:

```bash
REMOTE_HOST="staging.your-site.com"
```

Then after testing, push to production.
