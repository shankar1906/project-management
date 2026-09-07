# Project Rules & Architecture Guidelines

This document outlines the core principles, security rules, and coding standards for the Teslead Connect Server.

## 1. Multi-Tenancy & Isolation
All data MUST be scoped to an **Organization**. Some data may further be scoped to a **Project**.
- **Guard Pipeline**: Every authenticated route should follow this guard sequence:
  - `JwtAuthGuard`: Authenticates the user.
  - `OrgGuard`: Verifies membership in the organization and attaches `orgId` and `orgRole` to the request.
  - `ProjectGuard` (Optional): Required for project-specific routes. Verifies project access.
  - `RolesGuard` (Optional): Required when using the `@Roles()` decorator.

## 2. Role-Based Access Control (RBAC)
### Organization Roles
- **OWNER**: Full control. Can manage Billing, delete Organizations, and promote/demote other members.
- **ADMIN**: Can manage projects and members, but cannot modify an OWNER.
- **MEMBER**: Standard access to assigned projects.

### Project Roles
- **ADMIN**: Full control over project settings, tasks, and members.
- **MEMBER**: Can create and edit tasks.
- **VIEWER**: Read-only access.

## 3. Security Rules
- **Owner-Only Promotion**: Only an `OWNER` can invite another `OWNER` or update a member's role to `OWNER`.
- **Tenant Leakage**: Always include `orgId` in Prisma `where` clauses, even when searching by a unique `id`.
- **Soft Deletes**: Use the `isDeleted` flag for Organizations, Projects, and Tasks. Never perform a hard delete on these entities.

## 4. Coding Standards
- **Logic in Services**: Controllers are for request/response handling, logging, and calling services. No business logic in Controllers.
- **DTOs & Validation**: All `POST`, `PATCH`, and `PUT` requests MUST use DTOs with `class-validator` decorators. Use `class-transformer` for type conversion (e.g., strings to numbers for pagination).
- **Naming Conventions**:
  - Files: `kebab-case.module.ts`, `kebab-case.service.ts`.
  - Classes: `PascalCase`.
  - Functions/Variables: `camelCase`.
- **Prisma Usage**: Use the `PrismaService` for all database interactions. Use transactions (`$transaction`) for multi-step operations (e.g., creating an org and its default project).

## 5. API Response Standards
- Successful creations should return the created object.
- Use appropriate NestJS exceptions (`ConflictException`, `ForbiddenException`, `NotFoundException`) for errors.
- **Consistency**: When a user is already a member of an organization during an invite, always return the message: `"User already in our organization"`.

## 6. Directory Structure
- `src/modules`: Feature-based modules (e.g., `organizations`, `projects`, `tasks`).
- `src/common`: Shared guards, decorators, filters, and interceptors.
- `prisma/`: Database schema and migrations.
