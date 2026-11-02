# PluginForge security notes

## How prompts are charged
1. The server reads the Discord session (cookie, checked against a server-side session record).
2. It validates the request (`prompt` is one string, 1 to 4000 characters; the project must belong to the caller).
3. `reserveUsage` runs one Redis Lua script that checks the allowance and spends it in the same step. Two requests can never spend the same prompt.
4. The generation provider (`generate()` in `api/_projects.js`) is called. Today it returns the "not connected" reply.
5. The project change is saved with a compare-and-set script. If the provider or the save fails, the prompt is refunded.
The browser never sends a conversation history that matters: it sends only the new prompt, and the server appends both the prompt and the reply. Saved history cannot be edited (`PUT` only renames). Retried requests are charged each time (no idempotency key yet).

Plans: Stone 5 prompts, rolling 24 hours from the first prompt after a refill. Iron 250 and Diamond 1000 per calendar month (UTC). Admin-granted prompts are stored as a negative "used" value. All admin changes use the same script.

## Manual steps
- Create separate Upstash databases for Preview and Development and put their `KV_REST_API_URL` / `KV_REST_API_TOKEN` only on those environments. Keys are also prefixed with `preview:` / `development:` as a second guard.
- Use a different `SESSION_SECRET` on Preview and Development.
- GitHub: Settings > Branches > protect `main` (require pull request and the `CI / test` check).
- After deploying, everyone is signed out once (old sessions have no server record). Old `usage:<id>:day:*` and `usage:<id>:month:*` counters are no longer read, so usage starts fresh. Tiers and projects are unchanged.
- Discord OAuth scope is `identify email` (email is only stored in the server-side session for the profile screen).
