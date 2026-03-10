# Invoice Management - Backend

## Tech Stack
- **Node.js** + **Express** — REST API
- **Prisma** — ORM for database access
- **PostgreSQL** — Primary database
- **Nodemailer** — Email sending (invoice emails to customers)
- **JWT** — Authentication
- **bcryptjs** — Password hashing

## Folder Structure

```
backend/
├── prisma/
│   └── schema.prisma       # Database models
├── src/
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── customer.controller.js
│   │   ├── product.controller.js
│   │   └── invoice.controller.js
│   ├── lib/
│   │   ├── prisma.js       # Prisma client singleton
│   │   └── mailer.js       # Nodemailer + email templates
│   ├── middleware/
│   │   ├── auth.middleware.js   # JWT protect()
│   │   ├── error.middleware.js  # Global error handler
│   │   └── notFound.middleware.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── customer.routes.js
│   │   ├── product.routes.js
│   │   └── invoice.routes.js
│   └── index.js            # App entry point
├── .env                    # Environment variables
├── .env.example            # Template
└── package.json
```

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Get current user |
| PATCH | `/api/auth/profile` | Update business profile |

### Customers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/customers` | List all customers |
| GET | `/api/customers/:id` | Get one customer |
| POST | `/api/customers` | Create customer |
| PATCH | `/api/customers/:id` | Update customer |
| DELETE | `/api/customers/:id` | Delete customer |

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List all products |
| GET | `/api/products/:id` | Get one product |
| POST | `/api/products` | Create product |
| PATCH | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |

### Invoices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/invoices` | List all invoices (filter by `?status=`) |
| GET | `/api/invoices/:id` | Get one invoice |
| POST | `/api/invoices` | Create invoice |
| PATCH | `/api/invoices/:id/status` | Update status (PAID, OVERDUE, etc.) |
| POST | `/api/invoices/:id/send` | Send invoice email to customer |
| DELETE | `/api/invoices/:id` | Delete invoice |
