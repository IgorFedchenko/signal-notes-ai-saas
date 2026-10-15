# Signal Notes

Reference implementation for a public freelance portfolio. MIT. Synthetic data only.
Keep the GitHub repository private until Igor explicitly approves publication.
Use only free infrastructure and Stripe test mode. An LLM API key or paid use needs
Igor's approval; he provisions secrets on the host. Never print or commit secrets.

On Studio, run builds, Docker operations and browser E2E through
`~/.local/bin/studio-heavy-run -- <command>`.
`npm run demo` is the clean-clone local entry point (Docker required).
Checks: `npm run check`, `npm run test:db`, `npm run build`, `npm run test:e2e`.
The database tests use a dedicated local Supabase stack; never point them at hosted data.
Keep server credentials in modules importing `server-only`. User data uses the user's JWT
and RLS; elevated access is restricted to billing reconciliation and metering RPCs.
