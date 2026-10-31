# HTI School Backend

Express/MySQL API for HTI student management, daily and lesson attendance, examinations, results, and the admin dashboard. This repository contains the backend only.

## Run locally

1. Install Node.js (the test suite was verified with Node.js 24).
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and configure the MySQL connection and a strong `JWT_SECRET`.
4. Run `npm start`.

The server uses `PORT` from the environment, defaulting to 5001. It connects to MySQL and performs schema upgrades before accepting requests. Back up an existing database before deployment. Existing accounts and school records require importing the existing database; an empty database does not provide a default administrator account.

## Deployment settings

- Application root: repository root.
- Start command: `npm start` (`node server.js`).
- Build: no compilation is required; install dependencies with npm.
- Set database variables and `JWT_SECRET` using the hosting provider's environment settings. Let the provider supply `PORT` where applicable.
- Publish the API through HTTPS, and configure clients with `https://your-api-domain/api`.
- Uploaded files are stored under `uploads/`. Provision persistent storage and backups before accepting uploads in production.
- Never commit `.env`, database exports, upload contents, keys, or logs.

## API documentation

- [Dashboard API](DASHBOARD_API.md)
- [Attendance API](ATTENDANCE_API.md)
- [Assessment integration](ASSESSMENT-INTEGRATION.md)
- [Annual marks API](ANNUAL_MARKS_API.md)
- OpenAPI UI: `/api-docs`.

## Tests

`npm test` runs the automated tests. `npm run test:attendance:mysql` additionally creates and removes an isolated temporary MySQL database, and requires database creation privileges. Do not run the integration test using restricted production credentials.
