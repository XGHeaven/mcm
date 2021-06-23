.PHONY: mcm install update format test bundle play

CACHE_DIR=.cache/deno

mcm:
	DENO_DIR=$(CACHE_DIR) deno run --lock lock.json --unstable -A ./lib/bin.dev.ts $(ARGS)

install:
	DENO_DIR=$(CACHE_DIR) deno cache --lock lock.json --unstable ./lib/deps.ts ./lib/prepare.ts

update:
	DENO_DIR=$(CACHE_DIR) deno cache --lock lock.json --lock-write --unstable ./lib/deps.ts ./lib/prepare.ts

play:
	DENO_DIR=$(CACHE_DIR) deno run --lock lock.json -A --unstable ./lib/playground.ts

format:
	deno fmt lib/

lint:
	DENO_DIR=$(CACHE_DIR) deno lint --unstable ./lib

test:
	DENO_DIR=$(CACHE_DIR) deno test --unstable -A

bundle:
	DENO_DIR=$(CACHE_DIR) deno bundle --unstable ./lib/mcm.ts mcm.js
