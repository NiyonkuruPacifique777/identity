# Identity API

Node.js and Express API for the React app in `~/ID`. It uses MySQL for accounts,
profiles, and refresh-token sessions. Authentication uses short-lived JWT access
tokens and rotating JWT refresh tokens in `httpOnly` cookies.

## Setup

1. Install MySQL and create a database and user with permission to create tables.
2. Copy `.env.example` to `.env`. Set the MySQL credentials and replace both JWT
   secrets with independent random values of at least 32 characters.
3. Install packages and initialize the schema:

   ```sh
   npm install
   npm run db:setup
   npm run dev
   ```

The API listens on `http://localhost:4000` by default. Configure the React app's
`VITE_API_BASE_URL` to the API's `/api` URL.

## Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service health |
| POST | `/api/auth/register` | Create an account and initial private profile |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/refresh` | Rotate the refresh token and issue a new access token |
| POST | `/api/auth/logout` | Revoke the current refresh token |
| GET | `/api/auth/me` | Current account |
| PUT | `/api/auth/account` | Update account email (current password required) |
| PUT | `/api/auth/password` | Change account password (current password required) |
| DELETE | `/api/auth/account` | Permanently delete account and saved data |
| GET/PUT | `/api/profiles/me` | Read or update the signed-in user's profile |
| POST | `/api/profiles/me/publish` | Publish a snapshot of the signed-in user's profile |
| POST | `/api/profiles/me/unpublish` | Remove the public snapshot |
| GET | `/api/profiles/:slug` | Read a published profile only |
| GET/POST | `/api/resumes` | List or create resumes for the signed-in user |
| GET/PUT/DELETE | `/api/resumes/:id` | Read, update, or delete an owned resume |

Profile edits require an access token and are scoped to the authenticated user.
Edits save as drafts; only the explicit publish action replaces the public
snapshot. Unpublishing removes that snapshot. Public profile responses do not
include account IDs or password data. Contact fields become public when the
owner publishes the profile. Profile photos are stored as validated JPEG, PNG,
or WebP data URLs (up to 1 MB) and are included in the published profile
snapshot.
Resumes store personal details, experience, education, skill and language
levels, plus one of 20 templates and a custom hex color. New resumes are
prefilled from the user's profile.

Run `npm test` for backend validation tests. When MySQL credentials are present
in `.env`, the test suite also creates a temporary account and exercises the
database-backed profile and resume save, retrieval, publish, and delete flows,
cleaning up the test account afterward.
