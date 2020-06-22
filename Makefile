.PHONY: run install format

run:
	deno run

install:
	deno run --unstable ./lib/deps.ts

play:
	deno run -A --unstable ./lib/playground.ts

format:
	deno fmt lib/
