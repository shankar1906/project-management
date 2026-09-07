# 🚀 NestJS SaaS Project Management Backend

A **production-ready** NestJS backend for a multi-tenant project management system (similar to Jira/Zoho Projects) with Auth0 authentication, granular RBAC, and data-driven workflows.

---

## ✨ Features

### 🔐 Authentication & Authorization
- **Auth0 Integration** - Authentication handled by Auth0 (login, signup, social, MFA)
- **Backend-Issued JWT** - Internal tokens containing `userId` + `orgId` for tenant isolation
- **Multi-Tenant Architecture** - Strict organization-based data isolation
- **Dual-Level RBAC** - Organization roles (OWNER, ADMIN, MEMBER) + Project roles (ADMIN, MEMBER, VIEWER)
- **Security Pipeline** - 4-layer guard system (JWT → Org → Project → Roles)

### 📊 Project Management
- **Organizations (Tenants)** - Multi-tenant with complete data isolation
- **Projects** - Tenant-scoped projects with member management
- **Tasks** - Full task management with subtasks, assignees, tags, priorities
- **Data-Driven Workflow** - Customizable stages and statuses (Kanban-style)
- **Status History** - Complete audit trail of task status changes

### 🏗️ Architecture
- **Clean Architecture** - Modular design with clear separation of concerns
- **Prisma ORM** - Type-safe database access with auto-generated types
- **Global Validation** - DTO validation on all endpoints
- **Structured Logging** - Production-ready logging with Pino
- **Error Handling** - Centralized exception filter with Prisma error mapping
- **Mobile-Ready** - Stateless JWT authentication works with any client

---

## 🎯 Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Auth0 Account (free tier works)
- pnpm (or npm/yarn)

### 1. Clone and Install

```bash
cd project-management-server
pnpm install
```

### 2. Setup Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/project_management?schema=public"

# JWT (Backend tokens)
JWT_SECRET="your-secret-key-change-in-production"
JWT_EXPIRES_IN="7d"

# Auth0
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_AUDIENCE="https://your-api-identifier"
AUTH0_CLIENT_ID="your-client-id"
AUTH0_CLIENT_SECRET="your-client-secret"

# CORS
CORS_ORIGIN="http://localhost:3001,http://localhost:3000"

# App
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

### 3. Setup Database

```bash
# Generate Prisma Client
pnpm prisma:generate

# Run migrations
pnpm prisma:migrate

# (Optional) Open Prisma Studio to view data
pnpm prisma:studio
```

### 4. Start Development Server

```bash
pnpm start:dev
```

Server runs on: **http://localhost:3000**

---

## 🔧 Auth0 Setup

### 1. Create Auth0 Application

1. Go to [Auth0 Dashboard](https://manage.auth0.com/)
2. Create new **Application** → **Single Page Application** (or Native for mobile)
3. Note down:
   - **Domain** (e.g., `your-tenant.auth0.com`)
   - **Client ID**
   - **Client Secret**

### 2. Create Auth0 API

1. Go to **APIs** → **Create API**
2. Set **Name**: `Project Management API`
3. Set **Identifier**: `https://api.yourapp.com` (this is your `AUTH0_AUDIENCE`)
4. Save and note the identifier

### 3. Configure Auth0 Application

**Allowed Callback URLs:**
```
http://localhost:3001/callback,
https://yourapp.com/callback
```

**Allowed Logout URLs:**
```
http://localhost:3001,
https://yourapp.com
```

**Allowed Web Origins:**
```
http://localhost:3001,
https://yourapp.com
```

---

## 🌊 Authentication Flow

```
┌─────────────┐
│   Frontend  │
└──────┬──────┘
       │
       │ 1. User logs in with Auth0
       ▼
┌─────────────┐
│    Auth0    │
└──────┬──────┘
       │
       │ 2. Returns Auth0 ID token
       ▼
┌─────────────┐
│   Frontend  │
└──────┬──────┘
       │
       │ 3. POST /auth/login { auth0Token }
       ▼
┌────────────────────┐
│  NestJS Backend    │
│  ┌──────────────┐  │
│  │ Verify Auth0 │  │
│  └──────┬───────┘  │
│         │          │
│  ┌──────▼───────┐  │
│  │ Create/Find  │  │
│  │    User      │  │
│  └──────┬───────┘  │
│         │          │
│  ┌──────▼───────┐  │
│  │ Issue JWT    │  │
│  │{userId,orgId}│  │
│  └──────────────┘  │
└────────┬───────────┘
         │
         │ 4. Returns { accessToken, user, org }
         ▼
┌─────────────┐
│   Frontend  │
│ Stores JWT  │
└─────────────┘
```

**See [FLOW.md](./FLOW.md) for complete details.**

---

## 📡 API Endpoints

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/login` | Exchange Auth0 token for backend JWT | No |
| POST | `/auth/switch-org` | Switch to different organization | Yes |

### Organizations

| Method | Endpoint | Description | Auth Required | Role Required |
|--------|----------|-------------|---------------|---------------|
| POST | `/organizations` | Create new organization | Yes | - |
| GET | `/organizations` | List user's organizations | Yes | - |

### Projects

| Method | Endpoint | Description | Auth Required | Role Required |
|--------|----------|-------------|---------------|---------------|
| POST | `/projects` | Create project | Yes | ADMIN, OWNER |
| GET | `/projects` | List user's projects | Yes | - |
| GET | `/projects/:id` | Get project details | Yes | - |

### Workflow

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/projects/:projectId/workflow` | Get project workflow | Yes |
| POST | `/projects/:projectId/stages` | Create workflow stage | Yes |
| POST | `/projects/:projectId/statuses` | Create workflow status | Yes |

### Tasks

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/projects/:projectId/tasks` | Create task | Yes |
| GET | `/projects/:projectId/tasks` | List project tasks | Yes |
| PATCH | `/tasks/:id/status` | Update task status | Yes |

---

## 🛡️ Security Architecture

### Guard Pipeline

Every protected endpoint passes through:

```typescript
@UseGuards(JwtAuthGuard, OrgGuard, ProjectGuard?, RolesGuard?)
```

1. **JwtAuthGuard** - Validates JWT, extracts `userId` + `orgId`
2. **OrgGuard** - Verifies user belongs to organization, loads role
3. **ProjectGuard** - (Optional) Verifies project access
4. **RolesGuard** - (Optional) Checks organization role requirements

### Tenant Isolation

**Every database query is tenant-scoped:**

```typescript
// ✅ CORRECT
await prisma.project.findMany({
  where: { orgId: request.orgId },  // From OrgGuard
});

// ❌ WRONG - Will fail code review
await prisma.project.findMany();
```

---

## 🗄️ Database Schema

### Core Entities

```
Organization (Tenant)
  ├── OrgMember (User ↔ Organization + Role)
  ├── Project
  │    ├── ProjectMember (User ↔ Project + Role)
  │    ├── TaskStage (Workflow columns)
  │    │    └── TaskStatus (Workflow cards)
  │    └── Task
  │         ├── TaskAssignee (User ↔ Task)
  │         └── TaskTag (Tag ↔ Task)
  └── Tag

User
  ├── OrgMember
  ├── ProjectMember
  ├── TaskAssignee
  └── TaskStatusHistory
```

**Key Design Decisions:**

- **No enums for statuses** - Data-driven workflow (like Jira)
- **No password field** - Auth0 handles authentication
- **Join tables for all many-to-many** - Proper normalization
- **Soft deletes** - `isDeleted` flags instead of hard deletes
- **Self-referencing tasks** - Subtasks via `parentId`

**See [CHANGES.md](./CHANGES.md) for detailed schema explanation.**

---

## 📦 Project Structure

```
src/
├── main.ts                      # Bootstrap
├── app.module.ts                # Root module
│
├── config/                      # Configuration
│   ├── app.config.ts
│   ├── auth0.config.ts
│   └── database.config.ts
│
├── prisma/                      # Database
│   ├── prisma.service.ts
│   └── prisma.module.ts
│
├── common/                      # Shared utilities
│   ├── decorators/              # @Roles(), @OrgId(), @UserId()
│   ├── guards/                  # Security guards
│   ├── filters/                 # Exception filters
│   └── interceptors/            # Logging
│
└── modules/                     # Business modules
    ├── auth/                    # Auth0 + JWT
    ├── organizations/           # Tenant management
    ├── projects/                # Project CRUD
    ├── tasks/                   # Task management
    └── workflow/                # Custom workflows
```

---

## 🔨 Development

### Available Scripts

```bash
# Development
pnpm start:dev          # Start with hot reload
pnpm start:debug        # Start with debugger

# Production
pnpm build              # Build for production
pnpm start:prod         # Run production build

# Database
pnpm prisma:generate    # Generate Prisma Client
pnpm prisma:migrate     # Create and run migration
pnpm prisma:deploy      # Deploy migrations (production)
pnpm prisma:studio      # Open Prisma Studio GUI

# Code Quality
pnpm lint               # Lint code
pnpm format             # Format code

# Testing
pnpm test               # Run tests
pnpm test:watch         # Run tests in watch mode
pnpm test:cov           # Coverage report
```

### Database Migrations

**Create migration:**
```bash
pnpm prisma:migrate
```

**Deploy to production:**
```bash
pnpm prisma:deploy
```

---

## 🌐 Frontend Integration

### Login Flow

```typescript
// 1. User logs in with Auth0
const auth0Token = await auth0.getAccessToken();

// 2. Exchange for backend JWT
const response = await fetch('http://localhost:3000/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ auth0Token }),
});

const { accessToken, user, organization } = await response.json();

// 3. Store JWT
localStorage.setItem('token', accessToken);

// 4. Use JWT for all requests
fetch('http://localhost:3000/projects', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
  },
});
```

### Organization Switching

```typescript
const response = await fetch('http://localhost:3000/auth/switch-org', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${currentToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ orgId: newOrgId }),
});

const { accessToken } = await response.json();
localStorage.setItem('token', accessToken);  // Replace old token
```

---

## 🚀 Production Deployment

### Environment Variables Checklist

- [ ] `JWT_SECRET` - Generate with `openssl rand -base64 32`
- [ ] `DATABASE_URL` - Use managed PostgreSQL (AWS RDS, Heroku, etc.)
- [ ] `AUTH0_DOMAIN` - Production Auth0 tenant
- [ ] `AUTH0_AUDIENCE` - Production API identifier
- [ ] `NODE_ENV=production`
- [ ] `LOG_LEVEL=warn` or `error`
- [ ] `CORS_ORIGIN` - Production frontend URLs only

### Database

1. **Run migrations before deployment:**
```bash
pnpm prisma:deploy
```

2. **Enable connection pooling** (recommended for serverless)

3. **Set up backups** (automated daily backups)

### Security

- [ ] Enable HTTPS (use reverse proxy like nginx/Caddy)
- [ ] Set up rate limiting
- [ ] Enable Auth0 MFA
- [ ] Rotate JWT secret periodically
- [ ] Monitor logs for suspicious activity
- [ ] Set up database access restrictions (IP whitelist)

---

## 📚 Documentation

- **[FLOW.md](./FLOW.md)** - Complete authentication & authorization flow
- **[CHANGES.md](./CHANGES.md)** - What was updated and why
- **[.env.example](./.env.example)** - Environment variables reference

---

## 🧪 Testing

### Unit Tests

```bash
pnpm test
```

### E2E Tests

```bash
pnpm test:e2e
```

### Manual Testing with Postman/Insomnia

1. Import provided Postman collection (if available)
2. Set environment variables:
   - `baseUrl`: `http://localhost:3000`
   - `authToken`: JWT from `/auth/login`

---

## 🤝 Contributing

### Code Style

- Follow existing patterns
- Use Prettier for formatting (`pnpm format`)
- Lint before committing (`pnpm lint`)

### Adding New Modules

1. Generate module: `nest g module modules/feature`
2. Add to `app.module.ts`
3. Use existing guards for security
4. Update this README

---

## 📝 License

UNLICENSED - Internal Project

---

## 🆘 Troubleshooting

### Database Connection Issues

```bash
# Test connection
pnpm prisma db pull
```

### Auth0 Token Verification Fails

- Check `AUTH0_DOMAIN` in `.env`
- Verify token hasn't expired
- Ensure Auth0 application is active

### CORS Errors

- Add frontend URL to `CORS_ORIGIN` in `.env`
- Restart server after changing env variables

### Prisma Client Not Found

```bash
pnpm prisma:generate
```

---

## 📞 Support

For issues or questions:
1. Check [FLOW.md](./FLOW.md) and [CHANGES.md](./CHANGES.md)
2. Review code comments
3. Check NestJS documentation: https://docs.nestjs.com
4. Check Prisma documentation: https://www.prisma.io/docs

---

**Built with ❤️ using NestJS, Prisma, PostgreSQL, and Auth0**
