# Server Security Hardening

VPS: Hetzner `46.224.227.119` — Ubuntu 24.04 ARM64
Hardened: 2026-02-16

---

## SSH Access

- **User**: `deploy` (root login disabled)
- **Auth**: SSH key only (password auth disabled)
- **Config**: `/etc/ssh/sshd_config.d/hardening.conf`

```
ssh deploy@46.224.227.119
```

Settings applied:
- `PermitRootLogin no`
- `PasswordAuthentication no`
- `MaxAuthTries 6`
- `AllowUsers deploy root`
- `X11Forwarding no`

---

## Firewall (UFW)

Default: deny incoming, allow outgoing.

| Port | Access | Purpose |
|------|--------|---------|
| 22/tcp | Anywhere | SSH |
| 80/tcp | Anywhere | HTTP |
| 443/tcp | Anywhere | HTTPS |
| 8000 | IP-restricted | Coolify dashboard |
| lo (loopback) | Anywhere | Coolify internal (required) |
| 172.16.0.0/12 | Docker bridge | Container networking (required) |
| 10.0.0.0/8 | Docker custom bridge | Coolify network (required) |

Ports 6001, 6002, 8080 (Coolify internal) listen on 0.0.0.0 but are only reachable via loopback and Docker bridge rules above — not exposed to the internet.

> **Important:** Coolify uses a custom Docker bridge network (`10.0.1.0/24`). UFW must whitelist these ranges or Coolify will lose access to localhost.

### Managing Coolify IP access

```bash
# Add a new IP
sudo ufw allow from <IP> to any port 8000 comment 'Coolify - description'

# Remove an IP (use rule number from `sudo ufw status numbered`)
sudo ufw delete <rule_number>

# List current rules
sudo ufw status numbered
```

---

## Fail2ban

**SSH jail is disabled.** With key-only authentication, brute-force protection is unnecessary and was causing repeated lockouts. fail2ban remains installed but inactive — it can be re-enabled for future password-based services if needed.

- **Config**: `/etc/fail2ban/jail.local`
- **SSH jail**: `enabled = false`

```bash
# Check status
sudo fail2ban-client status
```

---

## Automatic Updates

`unattended-upgrades` is installed and enabled for security patches.

---

## Maintenance Commands

```bash
# Reboot (needed after kernel updates)
sudo reboot

# Check listening ports
ss -tlnp

# Check firewall
sudo ufw status verbose

# Check fail2ban
sudo fail2ban-client status

# Check Docker containers
docker compose ps

# View logs
docker compose logs -f web
```
