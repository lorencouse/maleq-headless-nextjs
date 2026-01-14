# Enable Remote MySQL Access on CloudPanel

## Quick Setup via SSH

Since you have SSH access to your CloudPanel server, here's the fastest way to enable remote MySQL access:

### Step 1: Get Your Local IP Address

First, find your current IP address:
- Visit: https://whatismyipaddress.com
- Copy your IPv4 address (e.g., `123.45.67.89`)

### Step 2: SSH into Your Server

```bash
ssh root@159.69.220.162
```

### Step 3: Allow Remote MySQL Access

Once connected, run these commands:

```bash
# Edit MySQL configuration to allow remote connections
nano /etc/mysql/mysql.conf.d/mysqld.cnf
```

Find the line with `bind-address` and change it to:
```
bind-address = 0.0.0.0
```

Or if you want to be more secure, bind to specific IP:
```
bind-address = 159.69.220.162
```

Save and exit (Ctrl+X, Y, Enter)

### Step 4: Restart MySQL

```bash
systemctl restart mysql
```

### Step 5: Grant Remote Access to Your Database User

```bash
mysql -u root -p
```

Then in MySQL console:
```sql
-- Allow maleqdb to connect from your IP (replace with your actual IP)
GRANT ALL PRIVILEGES ON products.* TO 'maleqdb'@'123.45.67.89' IDENTIFIED BY 'Sandcatsma2025**';

-- Or allow from any IP (less secure, but easier for development)
GRANT ALL PRIVILEGES ON products.* TO 'maleqdb'@'%' IDENTIFIED BY 'Sandcatsma2025**';

FLUSH PRIVILEGES;
EXIT;
```

### Step 6: Configure Firewall (if needed)

```bash
# Allow MySQL port through firewall
ufw allow 3306/tcp

# Or allow only from your IP
ufw allow from 123.45.67.89 to any port 3306
```

### Step 7: Test Connection from Your Mac

Back on your local machine:

```bash
# Test if you can connect
mysql -h 159.69.220.162 -u maleqdb -p products
# Enter password: Sandcatsma2025**
```

If successful, you should see the MySQL prompt!

## Alternative: Use IP Address in .env.local

Instead of `staging.maleq.com`, you can also use the IP directly:

```env
DATABASE_URL="mysql://maleqdb:Sandcatsma2025**@159.69.220.162:3306/products"
```

## Security Notes

**For Production:**
- Only allow specific IP addresses, not `%`
- Use SSH tunneling instead of direct remote access
- Keep firewall rules tight

**For Development:**
- Allowing `%` is okay temporarily
- Remember to restrict it before going live
- Use VPN if possible for added security

## SSH Tunnel Alternative (Most Secure)

Instead of opening MySQL to the internet, you can use SSH tunneling:

```bash
# On your Mac, create SSH tunnel
ssh -L 3306:localhost:3306 root@159.69.220.162 -N
```

Keep this terminal open, then in your `.env.local`:
```env
DATABASE_URL="mysql://maleqdb:Sandcatsma2025**@localhost:3306/products"
```

This tunnels the connection through SSH (much more secure).

## After Remote Access is Enabled

Once you've enabled remote access, try the test sync again:

1. Go to http://localhost:3001/admin/sync
2. Click "🧪 Test Sync - 10 Products Only"
3. Check results!

## Troubleshooting

**Connection refused:**
- Check MySQL is running: `systemctl status mysql`
- Check firewall: `ufw status`
- Verify bind-address is set correctly

**Access denied:**
- Double-check username/password
- Verify GRANT permissions were applied
- Run `FLUSH PRIVILEGES;` again

**Timeout:**
- Firewall blocking port 3306
- CloudPanel firewall settings
- ISP blocking outgoing MySQL connections
