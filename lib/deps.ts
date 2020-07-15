// builtin
export * as fs from "https://deno.land/std@0.61.0/fs/mod.ts";
export * as path from "https://deno.land/std@0.61.0/path/mod.ts";
export * as hash from "https://deno.land/std@0.61.0/hash/mod.ts";
export * as colors from "https://deno.land/std@0.61.0/fmt/colors.ts";
export * as async from "https://deno.land/std@0.61.0/async/mod.ts";
export * as asserts from "https://deno.land/std@0.61.0/testing/asserts.ts";
// export * as log from 'https://deno.land/std@0.61.0/log/mod.ts';
export * as flags from "https://deno.land/std@0.61.0/flags/mod.ts";
// export * as permissions from 'https://deno.land/std@0.61.0/permissions/mod.ts';

// third part
export { hmac } from "https://denopkg.com/chiefbiiko/hmac/mod.ts";

// pika
import { default as _JSZip } from "https://dev.jspm.io/jszip@3.5.0";
// 因为类型问题，所以要单独转换一次
export const JSZip: any = _JSZip;
