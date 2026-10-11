# Blood Bridge

## Project structure

```text
frontend/          Browser pages, styles, and client-side JavaScript
  css/             Shared stylesheets
  js/              Client-side scripts
backend/           Express API
  config/          Service configuration
  controllers/     API request handlers
  routes/          API route definitions
  legacy/          Previous root-level backend copies
database/          Database schema
```

## Run locally

```bash
npm start
```

The Express server serves the frontend and API from `http://localhost:3000`.

Before using signup or database-backed pages, run `database/schema.sql` once in
the Supabase SQL Editor. It creates the signup profile trigger and the required
row-level security policies.
