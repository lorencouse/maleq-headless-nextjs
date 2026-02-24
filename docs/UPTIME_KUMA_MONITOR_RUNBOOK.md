# Uptime Kuma Monitor Runbook (Male Q)

Last updated: 2026-02-24

Use this to configure the remaining monitors in Uptime Kuma.

## 1) `panel.maleq.com` (CloudPanel login)

- Type: `HTTP(s)`
- Name: `panel.maleq.com login gate`
- URL: `https://panel.maleq.com/login`
- Method: `GET`
- Expected status codes: `401`
- Interval: `60s`
- Retry: `2`
- Timeout: `15s`

Reason: this endpoint is intentionally auth-gated; `401` is healthy.

## 2) `status.maleq.com` (status endpoint behind auth)

- Type: `HTTP(s)`
- Name: `status.maleq.com auth gate`
- URL: `https://status.maleq.com/`
- Method: `GET`
- Expected status codes: `401`
- Interval: `60s`
- Retry: `2`
- Timeout: `15s`

Reason: this endpoint is intentionally auth-gated; `401` is healthy.

## 3) `wp.maleq.com/graphql` (GraphQL health)

- Type: `HTTP(s) - Keyword`
- Name: `wp.maleq.com GraphQL POST`
- URL: `https://wp.maleq.com/graphql`
- Method: `POST`
- Request headers:
  - `Content-Type: application/json`
- Request body:
  - `{"query":"{__typename}"}`
- Expected status codes: `200`
- Keyword (contains): `RootQuery`
- Interval: `60s`
- Retry: `2`
- Timeout: `20s`

Reason: GraphQL health must be tested with POST + body, not plain GET.

## 4) Optional Verification Commands

```bash
# panel/status should return 401
curl -I https://panel.maleq.com/login
curl -I https://status.maleq.com/

# GraphQL should return 200 and include RootQuery
curl -sS -H 'content-type: application/json' \
  --data '{"query":"{__typename}"}' \
  https://wp.maleq.com/graphql
```
