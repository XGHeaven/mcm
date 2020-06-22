.PHONY: run install

run:
	deno run

install:
	deno run --unstable ./lib/deps.ts

play:
	deno run -A --unstable ./lib/playground.ts
