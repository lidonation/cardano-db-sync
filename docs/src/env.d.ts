/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// Bindings used both by cloudflare:workers (env.DB, env.IP_HASH_SALT)
// and by @astrojs/cloudflare's Runtime<Env> (locals.runtime.env in Astro v5 style).
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    IP_HASH_SALT: string;
  }
}

type Runtime = import('@astrojs/cloudflare').Runtime<Cloudflare.Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
