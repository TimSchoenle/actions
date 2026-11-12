# bun/setup-cached fixture

A project with a committed `bun.lock` whose one dependency is the local `dep/` directory. The
`verify-bun-cache` job in `.github/verify/bun-setup-cached.yaml` runs the action on it without
installing Bun first, so setup-bun's own cache of the Bun executable is what decides `bun-cache-hit`.
