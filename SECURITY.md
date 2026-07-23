# Security policy

## Supported version

Security fixes are made on the latest revision of the `main` branch.

## Reporting a vulnerability

Please report vulnerabilities privately through this repository's
**Security** tab using **Report a vulnerability**. Do not open a public issue
for an unpatched vulnerability.

Reports should include the affected version, impact, reproduction steps, and a
minimal synthetic example. Do not attach real AI histories, database files,
screenshots, credentials, or other personal data.

## Security boundary

AI Log Explorer is designed for one trusted user on a local Mac:

- The development and production scripts bind to loopback.
- Mutation endpoints require a local same-origin request.
- Imported histories are read locally and indexed into a gitignored SQLite
  database.
- The application does not send indexed content to analytics, cloud storage,
  hosted models, or other remote services.

The app is not designed to be deployed as a public or remotely accessible web
service. Publishing the source code does not make such a deployment safe.
