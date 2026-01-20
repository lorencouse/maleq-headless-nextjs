# API Documentation

This document describes the API endpoints available in the Maleq headless e-commerce application.

---

## Base URL

- **Development**: `http://localhost:3000/api`
- **Production**: `https://maleq.com/api`

---

## Authentication Endpoints

### POST /api/auth/register

Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "user": {
    "id": 123,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Email already exists"
}
```

---

### POST /api/auth/login

Authenticate a user.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "rememberMe": true
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": 123,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Error Response (401):**
```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

---

### GET /api/auth/me

Get current authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "user": {
    "id": 123,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "billing": { ... },
    "shipping": { ... }
  }
}
```

---

### POST /api/auth/forgot-password

Request password reset email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "If an account exists, a reset email has been sent"
}
```

---

## Order Endpoints

### POST /api/orders/create

Create a new order.

**Request Body:**
```json
{
  "paymentIntentId": "pi_xxxxx",
  "billing": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "555-0123",
    "address1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postcode": "10001",
    "country": "US"
  },
  "shipping": {
    "firstName": "John",
    "lastName": "Doe",
    "address1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postcode": "10001",
    "country": "US"
  },
  "items": [
    {
      "productId": 456,
      "variationId": 789,
      "quantity": 2
    }
  ],
  "shippingMethod": "flat_rate",
  "couponCode": "SAVE10"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "orderId": 1001,
  "orderNumber": "1001",
  "total": "99.99"
}
```

---

### GET /api/orders

Get orders for authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `perPage` (optional): Items per page (default: 10)

**Response (200 OK):**
```json
{
  "orders": [
    {
      "id": 1001,
      "number": "1001",
      "status": "completed",
      "total": "99.99",
      "dateCreated": "2026-01-19T12:00:00Z",
      "items": [...]
    }
  ],
  "total": 5,
  "page": 1,
  "perPage": 10
}
```

---

## Payment Endpoints

### POST /api/payment/create-intent

Create a Stripe payment intent.

**Request Body:**
```json
{
  "amount": 9999,
  "currency": "usd",
  "metadata": {
    "orderId": "temp_123"
  }
}
```

**Response (200 OK):**
```json
{
  "clientSecret": "pi_xxxxx_secret_xxxxx"
}
```

---

## Product Endpoints

### GET /api/search

Search products.

**Query Parameters:**
- `q` (required): Search query
- `limit` (optional): Max results (default: 10)

**Response (200 OK):**
```json
{
  "products": [
    {
      "id": "123",
      "name": "Product Name",
      "slug": "product-name",
      "price": "$29.99",
      "image": {
        "url": "https://...",
        "altText": "Product"
      }
    }
  ],
  "categories": [
    {
      "id": "456",
      "name": "Category",
      "slug": "category",
      "count": 15
    }
  ]
}
```

---

### GET /api/reviews

Get product reviews.

**Query Parameters:**
- `productId` (required): Product ID
- `page` (optional): Page number (default: 1)
- `perPage` (optional): Items per page (default: 10)

**Response (200 OK):**
```json
{
  "reviews": [
    {
      "id": 1,
      "rating": 5,
      "review": "Great product!",
      "reviewer": "John D.",
      "verified": true,
      "dateCreated": "2026-01-15T10:00:00Z"
    }
  ],
  "total": 25,
  "averageRating": 4.5
}
```

---

### POST /api/reviews

Create a product review.

**Request Body:**
```json
{
  "productId": 123,
  "rating": 5,
  "review": "This is an excellent product!",
  "reviewer": "John Doe",
  "reviewerEmail": "john@example.com"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "review": {
    "id": 456,
    "rating": 5,
    "review": "This is an excellent product!",
    "status": "hold"
  }
}
```

---

## Coupon Endpoints

### POST /api/coupons/validate

Validate a coupon code.

**Request Body:**
```json
{
  "code": "SAVE10",
  "cartTotal": 99.99,
  "productIds": [123, 456]
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "coupon": {
    "code": "SAVE10",
    "discountType": "percent",
    "amount": "10"
  },
  "discountAmount": 9.99,
  "message": "Coupon applied successfully"
}
```

**Error Response (400):**
```json
{
  "valid": false,
  "message": "Coupon has expired"
}
```

---

## Customer Endpoints

### GET /api/customers/[id]

Get customer details.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "id": 123,
  "email": "john@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "billing": {
    "firstName": "John",
    "lastName": "Doe",
    "address1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postcode": "10001",
    "country": "US",
    "phone": "555-0123"
  },
  "shipping": { ... }
}
```

---

### PUT /api/customers/[id]

Update customer details.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "billing": {
    "address1": "456 Oak Ave",
    "city": "Los Angeles",
    "state": "CA",
    "postcode": "90001"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "customer": { ... }
}
```

---

## Newsletter Endpoints

### POST /api/newsletter/subscribe

Subscribe to newsletter.

**Request Body:**
```json
{
  "email": "subscriber@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Successfully subscribed to newsletter"
}
```

---

## Stock Alert Endpoints

### POST /api/stock-alerts/subscribe

Subscribe to stock alerts for a product.

**Request Body:**
```json
{
  "email": "customer@example.com",
  "productId": 123,
  "productName": "Product Name"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "You will be notified when this product is back in stock"
}
```

---

## Contact Endpoints

### POST /api/contact

Submit contact form.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "subject": "Question about order",
  "message": "I have a question about my recent order..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Your message has been sent successfully"
}
```

---

## Error Responses

All endpoints may return these error responses:

### 400 Bad Request
```json
{
  "error": "Invalid request body",
  "details": ["email is required", "password must be at least 8 characters"]
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication required"
}
```

### 403 Forbidden
```json
{
  "error": "You do not have permission to access this resource"
}
```

### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "An unexpected error occurred"
}
```

---

## Rate Limiting

API endpoints are rate limited to prevent abuse:

- **Default**: 100 requests per minute per IP
- **Authentication**: 10 requests per minute per IP
- **Search**: 30 requests per minute per IP

When rate limited, you'll receive a `429 Too Many Requests` response.
