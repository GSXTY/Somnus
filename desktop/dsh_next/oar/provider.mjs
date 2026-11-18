import z from "@deepseek-ai/schemastery";
import { accessSync, closeSync, constants, existsSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import path, { basename, extname, join, resolve } from "node:path";
import which from "which";
import spawn from "cross-spawn";
import { execFile, execFileSync, spawn as spawn$1 } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { PROTOCOL_VERSION, RequestError, client, methods, methods as methods$1, ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
import { homedir, tmpdir } from "node:os";
import "@earendil-works/pi-coding-agent";
import { NO_START_CAPABILITIES, assertPositiveFinite, assertUsableCwd, settleRunResult, subprocessRunHandle } from "@deepseek-ai/dsh-subagent";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { brandString } from "@deepseek-ai/dsh-brand";
import { assertNever } from "@deepseek-ai/dsh-util-values";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/registry.js
var RuntimeRegistry = class {
	#runtimes;
	constructor(runtimes) {
		const indexed = /* @__PURE__ */ new Map();
		for (const runtime of runtimes) {
			if (indexed.has(runtime.id)) throw new Error(`duplicate runtime id: ${runtime.id}`);
			indexed.set(runtime.id, runtime);
		}
		this.#runtimes = indexed;
	}
	get(id) {
		return this.#runtimes.get(id);
	}
	require(id) {
		const runtime = this.get(id);
		if (runtime === void 0) throw new Error(`unknown runtime: ${id}`);
		return runtime;
	}
	list() {
		return [...this.#runtimes.values()];
	}
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/brands.js
const brands = {
	claude: {
		name: "Claude Code",
		icon: `data:image/svg+xml,${encodeURIComponent("<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Claude Code</title><path clip-rule=\"evenodd\" d=\"M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z\" fill=\"#D97757\" fill-rule=\"evenodd\"></path></svg>")}`
	},
	codex: {
		name: "Codex",
		icon: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Codex</title><path clip-rule=\"evenodd\" d=\"M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z\"></path></svg>")}`,
		icons: {
			light: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"#000\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Codex</title><path clip-rule=\"evenodd\" d=\"M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z\"></path></svg>")}`,
			dark: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"#fff\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Codex</title><path clip-rule=\"evenodd\" d=\"M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z\"></path></svg>")}`
		}
	},
	kimi: {
		name: "Kimi Code",
		icon: `data:image/svg+xml,${encodeURIComponent("<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Kimi</title><path d=\"M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z\" fill=\"#1783FF\"></path><path d=\"M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z\" fill=\"#fff\"></path></svg>")}`,
		icons: {
			light: `data:image/svg+xml,${encodeURIComponent("<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Kimi</title><path d=\"M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z\" fill=\"#1783FF\"></path><path d=\"M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z\" fill=\"#000\"></path></svg>")}`,
			dark: `data:image/svg+xml,${encodeURIComponent("<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Kimi</title><path d=\"M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z\" fill=\"#1783FF\"></path><path d=\"M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z\" fill=\"#fff\"></path></svg>")}`
		}
	},
	pi: {
		name: "Pi",
		icon: `data:image/svg+xml,${encodeURIComponent("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\">\n  <path fill=\"#F09082\" d=\"M165.29 165.29H517.36V400H400V282.65H165.29Z\"/>\n  <path fill=\"#4D9ABF\" d=\"M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z\"/>\n  <path fill=\"#F1BE58\" d=\"M517.36 400H634.72V634.72H517.36Z\"/>\n</svg>\n")}`,
		icons: {
			light: `data:image/svg+xml,${encodeURIComponent("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\">\n  <path fill=\"#F09082\" d=\"M165.29 165.29H517.36V400H400V282.65H165.29Z\"/>\n  <path fill=\"#4D9ABF\" d=\"M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z\"/>\n  <path fill=\"#F1BE58\" d=\"M517.36 400H634.72V634.72H517.36Z\"/>\n</svg>\n")}`,
			dark: `data:image/svg+xml,${encodeURIComponent("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\">\n  <path fill=\"#F09082\" d=\"M165.29 165.29H517.36V400H400V282.65H165.29Z\"/>\n  <path fill=\"#4D9ABF\" d=\"M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z\"/>\n  <path fill=\"#F1BE58\" d=\"M517.36 400H634.72V634.72H517.36Z\"/>\n</svg>\n")}`
		}
	},
	grok: {
		name: "Grok Build",
		icon: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Grok</title><path d=\"M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815\"></path></svg>")}`,
		icons: {
			light: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"#000\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Grok</title><path d=\"M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815\"></path></svg>")}`,
			dark: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"#fff\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Grok</title><path d=\"M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815\"></path></svg>")}`
		}
	},
	cursor: {
		name: "Cursor",
		icon: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Cursor</title><path d=\"M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z\"></path></svg>")}`,
		icons: {
			light: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"#000\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Cursor</title><path d=\"M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z\"></path></svg>")}`,
			dark: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"#fff\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Cursor</title><path d=\"M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z\"></path></svg>")}`
		}
	},
	opencode: {
		name: "OpenCode",
		icon: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>opencode</title><path d=\"M16 6H8v12h8V6zm4 16H4V2h16v20z\"></path></svg>")}`,
		icons: {
			light: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"#000\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>opencode</title><path d=\"M16 6H8v12h8V6zm4 16H4V2h16v20z\"></path></svg>")}`,
			dark: `data:image/svg+xml,${encodeURIComponent("<svg fill=\"#fff\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>opencode</title><path d=\"M16 6H8v12h8V6zm4 16H4V2h16v20z\"></path></svg>")}`
		}
	},
	antigravity: {
		name: "Antigravity",
		icon: `data:image/svg+xml,${encodeURIComponent("<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Antigravity</title><mask height=\"23\" id=\"lobe-icons-antigravity-0-_R_0_\" maskUnits=\"userSpaceOnUse\" width=\"24\" x=\"0\" y=\"1\"><path d=\"M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z\" fill=\"#fff\"></path></mask><g mask=\"url(#lobe-icons-antigravity-0-_R_0_)\"><g filter=\"url(#lobe-icons-antigravity-1-_R_0_)\"><path d=\"M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z\" fill=\"#FFE432\"></path></g><g filter=\"url(#lobe-icons-antigravity-2-_R_0_)\"><path d=\"M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z\" fill=\"#FC413D\"></path></g><g filter=\"url(#lobe-icons-antigravity-3-_R_0_)\"><path d=\"M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-4-_R_0_)\"><path d=\"M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-5-_R_0_)\"><path d=\"M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z\" fill=\"#00B95C\"></path></g><g filter=\"url(#lobe-icons-antigravity-6-_R_0_)\"><path d=\"M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z\" fill=\"#3186FF\"></path></g><g filter=\"url(#lobe-icons-antigravity-7-_R_0_)\"><path d=\"M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z\" fill=\"#FBBC04\"></path></g><g filter=\"url(#lobe-icons-antigravity-8-_R_0_)\"><path d=\"M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z\" fill=\"#3186FF\"></path></g><g filter=\"url(#lobe-icons-antigravity-9-_R_0_)\"><path d=\"M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z\" fill=\"#749BFF\"></path></g><g filter=\"url(#lobe-icons-antigravity-10-_R_0_)\"><path d=\"M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z\" fill=\"#FC413D\"></path></g><g filter=\"url(#lobe-icons-antigravity-11-_R_0_)\"><path d=\"M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z\" fill=\"#FFEE48\"></path></g></g><defs><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"17.587\" id=\"lobe-icons-antigravity-1-_R_0_\" width=\"19.838\" x=\"-3.288\" y=\"-11.917\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"1.117\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"38.565\" id=\"lobe-icons-antigravity-2-_R_0_\" width=\"38.9\" x=\"4.251\" y=\"-13.493\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"5.4\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.517\" id=\"lobe-icons-antigravity-3-_R_0_\" width=\"40.955\" x=\"-21.889\" y=\"-10.592\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.517\" id=\"lobe-icons-antigravity-4-_R_0_\" width=\"40.955\" x=\"-21.889\" y=\"-10.592\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"36.595\" id=\"lobe-icons-antigravity-5-_R_0_\" width=\"36.632\" x=\"-19.099\" y=\"-10.278\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.591\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"34.087\" id=\"lobe-icons-antigravity-6-_R_0_\" width=\"33.533\" x=\".981\" y=\"8.758\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"4.363\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"35.276\" id=\"lobe-icons-antigravity-7-_R_0_\" width=\"35.978\" x=\"-6.143\" y=\"-21.659\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.954\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"46.523\" id=\"lobe-icons-antigravity-8-_R_0_\" width=\"45.114\" x=\"-11.96\" y=\"-.46\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.531\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"24.054\" id=\"lobe-icons-antigravity-9-_R_0_\" width=\"25.094\" x=\"10.485\" y=\".58\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.159\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"30.007\" id=\"lobe-icons-antigravity-10-_R_0_\" width=\"33.508\" x=\"5.833\" y=\"-12.467\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"2.669\"></feGaussianBlur></filter><filter color-interpolation-filters=\"sRGB\" filterUnits=\"userSpaceOnUse\" height=\"26.151\" id=\"lobe-icons-antigravity-11-_R_0_\" width=\"22.194\" x=\"-8.355\" y=\"-8.876\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"></feFlood><feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\"></feBlend><feGaussianBlur result=\"effect1_foregroundBlur_977_115\" stdDeviation=\"3.303\"></feGaussianBlur></filter></defs></svg>")}`
	}
};
const runtimeBrands = {
	...brands,
	"pi-durable": {
		...brands.pi,
		name: "Pi Durable"
	}
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/contracts/runtime.js
async function unsupported() {
	await Promise.resolve();
	return {
		kind: "unsupported",
		code: "transport_unavailable",
		reason: "The selected runtime interface does not expose this inventory"
	};
}
function defineRuntime(runtime) {
	return {
		skills: unsupported,
		commands: unsupported,
		mcpServers: unsupported,
		tools: unsupported,
		...runtime,
		brand: runtime.brand ?? {
			name: runtime.id,
			icon: null
		}
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/lazy.js
/**
* A function that imports its implementation on its first call, so a
* runtime's entry module stays light (no ACP SDK, about 20 MB of heap) until
* a host actually opens a session, lists models or reads usage. Every later
* call shares the import; a failed import is tried again on the next call.
*/
function onFirstCall(load) {
	let loading = null;
	const loaded = async () => {
		const attempt = loading ?? load();
		loading = attempt;
		try {
			return await attempt;
		} catch (error) {
			if (loading === attempt) loading = null;
			throw error;
		}
	};
	return async (...args) => {
		return (await loaded())(...args);
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/resolve.js
/** Resolve one executable through PATH (and PATHEXT on Windows) without spawning anything. */
function resolveExecutable(executable) {
	return which.sync(executable, { nothrow: true });
}
/**
* Every match of an executable on PATH, in PATH order, like `which -a`; the
* first is the one {@link resolveExecutable} returns. Raw: a folder listed
* twice matches twice, and on Windows one folder can match once per PATHEXT
* extension.
*/
function resolveExecutableAll(executable) {
	return which.sync(executable, {
		all: true,
		nothrow: true
	}) ?? [];
}
var init_resolve = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/windows-shim.js
/** Whether a resolved command is a Windows shell shim (`.cmd`/`.bat`), the only commands that go through `cmd.exe`. */
function isWindowsShim(command) {
	return SHIM.test(command);
}
/** Every double-quoted token in the shim text, in order. */
function quotedTokens(text) {
	return [...text.matchAll(/"([^"]*)"/gu)].map((match) => match[1] ?? "");
}
/** A token naming the shim's own directory: npm's `%dp0%` or pnpm's `%~dp0`. */
function isShimRelative(token) {
	return /%(?:~)?dp0%?/iu.test(token);
}
/** Replace a shim's own-directory variable (`%dp0%` or `%~dp0`) and normalize to a Windows path. */
function expand(token, shimDir) {
	return path.win32.normalize(token.replaceAll(/%dp0%|%~dp0/giu, `${shimDir}\\`));
}
/** `node` from a shim, bare or shim-relative; not the script it runs. */
function isNodeBinary(candidate) {
	return /(?:^|[\\/])node\.exe$/iu.test(candidate);
}
/**
* What a global package-manager shim (`.cmd`/`.bat`) would run, or null when
* the text is not a shim shape we recognize. npm and pnpm both wrap a
* package's `bin`, naming every path relative to the shim's own directory
* (`%dp0%` / `%~dp0`) and forwarding exactly `%*`:
* - a native binary (claude's `claude.exe`) runs directly;
* - a Node script (codex's `codex.js`) runs with the shim's own `node.exe`
*   when it sits beside the shim, else `node` from PATH.
*
* Recognized by the shim-relative target alone, so npm's and pnpm's differing
* boilerplate both match, while an absolute target or extra fixed arguments
* (a hand-rolled `.cmd`) do not and the caller launches it unchanged. Pure:
* `shimExists` decides whether the bundled `node.exe` is present (the real
* check is the file system; a test passes its own). The caller spawns
* `command` with `[...prefixArgs, ...callerArgs]` and no shell.
*/
function parseWindowsShim(shimPath, text, shimExists) {
	if (!text.includes("%*")) return null;
	const shimDir = path.win32.dirname(shimPath);
	const relative = [...new Set(quotedTokens(text).filter((token) => isShimRelative(token)).map((token) => expand(token, shimDir)))];
	const scripts = relative.filter((candidate) => SCRIPT.test(candidate));
	const natives = relative.filter((candidate) => NATIVE.test(candidate) && !isNodeBinary(candidate));
	if (scripts.length === 1 && natives.length === 0) {
		const bundledNode = path.win32.join(shimDir, "node.exe");
		return {
			command: shimExists(bundledNode) ? bundledNode : "node",
			prefixArgs: [scripts[0] ?? ""]
		};
	}
	if (natives.length === 1 && scripts.length === 0) return {
		command: natives[0] ?? "",
		prefixArgs: []
	};
	return null;
}
/** A shim's text, or null when it cannot be read. */
function readShim(shimPath) {
	try {
		return readFileSync(shimPath, "utf8");
	} catch {
		return null;
	}
}
/**
* The command and arguments to spawn, with no shell, when a `.cmd`/`.bat`
* shim can be read as the Node CLI it wraps: the interpreter and script it
* would run, with the shim's own arguments ahead of the caller's, so nothing
* reaches `cmd.exe`. Off Windows, for a non-shim command, or for a shim this
* cannot read as a Node CLI, the inputs unchanged, so the caller spawns as
* before (cross-spawn's shim handling). `resolve` finds a bare command on
* PATH (its own default).
*/
function windowsSpawnTarget(command, args, platform = process.platform, resolve = resolveExecutable) {
	if (platform !== "win32") return {
		command,
		args
	};
	const resolved = isWindowsShim(command) ? command : resolve(command);
	if (resolved === null || !isWindowsShim(resolved)) return {
		command,
		args
	};
	const text = readShim(resolved);
	const shim = text === null ? null : parseWindowsShim(resolved, text, existsSync);
	return shim === null ? {
		command,
		args
	} : {
		command: shim.command,
		args: [...shim.prefixArgs, ...args]
	};
}
var SHIM, SCRIPT, NATIVE;
var init_windows_shim = __esmMin((() => {
	init_resolve();
	SHIM = /\.(?:cmd|bat)$/iu;
	SCRIPT = /\.(?:c|m)?js$/iu;
	NATIVE = /\.(?:exe|com)$/iu;
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/diagnostics.js
function stderrTail(text) {
	const tail = new StderrTail();
	tail.append(text);
	return tail.text();
}
function nativeError(error) {
	return {
		..."code" in error && typeof error.code === "string" ? { code: error.code } : {},
		message: stderrTail(error.message)
	};
}
/**
* A spawn failure as a host may see it: Node's own error carries the whole
* argv in `spawnargs` (prompts, SessionOptions.launchArgs). This keeps the
* message (which names only the command) and the identifying fields, no argv
* and no cause pointing back at the original.
*/
function spawnFailure(error, message = error.message) {
	const failure = new Error(message);
	for (const key of [
		"code",
		"errno",
		"syscall",
		"path"
	]) {
		const field = Object.getOwnPropertyDescriptor(error, key);
		if (field !== void 0) {
			const value = field.value;
			Object.assign(failure, { [key]: value });
		}
	}
	return failure;
}
/**
* Node rejects an argument or environment value it cannot pass (a NUL byte)
* synchronously, quoting the value after "Received". Rethrown with the
* value cut, so an argv or env secret never reaches the host's error.
*/
function spawnChecked(start) {
	try {
		return start();
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		throw spawnFailure(error, error.message.split(" Received")[0] ?? error.message);
	}
}
function processFailure(context, diagnostics) {
	const reasons = [`exit code ${diagnostics.exitCode === null ? "unavailable" : String(diagnostics.exitCode)}`, `signal ${diagnostics.signal ?? "none"}`];
	if (diagnostics.timeoutMs !== void 0) reasons.push(`timeout after ${String(diagnostics.timeoutMs)} ms`);
	if (diagnostics.error !== void 0) reasons.push(`${diagnostics.error.code ?? "native error"}: ${diagnostics.error.message}`);
	const stderr = diagnostics.stderr === "" ? "" : `\nstderr (tail):\n${diagnostics.stderr}`;
	return new Error(`${context}: ${reasons.join("; ")}${stderr}`, { cause: diagnostics });
}
/**
* Throws when a command timed out or never ran to an exit code of its own (a
* failed spawn, a signal): an operational failure, carrying the native reason
* and a bounded stderr tail. A command that exited with a code returns; that
* answer is the caller's to read.
*/
function assertRan(result, context) {
	if (!result.ok && (result.exitCode === null || result.diagnostics?.timeoutMs !== void 0)) throw processFailure(context, result.diagnostics ?? {
		exitCode: result.exitCode,
		signal: null,
		stderr: stderrTail(result.stderr)
	});
}
var STDERR_TAIL_BYTES, StderrTail;
var init_diagnostics = __esmMin((() => {
	STDERR_TAIL_BYTES = 8192;
	StderrTail = class {
		bytes = Buffer.alloc(0);
		append(chunk) {
			const incoming = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			this.bytes = incoming.length >= 8192 ? Buffer.from(incoming.subarray(-8192)) : Buffer.concat([this.bytes.subarray(Math.max(0, this.bytes.length + incoming.length - STDERR_TAIL_BYTES)), incoming]);
		}
		text() {
			let start = 0;
			for (const byte of this.bytes) {
				if ((byte & 192) !== 128) break;
				start += 1;
			}
			return this.bytes.subarray(start).toString("utf8");
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/process-tree.js
/** `/proc/<pid>/stat`'s ppid, pgrp and starttime (clock ticks since boot); null once the process is gone. */
function readStat$1(pid) {
	let stat = "";
	try {
		stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
	} catch {
		return null;
	}
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	const [ppid, pgid, start] = [
		Number(fields[1]),
		Number(fields[2]),
		fields[19]
	];
	return Number.isInteger(ppid) && Number.isInteger(pgid) && start !== void 0 ? {
		pid,
		ppid,
		pgid,
		start
	} : null;
}
/** Linux: every process's stat. */
function readProcfs$1() {
	const table = /* @__PURE__ */ new Map();
	for (const name of readdirSync("/proc")) {
		const entry = /^\d+$/u.test(name) ? readStat$1(Number(name)) : null;
		if (entry !== null) table.set(entry.pid, entry);
	}
	return table;
}
/** Other POSIX systems (macOS): one `ps` run; `lstart` is the start time to the second. */
function readPs$1() {
	const output = execFileSync("ps", [
		"-A",
		"-o",
		"pid=,ppid=,pgid=,lstart="
	], {
		encoding: "utf8",
		env: {
			...process.env,
			LC_ALL: "C"
		},
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		timeout: 5e3,
		maxBuffer: 16 * 1024 * 1024
	});
	const table = /* @__PURE__ */ new Map();
	for (const line of output.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S.*?)\s*$/u.exec(line);
		if (match !== null) {
			const pid = Number(match[1]);
			table.set(pid, {
				pid,
				ppid: Number(match[2]),
				pgid: Number(match[3]),
				start: match[4] ?? ""
			});
		}
	}
	return table;
}
/**
* The process table now (synchronous: the host's `exit` hook reads it too).
* Empty when it cannot be read; the caller then reaches the process group only.
*/
function readProcessTable(source = process.platform === "linux" ? "procfs" : "ps") {
	try {
		return source === "procfs" ? readProcfs$1() : readPs$1();
	} catch {
		return /* @__PURE__ */ new Map();
	}
}
/** Every process below `pid` in `table`: its children, theirs, and so on. */
function descendantsOf(table, pid) {
	const children = /* @__PURE__ */ new Map();
	for (const entry of table.values()) {
		const siblings = children.get(entry.ppid);
		if (siblings === void 0) children.set(entry.ppid, [entry]);
		else siblings.push(entry);
	}
	const found = [];
	const seen = new Set([pid]);
	const pending = [pid];
	for (let parent = pending.pop(); parent !== void 0; parent = pending.pop()) for (const child of children.get(parent) ?? []) if (!seen.has(child.pid)) {
		seen.add(child.pid);
		found.push(child);
		pending.push(child.pid);
	}
	return found;
}
/**
* SIGKILL each of `entries` that `table` (read just before) shows still
* running, the same process (same start time), and the process group each
* belongs to now: the runtime's own, or one a descendant made, which can hold
* processes started since the entries were read. Never the host, nor its group.
*/
function killEntries(entries, table) {
	const hostGroup = table.get(process.pid)?.pgid;
	const groups = /* @__PURE__ */ new Set();
	const pids = /* @__PURE__ */ new Set();
	for (const entry of entries) {
		const current = table.get(entry.pid);
		if (current === void 0 || current.start !== entry.start || current.pid === process.pid) continue;
		pids.add(current.pid);
		if (current.pgid > 1 && current.pgid !== hostGroup) groups.add(current.pgid);
	}
	for (const group of groups) try {
		process.kill(-group, "SIGKILL");
	} catch {}
	for (const pid of pids) try {
		process.kill(pid, "SIGKILL");
	} catch {}
}
var init_process_tree = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/ownership.js
function killOwnedProcess(child, table) {
	try {
		if (child.pid !== void 0) {
			if (process.platform === "win32") {
				if (child.exitCode !== null || child.signalCode !== null) return;
				execFileSync("taskkill", [
					"/pid",
					String(child.pid),
					"/T",
					"/F"
				], {
					stdio: "ignore",
					timeout: 1e4,
					windowsHide: true
				});
			} else {
				if (child.exitCode === null && child.signalCode === null) killEntries(descendantsOf(table(), child.pid), table());
				process.kill(-child.pid, "SIGKILL");
			}
			return;
		}
	} catch {}
	try {
		child.kill("SIGKILL");
	} catch {}
}
/**
* Own a detached POSIX group or Windows tree until its output pipes close:
* descendants may hold them after the launcher exits. One synchronous hook
* covers sessions, probes, updaters, logins and ACP terminals when a host
* calls process.exit without disposing them; on POSIX it also SIGKILLs the
* descendants of a child still running that left its group, and their groups
* (process-tree.ts). Node does not emit `exit` for an unhandled terminating
* signal or SIGKILL; hosts own graceful handling.
*/
function trackOwnedProcess(child) {
	ownedChildren.add(child);
	const forget = () => {
		ownedChildren.delete(child);
	};
	child.once("close", forget);
	child.once("error", () => {
		if (child.pid === void 0) forget();
	});
	if (!exitHookInstalled) {
		exitHookInstalled = true;
		process.once("exit", () => {
			let table = null;
			const read = () => {
				table ??= readProcessTable();
				return table;
			};
			for (const owned of ownedChildren) killOwnedProcess(owned, read);
		});
	}
}
var ownedChildren, exitHookInstalled;
var init_ownership = __esmMin((() => {
	init_process_tree();
	ownedChildren = /* @__PURE__ */ new Set();
	exitHookInstalled = false;
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/run.js
var OUTPUT_LIMIT$1, runExecutable;
var init_run = __esmMin((() => {
	init_process$1();
	init_diagnostics();
	init_windows_shim();
	OUTPUT_LIMIT$1 = 2 * 1024 * 1024;
	runExecutable = async (executable, args, options = {}) => {
		const timeoutMs = options.timeoutMs ?? 15e3;
		return await new Promise((resolve) => {
			let stdout = Buffer.alloc(0);
			let stderr = Buffer.alloc(0);
			let failure = null;
			let timedOut = false;
			let stopped = false;
			let timer = null;
			let escalation = null;
			const complete = (code, signal) => {
				clearTimeout(timer ?? void 0);
				clearTimeout(escalation ?? void 0);
				options.signal?.removeEventListener("abort", onAbort);
				const ok = code === 0 && signal === null && failure === null && !stopped;
				const exitCode = ok || failure !== null || stopped ? null : code;
				resolve({
					ok,
					stdout: stdout.toString("utf8"),
					stderr: stderr.toString("utf8"),
					exitCode,
					...ok ? {} : { diagnostics: {
						exitCode,
						signal,
						stderr: stderrTail(stderr.toString("utf8")),
						...timedOut ? { timeoutMs } : {},
						...failure === null ? {} : { error: failure }
					} }
				});
			};
			let stop = null;
			const onAbort = () => {
				failure ??= {
					code: "ABORT_ERR",
					message: "The operation was aborted"
				};
				stop?.();
			};
			try {
				if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw Object.assign(/* @__PURE__ */ new RangeError("timeoutMs must be a nonnegative integer"), { code: "ERR_OUT_OF_RANGE" });
				const target = windowsSpawnTarget(executable, args);
				const child = spawn$1(target.command, [...target.args], {
					cwd: options.cwd,
					env: options.env,
					stdio: [
						"pipe",
						"pipe",
						"pipe"
					],
					detached: OWN_PROCESS_GROUP,
					shell: process.platform === "win32" && isWindowsShim(target.command)
				});
				trackOwnedProcess(child);
				stop = () => {
					if (stopped) return;
					stopped = true;
					clearTimeout(timer ?? void 0);
					signalProcessGroup(child, "SIGTERM");
					escalation = setTimeout(() => {
						signalProcessGroup(child, "SIGKILL");
					}, killGraceMs());
					escalation.unref();
				};
				const append = (output, chunk, stream) => {
					const remaining = OUTPUT_LIMIT$1 - output.length;
					const next = Buffer.concat([output, chunk.subarray(0, Math.max(0, remaining))]);
					if (chunk.length > remaining) {
						failure ??= {
							code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
							message: `${stream} maxBuffer length exceeded`
						};
						stop?.();
					}
					return next;
				};
				child.stdout.on("data", (chunk) => {
					stdout = append(stdout, chunk, "stdout");
				});
				child.stderr.on("data", (chunk) => {
					stderr = append(stderr, chunk, "stderr");
				});
				child.once("error", (error) => {
					failure ??= nativeError(error);
				});
				child.once("close", complete);
				if (timeoutMs > 0) {
					timer = setTimeout(() => {
						timedOut = true;
						stop?.();
					}, timeoutMs);
					timer.unref();
				}
				options.signal?.addEventListener("abort", onAbort, { once: true });
				if (options.signal?.aborted === true) onAbort();
			} catch (error) {
				if (!(error instanceof Error)) throw error;
				failure = nativeError(error);
				complete(null, null);
			}
		});
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/process-resources.js
/** The kernel's page size (`getconf PAGESIZE`), read once; 4096 when it cannot be read. */
async function linuxPageSize() {
	if (pageSize === null) {
		const result = await runExecutable("getconf", ["PAGESIZE"], { timeoutMs: 5e3 });
		const size = Number(result.stdout.trim());
		pageSize = result.ok && Number.isInteger(size) && size > 0 ? size : DEFAULT_PAGE_SIZE;
	}
	return pageSize;
}
/** The process went away between the listing and the read: skipped. Any other failure fails the reading. */
function gone(error) {
	if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH")) return null;
	throw error;
}
/** `/proc/<pid>/stat`'s ppid, pgrp and rss (field 24, in pages); null once the process is gone. */
async function readStat(pid, page) {
	const stat = await readFile(`/proc/${String(pid)}/stat`, "utf8").catch(gone);
	if (stat === null) return null;
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	const [ppid, pgid, pages] = [
		Number(fields[1]),
		Number(fields[2]),
		Number(fields[21])
	];
	return Number.isInteger(ppid) && Number.isInteger(pgid) && Number.isInteger(pages) ? {
		pid,
		ppid,
		pgid,
		start: "",
		rss: pages * page
	} : null;
}
async function readProcfs() {
	const page = await linuxPageSize();
	const pids = (await readdir("/proc")).filter((name) => /^\d+$/u.test(name)).map(Number);
	const table = /* @__PURE__ */ new Map();
	for (let start = 0; start < pids.length; start += BATCH) {
		const batch = await Promise.all(pids.slice(start, start + BATCH).map(async (pid) => {
			return await readStat(pid, page);
		}));
		for (const entry of batch) if (entry !== null) table.set(entry.pid, entry);
	}
	return table;
}
async function readPs() {
	const result = await runExecutable("ps", [
		"-A",
		"-o",
		"pid=,ppid=,pgid=,rss="
	], {
		env: {
			...process.env,
			LC_ALL: "C"
		},
		timeoutMs: 5e3
	});
	if (!result.ok) return null;
	const table = /* @__PURE__ */ new Map();
	for (const line of result.stdout.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(line);
		if (match !== null) {
			const pid = Number(match[1]);
			table.set(pid, {
				pid,
				ppid: Number(match[2]),
				pgid: Number(match[3]),
				start: "",
				rss: Number(match[4]) * 1024
			});
		}
	}
	return table;
}
/** The processes counted for `pid`: itself, the group it leads, and its descendants (those that left the group too). */
function counted(table, root) {
	const members = new Map([[root.pid, root]]);
	for (const entry of table.values()) if (entry.pgid === root.pid) members.set(entry.pid, entry);
	for (const { pid } of descendantsOf(table, root.pid)) {
		const resident = table.get(pid);
		if (resident !== void 0) members.set(pid, resident);
	}
	return members;
}
/** One read of the table, forgotten once it settles; null when it cannot be read whole. */
async function readTable(source) {
	try {
		return await (source === "procfs" ? readProcfs() : readPs());
	} catch {
		return null;
	} finally {
		inFlight.delete(source);
	}
}
/** The process table now: the read already in flight, if one is, else a fresh one. */
async function currentTable(source) {
	let read = inFlight.get(source);
	if (read === void 0) {
		read = readTable(source);
		inFlight.set(source, read);
	}
	return await read;
}
/**
* The resident memory of `pid`, the process group it leads and its
* descendants, and how many processes that is. Null when `pid` is no longer
* in the table, when the table cannot be read, and on Windows.
*/
async function processTreeResources(pid, platform = process.platform) {
	if (platform === "win32") return null;
	const table = await currentTable(platform === "linux" ? "procfs" : "ps");
	const root = table?.get(pid);
	if (table === null || root === void 0) return null;
	const members = counted(table, root);
	let rss = 0;
	for (const member of members.values()) rss += member.rss;
	return {
		rss,
		processes: members.size
	};
}
/** A line process's `resources()`: null once `exited()` says it has, or before it has a pid. */
function treeResourcesReader(child, exited) {
	return async () => {
		return exited() || child.pid === void 0 ? null : await processTreeResources(child.pid);
	};
}
var DEFAULT_PAGE_SIZE, pageSize, BATCH, inFlight;
var init_process_resources = __esmMin((() => {
	init_process_tree();
	init_run();
	DEFAULT_PAGE_SIZE = 4096;
	pageSize = null;
	BATCH = 64;
	inFlight = /* @__PURE__ */ new Map();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/process.js
/**
* The grace period in force: `OAR_KILL_GRACE_MS` when it holds a nonnegative
* number of milliseconds (a host whose runtimes need longer, e.g. claude with
* slow SessionEnd hooks, or that wants a faster teardown), else `KILL_GRACE_MS`.
*/
function killGraceMs(env = process.env) {
	const configured = env.OAR_KILL_GRACE_MS?.trim() ?? "";
	const value = Number(configured);
	return configured.length > 0 && Number.isFinite(value) && value >= 0 ? value : KILL_GRACE_MS;
}
/**
* Send `signal` to a child spawned with `detached: OWN_PROCESS_GROUP` and to
* everything in its process group. Falls back to the child alone where there
* are no groups (Windows) or the group is gone (the child left it; ESRCH).
* A reaped child's pid can be reused, so call this only while the child, or a
* process it started, can still be alive.
*/
function signalProcessGroup(child, signal) {
	if (OWN_PROCESS_GROUP && child.pid !== void 0) try {
		process.kill(-child.pid, signal);
		return;
	} catch {}
	child.kill(signal);
}
/**
* Windows has no process groups: end the child and everything it started by
* walking its process tree (`taskkill /T /F`), falling back to the child
* alone when the walk fails.
*/
function killProcessTree(child) {
	if (child.pid === void 0) {
		child.kill();
		return;
	}
	trackOwnedProcess(execFile("taskkill", [
		"/pid",
		String(child.pid),
		"/T",
		"/F"
	], (error) => {
		if (error !== null) child.kill();
	}));
}
/**
* Spawn through cross-spawn. On Windows a `.cmd`/`.bat` shim is first
* resolved to the Node interpreter and script it wraps, so a shim's arguments
* never reach `cmd.exe` (windows-shim.ts). Line parsing is attached lazily;
* protocol SDKs can consume the raw streams.
*/
function spawnLineProcess(command, args, options = {}) {
	const target = windowsSpawnTarget(command, args);
	const child = spawnChecked(() => spawn(target.command, [...target.args], {
		...options.cwd === void 0 ? {} : { cwd: options.cwd },
		env: options.env ?? process.env,
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		],
		detached: OWN_PROCESS_GROUP
	}));
	trackOwnedProcess(child);
	const { stdin, stdout } = child;
	const stderr = new StderrTail();
	const inheritStderr = options.inheritStderr ?? process.env.OAR_CHILD_STDERR === "inherit";
	child.stderr?.on("data", (chunk) => {
		stderr.append(chunk);
		if (inheritStderr) process.stderr.write(chunk);
	});
	if (stdin === null || stdout === null) throw new Error("line process stdio must be piped");
	stdin.on("error", () => {});
	const lineHandlers = [];
	const exitHandlers = [];
	let buffer = "";
	let readingLines = false;
	let ended = false;
	let exitCode = null;
	let exitSignal = null;
	let spawnError = void 0;
	let escalation = null;
	let descendants = [];
	const { promise: spawned, resolve: spawnOk, reject: spawnFailed } = Promise.withResolvers();
	const { promise: exited, resolve: exitDone } = Promise.withResolvers();
	child.once("spawn", spawnOk);
	const end = (code, signal = null) => {
		if (ended) return;
		ended = true;
		exitCode = code;
		exitSignal = signal;
		if (escalation !== null) clearTimeout(escalation);
		if (descendants.length > 0) {
			killEntries(descendants, readProcessTable());
			descendants = [];
		}
		for (const handler of exitHandlers) handler(code);
		exitDone(code);
	};
	child.on("exit", end);
	child.on("error", (error) => {
		spawnError = nativeError(error);
		spawnFailed(spawnFailure(error));
		end(null);
	});
	const readLines = () => {
		const decoder = new StringDecoder("utf8");
		stdout.on("data", (chunk) => {
			buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const raw of lines) {
				const line = raw.trim();
				if (line.length > 0) for (const handler of lineHandlers) handler(line);
			}
		});
	};
	return {
		spawned,
		exited,
		stdin,
		stdout,
		diagnostics: () => ({
			exitCode,
			signal: exitSignal,
			stderr: stderr.text(),
			...spawnError === void 0 ? {} : { error: spawnError }
		}),
		write: (text) => {
			if (!stdin.writableEnded && !stdin.destroyed) stdin.write(text);
		},
		onLine(handler) {
			lineHandlers.push(handler);
			if (!readingLines) {
				readingLines = true;
				readLines();
			}
		},
		onExit(handler) {
			if (ended) queueMicrotask(() => {
				handler(exitCode);
			});
			else exitHandlers.push(handler);
		},
		resources: treeResourcesReader(child, () => ended),
		kill() {
			stdin.end();
			if (ended || escalation !== null) return;
			if (options.killTree === true && process.platform === "win32") {
				killProcessTree(child);
				escalation = setTimeout(() => {
					child.kill("SIGKILL");
				}, killGraceMs());
				return;
			}
			const { pid } = child;
			const tree = options.killTree === true && pid !== void 0;
			if (tree) descendants = descendantsOf(readProcessTable(), pid);
			signalProcessGroup(child, "SIGTERM");
			escalation = setTimeout(() => {
				if (!tree) {
					signalProcessGroup(child, "SIGKILL");
					return;
				}
				const table = readProcessTable();
				const now = descendantsOf(table, pid);
				signalProcessGroup(child, "SIGKILL");
				killEntries([...descendants, ...now], table);
				descendants = [];
			}, killGraceMs());
		}
	};
}
var KILL_GRACE_MS, OWN_PROCESS_GROUP;
var init_process$1 = __esmMin((() => {
	init_diagnostics();
	init_ownership();
	init_process_resources();
	init_process_tree();
	init_windows_shim();
	KILL_GRACE_MS = 1e4;
	OWN_PROCESS_GROUP = process.platform !== "win32";
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/isolated.js
function keepTail(text) {
	return text.length > OUTPUT_LIMIT ? text.slice(-1048576) : text;
}
/** Stop the command and everything it started: its process group on POSIX, its process tree on Windows. */
function stopTree$1(child) {
	if (process.platform === "win32") {
		killProcessTree(child);
		return;
	}
	signalProcessGroup(child, "SIGTERM");
	setTimeout(() => {
		signalProcessGroup(child, "SIGKILL");
	}, killGraceMs()).unref();
}
/**
* Run a command that may start others (an updater runs npm or `curl | sh`)
* with no stdin, no controlling terminal (its own session and process group
* on POSIX), and a timeout that stops the whole group rather than only the
* command, so nothing is cut off midway without the caller seeing a timeout
* or left running after it.
*/
async function runIsolated(command, args, options) {
	const target = windowsSpawnTarget(command, args);
	const child = spawn(target.command, [...target.args], {
		env: options.env,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		detached: OWN_PROCESS_GROUP,
		windowsHide: true
	});
	trackOwnedProcess(child);
	let stdout = "";
	let stderr = "";
	const stop = { timedOut: false };
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk) => {
		stdout = keepTail(stdout + chunk);
	});
	child.stderr?.on("data", (chunk) => {
		stderr = keepTail(stderr + chunk);
	});
	const timer = setTimeout(() => {
		stop.timedOut = true;
		stopTree$1(child);
	}, options.timeoutMs);
	const exitCode = await new Promise((resolve) => {
		let code = null;
		child.once("exit", (exit) => {
			code = exit;
			setTimeout(() => {
				resolve(code);
			}, PIPE_DRAIN_MS$1);
		});
		child.once("close", (exit) => {
			resolve(exit ?? code);
		});
		child.once("error", (error) => {
			stderr += error.message;
			resolve(null);
		});
	});
	clearTimeout(timer);
	return {
		exitCode: stop.timedOut ? null : exitCode,
		timedOut: stop.timedOut,
		stdout,
		stderr
	};
}
/**
* A run's stdout then stderr, verbatim, with oar's note when the timeout
* stopped it. `what` names the command for that note ("updater", "installer").
*/
function isolatedOutput(result, timeoutMs, what) {
	const output = `${result.stdout}${result.stderr}`;
	return result.timedOut ? `${output}\n[oar: stopped the ${what} after ${String(timeoutMs)} ms]\n` : output;
}
var OUTPUT_LIMIT, PIPE_DRAIN_MS$1;
var init_isolated = __esmMin((() => {
	init_process$1();
	init_windows_shim();
	OUTPUT_LIMIT = 1024 * 1024;
	PIPE_DRAIN_MS$1 = 2e3;
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/version.js
function firstLine(stdout) {
	return stdout.trim().split(/\r?\n/u)[0];
}
/**
* Read one executable's `--version`, its first line unless `read` picks another part.
* Returns undefined when the executable rejects the flag; execution failures
* and timeouts throw with the native reason and bounded stderr tail.
*/
async function readExecutableVersion(executable, timeoutMs, read = firstLine, env) {
	const result = await runExecutable(executable, ["--version"], {
		env,
		...timeoutMs === void 0 ? {} : { timeoutMs }
	});
	assertRan(result, `Failed to run ${executable} --version`);
	if (!result.ok) return;
	const version = read(result.stdout)?.trim();
	return version === void 0 || version.length === 0 ? void 0 : version;
}
var init_version$1 = __esmMin((() => {
	init_run();
	init_diagnostics();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/executable/index.js
var init_executable = __esmMin((() => {
	init_resolve();
	init_windows_shim();
	init_isolated();
	init_run();
	init_version$1();
	init_process$1();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/environment.js
/** A fresh child environment: strings override, null removes, and the host is untouched. */
function sessionEnvironment(overlay, inherited = process.env, platform = process.platform) {
	const environment = { ...inherited };
	for (const [key, value] of Object.entries(overlay ?? {})) {
		if (platform === "win32") {
			for (const name of Object.keys(environment)) if (name.toUpperCase() === key.toUpperCase()) delete environment[name];
		}
		if (value === null) delete environment[key];
		else environment[key] = value;
	}
	return environment;
}
var init_environment = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/installation.js
init_executable();
init_diagnostics();
init_environment();
function isPinnedPath(entry) {
	return entry.includes("/") || entry.includes("\\");
}
/**
* Where an installation entry is, found without spawning anything: a pinned
* path must exist as given, a bare name resolves on PATH (and PATHEXT on
* Windows). Null when it is not there.
*/
function locateExecutable(entry) {
	if (isPinnedPath(entry)) return existsSync(entry) ? entry : null;
	return resolveExecutable(entry);
}
/** A bare command on PATH, like `which -a`: the copy that runs and the ones after it. Null when there is none. */
function locateOnPath(name) {
	const matches = resolveExecutableAll(name);
	const [command] = matches;
	return command === void 0 ? null : {
		command,
		shadowed: shadowedCopies(matches)
	};
}
function realPath(file) {
	try {
		return realpathSync.native(file);
	} catch {
		return path.resolve(file);
	}
}
/**
* The copies PATH lists after the first of `matches` (which runs), in PATH
* order, each once and as PATH spells it. Paths that resolve to one file are
* one copy: a folder listed twice, `/bin` and `/usr/bin` on merged-usr Linux,
* a symlink to the running copy. A folder holds one copy, the first match
* there: Windows runs the first PATHEXT extension it finds, and the other
* launchers beside it (npm writes `codex.cmd` and `codex.ps1` together) are
* the same installation.
*/
function shadowedCopies(matches) {
	const folders = /* @__PURE__ */ new Set();
	const files = /* @__PURE__ */ new Set();
	const shadowed = [];
	for (const match of matches) {
		const folder = realPath(path.dirname(match));
		if (folders.has(folder)) continue;
		folders.add(folder);
		const file = realPath(match);
		if (files.has(file)) continue;
		if (files.size > 0) shadowed.push(match);
		files.add(file);
	}
	return shadowed;
}
function locateCandidate(entry) {
	if (isPinnedPath(entry)) return existsSync(entry) ? {
		command: entry,
		shadowed: []
	} : null;
	return locateOnPath(entry);
}
async function versionSnapshot({ command, shadowed }, options, env) {
	const version = await readExecutableVersion(command, options.versionTimeoutMs, options.readVersion, env);
	return {
		kind: "available",
		via: "executable",
		command,
		...version === void 0 ? {} : { version },
		...shadowed.length === 0 ? {} : { shadowed }
	};
}
/**
* An installation probed from an executable: the env var pins one candidate
* exclusively; otherwise the command name and fallbacks are tried in order and
* the first usable candidate wins. When readiness args are given, a candidate
* must run them successfully or the probe moves on to the next one. The copies
* a winner found on PATH shadows are reported, never for a pinned env var.
*/
function executableInstallation(envVar, command, fallbacks = [], readiness, options = {}) {
	return async (probeOptions = {}) => {
		const env = sessionEnvironment(probeOptions.env);
		const pinned = process.env[envVar];
		const found = [];
		if (pinned !== void 0 && pinned !== "") {
			const located = locateExecutable(pinned);
			if (located !== null) found.push({
				command: located,
				shadowed: []
			});
		} else for (const entry of [command, ...typeof fallbacks === "function" ? fallbacks() : fallbacks]) {
			const candidate = locateCandidate(entry);
			if (candidate !== null && !found.some((other) => other.command === candidate.command)) found.push(candidate);
		}
		const [first] = found;
		if (first === void 0) return { kind: "not_found" };
		if (readiness === void 0) return versionSnapshot(first, options, env);
		for (const candidate of found) {
			const result = await runExecutable(candidate.command, readiness, {
				env,
				...options.readinessTimeoutMs === void 0 ? {} : { timeoutMs: options.readinessTimeoutMs }
			});
			assertRan(result, `Failed to run ${candidate.command} ${readiness.join(" ")}`);
			if (result.ok) return versionSnapshot(candidate, options, env);
		}
		return {
			kind: "unsupported",
			reason: `${readiness.join(" ")} failed`
		};
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/antigravity/installation.js
/**
* agy_acp_server 1.2.1 prints its build stamp for `--version`; the release
* is the `Build label:` line. Its `--help` exits 1, so there is no cheap
* readiness check beyond the version read.
*/
function readAntigravityVersion(stdout) {
	return /^Build label:\s*(\S+)/mu.exec(stdout)?.[1];
}
/**
* The ACP registry ships the server as a zip that unpacks to
* `agy_acp_server.par` (`agy_acp_server.exe` on Windows) with no installer,
* so it is found on PATH or pinned with OAR_ANTIGRAVITY_BIN.
*/
const antigravityInstallation = executableInstallation("OAR_ANTIGRAVITY_BIN", process.platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par", [], void 0, {
	versionTimeoutMs: 3e4,
	readVersion: readAntigravityVersion
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/instant.js
function utcInstantFromDate(value) {
	return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}
var init_instant = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/json.js
/** Parse JSON text; undefined (never a legal JSON value) signals invalid JSON. */
function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
}
function asRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}
function asNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
/** Narrow an epoch timestamp in seconds or milliseconds to an ISO-8601 instant. */
function asEpochInstant(value) {
	const raw = asNumber(value);
	if (raw === null) return null;
	return utcInstantFromDate(new Date(raw >= 0xe8d4a51000 ? raw : raw * 1e3));
}
/** Array members that are JSON objects; non-arrays and non-object members are dropped. */
function asRecordList(value) {
	if (!Array.isArray(value)) return [];
	const entries = value;
	const records = [];
	for (const entry of entries) {
		const record = asRecord(entry);
		if (record !== null) records.push(record);
	}
	return records;
}
var init_json = __esmMin((() => {
	init_instant();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/update.js
init_executable();
init_json();
const UPGRADE_TIMEOUT_MS = 6e5;
/** The slowest installation probe (kimi) allows 30 s for `--version`; a kimi start after an upgrade also swaps the staged binary in. */
const VERSION_TIMEOUT_MS = 3e4;
/** The release version inside a `--version` line or release pointer: a semver, after a `v` or not (`opencode v2.0.26`). */
function releaseVersion(text) {
	return /\bv?(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/u.exec(text)?.[1];
}
function numericParts(value) {
	return (value.split("-")[0] ?? "").split(".").map(Number);
}
/** Numeric `major.minor.patch` order; prerelease tags are ignored. */
function versionAtLeast(version, floor) {
	const [left, right] = [numericParts(version), numericParts(floor)];
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference > 0;
	}
	return true;
}
const SCRIPT_CONTEXT = /^npm_(?:config_user_agent|lifecycle_|package_|execpath$|node_execpath$|command$)/iu;
/**
* The host environment without the markers a package script run (`npm run`,
* `pnpm run`) adds: given `npm_config_user_agent`, grok 1.0.46 treats a
* script install as npm-managed and installs a second copy. npm
* configuration itself (such as the prefix) stays: npm-method updaters
* should honor it, and the version read-back catches an update that went to
* another prefix.
*/
function updaterEnv(env = process.env) {
	return Object.fromEntries(Object.entries(env).filter(([key]) => !SCRIPT_CONTEXT.test(key)));
}
/** The executable and its installed release version, or why a check cannot start. */
function executableUpdate(installation) {
	if (installation.via !== "executable") return {
		kind: "unavailable",
		check: {
			kind: "unavailable",
			reason: "unsupported_installation",
			detail: "an in-process SDK; it moves with the package that carries it"
		}
	};
	const installed = installation.version === void 0 ? void 0 : releaseVersion(installation.version);
	if (installed === void 0) return {
		kind: "unavailable",
		check: {
			kind: "unavailable",
			reason: "version_unreadable",
			detail: `${installation.command} --version gave no release version`
		}
	};
	return {
		kind: "executable",
		installation,
		installed
	};
}
/** The executable's real path with `/` separators, for install-layout tests. */
function installedPath(command) {
	try {
		return realpathSync(command).replaceAll("\\", "/");
	} catch {
		return command.replaceAll("\\", "/");
	}
}
/** A check from an installed and a released version, when the runtime gives no verdict of its own. */
function comparedCheck(installed, released, source, channel) {
	const latest = releaseVersion(released);
	if (latest === void 0) return {
		kind: "unavailable",
		reason: "version_unreadable",
		detail: `no release version in ${JSON.stringify(released.slice(0, 80))}`,
		source
	};
	return {
		kind: "ok",
		installed,
		latest,
		updateAvailable: latest !== installed,
		...channel === void 0 ? {} : { channel },
		source
	};
}
/** GET one release source; failures come back as the check's `lookup_failed`. */
async function readReleaseSource(url, timeoutMs) {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		if (!response.ok) return {
			ok: false,
			check: {
				kind: "unavailable",
				reason: "lookup_failed",
				detail: `HTTP ${String(response.status)}`,
				source: url
			}
		};
		return {
			ok: true,
			text: await response.text()
		};
	} catch (error) {
		return {
			ok: false,
			check: {
				kind: "unavailable",
				reason: "lookup_failed",
				detail: error instanceof Error ? error.message : String(error),
				source: url
			}
		};
	}
}
/** Run one of the runtime's own check commands, read only, with the updater environment. */
async function runCheckCommand(command, args, timeoutMs) {
	const result = await runIsolated(command, args, {
		env: updaterEnv(),
		timeoutMs
	});
	return {
		result,
		json: parseJson(result.stdout)
	};
}
async function versionNow(command) {
	try {
		const raw = await readExecutableVersion(command, VERSION_TIMEOUT_MS);
		return raw === void 0 ? void 0 : releaseVersion(raw);
	} catch {
		return;
	}
}
/**
* Read the executable's version, check, then run the runtime's own updater
* on the same executable and judge the outcome by the version it reports
* afterwards. The updater runs only when the check does not already say the
* installation is current. The installation's own version is what its probe
* read, and the runtime may have updated itself since (claude's native
* install does in the background), so the check and the comparison start
* from what the executable says now.
*/
async function upgradeExecutable(installation, updater, options = {}) {
	if (installation.via !== "executable") return {
		kind: "unsupported",
		reason: "unsupported_installation",
		detail: "an in-process SDK; it moves with the package that carries it"
	};
	const now = await versionNow(installation.command);
	const current = now === void 0 ? installation : {
		...installation,
		version: now
	};
	const check = await updater.check(current, options.timeoutMs === void 0 ? {} : { timeoutMs: options.timeoutMs });
	if (check.kind === "ok" && !check.updateAvailable) return {
		kind: "current",
		version: check.installed,
		check
	};
	const before = now ?? (check.kind === "ok" ? check.installed : void 0);
	const timeoutMs = options.timeoutMs ?? UPGRADE_TIMEOUT_MS;
	const run = await runIsolated(installation.command, updater.args, {
		env: updaterEnv(updater.env?.() ?? process.env),
		timeoutMs
	});
	const output = isolatedOutput(run, timeoutMs, "updater");
	const after = await versionNow(installation.command);
	if (before !== void 0 && after !== void 0 && after !== before) return {
		kind: "upgraded",
		from: before,
		to: after,
		output
	};
	if (run.exitCode !== 0 || after === void 0) return {
		kind: "failed",
		exitCode: run.exitCode,
		output
	};
	return {
		kind: "unchanged",
		version: after,
		output
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/install.js
init_executable();
const INSTALL_TIMEOUT_MS = 6e5;
/** An installer's location variable when it is set and not empty, otherwise its default. */
function installDir(variable, fallback) {
	return variable === void 0 || variable === "" ? fallback : variable;
}
function nearestExisting(dir) {
	let current = path.resolve(dir);
	while (!existsSync(current)) {
		const parent = path.dirname(current);
		if (parent === current) return current;
		current = parent;
	}
	return current;
}
/** The nearest existing directory at or above `dir`, when this user cannot write it; null when `dir` can be created or written. */
function unwritableAncestor(dir) {
	const existing = nearestExisting(dir);
	try {
		accessSync(existing, constants.W_OK);
		return null;
	} catch {
		return existing;
	}
}
const thisMachine = {
	platform: process.platform,
	arch: process.arch,
	locate: (tool) => resolveExecutable(tool),
	unwritable: unwritableAncestor
};
const SCRIPT_PLATFORMS = new Set(["darwin", "linux"]);
const SCRIPT_ARCHES = new Set(["x64", "arm64"]);
/**
* The plan for a script installer on `host`: `platform` off macOS and Linux
* (the vendors' Windows installers are PowerShell scripts oar has not
* verified, so their command is only named), `missing_tool` when the line's
* programs are not on PATH, `requires_privileges` when a directory it writes
* is not this user's to write (an install location variable pointing at
* `/usr/local`, say), which the installer would otherwise discover midway.
* Those two still carry the plan's `steps` and `source`, for a person to run
* once they have the tool or the rights.
*/
function scriptInstallPlanOn(method, host) {
	const steps = [{
		command: [
			"sh",
			"-c",
			method.line
		],
		display: method.line
	}];
	if (!SCRIPT_PLATFORMS.has(host.platform)) return {
		kind: "unsupported",
		reason: "platform",
		detail: host.platform === "win32" ? `oar runs this installer on macOS and Linux only. On Windows, ${method.windows}` : `the installer supports macOS and Linux, not ${host.platform}`
	};
	if (!SCRIPT_ARCHES.has(host.arch)) return {
		kind: "unsupported",
		reason: "platform",
		detail: `the installer has no build for ${host.arch}`
	};
	for (const tool of ["sh", ...method.tools]) if (host.locate(tool) === null) return {
		kind: "unsupported",
		reason: "missing_tool",
		detail: tool,
		steps,
		source: method.source
	};
	for (const dir of method.writes()) {
		const blocked = host.unwritable(dir);
		if (blocked !== null) return {
			kind: "unsupported",
			reason: "requires_privileges",
			detail: `the installer writes ${dir}, and ${blocked} is not writable by this user`,
			steps,
			source: method.source
		};
	}
	return {
		kind: "plan",
		steps,
		source: method.source,
		network: true,
		privileges: false
	};
}
/** A runtime with one release line: a `line` is refused, never ignored. */
function scriptInstallPlan(method, host = thisMachine) {
	return async (options = {}) => {
		await Promise.resolve();
		if (options.line !== void 0) return {
			kind: "unsupported",
			reason: "unknown_line",
			detail: `this runtime ships one release line; leave line ${JSON.stringify(options.line)} out`
		};
		return scriptInstallPlanOn(method, host);
	};
}
/**
* The plan for the line `options.line` names: `line_required` without one
* (oar does not choose a line for the person), `unknown_line` for a line the
* runtime does not ship.
*/
function linedInstallPlan(lined, host = thisMachine) {
	const names = lined.lines.map((entry) => entry.line).join(", ");
	return async (options = {}) => {
		await Promise.resolve();
		if (options.line === void 0) return {
			kind: "unsupported",
			reason: "line_required",
			detail: `choose a release line: ${names}`
		};
		const method = Object.hasOwn(lined.methods, options.line) ? lined.methods[options.line] : void 0;
		if (method === void 0) return {
			kind: "unsupported",
			reason: "unknown_line",
			detail: `${JSON.stringify(options.line)} is not one of ${names}`
		};
		return scriptInstallPlanOn(method, host);
	};
}
/** A runtime whose vendor offers nothing oar can run: its plan and its install give this answer. */
function unsupportedInstallPlan(unsupported) {
	return async () => {
		await Promise.resolve();
		return unsupported;
	};
}
/** Run the steps in order, without stdin or a terminal, stopping at the first that fails; one deadline bounds them all. */
async function runSteps(steps, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let output = "";
	let exitCode = 0;
	for (const step of steps) {
		const [command, ...args] = step.command;
		if (command === void 0) continue;
		const run = await runIsolated(command, args, {
			env: updaterEnv(),
			timeoutMs: Math.max(deadline - Date.now(), 1)
		});
		output += isolatedOutput(run, timeoutMs, "installer");
		exitCode = run.exitCode;
		if (run.timedOut || exitCode !== 0) break;
	}
	return {
		exitCode,
		output
	};
}
async function probeAfter(probe) {
	try {
		return {
			snapshot: await probe(),
			note: ""
		};
	} catch (error) {
		return { note: `\n[oar: the installation probe after the installer failed: ${error instanceof Error ? error.message : String(error)}]\n` };
	}
}
function withLine(installation, lineOf) {
	const line = lineOf?.(installation);
	return line === void 0 ? { installation } : {
		installation,
		line
	};
}
/**
* An installer from the runtime's installation probe and its plan. The
* probe decides both ends: an installation it already finds means nothing
* runs (`already_installed`, whichever line was asked for, so a copy of one
* line is never replaced by another), and after the plan's steps ran, only
* an available installation it finds is `installed`, whatever the installer
* exited with: what the probe finds is what a session would run, and a copy
* the installer put where the probe does not look is a probe to fix.
* `lineOf` names the line of what the probe found, for a runtime with lines.
*/
function planInstaller(probe, plan, lineOf) {
	return async (options = {}) => {
		const before = await probe();
		if (before.kind === "available") return {
			kind: "already_installed",
			...withLine(before, lineOf)
		};
		const planned = await plan(options);
		if (planned.kind === "unsupported") return planned;
		const run = await runSteps(planned.steps, options.timeoutMs ?? INSTALL_TIMEOUT_MS);
		const after = await probeAfter(probe);
		if (after.snapshot?.kind === "available") return {
			kind: "installed",
			...withLine(after.snapshot, lineOf),
			output: run.output
		};
		return {
			kind: "failed",
			exitCode: run.exitCode,
			output: `${run.output}${after.note}`
		};
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/antigravity/install.js
/**
* Google documents installing the Antigravity agent only from inside an
* editor (Zed: agent settings, External Agents, Install from Registry;
* https://antigravity.google/docs/ide/extensions/zed), which also signs it in
* through the browser. There is no command-line installer: the ACP registry's
* zip is what the editor unpacks.
*/
const antigravityInstallPlan = unsupportedInstallPlan({
	kind: "unsupported",
	reason: "requires_gui",
	detail: "Google installs the Antigravity agent from an editor's agent registry (Zed: External Agents, Install from Registry); https://antigravity.google/docs/ide/extensions/zed"
});
const antigravityInstall = planInstaller(antigravityInstallation, antigravityInstallPlan);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/antigravity/update.js
init_json();
/**
* agy_acp_server has no updater and Google publishes no latest pointer; the
* ACP registry entry is the only release listing, and it trails Google's
* own downloads (1.2.1 listed while 1.3.0 was downloadable on 2026-10-01).
* So this check names the registry as its source, counts only a newer
* registry version as an update, and there is no upgrade.
*/
function antigravityUpdateCheck(registry = "https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json") {
	return async (installation, options = {}) => {
		const update = executableUpdate(installation);
		if (update.kind === "unavailable") return update.check;
		const read = await readReleaseSource(registry, options.timeoutMs ?? 2e4);
		if (!read.ok) return read.check;
		const version = asRecord(parseJson(read.text))?.version;
		const check = comparedCheck(update.installed, typeof version === "string" ? version : "", registry);
		return check.kind === "ok" && check.updateAvailable ? {
			...check,
			updateAvailable: !versionAtLeast(check.installed, check.latest)
		} : check;
	};
}
const antigravityCheckUpdate = antigravityUpdateCheck();
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/antigravity/options.js
var antigravityRefusedSessionOptions;
var init_options$3 = __esmMin((() => {
	antigravityRefusedSessionOptions = {
		outputSchema: "Antigravity ACP and launch configuration expose no final-output schema channel",
		name: "antigravity exposes no verified session name setting",
		additionalDirectories: "antigravity accepts but ignores ACP additionalDirectories",
		serviceTier: "antigravity exposes no verified per-session service-tier setting and readback",
		systemPrompt: "The Antigravity ACP server has no system prompt override in its protocol, launch options, or configuration",
		mcpServerCredentials: "antigravity stores a session's MCP servers, env and header values included, in plain text in its conversation database, where they outlive the session; it attaches no entry with env or headers"
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/contracts/errors.js
var UnsupportedOptionError;
var init_errors$1 = __esmMin((() => {
	UnsupportedOptionError = class extends Error {
		name = "UnsupportedOptionError";
		option;
		constructor(option, message) {
			super(message);
			this.option = option;
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/redact-text.js
/** Copy diagnostic data, including Error fields and cause chains, replacing known strings without mutating native inputs. */
function redactText(value, redact, contains) {
	const scanned = /* @__PURE__ */ new Set();
	const matches = (entry) => {
		if (typeof entry === "string") return contains(entry);
		if (entry === null || typeof entry !== "object" || scanned.has(entry)) return false;
		scanned.add(entry);
		if (Array.isArray(entry)) return entry.some((item) => matches(item));
		return Object.getOwnPropertyNames(entry).some((key) => {
			if (contains(key)) return true;
			const descriptor = Object.getOwnPropertyDescriptor(entry, key);
			if (descriptor !== void 0 && "value" in descriptor) return matches(descriptor.value);
			return entry instanceof Error && key === "stack" && matches(entry.stack);
		});
	};
	if (!matches(value)) return value;
	const seen = /* @__PURE__ */ new Map();
	const copy = (entry) => {
		if (typeof entry === "string") return redact(entry);
		if (entry === null || typeof entry !== "object") return entry;
		if (seen.has(entry)) return seen.get(entry);
		if (Array.isArray(entry)) {
			const result = [];
			seen.set(entry, result);
			for (const item of entry) result.push(copy(item));
			return result;
		}
		const result = entry instanceof Error ? Object.setPrototypeOf(new Error(redact(entry.message)), Object.getPrototypeOf(entry)) : {};
		seen.set(entry, result);
		for (const key of Object.getOwnPropertyNames(entry)) {
			const descriptor = Object.getOwnPropertyDescriptor(entry, key);
			if (descriptor !== void 0 && "value" in descriptor) Object.defineProperty(result, redact(key), {
				...descriptor,
				value: copy(descriptor.value)
			});
			else if (entry instanceof Error && key === "stack" && typeof entry.stack === "string") Object.defineProperty(result, "stack", {
				value: redact(entry.stack),
				configurable: true,
				writable: true
			});
		}
		return result;
	};
	return copy(value);
}
var init_redact_text = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/credential-redactor.js
function credentialValue(value) {
	return typeof value === "string" && value.length >= CREDENTIAL_MIN_LENGTH && !PATH_VALUE.test(value);
}
/** A connection string proves its password is a credential, regardless of the env name. */
function urlCredentials(value) {
	if (typeof value !== "string" || !/^[a-z][a-z\d+.-]*:\/\//iu.test(value) || !URL.canParse(value)) return [];
	const parsed = new URL(value);
	if (parsed.password === "") return [];
	const passwords = [parsed.password];
	try {
		passwords.push(decodeURIComponent(parsed.password));
	} catch {}
	return [value, ...passwords.filter((password) => password.length >= CREDENTIAL_MIN_LENGTH)];
}
/** Explicit session credentials only; runtime-native keys can be added after SDK resolution. */
function sessionCredentialRedactor(options) {
	const known = /* @__PURE__ */ new Set();
	const add = (value) => {
		if (credentialValue(value)) known.add(value);
	};
	const env = (entries) => {
		for (const [name, value] of Object.entries(entries ?? {})) {
			const upper = name.toUpperCase();
			if (CREDENTIAL_WORDS.has(upper.split("_").at(-1) ?? "") || CREDENTIAL_NAMES.has(upper)) add(value);
			for (const credential of urlCredentials(value)) known.add(credential);
		}
	};
	env(options.env);
	for (const server of options.mcpServers ?? []) {
		if (!("type" in server)) {
			env(server.env);
			continue;
		}
		for (const [name, value] of Object.entries(server.headers ?? {})) {
			const upper = name.toUpperCase();
			const authorization = AUTH_HEADERS.has(upper);
			if (authorization || CREDENTIAL_WORDS.has(upper.split("-").at(-1) ?? "")) add(value);
			if (authorization) add(/^\s*\S+\s+(.+?)\s*$/u.exec(value)?.[1]);
		}
	}
	let values = [...known].toSorted((left, right) => right.length - left.length);
	const redact = (text) => values.reduce((result, value) => result.replaceAll(value, "[redacted]"), text);
	return {
		add(value) {
			if (credentialValue(value) && !known.has(value)) {
				known.add(value);
				values = [...known].toSorted((left, right) => right.length - left.length);
			}
		},
		redact,
		redactValue: (value) => values.length === 0 ? value : redactText(value, redact, (text) => values.some((knownValue) => text.includes(knownValue)))
	};
}
var CREDENTIAL_WORDS, AUTH_HEADERS, CREDENTIAL_NAMES, CREDENTIAL_MIN_LENGTH, PATH_VALUE;
var init_credential_redactor = __esmMin((() => {
	init_redact_text();
	CREDENTIAL_WORDS = new Set([
		"KEY",
		"APIKEY",
		"TOKEN",
		"SECRET",
		"PASSWORD",
		"PASSWD",
		"PASSPHRASE",
		"CREDENTIAL",
		"CREDENTIALS",
		"COOKIE",
		"PWD"
	]);
	AUTH_HEADERS = new Set(["AUTHORIZATION", "PROXY-AUTHORIZATION"]);
	CREDENTIAL_NAMES = new Set(["PGPASSWORD"]);
	CREDENTIAL_MIN_LENGTH = 8;
	PATH_VALUE = /^(?:\/|~\/|[a-z]:\\)/iu;
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/turn-stop.js
/** Fold only the current root turn's controls; callers own scope and turn boundaries. */
function reduceTurnStop(previous, record) {
	const pending = previous?.pendingAbortIds ?? [];
	const aborted = previous?.abortedOnExit === true;
	if (record.kind === "request" && record.direction === "toRuntime") {
		if (record.body.kind === "dispose") return {
			pendingAbortIds: pending,
			abortedOnExit: true
		};
		if (record.body.kind === "abort") return {
			pendingAbortIds: [...pending, record.id],
			abortedOnExit: aborted
		};
	}
	if (record.kind === "response" && (record.body.kind === "accepted" || record.body.kind === "rejected") && pending.includes(record.requestId)) {
		const remaining = pending.filter((id) => id !== record.requestId);
		const abortedOnExit = aborted || record.body.kind === "accepted";
		return remaining.length === 0 && !abortedOnExit ? void 0 : {
			pendingAbortIds: remaining,
			abortedOnExit
		};
	}
	return previous;
}
/** An observed exit ends stopped work as aborted, preserving the exit record itself. */
function exitTurnOutcome(stop) {
	return stop?.abortedOnExit === true ? { kind: "aborted" } : {
		kind: "failed",
		reason: "runtime exited",
		failure: "runtime_exited"
	};
}
var init_turn_stop = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/agent-status.js
/** The status fold over a retained log, as a query (`Session.status()`): `seq` is the last record consumed, -1 before any. */
function statusOf$1(records, sessionId) {
	let value = initialStatus;
	let seq = -1;
	for (const record of records) {
		value = reduceStatus(value, record, sessionId);
		seq = record.seq;
	}
	return {
		value,
		seq
	};
}
function running$1(previous, record, phase) {
	const sinceSeq = previous.kind === "running" ? previous.sinceSeq : record.seq;
	const requestId = previous.kind === "running" ? previous.requestId : void 0;
	return {
		kind: "running",
		sinceSeq,
		...requestId === void 0 ? {} : { requestId },
		...previous.kind === "running" && previous.stop !== void 0 ? { stop: previous.stop } : {},
		...previous.kind === "running" && previous.inputId !== void 0 ? { inputId: previous.inputId } : {},
		...previous.pendingPrompt === void 0 ? {} : { pendingPrompt: previous.pendingPrompt },
		phase,
		lastEventAt: record.receivedAt
	};
}
function reduceStatus(previous, record, sessionId) {
	const foreignSession = sessionId !== void 0 && record.sessionId !== sessionId;
	if (foreignSession && !belongsToSession(record, sessionId)) return previous;
	if (foreignSession || record.agentPath.length > 0 || record.kind === "frame" && record.body.events.length === 0) return previous.kind === "running" ? {
		...previous,
		lastEventAt: record.receivedAt
	} : previous;
	if (previous.pendingPrompt !== void 0 && (previous.kind === "idle" || previous.inputId === previous.pendingPrompt.inputId || record.kind === "request" && record.body.kind === "dispose" || record.kind === "response" && previous.pendingPrompt.stop?.pendingAbortIds.includes(record.requestId) === true)) {
		const { stop: priorStop, ...pendingPrompt } = previous.pendingPrompt;
		const stop = reduceTurnStop(priorStop, record);
		if (stop !== priorStop) previous = {
			...previous,
			pendingPrompt: stop === void 0 ? pendingPrompt : {
				...pendingPrompt,
				stop
			}
		};
	}
	if (previous.kind === "running") {
		const { stop: priorStop, ...active } = previous;
		const stop = reduceTurnStop(priorStop, record);
		if (stop !== priorStop) previous = stop === void 0 ? active : {
			...active,
			stop
		};
	}
	switch (record.kind) {
		case "request": return record.direction === "toRuntime" && record.body.kind === "prompt" && previous.kind === "idle" && previous.pendingPrompt === void 0 ? {
			kind: "running",
			sinceSeq: record.seq,
			requestId: record.id,
			...record.body.inputId === void 0 ? {} : { inputId: record.body.inputId },
			phase: "waiting_model",
			lastEventAt: record.receivedAt
		} : previous;
		case "response":
			if (record.body.kind === "rejected" && previous.kind === "running" && previous.requestId === record.requestId) return { kind: "idle" };
			if (record.body.kind === "exited" && previous.kind === "idle") return {
				kind: "idle",
				...previous.lastTurnOutcome === void 0 ? {} : { lastTurnOutcome: previous.lastTurnOutcome }
			};
			if (record.body.kind === "exited" && previous.kind === "running") return {
				kind: "idle",
				lastTurnOutcome: exitTurnOutcome(previous.stop)
			};
			return previous;
		case "frame": {
			let status = previous;
			for (const event of record.body.events) status = reduceEvent(status, record, event);
			return status;
		}
		default: return previous;
	}
}
function reduceEvent(previous, record, event) {
	switch (event.kind) {
		case "input_queued": {
			const own = previous.kind === "running" && previous.inputId === event.inputId;
			const pendingPrompt = {
				inputId: event.inputId,
				sinceSeq: own ? previous.sinceSeq : record.seq,
				...own && previous.requestId !== void 0 ? { requestId: previous.requestId } : {},
				...own && previous.stop !== void 0 ? { stop: previous.stop } : {}
			};
			return {
				...previous,
				pendingPrompt,
				...previous.kind === "running" ? { lastEventAt: record.receivedAt } : {}
			};
		}
		case "turn_active":
			if (event.inputId !== void 0 && previous.pendingPrompt?.inputId === event.inputId) return waitingForPrompt(previous.pendingPrompt, record, false);
			if (previous.pendingPrompt !== void 0 && (previous.kind === "idle" || previous.inputId === previous.pendingPrompt.inputId)) return {
				kind: "running",
				sinceSeq: record.seq,
				phase: "waiting_model",
				lastEventAt: record.receivedAt,
				pendingPrompt: previous.pendingPrompt
			};
			return previous.kind === "running" ? {
				...previous,
				lastEventAt: record.receivedAt
			} : running$1(previous, record, "waiting_model");
		case "reasoning": return running$1(previous, record, "thinking");
		case "text_delta": return running$1(previous, record, "responding");
		case "tool_call_started": return running$1(previous, record, {
			tool: event.tool,
			callId: event.callId
		});
		case "tool_call_ended":
		case "retry": return running$1(previous, record, "waiting_model");
		case "compaction_ended": return previous.kind === "running" ? running$1(previous, record, "waiting_model") : previous;
		case "compaction_started": return running$1(previous, record, "compacting");
		case "tool_call_input_delta":
		case "tool_call_input": {
			if (previous.kind !== "running") return previous;
			const { phase } = previous;
			if (typeof phase === "object" && phase.callId === event.callId) return {
				...previous,
				phase: event.kind === "tool_call_input_delta" ? {
					tool: phase.tool,
					callId: phase.callId,
					writing: true
				} : {
					tool: phase.tool,
					callId: phase.callId
				},
				lastEventAt: record.receivedAt
			};
			return {
				...previous,
				lastEventAt: record.receivedAt
			};
		}
		case "tool_call_progress": return previous.kind === "running" ? {
			...previous,
			lastEventAt: record.receivedAt
		} : previous;
		case "turn_ended": return previous.pendingPrompt === void 0 ? {
			kind: "idle",
			lastTurnOutcome: event.outcome
		} : waitingForPrompt(previous.pendingPrompt, record, true);
		case "task_started":
		case "task_updated":
		case "task_ended": return previous.kind === "running" ? {
			...previous,
			lastEventAt: record.receivedAt
		} : previous;
		case "input_dropped": {
			if (previous.kind === "running" && previous.inputId === event.inputId) return { kind: "idle" };
			if (previous.pendingPrompt?.inputId !== event.inputId) return previous;
			const { pendingPrompt: _pending, ...status } = previous;
			return status;
		}
		case "app_request_cancelled":
		case "session_linked":
		case "user_message":
		case "usage":
		case "model":
		case "effort":
		case "service_tier": return previous;
	}
	return previous;
}
/** A notification can finish while the accepted host input still owns the slot. */
function waitingForPrompt(pending, record, keepPending) {
	return {
		kind: "running",
		sinceSeq: pending.sinceSeq,
		inputId: pending.inputId,
		...pending.requestId === void 0 ? {} : { requestId: pending.requestId },
		...pending.stop === void 0 ? {} : { stop: pending.stop },
		...keepPending ? { pendingPrompt: pending } : {},
		phase: "waiting_model",
		lastEventAt: record.receivedAt
	};
}
/**
* Whether a record of another session id belongs to this session's activity.
* The stream only ever carries the session's own records and its derived
* children's (docs/spec/session-graph-and-cursor.md), so every record in it
* counts; the hook exists so a consumer folding a merged multi-session log can
* narrow it.
*/
function belongsToSession(_record, _sessionId) {
	return true;
}
var initialStatus;
var init_agent_status = __esmMin((() => {
	init_turn_stop();
	initialStatus = { kind: "idle" };
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/tool-output.js
/**
* One content block as a tool output part. Images come in two shapes:
* Anthropic's `{type: "image", source: {type: "base64", media_type, data}}`
* (claude's `Read` of an image) and the MCP / pi / ACP
* `{type: "image", data, mimeType}`. Any block that is neither text nor a
* recognized image is kept whole as `other`.
*/
function toolOutputPart(block) {
	const record = asRecord(block);
	if (record?.type === "text" && typeof record.text === "string") return {
		type: "text",
		text: record.text
	};
	if (record?.type === "image") {
		const source = asRecord(record.source);
		if (source?.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string") return {
			type: "image",
			mediaType: source.media_type,
			data: source.data
		};
		if (typeof record.data === "string" && typeof record.mimeType === "string") return {
			type: "image",
			mediaType: record.mimeType,
			data: record.data
		};
	}
	return {
		type: "other",
		value: block
	};
}
/**
* A tool result value as `tool_call_ended.content`: a string is one text
* part, an array is its blocks in order (`unwrap` reaches a block a wrapper
* carries, ACP's `{type: "content", content}`), anything else is one `other`
* part, and an absent value or an empty array is no content.
*/
function toolContent(value, unwrap = (block) => block) {
	if (value === void 0 || value === null) return;
	if (typeof value === "string") return [{
		type: "text",
		text: value
	}];
	if (Array.isArray(value)) return value.length === 0 ? void 0 : value.map((block) => toolOutputPart(unwrap(block)));
	return [{
		type: "other",
		value
	}];
}
var init_tool_output = __esmMin((() => {
	init_json();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/legacy.js
/**
* Records written by an older OAR, read through today's folds. Hosts persist
* records and replay them (foundations: the host owns its data layer), so a
* fold must still read what an earlier version wrote. Each upgrade names the
* version whose shape it reads; nothing here changes a current record.
*/
function isContentBlockArray(value) {
	return Array.isArray(value) && value.length > 0 && value.every((block) => typeof asRecord(block)?.type === "string");
}
/**
* Before 0.14.0, `tool_call_ended` carried the result as one `output` string.
* As `content`: the JSON of content blocks (claude stringified its
* `tool_result` blocks) becomes their parts, a JSON string literal (claude
* quoted a plain string result) becomes its text, and anything else is the
* text it was.
*/
function contentOfLegacyOutput(output) {
	let parsed = void 0;
	try {
		parsed = JSON.parse(output);
	} catch {
		return [{
			type: "text",
			text: output
		}];
	}
	if (isContentBlockArray(parsed)) return toolContent(parsed) ?? [{
		type: "text",
		text: output
	}];
	return [{
		type: "text",
		text: typeof parsed === "string" ? parsed : output
	}];
}
/** A pre-0.14.0 tool end's `output`, when the event is one; undefined otherwise. */
function legacyOutput(event) {
	if (event.kind !== "tool_call_ended" || event.content !== void 0) return;
	const output = asRecord(event)?.output;
	return typeof output === "string" ? output : void 0;
}
/** An event body as today's folds read it: a pre-0.14.0 tool end gets `content` from its `output`. */
function upgradeLegacyBody(event) {
	const output = legacyOutput(event);
	if (output === void 0 || event.kind !== "tool_call_ended") return event;
	const { callId, result, exitCode } = event;
	return {
		kind: "tool_call_ended",
		callId,
		content: contentOfLegacyOutput(output),
		...result === void 0 ? {} : { result },
		...exitCode === void 0 ? {} : { exitCode }
	};
}
var init_legacy = __esmMin((() => {
	init_json();
	init_tool_output();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/events.js
/** What `eventsOf` keeps of a request body: null for a runtime→app body. */
function knownControl(body) {
	if (body.kind === "native") return null;
	return body.kind === "withdraw" ? body : body.kind;
}
/**
* The consumer face of the stream. `eventsOf` reads the flat, attributed
* `Event`s out of one record: every reading of a Frame (each stamped with the
* frame's envelope, so events read from one frame share its `seq`), the turn
* start a prompt request is, a held input taken back (an accepted withdraw),
* a rejected control action, a runtime→app request and oar's answer, and the
* process exit.
* A record oar read nothing from yields no events. Pure given `actions`, the
* toRuntime requests seen so far (a response names only its `requestId`;
* `controlActionsOf` builds the map from a log), so a RawEvent log replays
* into exactly the events the live subscription delivered.
*/
function eventsOf(record, actions = /* @__PURE__ */ new Map()) {
	const { sessionId, agentPath, seq, receivedAt } = record;
	const envelope = {
		sessionId,
		agentPath,
		seq,
		receivedAt,
		...record.spanId === void 0 ? {} : { spanId: record.spanId }
	};
	switch (record.kind) {
		case "frame": return record.body.events.map((event) => ({
			...upgradeLegacyBody(event),
			...envelope
		}));
		case "request":
			if (record.direction === "toApp") {
				const type = record.body.kind === "native" ? record.body.type : record.body.kind;
				return [{
					kind: "app_request",
					requestId: record.id,
					type,
					...envelope
				}];
			}
			return record.body.kind === "prompt" ? [{
				kind: "turn_started",
				requestId: record.id,
				input: record.body.input,
				...envelope
			}] : [];
		case "response": {
			if (record.body.kind === "exited") return [{
				kind: "exited",
				code: record.body.code,
				...envelope
			}];
			if (record.body.kind === "answered") return [{
				kind: "app_answered",
				requestId: record.requestId,
				...envelope
			}];
			const known = actions.get(record.requestId);
			if (record.body.kind === "rejected") return known === void 0 ? [] : [{
				kind: "control_rejected",
				requestId: record.requestId,
				action: typeof known === "string" ? known : known.kind,
				code: record.body.code,
				reason: record.body.reason,
				...envelope
			}];
			return known === void 0 || typeof known === "string" ? [] : [{
				kind: "input_withdrawn",
				requestId: record.requestId,
				inputId: known.inputId,
				...envelope
			}];
		}
	}
	return [];
}
function remember(actions, record) {
	if (record.kind === "request" && record.direction === "toRuntime") {
		const known = knownControl(record.body);
		if (known !== null) actions.set(record.id, known);
	}
}
/** A raw-event observer that delivers `eventsOf` each record to `observer`, remembering toRuntime requests so a rejection names its action and an accepted withdraw its input. */
function eventsReader(observer) {
	const actions = /* @__PURE__ */ new Map();
	return (record) => {
		remember(actions, record);
		for (const event of eventsOf(record, actions)) observer(event);
		if (record.kind === "response") actions.delete(record.requestId);
	};
}
function textOf(event) {
	if (event.kind === "text_delta") return event.text;
	return event.kind === "reasoning" && event.content.kind === "text" ? event.content.text : null;
}
function withText(event, text) {
	if (event.kind === "reasoning") return {
		...event,
		content: {
			kind: "text",
			text
		}
	};
	return event.kind === "text_delta" ? {
		...event,
		text
	} : event;
}
function messageIdOf(event) {
	return event.kind === "text_delta" || event.kind === "reasoning" ? event.messageId : void 0;
}
function sameLane(held, next) {
	return held.kind === next.kind && held.sessionId === next.sessionId && held.agentPath.length === next.agentPath.length && held.agentPath.every((segment, index) => segment === next.agentPath[index]) && messageIdOf(held) === messageIdOf(next);
}
/**
* Consumer-side coalescing: wrap an event observer so consecutive text (or
* readable reasoning) pieces of one agent arrive as one event instead of a
* token stream. Flushes when the kind, agent or `messageId` changes, a
* non-text event arrives, or (when `maxHoldMs` is set) the stream goes quiet
* for that long.
* The merged event carries the LAST piece's envelope. Order is safe because
* only consecutive same-lane pieces are ever held.
*/
function coalesceText(observer, options = {}) {
	let held = null;
	let holdTimer = null;
	const flush = () => {
		if (holdTimer !== null) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
		if (held !== null) {
			const event = held;
			held = null;
			observer(event);
		}
	};
	const armHoldTimer = () => {
		if (options.maxHoldMs === void 0) return;
		if (holdTimer !== null) clearTimeout(holdTimer);
		holdTimer = setTimeout(flush, options.maxHoldMs);
	};
	return (event) => {
		const text = textOf(event);
		if (text !== null) {
			const previousText = held === null ? null : textOf(held);
			if (held !== null && previousText !== null && sameLane(held, event)) {
				held = withText(event, `${previousText}${text}`);
				armHoldTimer();
				return;
			}
			flush();
			held = event;
			armHoldTimer();
			return;
		}
		flush();
		observer(event);
	};
}
var init_events = __esmMin((() => {
	init_legacy();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/graph.js
/** Record envelopes establish nodes. A retained index avoids scanning nodes in long-lived folds. */
function withSessionNode(graph, id, nodeIds) {
	if (nodeIds?.has(id) ?? graph.nodes.some((node) => node.id === id)) return graph;
	nodeIds?.add(id);
	return {
		...graph,
		nodes: [...graph.nodes, { id }]
	};
}
/** The same native edge may be reported many times; the graph contains it once. */
function withSessionLink(graph, edge, nodeIds) {
	const nodes = withSessionNode(withSessionNode(graph, edge.parent, nodeIds), edge.child, nodeIds);
	return nodes.edges.some((known) => known.parent === edge.parent && known.child === edge.child) ? nodes : {
		...nodes,
		edges: [...nodes.edges, {
			parent: edge.parent,
			child: edge.child,
			via: edge.via
		}]
	};
}
/** One record's graph facts, shared by the retained live graph and batch replay. */
function withSessionRecord(graph, record, nodeIds) {
	let next = withSessionNode(graph, record.sessionId, nodeIds);
	if (record.kind === "frame") {
		for (const event of record.body.events) if (event.kind === "session_linked") next = withSessionLink(next, event, nodeIds);
	}
	return next;
}
/**
* True sessions observed in records, with only runtime-reported lineage.
* Foreign session ids establish nodes, never edges. Old logs without
* `session_linked` therefore have no edges; an empty log has no nodes.
*/
function graphOf(records) {
	let graph = {
		nodes: [],
		edges: []
	};
	const nodeIds = /* @__PURE__ */ new Set();
	for (const record of records) graph = withSessionRecord(graph, record, nodeIds);
	return graph;
}
var init_graph = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/token-totals.js
function sumPart(previous, report) {
	return previous === void 0 && report === void 0 ? void 0 : (previous ?? 0) + (report ?? 0);
}
/**
* `previous` plus one report's counts: an adapter folding a frame's own
* usage into its running total, or a fold summing agents into the session
* total. `cacheRead` / `cacheWrite` / `reasoning` add like `input` but exist only once a
* report carried them: a report without one adds nothing to it, and one that
* has appeared stays (TokenTotals in contracts/records.ts).
*/
function addTokens(previous, report) {
	const cacheRead = sumPart(previous.cacheRead, report.cacheRead);
	const cacheWrite = sumPart(previous.cacheWrite, report.cacheWrite);
	const reasoning = sumPart(previous.reasoning, report.reasoning);
	return {
		input: previous.input + report.input,
		output: previous.output + report.output,
		...reasoning === void 0 ? {} : { reasoning },
		...cacheRead === void 0 ? {} : { cacheRead },
		...cacheWrite === void 0 ? {} : { cacheWrite }
	};
}
/**
* `total` counted from `baseline` on: a runtime's own running total less
* the total it had already reported when this Session opened, so the
* numbers count from when this Session opened (TokenTotals in
* contracts/records.ts). Each part is the runtime's own number minus the
* baseline's; a part `total` lacks stays absent, and a part the baseline
* lacks subtracts nothing.
*/
function subtractTokens(total, baseline) {
	return {
		input: total.input - baseline.input,
		output: total.output - baseline.output,
		...total.reasoning === void 0 ? {} : { reasoning: total.reasoning - (baseline.reasoning ?? 0) },
		...total.cacheRead === void 0 ? {} : { cacheRead: total.cacheRead - (baseline.cacheRead ?? 0) },
		...total.cacheWrite === void 0 ? {} : { cacheWrite: total.cacheWrite - (baseline.cacheWrite ?? 0) }
	};
}
/** A native reasoning subset of output; absence stays unknown, never inferred from text or effort. */
function reasoningPart(usage, field) {
	const reasoning = asNumber(usage[field]);
	return reasoning === null ? {} : { reasoning };
}
/**
* The cache parts a native usage record reports, read from the runtime's own
* field names: a field the record lacks (or that is not a number) stays
* absent, never a guessed 0.
*/
function cacheParts(usage, fields) {
	const cacheRead = asNumber(usage[fields.read]);
	const cacheWrite = asNumber(usage[fields.write]);
	return {
		...cacheRead === null ? {} : { cacheRead },
		...cacheWrite === null ? {} : { cacheWrite }
	};
}
var noTokens;
var init_token_totals = __esmMin((() => {
	init_json();
	noTokens = {
		input: 0,
		output: 0
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/usage-totals.js
function hasTokens(tokens) {
	return tokens.input > 0 || tokens.output > 0;
}
/**
* A session's usage from each agent's latest running total and, where the
* runtime reports one beyond its agents' figures (claude's `modelUsage`), its
* own session total: then the total is the runtime's, and what no agent
* accounts for is `unattributed`, the difference, never split by estimate.
* Elsewhere the agents' figures sum to the total. Shared by `usageOf` and the
* session view.
*/
function sessionUsageFrom(byAgent, reported) {
	if (byAgent.length === 0 && reported === null) return { total: null };
	const attributed = byAgent.reduce((sum, entry) => addTokens(sum, entry.tokens), noTokens);
	const remainder = reported === null ? null : subtractTokens(reported, attributed);
	const unattributed = remainder !== null && hasTokens(remainder) ? remainder : null;
	const onlyRoot = byAgent.length <= 1 && byAgent.every((entry) => entry.agentPath.length === 0);
	return {
		total: reported ?? attributed,
		...onlyRoot && unattributed === null ? {} : { byAgent },
		...unattributed === null ? {} : { unattributed }
	};
}
/** Every session derived from `sessionId` in the graph, nested ones too, each once; never `sessionId` itself. */
function derivedFrom(graph, sessionId) {
	const found = /* @__PURE__ */ new Set();
	const queue = [sessionId];
	while (queue.length > 0) {
		const parent = queue.shift();
		for (const edge of graph.edges) if (edge.parent === parent && edge.child !== sessionId && !found.has(edge.child)) {
			found.add(edge.child);
			queue.push(edge.child);
		}
	}
	return found;
}
/** Latest totals per agent, without mutating a previously published view. */
function foldSessionTokens(previous, agentPath, usage) {
	const agents = new Map(previous?.agents);
	if (usage.tokens !== void 0) agents.set(JSON.stringify(agentPath), {
		agentPath,
		tokens: usage.tokens
	});
	return {
		agents,
		total: usage.total ?? previous?.total ?? null
	};
}
/** Own usage and each reachable child's latest total, shared by query and view. */
function usageFromSessions(sessions, sessionId, graph) {
	const ofSession = (id) => {
		const session = sessions.get(id);
		return session === void 0 ? { total: null } : sessionUsageFrom([...session.agents.values()], session.total);
	};
	const own = ofSession(sessionId);
	const childTotals = [...derivedFrom(graph, sessionId)].flatMap((child) => ofSession(child).total ?? []);
	return own.total === null || childTotals.length === 0 ? own : {
		...own,
		withChildren: childTotals.reduce((sum, tokens) => addTokens(sum, tokens), own.total)
	};
}
var init_usage_totals = __esmMin((() => {
	init_token_totals();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/usage.js
/**
* Query = projection over the stream. Model, token usage and context
* fullness are folds over seq-carrying records, never a second source of
* truth held beside the stream, so every answer can be aligned with the
* record that produced it and reproduced from a replay.
*
* Scope: one session. A derived child session (codex child thread, grok child
* session) carries its own `sessionId` and `agentPath []` on its records; it
* is a separate session, not a sub-agent of this one, so its figures are NOT
* folded into this session's answers. When `sessionId` is given, records of
* other sessions are skipped; the session graph says where the child came
* from and the child's own records hold its usage, which only `usageOf`'s
* `withChildren` adds, apart from the session's own figures. Observed live on codex
* 0.149.0: both threads report `thread/tokenUsage/updated` with cumulative
* totals on the parent's connection, and without this scope the child's
* figure overwrote the root's under the same `agentPath []` key.
*/
function inSession(record, sessionId) {
	return sessionId === void 0 || record.sessionId === sessionId;
}
/** The latest model the runtime reported for the root agent; null before any. */
function modelOf(records, sessionId) {
	let value = null;
	let seq = -1;
	for (const record of records) {
		if (!inSession(record, sessionId)) continue;
		seq = record.seq;
		if (record.kind === "frame" && record.agentPath.length === 0) {
			const event = record.body.events.findLast((candidate) => candidate.kind === "model");
			if (event?.kind === "model") value = event.model;
		}
	}
	return {
		value,
		seq
	};
}
/** The latest reasoning-effort level the runtime reported for the root agent; null before any. */
function effortOf(records, sessionId) {
	let value = null;
	let seq = -1;
	for (const record of records) {
		if (!inSession(record, sessionId)) continue;
		seq = record.seq;
		if (record.kind === "frame" && record.agentPath.length === 0) {
			const event = record.body.events.findLast((candidate) => candidate.kind === "effort");
			if (event?.kind === "effort") value = event.effort;
		}
	}
	return {
		value,
		seq
	};
}
/** The latest service tier the runtime reported for the root agent; null before any. */
function serviceTierOf(records, sessionId) {
	let value = null;
	let seq = -1;
	for (const record of records) {
		if (!inSession(record, sessionId)) continue;
		seq = record.seq;
		if (record.kind === "frame" && record.agentPath.length === 0) {
			const event = record.body.events.findLast((candidate) => candidate.kind === "service_tier");
			if (event?.kind === "service_tier") value = event.serviceTier;
		}
	}
	return {
		value,
		seq
	};
}
/** The latest context fullness the runtime reported for the root agent; null before any. */
function contextUsageOf(records, sessionId) {
	let value = null;
	let seq = -1;
	for (const record of records) {
		if (!inSession(record, sessionId)) continue;
		seq = record.seq;
		if (record.kind === "frame" && record.agentPath.length === 0) {
			const event = record.body.events.findLast((candidate) => candidate.kind === "usage" && candidate.usage.context !== void 0);
			if (event?.kind === "usage" && event.usage.context !== void 0) value = event.usage.context;
		}
	}
	return {
		value,
		seq
	};
}
/**
* Session total plus a per-agent breakdown. Each agent's totals are the
* LATEST figure its records reported (adapters resolve their runtime's
* accounting into a running total per agent, counted from when this Session
* opened, before the record is stamped), so the breakdown is deduplicated by
* construction; with the runtime's own session total, when it reports one,
* the breakdown plus `unattributed` sums to the total. Agents are the
* `agentPath`s of THIS session; derived child sessions are not agents of it.
* The graph defaults to graphOf(records); an explicit graph overrides it.
* Each derived child session's total (folded from
* its own records the same way) is added once into `withChildren`, and the
* answer's `seq` covers those records too.
*/
function usageOf(records, sessionId, graph) {
	const lineage = graph ?? graphOf(records);
	const children = sessionId === void 0 ? /* @__PURE__ */ new Set() : derivedFrom(lineage, sessionId);
	const sessions = /* @__PURE__ */ new Map();
	let seq = -1;
	for (const record of records) {
		const related = inSession(record, sessionId) || children.has(record.sessionId);
		const linked = record.kind === "frame" && record.body.events.some((event) => event.kind === "session_linked" && children.has(event.child) && (event.parent === sessionId || children.has(event.parent)));
		if (related || linked) seq = record.seq;
		if (!related) continue;
		if (record.kind !== "frame") continue;
		const key = sessionId === void 0 ? "" : record.sessionId;
		for (const event of record.body.events) {
			if (event.kind !== "usage") continue;
			sessions.set(key, foldSessionTokens(sessions.get(key), record.agentPath, event.usage));
		}
	}
	return {
		value: usageFromSessions(sessions, sessionId ?? "", sessionId === void 0 ? {
			nodes: [],
			edges: []
		} : lineage),
		seq
	};
}
var init_usage = __esmMin((() => {
	init_graph();
	init_usage_totals();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/turns.js
/** Keep request/response correlation across both the retained prefix and live records. */
function turnEndReader(afterSeq, sessionId, inputId, onText, onlyWhenIdle = false) {
	let status = initialStatus;
	let waitingForInput = false;
	return (record) => {
		if (record.agentPath.length > 0 || sessionId !== void 0 && record.sessionId !== sessionId) return null;
		const previous = status;
		status = reduceStatus(previous, record, sessionId);
		if (record.kind === "frame") for (const event of record.body.events) {
			if (inputId !== void 0 && event.kind === "input_queued" && event.inputId === inputId) waitingForInput = true;
			if (inputId !== void 0 && event.kind === "turn_active" && event.inputId === inputId) waitingForInput = false;
			if (inputId !== void 0 && event.kind === "input_dropped" && event.inputId === inputId) {
				waitingForInput = false;
				if (record.seq > afterSeq && (!onlyWhenIdle || status.kind === "idle")) return event.reason === "turn_interrupted" ? { kind: "aborted" } : {
					kind: "failed",
					failure: event.failure ?? "unknown",
					reason: event.message ?? "runtime refused the input"
				};
			}
			if (record.seq > afterSeq && !waitingForInput && event.kind === "text_delta") onText?.(event.text);
			if (record.seq > afterSeq && !waitingForInput && event.kind === "turn_ended" && (!onlyWhenIdle || status.kind === "idle")) return event.outcome;
		}
		return record.seq > afterSeq && record.kind === "response" && record.body.kind === "exited" ? exitTurnOutcome(previous.kind === "running" ? previous.stop ?? previous.pendingPrompt?.stop : previous.pendingPrompt?.stop) : null;
	};
}
/**
* Resolve with the first turn end of the session's root agent recorded after
* `afterSeq`, from the retained log if it already happened, otherwise live.
* A derived child session's turn end never satisfies it. With inputId, native
* queue/start evidence excludes intervening turns. Without it, behavior is unchanged.
*/
async function awaitTurnEnd(session, afterSeq, inputId) {
	return await watchTurn(session, afterSeq, inputId);
}
/** One reader owns both the turn boundary and its text, including replay before subscription. */
async function watchTurn(session, afterSeq, inputId, onText, onlyWhenIdle = false) {
	const { promise, resolve } = Promise.withResolvers();
	let done = false;
	const read = turnEndReader(afterSeq, session.id, inputId, onText, onlyWhenIdle);
	const unsubscribe = session.rawEvents((record) => {
		if (done) return;
		const outcome = read(record);
		if (outcome !== null) {
			done = true;
			resolve(outcome);
		}
	}, {
		sessionId: session.id,
		afterSeq: -1
	});
	try {
		return await promise;
	} finally {
		unsubscribe();
	}
}
/**
* Resolve once the root agent is idle: at once (null) when `session.status()`
* already says so, otherwise with the outcome when the owned input and any
* intervening turn are no longer pending. The status is read and the subscription placed through one cursor,
* so a turn ending in between is not missed. Nothing is prompted here: a
* runtime that runs a queued input as a turn of its own makes the next
* prompt `busy`, and this is how a caller waits that out instead of polling.
*/
async function awaitIdle(session) {
	const status = session.status();
	if (status.value.kind === "idle" && status.value.pendingPrompt === void 0) return null;
	const inputId = status.value.pendingPrompt?.inputId ?? (status.value.kind === "running" ? status.value.inputId : void 0);
	return await watchTurn(session, status.seq, inputId, void 0, true);
}
var init_turns$1 = __esmMin((() => {
	init_agent_status();
	init_turn_stop();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/deliver.js
function landed(kind, inputId, result) {
	return {
		landed: kind,
		inputId,
		result
	};
}
function refused(inputId, result) {
	return result.kind === "rejected" ? {
		landed: "rejected",
		inputId,
		code: result.code,
		reason: result.reason,
		result
	} : {
		landed: "rejected",
		inputId,
		code: "unsupported",
		reason: "accepted",
		result
	};
}
/** The running turn's start, or null when the session is idle. */
function runningSince(session) {
	const status = session.status().value;
	return status.kind === "running" ? status.sinceSeq : null;
}
/** One attempt into a running turn; null when the turn ended meanwhile (try again). */
async function intoRunning(session, input, options, when) {
	if (when === "now" && session.steer !== void 0) {
		const target = runningSince(session);
		const steered = await session.steer(input, options);
		if (steered.kind === "accepted") return landed("steered", options.inputId, steered);
		if (steered.code === "no_active_turn" || runningSince(session) !== target) return null;
		if (steered.code !== "unsupported") return refused(options.inputId, steered);
	}
	const queued = await session.queue(input, options);
	return queued.kind === "accepted" ? landed("queued", options.inputId, queued) : refused(options.inputId, queued);
}
/** `Session.deliver`, derived from the session's own controls and status. */
async function deliverInto(session, input, options) {
	const { when = "now", ...inputOptions } = options;
	let last = null;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		if (when === "when_idle") await awaitIdle(session);
		if (session.status().value.kind === "idle") {
			last = await session.prompt(input, inputOptions);
			if (last.kind === "accepted") return landed("prompted", options.inputId, last);
			if (last.code !== "busy") return refused(options.inputId, last);
		}
		if (when !== "when_idle") {
			const result = await intoRunning(session, input, inputOptions, when);
			if (result !== null) return result;
		}
	}
	return last === null ? {
		landed: "rejected",
		inputId: options.inputId,
		code: "busy",
		reason: "the session kept changing state; nothing was delivered"
	} : refused(options.inputId, last);
}
var MAX_ATTEMPTS;
var init_deliver = __esmMin((() => {
	init_turns$1();
	MAX_ATTEMPTS = 4;
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/seal-session.js
/**
* Read a control's answer off its two records. A toRuntime control is only
* ever answered `accepted` or `rejected`; the other two bodies answer other
* things (`answered`: a toApp request; `exited`: a dispose), so they are
* mapped totally rather than thrown on, should an adapter ever route one here.
*/
function controlOutcomeOf(result) {
	const { request, response } = result;
	const at = {
		request,
		response,
		seq: request.seq,
		requestId: request.id
	};
	if (response.body.kind === "rejected") return {
		kind: "rejected",
		code: response.body.code,
		reason: response.body.reason,
		...at
	};
	if (response.body.kind === "exited") return {
		kind: "rejected",
		code: "runtime_exited",
		reason: "runtime exited",
		...at
	};
	return {
		kind: "accepted",
		...at
	};
}
/**
* Derive the API face of a Session from what the adapter built: the read
* control answers (`ControlOutcome` over the adapter's records), the flat
* `events()` reading of the stream, the stream folds (model / effort / usage /
* contextUsage / status are projections over `records()`, never adapter-held
* snapshots) and the steer-or-queue policy. Method-style so consumers
* discover the surfaces in autocomplete; one implementation instead of one
* per adapter.
*/
function sealSession(adapterSession) {
	const prompt = async (input, options) => controlOutcomeOf(await adapterSession.prompt(input, {
		...options,
		...identify(options)
	}));
	const adapterFace = adapterSession;
	const adapterSteer = adapterSession.steer?.bind(adapterSession);
	const steer = adapterSteer === void 0 ? void 0 : async (input, options) => controlOutcomeOf(await adapterSteer(input, identify(options)));
	const queue = async (input, options) => controlOutcomeOf(await adapterSession.queue(input, identify(options)));
	const adapterWithdraw = adapterSession.withdraw?.bind(adapterSession);
	const withdraw = adapterWithdraw === void 0 ? void 0 : async (inputId) => controlOutcomeOf(await adapterWithdraw(inputId));
	const abort = async () => controlOutcomeOf(await adapterSession.abort());
	const steerOrQueue = async (input, options) => {
		const identified = identify(options);
		if (steer !== void 0) {
			const steered = await steer(input, identified);
			if (steered.kind === "accepted") return {
				landed: "steered",
				result: steered
			};
		}
		const queued = await queue(input, identified);
		return queued.kind === "accepted" ? {
			landed: "queued",
			result: queued
		} : {
			landed: "rejected",
			code: queued.code,
			reason: queued.reason,
			result: queued
		};
	};
	const sealed = {
		...adapterFace,
		prompt,
		...steer === void 0 ? {} : { steer },
		queue,
		...withdraw === void 0 ? {} : { withdraw },
		abort,
		events: (observer, options = {}) => {
			const coalesce = options.coalesceText ?? false;
			const target = coalesce === false ? observer : coalesceText(observer, coalesce === true ? {} : { maxHoldMs: coalesce.maxHoldMs });
			return adapterSession.rawEvents(eventsReader(target), options.cursor);
		},
		model: () => modelOf(adapterSession.records(), adapterSession.id),
		effort: () => effortOf(adapterSession.records(), adapterSession.id),
		serviceTier: () => serviceTierOf(adapterSession.records(), adapterSession.id),
		usage: () => usageOf(adapterSession.records(), adapterSession.id, adapterSession.graph()),
		contextUsage: () => contextUsageOf(adapterSession.records(), adapterSession.id),
		status: () => statusOf$1(adapterSession.records(), adapterSession.id),
		steerOrQueue,
		deliver: async (input, options = {}) => {
			return await deliverInto(sealed, input, {
				...options,
				inputId: identify(options).inputId ?? ""
			});
		}
	};
	return sealed;
}
var identify;
var init_seal_session = __esmMin((() => {
	init_agent_status();
	init_events();
	init_usage();
	init_deliver();
	identify = (options = {}) => {
		const inputId = options.inputId ?? globalThis.crypto.randomUUID();
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(inputId)) throw new Error("inputId must be a UUID");
		return {
			...options,
			inputId
		};
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/control-input.js
/** Refuse an input with neither text nor images before contacting the runtime. Whitespace is left intact. */
function emptyInputRefusal(body) {
	if ((body.kind === "prompt" || body.kind === "steer" || body.kind === "queue") && body.input === "" && (body.images?.length ?? 0) === 0) return {
		kind: "rejected",
		code: "unsupported",
		reason: "empty input: give text or images"
	};
	return null;
}
var init_control_input = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/session-kernel.js
async function settle(decide, issued) {
	try {
		return await decide(issued);
	} catch (error) {
		return {
			kind: "rejected",
			code: "error",
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
function deliver(observer, record) {
	try {
		observer(record);
	} catch {}
}
/** An optional session credential redactor runs before retention and observer delivery; native command inputs remain unchanged. */
function createSessionKernel(sessionId = globalThis.crypto.randomUUID(), redact) {
	const observers = /* @__PURE__ */ new Set();
	const log = [];
	const nodeIds = new Set([sessionId]);
	let graph = {
		nodes: [{ id: sessionId }],
		edges: []
	};
	let seq = 0;
	let exited = false;
	let disposing = false;
	const append = (build, at) => {
		const spanId = at?.spanId;
		const record = build({
			sessionId: at?.sessionId ?? sessionId,
			agentPath: at?.agentPath ?? [],
			...spanId === void 0 ? {} : { spanId },
			seq,
			receivedAt: Date.now()
		});
		seq += 1;
		const retained = redact === void 0 ? record : redact(record);
		log.push(retained);
		graph = withSessionRecord(graph, retained, nodeIds);
		if (record.kind === "response" && record.body.kind === "exited") exited = true;
		if (record.kind === "request" && record.direction === "toRuntime" && record.body.kind === "dispose") disposing = true;
		for (const observer of observers) deliver(observer, retained);
		return retained;
	};
	const unreachable = () => {
		if (exited) return {
			kind: "rejected",
			code: "runtime_exited",
			reason: "runtime exited"
		};
		return disposing ? {
			kind: "rejected",
			code: "disposed",
			reason: "session disposed"
		} : null;
	};
	const request = (direction, body, at) => append((envelope) => ({
		...envelope,
		kind: "request",
		id: at?.id ?? globalThis.crypto.randomUUID(),
		direction,
		body
	}), at);
	const respond = (requestId, body, at) => append((envelope) => ({
		...envelope,
		kind: "response",
		requestId,
		body
	}), at);
	return {
		sessionId,
		frame: (body, at) => append((envelope) => ({
			...envelope,
			kind: "frame",
			body
		}), at),
		request,
		respond,
		async control(body, decide, at) {
			const blocked = unreachable();
			const issued = request("toRuntime", body, at);
			const decided = blocked ?? emptyInputRefusal(body) ?? await settle(decide, {
				...issued,
				body
			});
			return {
				request: issued,
				response: respond(issued.id, decided, at)
			};
		},
		unreachable,
		rawEvents(observer, cursor) {
			if (cursor !== void 0) {
				if (cursor.sessionId !== sessionId) throw new Error(`cursor belongs to session ${cursor.sessionId}, not ${sessionId}`);
				for (const record of log) if (record.seq > cursor.afterSeq) deliver(observer, record);
			}
			observers.add(observer);
			return () => {
				observers.delete(observer);
			};
		},
		records: () => log,
		graph: () => graph,
		link: (edge) => ({
			kind: "session_linked",
			parent: edge.parent,
			child: edge.child,
			via: edge.via
		})
	};
}
var init_session_kernel = __esmMin((() => {
	init_control_input();
	init_graph();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/session-credentials.js
/** Credentials supplied for this session, plus native keys the adapter resolves. No inherited environment or credential-file scan. */
function sessionCredentials(options) {
	const { add, redact, redactValue } = sessionCredentialRedactor(options);
	const guard = (method) => async (...args) => {
		try {
			return await method(...args);
		} catch (error) {
			throw redactValue(error);
		}
	};
	return {
		add,
		redact,
		redactValue,
		kernel: (id) => createSessionKernel(id, redactValue),
		seal: (adapter) => sealSession({
			...adapter,
			prompt: guard(adapter.prompt.bind(adapter)),
			queue: guard(adapter.queue.bind(adapter)),
			...adapter.steer === void 0 ? {} : { steer: guard(adapter.steer.bind(adapter)) },
			...adapter.withdraw === void 0 ? {} : { withdraw: guard(adapter.withdraw.bind(adapter)) },
			abort: guard(adapter.abort.bind(adapter)),
			dispose: guard(adapter.dispose.bind(adapter)),
			...adapter.contextBreakdown === void 0 ? {} : { contextBreakdown: guard(adapter.contextBreakdown.bind(adapter)) },
			...adapter.resources === void 0 ? {} : { resources: guard(adapter.resources.bind(adapter)) }
		})
	};
}
/** Keep opening failures and later adapter errors under the same session credential rules as the record stream. */
function withSessionCredentials(open) {
	return async (installation, options) => {
		const credentials = sessionCredentials(options);
		try {
			return await open(installation, options, credentials);
		} catch (error) {
			throw credentials.redactValue(error);
		}
	};
}
var init_session_credentials = __esmMin((() => {
	init_credential_redactor();
	init_seal_session();
	init_session_kernel();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/client-app.js
/** OAR's YOLO answer to a permission request: the broadest allow on offer, else cancel. */
function allowPermission(request) {
	const selected = request.options.find((option) => option.kind === "allow_always") ?? request.options.find((option) => option.kind === "allow_once");
	return selected === void 0 ? { outcome: { outcome: "cancelled" } } : { outcome: {
		outcome: "selected",
		optionId: selected.optionId
	} };
}
function requestIdOf(context) {
	if (context.requestId === null) {
		anonymousRequestCounter += 1;
		return `acp-client-${String(anonymousRequestCounter)}`;
	}
	return String(context.requestId);
}
function isParamsRecord(params) {
	return params !== null && typeof params === "object" && !Array.isArray(params);
}
/** Compose OAR's typed ACP client handlers directly on the official SDK app. */
function createAcpClientApp(terminal, hooks) {
	const observed = (method, handle) => async (context) => {
		const id = requestIdOf(context);
		hooks.requested(id, method, context.params);
		try {
			const reply = await handle(context.params);
			hooks.answered(id, reply);
			return reply;
		} catch (error) {
			hooks.answered(id, { error: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	};
	let app = client({ name: "oar" }).onRequest(methods.client.session.requestPermission, observed(methods.client.session.requestPermission, allowPermission)).onRequest(methods.client.terminal.create, observed(methods.client.terminal.create, (params) => terminal.create(params))).onRequest(methods.client.terminal.output, observed(methods.client.terminal.output, (params) => terminal.output(params))).onRequest(methods.client.terminal.waitForExit, observed(methods.client.terminal.waitForExit, (params) => terminal.waitForExit(params))).onRequest(methods.client.terminal.kill, observed(methods.client.terminal.kill, (params) => terminal.kill(params))).onRequest(methods.client.terminal.release, observed(methods.client.terminal.release, (params) => terminal.release(params))).onNotification(methods.client.session.update, ({ params }) => {
		hooks.update(params);
	});
	for (const method of hooks.extensionNotifications) app = app.onNotification(method, passthrough, ({ params }) => {
		hooks.extension(method, params);
	});
	return app;
}
var anonymousRequestCounter, passthrough;
var init_client_app = __esmMin((() => {
	anonymousRequestCounter = 0;
	passthrough = (params) => isParamsRecord(params) ? params : {};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/additional-directories.js
/** Absolute native paths, independent of the host process's working directory. */
function resolvedAdditionalDirectories(options) {
	const directories = options.additionalDirectories ?? [];
	if (directories.some((directory) => directory.length === 0 || directory.includes("\0"))) throw new UnsupportedOptionError("additionalDirectories", "additionalDirectories must contain non-empty paths without NUL characters");
	return [...new Set(directories.map((directory) => path.resolve(options.cwd, directory)))];
}
var init_additional_directories$1 = __esmMin((() => {
	init_errors$1();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/additional-directories.js
/** Only the advertised ACP extension may receive directory parameters. */
function acpAdditionalDirectories(options, initialized) {
	const directories = resolvedAdditionalDirectories(options);
	if (directories.length === 0) return {};
	const capability = asRecord(asRecord(initialized.agentCapabilities)?.sessionCapabilities)?.additionalDirectories;
	if (capability !== true && asRecord(capability) === null) throw new UnsupportedOptionError("additionalDirectories", "ACP runtime declares no sessionCapabilities.additionalDirectories, so the requested directories cannot be applied");
	return { additionalDirectories: directories };
}
var init_additional_directories = __esmMin((() => {
	init_errors$1();
	init_additional_directories$1();
	init_json();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/model.js
/**
* The model an ACP agent reports as in effect, read from the agent's own
* frames rather than from what we asked for. Two spellings exist upstream:
*
* - kimi-code (packages/acp-server, f9ca33376): `session/new|load|resume`
*   answer `configOptions` with a `{type: "select", id: "model", currentValue}`
*   row whose `currentValue` is the bare model id, and every switch
*   (`session/set_model`, `set_config_option`) pushes
*   `session/update {sessionUpdate: "config_option_update", configOptions}`
*   BEFORE the switch request is answered; the `set_model` response is `{}`.
* - xai-grok-shell 1.0.12 (bc7f02e): `session/new|load` answer
*   `models.currentModelId` (a requested model the account cannot use falls
*   back to the default silently) and `session/set_model` answers
*   `{_meta: {model}}` with the applied id.
*
* Null when the frame carries neither. Every such frame is an event
* record with a `model` event, so `Session.model()` is the latest of them;
* the request parameter is never consulted.
*/
function acpReportedModel(frame) {
	if (frame === null) return null;
	const option = asRecordList(frame.configOptions).find((entry) => entry.id === "model");
	if (typeof option?.currentValue === "string") return option.currentValue;
	const currentModelId = asRecord(frame.models)?.currentModelId;
	if (typeof currentModelId === "string") return currentModelId;
	const metaModel = asRecord(frame._meta)?.model;
	return typeof metaModel === "string" ? metaModel : null;
}
/**
* The agent's reasoning-effort selector: the config option in ACP's reserved
* `thought_level` category (ACP schema `SessionConfigOptionCategory`:
* "thought/reasoning level"), read off a frame's `configOptions`. grok and
* kimi put effort there, under their own ids ([env] 2026-09-29): grok
* 1.0.41 `reasoning_effort` (xhigh/high/medium/low per model), kimi 2.0.0
* `thinking` (low/high/max on k3); agy_acp_server 1.4.0 uses
* `thinking_level` (low/medium/high on gemini-3.8-flash). The category, not the id, is what this shared
* layer relies on; it carries no runtime identity. Null when the frame
* advertises none.
*/
function acpThoughtLevelOption(frame) {
	if (frame === null) return null;
	return asRecordList(frame.configOptions).find((entry) => entry.category === "thought_level") ?? null;
}
/**
* The reasoning effort an ACP agent reports as in effect: the `thought_level`
* option's `currentValue` in a handshake answer (`session/new|resume|load`,
* `session/set_config_option`, whose answer is "the full set of configuration
* options and their current values") or a `config_option_update` push. Null
* when the frame carries none; the request parameter is never consulted.
*/
function acpReportedEffort(frame) {
	const current = acpThoughtLevelOption(frame)?.currentValue;
	return typeof current === "string" && current.length > 0 ? current : null;
}
var init_model = __esmMin((() => {
	init_json();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/errors.js
function acpRequestTimeoutError(method, timeoutMs) {
	return new AcpError("timeout", `ACP request ${method} timed out after ${timeoutMs}ms`, {
		method,
		timeoutMs
	});
}
function acpProcessExitedError(exitCode) {
	return new AcpError("process_exited", exitCode === null ? "ACP process exited" : `ACP process exited with code ${exitCode}`, { exitCode });
}
var AcpError;
var init_errors = __esmMin((() => {
	AcpError = class extends Error {
		kind;
		exitCode;
		method;
		timeoutMs;
		constructor(kind, message, fields = {}) {
			super(message);
			this.name = "AcpError";
			this.kind = kind;
			this.exitCode = fields.exitCode ?? null;
			this.method = fields.method ?? null;
			this.timeoutMs = fields.timeoutMs ?? null;
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/native-error.js
/** Only decoded protocol JSON, never an arbitrary Error, request parameters or spawn arguments. */
function redactNative(value, redact) {
	if (typeof value === "string") return redact(value);
	if (Array.isArray(value)) return value.map((entry) => redactNative(entry, redact));
	const record = asRecord(value);
	return record === null ? value : redactRecord(record, redact);
}
function redactRecord(record, redact) {
	return Object.fromEntries(Object.entries(record).map(([key, value]) => [redact(key), redactNative(value, redact)]));
}
/** Diagnostic context for a failed native call, also usable before a Session exists to hold records. */
function nativeErrorCause(method, native, redact) {
	return {
		method,
		native: redactRecord(native, redact)
	};
}
var init_native_error = __esmMin((() => {
	init_json();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/opening.js
/** Preserve the wire's opening boundary across the SDK's asynchronous notification routing. */
function createAcpOpening() {
	const requests = /* @__PURE__ */ new Set();
	const live = /* @__PURE__ */ new WeakSet();
	let opened = false;
	return {
		outgoing(message) {
			if ("id" in message && "method" in message && (message.method === methods.agent.session.new || message.method === methods.agent.session.resume || message.method === methods.agent.session.load)) requests.add(message.id);
		},
		incoming(message) {
			if ("id" in message && !("method" in message) && requests.delete(message.id) && "result" in message) opened = true;
			if (!("id" in message) && "method" in message && opened) {
				const { params } = message;
				if (params !== null && typeof params === "object") live.add(params);
			}
		},
		afterOpen(params) {
			return live.has(params);
		}
	};
}
/** Observe decoded messages without changing them or delaying dispatch. */
function observeAcpOpening(stream, opening) {
	const writer = stream.writable.getWriter();
	return {
		readable: stream.readable.pipeThrough(new TransformStream({ transform(message, controller) {
			opening.incoming(message);
			controller.enqueue(message);
		} })),
		writable: new WritableStream({
			write(message) {
				opening.outgoing(message);
				return writer.write(message);
			},
			close() {
				return writer.close();
			},
			abort(reason) {
				return writer.abort(reason);
			}
		})
	};
}
var init_opening = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/process.js
function deadline(method, timeoutMs, controller) {
	const { promise, reject } = Promise.withResolvers();
	const timer = setTimeout(() => {
		controller.abort();
		reject(acpRequestTimeoutError(method, timeoutMs));
	}, timeoutMs);
	timer.unref();
	return {
		promise,
		timer
	};
}
function processClosed(process) {
	return process.closed;
}
/**
* Add OAR's deadline and process-exit semantics around one direct SDK request.
* A null timeout is for prompts, whose lifetime is controlled by cancel.
*/
async function withAcpDeadline(process, method, timeoutMs, send) {
	await process.spawned;
	if (processClosed(process)) throw acpProcessExitedError(process.exitCode);
	const controller = timeoutMs === null ? void 0 : new AbortController();
	const limit = timeoutMs === null || controller === void 0 ? void 0 : deadline(method, timeoutMs, controller);
	try {
		const request = send(controller === void 0 ? void 0 : { cancellationSignal: controller.signal });
		return await (limit === void 0 ? request : Promise.race([request, limit.promise]));
	} catch (error) {
		if (error instanceof AcpError && error.kind === "timeout") throw error;
		if (processClosed(process)) {
			await process.exited;
			throw acpProcessExitedError(process.exitCode);
		}
		if (error instanceof RequestError) {
			const redact = process.redact ?? ((text) => text);
			const cause = nativeErrorCause(method, error.toErrorResponse(), redact);
			const failure = new RequestError(error.code, redact(error.message), cause.native.data);
			Object.defineProperty(failure, "cause", {
				value: cause,
				configurable: true,
				writable: true
			});
			throw failure;
		}
		throw error;
	} finally {
		if (limit !== void 0) clearTimeout(limit.timer);
	}
}
/** Spawn a stdio ACP agent and let the official SDK own the wire protocol. */
function startAcpProcess(command, args, app, options = {}) {
	const child = spawnLineProcess(command, args, {
		...options,
		killTree: true
	});
	const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
	const connection = app.connect(options.opening === void 0 ? stream : observeAcpOpening(stream, options.opening));
	let ended = false;
	let exitCode = null;
	child.onExit((code) => {
		ended = true;
		exitCode = code;
		connection.close(acpProcessExitedError(code));
	});
	return {
		connection,
		...options.redact === void 0 ? {} : { redact: options.redact },
		spawned: child.spawned,
		exited: child.exited,
		get closed() {
			return ended || connection.signal.aborted;
		},
		get exitCode() {
			return exitCode;
		},
		kill() {
			if (!ended) {
				connection.close(acpProcessExitedError(null));
				child.kill();
			}
		},
		resources: child.resources
	};
}
var init_process = __esmMin((() => {
	init_executable();
	init_errors();
	init_native_error();
	init_opening();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/effort.js
/** An RPC error's message plus its `data` (grok puts the reason there: "unknown reasoning_effort value"). */
function rpcErrorText(error) {
	if (!(error instanceof Error)) return String(error);
	const data = asRecord(error)?.data;
	if (data === void 0 || data === null) return error.message;
	return `${error.message} (${typeof data === "string" ? data : JSON.stringify(data)})`;
}
/**
* Apply `SessionOptions.effort` through the agent's `thought_level` config
* option (model.ts): `session/set_config_option {configId, value}`, whose
* answer lists every option with its current value. The answer is observed
* like any handshake answer (a frame carrying the `effort` event), and
* anything but the requested level as the option's `currentValue` refuses the
* open: an agent without the option, one that refuses the value (grok 1.0.41
* and kimi 2.0.0 answer `-32602 Invalid params`), or one that applies another.
* Applied after `session/set_model`, because a model switch re-derives the
* option's menu for the new model.
*/
async function applyAcpEffort(process, opened, effort, context) {
	const configId = acpThoughtLevelOption(opened.response)?.id;
	if (typeof configId !== "string" || configId.length === 0) throw new UnsupportedOptionError("effort", `${opened.openMethod} advertises no thought_level config option, so effort ${effort} cannot be applied`);
	const method = "session/set_config_option";
	let answer = void 0;
	try {
		answer = await withAcpDeadline(process, method, context.timeoutMs, (requestOptions) => process.connection.agent.request(method, {
			sessionId: opened.sessionId,
			configId,
			value: effort
		}, requestOptions));
	} catch (error) {
		throw new Error(`${method} ${configId}=${effort} was refused: ${rpcErrorText(error)}`, { cause: error });
	}
	const response = asRecord(answer) ?? {};
	context.observe({
		method,
		response
	});
	const applied = acpReportedEffort(response);
	if (applied !== effort) throw new Error(`${method} left ${configId} at ${applied ?? "an unreported value"} although effort ${effort} was requested`);
}
/**
* Apply `SessionOptions.model`: `session/set_model {modelId}`, or with
* `viaConfigOption` `session/set_config_option` on the `model` option (for
* agents whose set_model answer reports nothing, agy_acp_server 1.2.1).
* The answer is observed like any handshake answer and returned.
*/
async function applyAcpModel(process, sessionId, model, context) {
	const method = context.viaConfigOption ? "session/set_config_option" : "session/set_model";
	const params = context.viaConfigOption ? {
		sessionId,
		configId: "model",
		value: model
	} : {
		sessionId,
		modelId: model
	};
	const response = asRecord(await withAcpDeadline(process, method, context.timeoutMs, (requestOptions) => process.connection.agent.request(method, params, requestOptions))) ?? void 0;
	context.observe({
		method,
		response: response ?? {}
	});
	return response;
}
var init_effort = __esmMin((() => {
	init_errors$1();
	init_json();
	init_model();
	init_process();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/contracts/session-not-found-error.js
var SessionNotFoundError;
var init_session_not_found_error = __esmMin((() => {
	SessionNotFoundError = class extends Error {
		name = "SessionNotFoundError";
		sessionId;
		constructor(sessionId, message, cause) {
			super(message, { cause });
			this.sessionId = sessionId;
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/contracts/runtime-failure-error.js
var RuntimeFailureError;
var init_runtime_failure_error = __esmMin((() => {
	RuntimeFailureError = class extends Error {
		name = "RuntimeFailureError";
		failure;
		constructor(failure, reason, details = {}) {
			super(reason, details.cause === void 0 ? void 0 : { cause: details.cause });
			this.failure = failure;
			if (details.credential !== void 0) this.credential = details.credential;
			if (details.status !== void 0) this.status = details.status;
		}
		/** The runtime's words: the message itself, so that redacting the message redacts it. */
		get reason() {
			return this.message;
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/failure-class.js
/**
* What an HTTP status means at the providers (the Anthropic, OpenAI and
* Gemini error references) when nothing richer says. A 401 says the
* credential failed, not whether it was missing or refused; a 400 is any
* rejected request.
*/
function failureFromStatus(status) {
	switch (status) {
		case 400: return "invalid_request";
		case 401: return "auth";
		case 402: return "billing";
		case 404: return "model_unavailable";
		case 429: return "rate_limited";
		case 503:
		case 529: return "overloaded";
		default: return status >= 500 && status < 600 ? "provider" : "unknown";
	}
}
/** The class a provider error code or type names; null for one no runtime was seen to carry. */
function failureFromErrorCode(code) {
	return ERROR_CODES[code] ?? null;
}
/**
* Anthropic's 400s that have no type of their own (both are
* `invalid_request_error`): an organization's spend limit and an exhausted
* credit balance. Matched on the API's own wording, the last resort for the
* adapters that carry Anthropic's message (claude, pi); pinned by their
* vendor tests.
*/
function anthropicLimitText(message) {
	if (/credit balance is too low/iu.test(message)) return "billing";
	if (/reached your specified API usage limits/iu.test(message)) return "quota";
	return null;
}
/**
* A provider's JSON error body, as Anthropic (`{type: "error", error: {type,
* message}}`) and OpenAI (`{error: {code, type, message}}`) send it: the
* class its code names, else its type's (Anthropic's 400 wording first).
* Null when `text` is no such body or names nothing known.
*/
function failureFromErrorBody(text) {
	const error = asRecord(asRecord(parseJson(text))?.error);
	if (error === null) return null;
	const code = typeof error.code === "string" ? failureFromErrorCode(error.code) : null;
	if (code !== null) return code;
	const message = typeof error.message === "string" ? error.message : "";
	if (error.type === "invalid_request_error") return anthropicLimitText(message) ?? "invalid_request";
	return typeof error.type === "string" ? failureFromErrorCode(error.type) : null;
}
/**
* Best-effort classification of vendor error prose: the documented last
* resort of the adapters whose runtime reports no structure for a failure
* (opencode's prompt errors, cursor's run errors). The patterns are pinned by
* the vendor snapshot tests: when a runtime changes its wording, the snapshot
* moves and this table gets a conscious update.
*/
function classifyFailure(reason) {
	if (/\b401\b|authenticat(?:e|ed|ion)|\boauth\b|unauthorized|invalid (?:user )?(?:x-)?api[- ]?key|x-api-key|log(?:ged)? ?in/iu.test(reason)) return "auth";
	const limit = anthropicLimitText(reason);
	if (limit !== null) return limit;
	if (/\b429\b|rate.?limit/iu.test(reason)) return "rate_limited";
	if (/quota|usage limit/iu.test(reason)) return "quota";
	if (/billing/iu.test(reason)) return "billing";
	if (/\b400\b|invalid_request|issue with the selected model|model .* (?:does not|doesn't|may not) exist|unknown model|invalid model/iu.test(reason)) return "invalid_request";
	if (/\b529\b|\b503\b|overloaded/iu.test(reason)) return "overloaded";
	if (/\b\d{3}\b|error/iu.test(reason)) return "provider";
	return "unknown";
}
var ERROR_CODES;
var init_failure_class = __esmMin((() => {
	init_json();
	ERROR_CODES = {
		invalid_api_key: "auth",
		model_not_found: "model_unavailable",
		rate_limit_exceeded: "rate_limited",
		insufficient_quota: "quota",
		organization_usage_limit_exceeded: "quota",
		usage_limit_reached: "quota",
		usage_not_included: "quota",
		credit_balance_exhausted: "billing",
		context_length_exceeded: "input_too_large",
		server_is_overloaded: "overloaded",
		authentication_error: "auth",
		not_found_error: "model_unavailable",
		rate_limit_error: "rate_limited",
		billing_error: "billing",
		overloaded_error: "overloaded",
		api_error: "provider",
		server_error: "provider",
		invalid_request_error: "invalid_request"
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/failure.js
/** The JSON-RPC error code an ACP request was answered with, if it was. */
function rpcErrorCode(error) {
	if (!(error instanceof Error) || error instanceof AcpError || !("code" in error)) return null;
	return typeof error.code === "number" ? error.code : null;
}
/** An open step's error, as `session()` rejects with it: a refused login or model becomes a `RuntimeFailureError`. */
function acpOpenFailure(error, step) {
	const code = rpcErrorCode(error);
	if (!(error instanceof Error) || code === null) return error;
	if (code === AUTH_REQUIRED) return new RuntimeFailureError("auth", error.message, { cause: error.cause ?? error });
	if (step === "model" && code === INVALID_PARAMS) return new RuntimeFailureError("model_unavailable", error.message, { cause: error.cause ?? error });
	return error;
}
/** A failed native resume/load call, under its runtime's missing-target rule. */
function acpResumeFailure(error, method, sessionId, isNotFound) {
	const failure = acpOpenFailure(error, "open");
	if (failure !== error) return failure;
	const cause = asRecord(error instanceof Error ? error.cause : void 0);
	const native = asRecord(cause?.native);
	if (error instanceof Error && cause?.method === method && native !== null && isNotFound(native)) return new SessionNotFoundError(sessionId, error.message, {
		method,
		native
	});
	return error;
}
/** `step` rejecting as `session()` does: through `acpOpenFailure`. */
async function acpOpenStep(step, kind) {
	try {
		return await step;
	} catch (error) {
		throw acpOpenFailure(error, kind);
	}
}
/** An RPC error's words: its message, and its `data` when that is text (grok puts the provider's answer there). */
function acpErrorReason(error) {
	if (!(error instanceof Error)) return "ACP prompt failed";
	const data = "data" in error && typeof error.data === "string" && error.data.length > 0 ? error.data : null;
	return data === null ? error.message : `${error.message}: ${data}`;
}
/** The outcome a rejected prompt request reports (an RPC error answer). */
function acpFailureOutcome(error, turnFrames = [], reader) {
	const reason = acpErrorReason(error);
	if (error instanceof AcpError && error.kind === "process_exited") return {
		kind: "failed",
		reason,
		failure: "runtime_exited"
	};
	if (rpcErrorCode(error) === AUTH_REQUIRED) return {
		kind: "failed",
		reason,
		failure: "auth"
	};
	return reader?.(error, turnFrames) ?? {
		kind: "failed",
		reason,
		failure: classifyFailure(reason)
	};
}
var AUTH_REQUIRED, INVALID_PARAMS;
var init_failure$1 = __esmMin((() => {
	init_session_not_found_error();
	init_json();
	init_runtime_failure_error();
	init_failure_class();
	init_errors();
	AUTH_REQUIRED = -32e3;
	INVALID_PARAMS = -32602;
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/mcp-servers.js
function isHttpMcpServer(server) {
	return "type" in server;
}
/** Whether the entry carries a credential: a non-empty `env` (stdio) or `headers` (http). */
function hasMcpCredentials(server) {
	return Object.keys((isHttpMcpServer(server) ? server.headers : server.env) ?? {}).length > 0;
}
/** The given list, or nothing when there is none to attach (absent or empty). */
function givenMcpServers(servers) {
	for (const server of servers ?? []) if (!isHttpMcpServer(server)) {
		for (const [key, value] of Object.entries(server.env ?? {})) if (typeof value !== "string") throw new UnsupportedOptionError("mcpServers", `MCP server ${JSON.stringify(server.name)} env.${key} must be a string; null removal is only supported by SessionOptions.env`);
	}
	return servers === void 0 || servers.length === 0 ? null : servers;
}
/**
* Throw on a list no runtime can attach as given: an empty name, or a name
* given twice (each runtime keys its servers by name, so the later entry
* would silently replace the earlier one), a plain error; or a reserved name,
* an `UnsupportedOptionError` on `mcpServers` as runtimes would drop it. The
* error names the value.
*/
function checkMcpServerNames(servers) {
	givenMcpServers(servers);
	const seen = /* @__PURE__ */ new Set();
	for (const { name } of servers) {
		if (name.length === 0) throw new Error("mcpServers has an entry with an empty name");
		if (seen.has(name)) throw new Error(`mcpServers names ${JSON.stringify(name)} twice; names are unique within a session`);
		if (RESERVED_MCP_SERVER_NAMES.has(name)) throw new UnsupportedOptionError("mcpServers", `mcpServers name ${JSON.stringify(name)} is reserved: some runtimes drop a server so named without a word`);
		seen.add(name);
	}
}
/** The same credential-name, length and path rules used for retained session records. */
function mcpCredentialRedactor(servers) {
	return sessionCredentialRedactor({ mcpServers: servers ?? [] }).redact;
}
/**
* `error` with its message and stack passed through `redact`, and so every
* error down its `cause` chain (a `RuntimeFailureError` keeps the agent's
* error there); in place, so classes and fields stay. Anything else as it is.
*/
function redactError(error, redact) {
	const seen = /* @__PURE__ */ new Set();
	for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
		seen.add(current);
		current.message = redact(current.message);
		if (current.stack !== void 0) current.stack = redact(current.stack);
	}
	return error;
}
var RESERVED_MCP_SERVER_NAMES;
var init_mcp_servers$1 = __esmMin((() => {
	init_credential_redactor();
	init_errors$1();
	RESERVED_MCP_SERVER_NAMES = new Set([
		"__proto__",
		"__defineGetter__",
		"__defineSetter__",
		"__lookupGetter__",
		"__lookupSetter__"
	]);
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/mcp-servers.js
function pairs(values) {
	return Object.entries(values ?? {}).map(([name, value]) => ({
		name,
		value
	}));
}
/** One entry in ACP's `McpServer` shape. */
function acpMcpServer(server) {
	return isHttpMcpServer(server) ? {
		type: "http",
		name: server.name,
		url: server.url,
		headers: pairs(server.headers)
	} : {
		name: server.name,
		command: server.command,
		args: [...server.args ?? []],
		env: pairs(server.env)
	};
}
/**
* The `mcpServers` param for an open, given the agent's `initialize` answer:
* an http entry is refused (`UnsupportedOptionError` on `mcpServers`) unless
* the agent declares `agentCapabilities.mcpCapabilities.http`, which ACP
* requires before a client sends one. Stdio needs no capability.
*/
function acpMcpServersParam(servers, initialized) {
	const given = givenMcpServers(servers);
	if (given === null) return [];
	const http = given.find((server) => isHttpMcpServer(server));
	const capabilities = asRecord(asRecord(initialized.agentCapabilities)?.mcpCapabilities);
	if (http !== void 0 && capabilities?.http !== true) throw new UnsupportedOptionError("mcpServers", `the agent's initialize declares no mcpCapabilities.http, so it attaches no http MCP server (${JSON.stringify(http.name)})`);
	return given.map((server) => acpMcpServer(server));
}
/**
* For an open given these entries: throws now, before the agent starts, on
* an empty or repeated name, and returns what a failed open's error becomes:
* the same error without the credentials the entries carry.
*/
function acpMcpOpenGuard(servers, redact = mcpCredentialRedactor(servers)) {
	checkMcpServerNames(servers ?? []);
	return (error) => redactError(error, redact);
}
var init_mcp_servers = __esmMin((() => {
	init_errors$1();
	init_json();
	init_mcp_servers$1();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/resume-cwd.js
function real(dir) {
	try {
		return realpathSync(dir);
	} catch {
		return path.resolve(dir);
	}
}
/** The same directory, spelled or linked differently. */
function sameDirectory(left, right) {
	return path.resolve(left) === path.resolve(right) || real(left) === real(right);
}
/**
* Refuse a different cwd with UnsupportedOptionError. Return true when found,
* false only after a complete, well-formed list, null when absence is unknown.
* Listing failures propagate unchanged; they never prove a session missing.
*/
async function refuseResumeElsewhere(process, sessionId, cwd, timeoutMs) {
	const method = methods$1.agent.session.list;
	let cursor = null;
	const visited = /* @__PURE__ */ new Set();
	let complete = true;
	do {
		const params = cursor === null ? {} : { cursor };
		const page = asRecord(await withAcpDeadline(process, method, timeoutMs, (requestOptions) => process.connection.agent.request(method, params, requestOptions)));
		const sessions = asRecordList(page?.sessions);
		if (!Array.isArray(page?.sessions) || sessions.length !== page.sessions.length || sessions.some((session) => typeof session.sessionId !== "string" || session.sessionId.length === 0)) complete = false;
		const found = sessions.find((session) => session.sessionId === sessionId);
		if (found !== void 0) {
			if (typeof found.cwd === "string" && !sameDirectory(found.cwd, cwd)) throw new UnsupportedOptionError("cwd", `session ${sessionId} lives in ${found.cwd} and this runtime resumes it only there; the resume names ${cwd}`);
			return true;
		}
		if (page?.nextCursor !== void 0 && page.nextCursor !== null && typeof page.nextCursor !== "string") return null;
		cursor = typeof page?.nextCursor === "string" && page.nextCursor !== "" ? page.nextCursor : null;
		if (cursor !== null) {
			if (visited.has(cursor)) return null;
			visited.add(cursor);
		}
	} while (cursor !== null);
	return complete ? false : null;
}
var init_resume_cwd = __esmMin((() => {
	init_errors$1();
	init_json();
	init_process();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/usage-wait.js
function createUsageUpdateGate() {
	let seen = false;
	let release = null;
	return {
		arm: () => {
			seen = false;
		},
		observe: (usageSeq) => {
			if (usageSeq === void 0) return;
			seen = true;
			release?.();
		},
		settleAfterPrompt: async (profile, aborting) => {
			if (profile.usageUpdateAfterPrompt !== true || aborting || seen) return;
			const { promise, resolve } = Promise.withResolvers();
			const timer = setTimeout(resolve, profile.usageUpdateTimeoutMs ?? 500);
			timer.unref();
			release = resolve;
			try {
				await promise;
			} finally {
				clearTimeout(timer);
				release = null;
			}
		}
	};
}
var init_usage_wait = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/profile.js
function hasAcpCapability(value) {
	return value === true || asRecord(value) !== null;
}
function responseRecord(method, value) {
	const response = asRecord(value);
	if (response === null) throw new TypeError(`ACP ${method} returned a non-object response`);
	return response;
}
async function promptAcp(process, sessionId, prompt, extraParams = {}) {
	const method = methods.agent.session.prompt;
	const response = await withAcpDeadline(process, method, null, (requestOptions) => process.connection.agent.request(method, {
		sessionId,
		prompt,
		...extraParams
	}, requestOptions));
	await new Promise((resolve) => {
		setImmediate(resolve);
	});
	return responseRecord(method, response);
}
async function closeAcpSession(process, sessionId) {
	const method = methods.agent.session.close;
	await withAcpDeadline(process, method, 2e3, (requestOptions) => process.connection.agent.request(method, { sessionId }, requestOptions));
}
async function initialize(process, profile, options, observe) {
	const meta = profile.initializeMeta?.(options);
	const method = methods.agent.initialize;
	const response = responseRecord(method, await withAcpDeadline(process, method, profile.requestTimeoutMs ?? 15e3, (requestOptions) => process.connection.agent.request(method, {
		protocolVersion: PROTOCOL_VERSION,
		clientCapabilities: {
			fs: {
				readTextFile: false,
				writeTextFile: false
			},
			terminal: true
		},
		clientInfo: {
			name: "oar",
			version: "0.0.0"
		},
		...meta === void 0 ? {} : { _meta: meta }
	}, requestOptions)));
	observe({
		method,
		response
	});
	const authMethod = profile.selectAuthMethod?.(response);
	if (authMethod !== void 0) {
		const authenticate = methods.agent.authenticate;
		observe({
			method: authenticate,
			response: asRecord(await withAcpDeadline(process, authenticate, profile.requestTimeoutMs ?? 15e3, (requestOptions) => process.connection.agent.request(authenticate, { methodId: authMethod }, requestOptions))) ?? {}
		});
	}
	return response;
}
async function createOrResume(process, profile, initialized, options, meta) {
	const capabilities = asRecord(initialized.agentCapabilities);
	const sessionCapabilities = asRecord(capabilities?.sessionCapabilities);
	const baseParams = {
		cwd: options.cwd,
		...acpAdditionalDirectories(options, initialized),
		mcpServers: acpMcpServersParam(options.mcpServers, initialized),
		...meta === void 0 ? {} : { _meta: meta }
	};
	const timeoutMs = profile.requestTimeoutMs ?? 15e3;
	if (options.resume !== void 0) {
		const sessionId = options.resume;
		let listed = null;
		if (profile.resumeKeepsSessionCwd === true && hasAcpCapability(sessionCapabilities?.list)) listed = await refuseResumeElsewhere(process, sessionId, options.cwd, timeoutMs);
		const params = {
			...baseParams,
			sessionId
		};
		let method = void 0;
		if (hasAcpCapability(sessionCapabilities?.resume)) method = methods.agent.session.resume;
		else if (capabilities?.loadSession === true) method = methods.agent.session.load;
		if (method === void 0) throw new Error("ACP runtime does not support session resume");
		const resumed = await withAcpDeadline(process, method, timeoutMs, (requestOptions) => process.connection.agent.request(method, params, requestOptions)).catch((error) => {
			throw acpResumeFailure(error, method, sessionId, (native) => profile.isResumeNotFound?.(native, listed) === true);
		});
		return {
			response: responseRecord(method, resumed),
			sessionId,
			openMethod: method
		};
	}
	const method = methods.agent.session.new;
	const response = responseRecord(method, await withAcpDeadline(process, method, timeoutMs, (requestOptions) => process.connection.agent.request(method, baseParams, requestOptions)));
	const sessionId = response.sessionId;
	if (typeof sessionId !== "string" || sessionId.length === 0) throw new TypeError("ACP session/new returned no session id");
	return {
		response,
		sessionId,
		openMethod: method
	};
}
async function openAcpSession(process, profile, options, observe = () => {}) {
	const initialized = await acpOpenStep(initialize(process, profile, options, observe), "open");
	const opened = await acpOpenStep(createOrResume(process, profile, initialized, options, profile.sessionMeta?.(options, initialized)), "open");
	observe({
		method: opened.openMethod,
		response: opened.response
	});
	const setModelResponse = options.model === void 0 ? void 0 : await acpOpenStep(applyAcpModel(process, opened.sessionId, options.model, {
		viaConfigOption: profile.modelViaConfigOption === true,
		timeoutMs: profile.requestTimeoutMs ?? 15e3,
		observe
	}), "model");
	if (options.effort !== void 0) await applyAcpEffort(process, setModelResponse !== void 0 && Array.isArray(setModelResponse.configOptions) ? {
		...opened,
		response: setModelResponse,
		openMethod: "session/set_config_option"
	} : opened, options.effort, {
		timeoutMs: profile.requestTimeoutMs ?? 15e3,
		observe
	});
	const configure = profile.configureSession;
	if (configure !== void 0) await configure({
		request: (method, params) => withAcpDeadline(process, method, profile.requestTimeoutMs ?? 15e3, (requestOptions) => process.connection.agent.request(method, params, requestOptions)),
		sessionId: opened.sessionId,
		response: opened.response,
		options
	});
	const sessionCapabilities = asRecord(asRecord(initialized.agentCapabilities)?.sessionCapabilities);
	return {
		initialized,
		...opened,
		supportsClose: hasAcpCapability(sessionCapabilities?.close),
		...setModelResponse === void 0 ? {} : { setModelResponse }
	};
}
var init_profile = __esmMin((() => {
	init_json();
	init_additional_directories();
	init_effort();
	init_failure$1();
	init_mcp_servers();
	init_process();
	init_resume_cwd();
	init_usage_wait();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/launch-args.js
/** The agent's argv for a session: the profile's args, with the host's own (SessionOptions.launchArgs) where the profile places them, after by default. */
function acpLaunchArgs(profile, options) {
	const args = typeof profile.args === "function" ? profile.args(options) : profile.args;
	const launchArgs = options.launchArgs ?? [];
	return launchArgs.length === 0 ? args : profile.withLaunchArgs?.(args, launchArgs) ?? [...args, ...launchArgs];
}
var init_launch_args = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/session-links.js
/** Add lineage to its first source frame, including at most one copy within that frame. */
function newSessionLinks(kernel, edges) {
	const known = kernel.graph().edges;
	const added = [];
	for (const edge of edges) {
		const same = (candidate) => candidate.parent === edge.parent && candidate.child === edge.child;
		if (!known.some((candidate) => same(candidate)) && !added.some((candidate) => same(candidate))) added.push(kernel.link(edge));
	}
	return added;
}
var init_session_links = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/projection.js
function createAcpProjectionState() {
	return { tools: /* @__PURE__ */ new Map() };
}
function textContent(value) {
	const content = asRecord(value);
	if (content !== null && typeof content.text === "string") return content.text;
	if (content !== null && content.type === "content") return textContent(content.content);
	if (Array.isArray(value)) {
		const parts = value.map((item) => textContent(item)).filter((item) => item !== null);
		return parts.length === 0 ? null : parts.join("\n");
	}
	return null;
}
function truncate(value) {
	return value.length > 1e4 ? `${value.slice(0, 1e4)}…` : value;
}
function detail(value) {
	if (typeof value === "string") return truncate(value);
	if (value === void 0 || value === null) return;
	const text = textContent(value);
	if (text !== null) return truncate(text);
	try {
		return truncate(JSON.stringify(value));
	} catch {
		return;
	}
}
function toolName(update) {
	if (typeof update.name === "string") return update.name;
	if (typeof update.toolName === "string") return update.toolName;
	if (update.sessionUpdate === "tool_call" && typeof update.title === "string") return update.title;
	return typeof update.kind === "string" ? update.kind : "tool";
}
function projectTool(state, update) {
	const callId = typeof update.toolCallId === "string" ? update.toolCallId : null;
	if (callId === null) return [];
	const events = [];
	let tool = state.tools.get(callId);
	const opening = tool === void 0;
	if (tool === void 0) {
		const input = detail(update.rawInput);
		tool = {
			callId,
			ended: false,
			input
		};
		state.tools.set(callId, tool);
		events.push({
			kind: "tool_call_started",
			callId,
			tool: toolName(update),
			...input === void 0 ? {} : { input }
		});
	} else if (!tool.ended) {
		const input = detail(update.rawInput);
		if (input !== void 0 && input !== tool.input) {
			tool.input = input;
			events.push({
				kind: "tool_call_input",
				callId,
				input
			});
		}
	}
	const terminal = update.status === "completed" || update.status === "failed" || update.status === "cancelled";
	if (!tool.ended && !terminal && !opening && update.rawOutput !== void 0) {
		const output = detail(update.rawOutput);
		events.push({
			kind: "tool_call_progress",
			callId,
			...output === void 0 ? {} : { output }
		});
	}
	if (!tool.ended && terminal) {
		tool.ended = true;
		const content = (toolContent(update.content, (item) => {
			const wrapper = asRecord(item);
			return wrapper?.type === "content" ? wrapper.content : item;
		}) ?? toolContent(update.rawOutput))?.map((part) => part.type === "text" ? {
			type: "text",
			text: truncate(part.text)
		} : part);
		let result = void 0;
		if (update.status === "completed") result = "ok";
		else if (update.status === "failed") result = "failed";
		const exitCode = rawOutputExitCode(update.rawOutput);
		events.push({
			kind: "tool_call_ended",
			callId,
			...content === void 0 ? {} : { content },
			...result === void 0 ? {} : { result },
			...exitCode === void 0 ? {} : { exitCode }
		});
	}
	return events;
}
/**
* The exit status a vendor puts on a completed command's `rawOutput` (grok
* 1.0.25: `{type: "Bash", exit_code: 0, signal: null, …}`). ACP itself
* defines none, so the key is read only when present; `null` is the
* runtime's own "no code".
*/
function rawOutputExitCode(rawOutput) {
	const record = asRecord(rawOutput);
	if (record === null) return;
	const value = "exit_code" in record ? record.exit_code : record.exitCode;
	if (value === void 0) return;
	return typeof value === "number" ? value : null;
}
/** Context fullness from a `usage_update` (`used` / `size`), when it carries any. */
function acpContextUsage(update) {
	const tokens = asNumber(update.used);
	const contextWindow = asNumber(update.size);
	if (tokens === null && contextWindow === null) return null;
	return {
		tokens,
		contextWindow,
		percent: tokens === null || contextWindow === null || contextWindow === 0 ? null : Math.round(tokens / contextWindow * 100)
	};
}
/**
* A prompt answer's `usage` event, from the profile's readings of it: the
* context, and the prompt's own ledger added to the session's `billed`
* total (cache parts included) and stamped cumulative. No event when the
* answer carried neither.
*/
function acpPromptUsage(context, prompted, billed) {
	const next = prompted === null ? billed : addTokens(billed, prompted);
	if (context === null && prompted === null) return {
		event: null,
		billed: next
	};
	return {
		event: {
			kind: "usage",
			usage: {
				...context === null ? {} : { context },
				...prompted === null ? {} : { tokens: next }
			}
		},
		billed: next
	};
}
function reasoningView(value) {
	const text = textContent(value);
	return {
		kind: "reasoning",
		content: text === null ? { kind: "redacted" } : text.length === 0 ? { kind: "empty" } : {
			kind: "text",
			text
		}
	};
}
/** The events oar reads out of one `session/update`; the update itself is recorded verbatim by the caller. */
function projectAcpUpdate(state, update) {
	const events = [];
	switch (update.sessionUpdate) {
		case "usage_update": {
			const context = acpContextUsage(update);
			if (context !== null) events.push({
				kind: "usage",
				usage: { context }
			});
			break;
		}
		case "agent_message_chunk": {
			const text = textContent(update.content);
			if (text !== null && text.length > 0) events.push({
				kind: "text_delta",
				text
			});
			break;
		}
		case "agent_thought_chunk":
			events.push(reasoningView(update.content));
			break;
		case "tool_call":
		case "tool_call_update":
			events.push(...projectTool(state, update));
			break;
		default: break;
	}
	const model = acpReportedModel(update);
	if (model !== null) events.push({
		kind: "model",
		model
	});
	const effort = acpReportedEffort(update);
	if (effort !== null) events.push({
		kind: "effort",
		effort
	});
	return events;
}
/** The outcome an ACP prompt answer reports: `cancelled` is the runtime honoring session/cancel. */
function defaultAcpPromptOutcome(response) {
	return response.stopReason === "cancelled" ? { kind: "aborted" } : { kind: "completed" };
}
/** A JSON-safe rendering of an RPC error for the `native` of a prompt-error event. */
function acpErrorNative(error) {
	if (error instanceof AcpError) return {
		name: error.name,
		kind: error.kind,
		message: error.message,
		exitCode: error.exitCode,
		method: error.method,
		timeoutMs: error.timeoutMs
	};
	if (error instanceof Error) return {
		...asRecord(error) ?? {},
		name: error.name,
		message: error.message
	};
	return { message: String(error) };
}
var init_projection = __esmMin((() => {
	init_json();
	init_token_totals();
	init_tool_output();
	init_errors();
	init_model();
	init_failure$1();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/records.js
function stringField(record, names) {
	for (const name of names) {
		const value = record[name];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}
/**
* The parent/child session pair a vendor notification names, in either
* spelling and at either depth. grok 1.0.25 (live, 2026-09-11) spells it
* `_x.ai/session_notification {sessionId: <parent>, update: {sessionUpdate:
* "subagent_spawned" | "subagent_progress", parent_session_id,
* child_session_id, subagent_type, …}}`: snake_case, nested under `update`;
* its `subagent_finished` carries only `child_session_id`, the parent being
* the envelope's `sessionId`. A flat camelCase `{parentSessionId,
* childSessionId | sessionId}` is the fixture spelling.
*/
function acpLineageOf(params) {
	const envelope = stringField(params, ["sessionId"]);
	const flatParent = stringField(params, ["parentSessionId", "parent_session_id"]);
	const flatChild = stringField(params, ["childSessionId", "child_session_id"]) ?? envelope;
	if (flatParent !== null && flatChild !== null && flatParent !== flatChild) return {
		parent: flatParent,
		child: flatChild
	};
	const update = asRecord(params.update);
	const nestedChild = update === null ? null : stringField(update, ["childSessionId", "child_session_id"]);
	const nestedParent = update === null ? null : stringField(update, ["parentSessionId", "parent_session_id"]) ?? envelope;
	if (nestedParent !== null && nestedChild !== null && nestedParent !== nestedChild) return {
		parent: nestedParent,
		child: nestedChild
	};
	return null;
}
function createAcpRecorder(usageGate, attributeUpdate, tokenUsage) {
	const projections = /* @__PURE__ */ new Map();
	const projectionFor = (sessionId) => {
		let state = projections.get(sessionId);
		if (state === void 0) {
			state = createAcpProjectionState();
			projections.set(sessionId, state);
		}
		return state;
	};
	let bound = null;
	const queued = [];
	const write = (append) => {
		if (bound === null) queued.push(append);
		else append(bound);
	};
	return {
		bind(kernel) {
			bound = kernel;
			for (const append of queued.splice(0)) append(kernel);
		},
		update(notification) {
			write((kernel) => {
				const source = attributeUpdate?.(notification);
				const update = asRecord(notification.update);
				const sessionId = source?.sessionId ?? notification.sessionId;
				const foreign = sessionId !== kernel.sessionId;
				const events = update === null ? [] : projectAcpUpdate(projectionFor(sessionId), update);
				if (source?.parent !== void 0) events.push(...newSessionLinks(kernel, [{
					parent: source.parent,
					child: sessionId,
					via: "tool_call"
				}]));
				const type = typeof update?.sessionUpdate === "string" ? update.sessionUpdate : methods$1.client.session.update;
				const record = kernel.frame({
					type,
					native: notification,
					events
				}, foreign ? { sessionId } : void 0);
				if (!foreign) usageGate.observe(events.some((event) => event.kind === "usage") ? record.seq : void 0);
			});
		},
		extension(method, params, afterOpen = false) {
			write((kernel) => {
				const sessionId = stringField(params, ["sessionId"]);
				const foreign = sessionId !== null && sessionId !== kernel.sessionId;
				const lineage = acpLineageOf(params);
				const events = lineage === null ? [] : newSessionLinks(kernel, [{
					...lineage,
					via: "tool_call"
				}]);
				const usage = sessionId === kernel.sessionId ? tokenUsage?.extension(method, params, afterOpen) : null;
				if (usage !== null && usage !== void 0) events.push(usage);
				kernel.frame({
					type: method,
					native: params,
					events
				}, foreign ? { sessionId } : void 0);
			});
		},
		step(method, response) {
			write((kernel) => {
				const model = acpReportedModel(response);
				const effort = acpReportedEffort(response);
				kernel.frame({
					type: method,
					native: response,
					events: [...model === null ? [] : [{
						kind: "model",
						model
					}], ...effort === null ? [] : [{
						kind: "effort",
						effort
					}]]
				});
			});
		},
		requested(id, method, params) {
			write((kernel) => {
				kernel.request("toApp", {
					kind: "native",
					type: method,
					native: params
				}, { id });
			});
		},
		answered(id, reply) {
			write((kernel) => {
				kernel.respond(id, {
					kind: "answered",
					native: reply ?? null
				});
			});
		}
	};
}
var init_records = __esmMin((() => {
	init_json();
	init_session_links();
	init_model();
	init_process();
	init_projection();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/terminal.js
function invalid(message) {
	throw RequestError.invalidParams(void 0, message);
}
function outputLimit(value) {
	if (value === void 0 || value === null) return DEFAULT_OUTPUT_LIMIT;
	if (!Number.isFinite(value) || value < 0) invalid("ACP terminal outputByteLimit must be finite and nonnegative");
	return Math.min(Math.floor(value), MAX_OUTPUT_LIMIT);
}
function tailAtCharacterBoundary(value, limit) {
	const encoded = Buffer.from(value);
	if (encoded.byteLength <= limit) return value;
	let start = encoded.byteLength - limit;
	while (start < encoded.byteLength) {
		const byte = encoded[start];
		if (byte === void 0 || (byte & 192) !== 128) break;
		start += 1;
	}
	return encoded.subarray(start).toString("utf8");
}
function appendOutput(state, text) {
	if (text.length === 0) return;
	const combined = `${state.output}${text}`;
	if (Buffer.byteLength(combined) > state.outputLimit) {
		state.truncated = true;
		state.output = tailAtCharacterBoundary(combined, state.outputLimit);
	} else state.output = combined;
}
function terminalFor(terminals, params) {
	const terminal = terminals.get(params.terminalId);
	if (terminal === void 0 || terminal.sessionId !== params.sessionId) invalid(`Unknown ACP terminal: ${params.terminalId}`);
	return terminal;
}
async function stopTerminal(state) {
	if (state.exitStatus === null) signalProcessGroup(state.child, "SIGKILL");
	await state.exited;
}
/** Host implementation of ACP v1's typed terminal reverse-RPC surface. */
function createAcpTerminalHost(cwd, environment, options = {}) {
	const terminals = /* @__PURE__ */ new Map();
	const create = async (params) => {
		if (params.command.length === 0) invalid("ACP terminal request requires command");
		if (params.cwd !== void 0 && params.cwd !== null && !path.isAbsolute(params.cwd)) invalid("ACP terminal cwd must be an absolute path");
		const terminalId = randomUUID();
		const child = spawn(params.command, params.args ?? [], {
			cwd: params.cwd ?? cwd,
			env: {
				...environment,
				...Object.fromEntries((params.env ?? []).map(({ name, value }) => [name, value]))
			},
			shell: options.shellCommand === true && params.args === void 0,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			detached: OWN_PROCESS_GROUP
		});
		trackOwnedProcess(child);
		const { stdout, stderr } = child;
		if (stdout === null || stderr === null) {
			child.kill("SIGKILL");
			throw RequestError.internalError(void 0, "ACP terminal process has no output streams");
		}
		const { promise: spawned, resolve: resolveSpawned, reject: rejectSpawned } = Promise.withResolvers();
		const { promise: exited, resolve: resolveExited } = Promise.withResolvers();
		const state = {
			child,
			exited,
			sessionId: params.sessionId,
			stderrDecoder: new StringDecoder("utf8"),
			stdoutDecoder: new StringDecoder("utf8"),
			terminalId,
			outputLimit: outputLimit(params.outputByteLimit),
			exitStatus: null,
			output: "",
			truncated: false
		};
		terminals.set(terminalId, state);
		stdout.on("data", (chunk) => {
			appendOutput(state, state.stdoutDecoder.write(Buffer.from(chunk)));
		});
		stderr.on("data", (chunk) => {
			appendOutput(state, state.stderrDecoder.write(Buffer.from(chunk)));
		});
		const finish = (status) => {
			if (state.exitStatus !== null) return;
			appendOutput(state, state.stdoutDecoder.end());
			appendOutput(state, state.stderrDecoder.end());
			state.exitStatus = status;
			resolveExited(status);
		};
		child.once("spawn", resolveSpawned);
		child.once("close", (exitCode, signal) => {
			finish({
				exitCode,
				signal
			});
		});
		child.once("error", (error) => {
			rejectSpawned(error);
			finish({
				exitCode: null,
				signal: null
			});
		});
		try {
			await spawned;
		} catch (error) {
			terminals.delete(terminalId);
			throw RequestError.internalError(void 0, error instanceof Error ? error.message : "Failed to create ACP terminal");
		}
		return { terminalId };
	};
	const output = (params) => {
		const state = terminalFor(terminals, params);
		return {
			output: state.output,
			truncated: state.truncated,
			...state.exitStatus === null ? {} : { exitStatus: state.exitStatus }
		};
	};
	const waitForExit = async (params) => ({ ...await terminalFor(terminals, params).exited });
	const kill = (params) => {
		const state = terminalFor(terminals, params);
		if (state.exitStatus === null) signalProcessGroup(state.child, "SIGTERM");
		return {};
	};
	const release = async (params) => {
		const state = terminalFor(terminals, params);
		terminals.delete(state.terminalId);
		await stopTerminal(state);
		return {};
	};
	return {
		create,
		output,
		waitForExit,
		kill,
		release,
		async dispose() {
			const active = [...terminals.values()];
			terminals.clear();
			await Promise.all(active.map(async (state) => {
				await stopTerminal(state);
			}));
		}
	};
}
var DEFAULT_OUTPUT_LIMIT, MAX_OUTPUT_LIMIT;
var init_terminal = __esmMin((() => {
	init_executable();
	DEFAULT_OUTPUT_LIMIT = 4 * 1024 * 1024;
	MAX_OUTPUT_LIMIT = 16 * 1024 * 1024;
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/held-input.js
/**
* The decision of `Session.withdraw` over an adapter-held queue: remove every
* entry held for `inputId` and answer `accepted`, or answer `not_queued` when
* none is waiting (already sent, never queued in this session, or already
* withdrawn). Synchronous on purpose, and called synchronously from the
* withdraw's `kernel.control` decision: the adapter's drain takes an entry
* off the same array in one step before it sends it, so a withdraw either
* removes the entry before the drain reaches it or finds it gone. It never
* accepts an input that may already have been sent.
*/
function withdrawHeld(held, inputId) {
	const before = held.length;
	for (let index = held.length - 1; index >= 0; index -= 1) if (held[index]?.inputId === inputId) held.splice(index, 1);
	return held.length < before ? { kind: "accepted" } : {
		kind: "rejected",
		code: "not_queued",
		reason: "no held input with this inputId is waiting"
	};
}
/**
* The `withdraw` member of an adapter that holds its queue in `held`: the
* request is recorded through `kernel.control`, so a disposed or exited
* session answers `disposed` / `runtime_exited` before `withdrawHeld` runs.
*/
function withdrawControl(kernel, held) {
	return async (inputId) => {
		return await kernel.control({
			kind: "withdraw",
			inputId
		}, () => withdrawHeld(held, inputId));
	};
}
var init_held_input = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/input-images.js
/**
* Why an input's images cannot go, or null when they can: a session without
* image input refuses any image `unsupported`, and so does a file that is not
* a png/jpeg/gif/webp; an unreadable one is an `error`. The whole input is
* refused, so nothing is ever delivered without the images it came with. An
* adapter asks after its own refusals (`busy` keeps its meaning).
*/
function inputImagesRefusal(capabilities, images) {
	if (images === void 0 || images.length === 0) return null;
	if (!capabilities.images) return rejected("unsupported", "this runtime takes no image input");
	for (const image of images) {
		const mediaType = mediaTypeOf(image);
		if (mediaType === void 0 || !accepted.has(mediaType)) return rejected("unsupported", `not a png, jpeg, gif or webp image: ${image.path}`);
		try {
			accessSync(image.path, constants.R_OK);
		} catch (error) {
			return rejected("error", `cannot read image ${image.path}: ${message(error)}`);
		}
	}
	return null;
}
/** Deliver an input with its images read (see `inputImagesRefusal`), or refuse it. */
function withInputImages(capabilities, images, deliver) {
	const refused = inputImagesRefusal(capabilities, images);
	if (refused !== null) return refused;
	const loaded = [];
	for (const image of images ?? []) try {
		loaded.push({
			path: image.path,
			mediaType: mediaTypeOf(image) ?? "",
			data: readFileSync(image.path).toString("base64")
		});
	} catch (error) {
		return rejected("error", `cannot read image ${image.path}: ${message(error)}`);
	}
	return deliver(loaded);
}
var mediaTypes, accepted, mediaTypeOf, rejected, message;
var init_input_images = __esmMin((() => {
	mediaTypes = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp"
	};
	accepted = new Set(Object.values(mediaTypes));
	mediaTypeOf = (image) => image.mediaType ?? mediaTypes[extname(image.path).toLowerCase()];
	rejected = (code, reason) => ({
		kind: "rejected",
		code,
		reason
	});
	message = (error) => error instanceof Error ? error.message : String(error);
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/turns.js
/** The agent advertised image prompts in `initialize` (`agentCapabilities.promptCapabilities.image`). */
function acpTakesImages(initialized) {
	return asRecord(asRecord(initialized.agentCapabilities)?.promptCapabilities)?.image === true;
}
/** One input as ACP ContentBlocks: the images (each naming its file as `uri`), then any nonempty text. */
function acpPrompt(input, images) {
	return [...images.map((image) => ({
		type: "image",
		mimeType: image.mediaType,
		data: image.data,
		uri: pathToFileURL(image.path).href
	})), ...input === "" ? [] : [{
		type: "text",
		text: input
	}]];
}
function createAcpTurns(deps) {
	const { kernel, runtime, profile, usageGate, capabilities, promptUsage, promptMeta } = deps;
	const rootId = kernel.sessionId;
	const held = [];
	let active = null;
	let nextRequest = 0;
	const closeTurn = (state) => {
		if (state.fallback !== null) {
			clearTimeout(state.fallback);
			state.fallback = null;
		}
		if (active === state) active = null;
		queueMicrotask(drainHeld);
	};
	const finishRequest = (state, requestNumber, frame, outcome) => {
		state.pending.delete(requestNumber);
		if (outcome !== null) state.outcomes.set(requestNumber, outcome);
		const closes = active === state && (profile.steerSupersedesPrompt === true ? state.pending.size === 0 : !frame.steered);
		const events = [];
		if (frame.dropped !== void 0) events.push({
			kind: "input_dropped",
			inputId: frame.dropped,
			reason: "runtime_refused"
		});
		if (closes) {
			const terminal = profile.steerSupersedesPrompt === true ? state.outcomes.get(Math.max(...state.outcomes.keys())) : outcome;
			if (terminal !== null && terminal !== void 0) events.push({
				kind: "turn_ended",
				outcome: terminal
			});
		}
		if (frame.context !== null) events.push(frame.context);
		kernel.frame({
			type: frame.type,
			native: frame.native,
			events
		});
		if (closes) closeTurn(state);
	};
	const startVendorPrompt = (state, prompt, extraParams = {}, steered) => {
		nextRequest += 1;
		const requestNumber = nextRequest;
		state.pending.add(requestNumber);
		(async () => {
			try {
				usageGate.arm();
				const result = await promptAcp(runtime, rootId, prompt, promptMeta === void 0 ? extraParams : {
					...extraParams,
					_meta: {
						...promptMeta,
						...asRecord(extraParams._meta)
					}
				});
				await usageGate.settleAfterPrompt(profile, state.abortRequested);
				const usage = promptUsage(result);
				finishRequest(state, requestNumber, {
					type: methods$1.agent.session.prompt,
					native: result,
					context: usage,
					steered: steered !== void 0
				}, profile.promptOutcome?.(result) ?? defaultAcpPromptOutcome(result));
			} catch (error) {
				if (error instanceof AcpError && error.kind === "process_exited") {
					state.pending.delete(requestNumber);
					closeTurn(state);
					return;
				}
				const turnFrames = kernel.records().flatMap((record) => record.kind === "frame" && record.seq > state.since ? [record.body] : []);
				const outcome = state.abortRequested ? { kind: "aborted" } : acpFailureOutcome(error, turnFrames, profile.failureOutcome);
				finishRequest(state, requestNumber, {
					type: `${methods$1.agent.session.prompt}/error`,
					native: acpErrorNative(error),
					context: null,
					steered: steered !== void 0,
					...steered === void 0 ? {} : { dropped: steered.inputId }
				}, steered === void 0 ? outcome : null);
			}
		})();
	};
	const gone = () => ({
		kind: "rejected",
		code: "runtime_exited",
		reason: acpProcessExitedError(runtime.exitCode).message
	});
	const open = (request, prompt) => {
		if (runtime.closed) return gone();
		const state = {
			request,
			since: kernel.records().at(-1)?.seq ?? -1,
			outcomes: /* @__PURE__ */ new Map(),
			pending: /* @__PURE__ */ new Set(),
			abortRequested: false,
			fallback: null
		};
		active = state;
		startVendorPrompt(state, prompt);
		return { kind: "accepted" };
	};
	const begin = (request, input, images) => withInputImages(capabilities, images, (loaded) => open(request, acpPrompt(input, loaded)));
	function drainHeld() {
		if (kernel.unreachable() !== null || active !== null || runtime.closed) return;
		const next = held.shift();
		if (next !== void 0) open(null, next.prompt);
	}
	return {
		active: () => active,
		begin,
		async steer(state, input, options, extraParams) {
			await runtime.spawned;
			if (runtime.closed) return gone();
			return withInputImages(capabilities, options?.images, (loaded) => {
				startVendorPrompt(state, acpPrompt(input, loaded), extraParams, { inputId: options?.inputId });
				return { kind: "accepted" };
			});
		},
		async abort(state) {
			if (!state.abortRequested) {
				state.abortRequested = true;
				try {
					await runtime.connection.agent.notify(methods$1.agent.session.cancel, { sessionId: rootId });
				} catch (error) {
					return {
						kind: "rejected",
						code: "error",
						reason: error instanceof Error ? error.message : String(error)
					};
				}
				state.fallback = setTimeout(() => {
					if (active === state) runtime.kill();
				}, profile.abortTimeoutMs ?? 1e4);
				state.fallback.unref();
			}
			return { kind: "accepted" };
		},
		async hold(input, images, inputId) {
			await runtime.spawned;
			if (runtime.closed) return gone();
			return withInputImages(capabilities, images, (loaded) => {
				held.push({
					inputId,
					prompt: acpPrompt(input, loaded)
				});
				queueMicrotask(drainHeld);
				return { kind: "accepted" };
			});
		},
		withdraw: (inputId) => withdrawHeld(held, inputId),
		onExit() {
			if (active !== null) closeTurn(active);
			held.splice(0);
		}
	};
}
var init_turns = __esmMin((() => {
	init_held_input();
	init_input_images();
	init_json();
	init_errors();
	init_profile();
	init_process();
	init_projection();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/token-usage.js
function createAcpTokenUsage(profile) {
	let billed = {
		input: 0,
		output: 0
	};
	const seen = /* @__PURE__ */ new Set();
	return {
		prompt(response) {
			const reading = acpPromptUsage(profile.promptContextUsage?.(response) ?? null, profile.promptTokenUsage?.(response) ?? null, billed);
			({billed} = reading);
			return reading.event;
		},
		extension(method, params, opened) {
			const report = profile.spontaneousTokenUsage?.(method, params);
			if (report === void 0 || report === null || seen.has(report.key)) return null;
			seen.add(report.key);
			if (!opened || report.replayed === true) return null;
			const reading = acpPromptUsage(null, report.tokens, billed);
			({billed} = reading);
			return reading.event;
		}
	};
}
var init_token_usage = __esmMin((() => {
	init_projection();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/acp/session.js
function acpSession(profile) {
	return withSessionCredentials(async (installation, options, credentials) => {
		if (installation.via !== "executable") throw new Error("ACP runtimes require an executable installation");
		profile.validateOptions?.(options);
		const withoutCredentials = acpMcpOpenGuard(options.mcpServers, credentials.redact);
		const args = acpLaunchArgs(profile, options);
		const environment = sessionEnvironment(options.env);
		const terminalHost = createAcpTerminalHost(options.cwd, environment, { shellCommand: profile.terminalShellCommand === true });
		const usageGate = createUsageUpdateGate();
		const tokenUsage = createAcpTokenUsage(profile);
		const opening = createAcpOpening();
		const recorder = createAcpRecorder(usageGate, profile.attributeUpdate, tokenUsage);
		const client = createAcpClientApp(terminalHost, {
			update: (notification) => {
				recorder.update(notification);
			},
			extension: (method, params) => {
				recorder.extension(method, profile.redactExtensionNotification?.(method, params) ?? params, opening.afterOpen(params));
			},
			requested: (id, method, params) => {
				recorder.requested(id, method, params);
			},
			answered: (id, reply) => {
				recorder.answered(id, reply);
			},
			extensionNotifications: profile.extensionNotifications ?? []
		});
		const runtime = startAcpProcess(installation.command, args, client, {
			cwd: options.cwd,
			env: environment,
			redact: credentials.redact,
			opening
		});
		const opened = await openAcpSession(runtime, profile, options, (step) => {
			recorder.step(step.method, step.response);
		}).catch(async (error) => {
			runtime.kill();
			await runtime.exited;
			await terminalHost.dispose();
			throw withoutCredentials(error);
		});
		const kernel = credentials.kernel(opened.sessionId);
		recorder.bind(kernel);
		let disposeRequest = null;
		const capabilities = {
			...profile.capabilities,
			images: profile.capabilities.images ?? acpTakesImages(opened.initialized)
		};
		const turns = createAcpTurns({
			kernel,
			runtime,
			profile,
			usageGate,
			capabilities,
			promptMeta: profile.promptMeta?.(options),
			promptUsage: (result) => tokenUsage.prompt(result)
		});
		runtime.exited.then((code) => {
			terminalHost.dispose();
			kernel.respond(disposeRequest?.id ?? "", {
				kind: "exited",
				code
			});
			turns.onExit();
		});
		const control = async (body, decide) => {
			if (runtime.closed && kernel.unreachable() === null) await runtime.exited;
			return kernel.control(body, decide);
		};
		const { steerParams } = profile;
		const steer = steerParams === void 0 ? {} : { steer: (input, inputOptions) => control({
			kind: "steer",
			input,
			...inputOptions
		}, () => {
			const state = turns.active();
			return state === null ? {
				kind: "rejected",
				code: "no_active_turn",
				reason: "not_steerable: no active turn"
			} : turns.steer(state, input, inputOptions, steerParams(input));
		}) };
		return credentials.seal({
			id: kernel.sessionId,
			capabilities,
			prompt: (input, inputOptions) => control({
				kind: "prompt",
				input,
				...inputOptions
			}, (request) => turns.active() === null ? turns.begin(request, input, inputOptions?.images) : {
				kind: "rejected",
				code: "busy",
				reason: "busy"
			}),
			...steer,
			queue: (input, inputOptions) => control({
				kind: "queue",
				input,
				...inputOptions
			}, () => turns.hold(input, inputOptions?.images, inputOptions?.inputId)),
			withdraw: (inputId) => control({
				kind: "withdraw",
				inputId
			}, () => turns.withdraw(inputId)),
			abort: () => control({ kind: "abort" }, () => {
				const state = turns.active();
				return state === null ? {
					kind: "rejected",
					code: "no_active_turn",
					reason: "no active turn"
				} : turns.abort(state);
			}),
			rawEvents: (observer, cursor) => kernel.rawEvents(observer, cursor),
			records: () => kernel.records(),
			graph: () => kernel.graph(),
			resources: runtime.resources,
			dispose: async () => {
				if (disposeRequest !== null) return;
				const gone = kernel.unreachable() !== null;
				disposeRequest = kernel.request("toRuntime", { kind: "dispose" });
				if (gone) {
					kernel.respond(disposeRequest.id, { kind: "accepted" });
					await terminalHost.dispose();
					return;
				}
				const state = turns.active();
				if (state !== null && !runtime.closed) await turns.abort(state);
				if (opened.supportsClose && !runtime.closed) await closeAcpSession(runtime, kernel.sessionId).catch(() => {});
				runtime.kill();
				await runtime.exited;
				await terminalHost.dispose();
			}
		});
	});
}
var init_session$4 = __esmMin((() => {
	init_environment();
	init_session_credentials();
	init_client_app();
	init_profile();
	init_launch_args();
	init_process();
	init_records();
	init_terminal();
	init_turns();
	init_token_usage();
	init_opening();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/session-options.js
/** The names of the `mcpServers` entries carrying a credential: `env` on a stdio entry, `headers` on an http one. */
function credentialEntries(options) {
	return (options.mcpServers ?? []).filter((server) => hasMcpCredentials(server)).map((server) => server.name);
}
/** Whether `options` gives `key`: any defined value (including an empty schema), a non-empty map for `env`, a non-empty list for list options, an entry carrying a credential for `mcpServerCredentials`. */
function sessionOptionGiven(options, key) {
	if (key === "env") return options.env !== void 0 && Object.keys(options.env).length > 0;
	if (key === "mcpServerCredentials") return credentialEntries(options).length > 0;
	if (key === "mcpServers" || key === "disallowedTools" || key === "launchArgs" || key === "additionalDirectories") return options[key] !== void 0 && options[key].length > 0;
	return options[key] !== void 0;
}
/**
* Reject an open that gives an option the runtime declares refused: an
* `UnsupportedOptionError` naming it (`mcpServers` for
* `mcpServerCredentials`), with the declared reason, followed by the refused
* values for `disallowedTools` and the entries' names for
* `mcpServerCredentials`.
*/
function refuseSessionOptions(refused, options) {
	for (const key of [
		"systemPrompt",
		"appendSystemPrompt",
		"env",
		"mcpServers",
		"mcpServerCredentials",
		"disallowedTools",
		"launchArgs",
		"serviceTier",
		"additionalDirectories",
		"outputSchema",
		"name"
	]) {
		const reason = refused[key];
		if (reason === void 0 || !sessionOptionGiven(options, key)) continue;
		if (key === "mcpServerCredentials") throw new UnsupportedOptionError("mcpServers", `${reason}: ${JSON.stringify(credentialEntries(options))}`);
		throw new UnsupportedOptionError(key, key === "disallowedTools" ? `${reason}: ${JSON.stringify(options.disallowedTools)}` : reason);
	}
}
/**
* A blank SessionOptions.name, or one with a NUL character, is refused before
* anything starts, as invalid `additionalDirectories` are: claude and pi
* would open unnamed without a word, codex would refuse a blank one only
* after the thread opened (pi's own `--name` refuses it the same way), and
* no command line can carry a NUL.
*/
function checkSessionName(options) {
	if (options.name !== void 0 && (options.name.trim().length === 0 || options.name.includes("\0"))) throw new UnsupportedOptionError("name", "name must not be blank or contain NUL characters");
}
var init_session_options = __esmMin((() => {
	init_errors$1();
	init_mcp_servers$1();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/antigravity/session.js
var session_exports$3 = /* @__PURE__ */ __exportAll({
	antigravityAcpArgs: () => antigravityAcpArgs,
	antigravityAcpProfile: () => antigravityAcpProfile,
	antigravitySession: () => antigravitySession,
	antigravityToolDenials: () => antigravityToolDenials,
	supportsAntigravityYolo: () => supportsAntigravityYolo
});
/**
* The ACP registry's launch line for agy_acp_server 1.2.1. On Linux the
* binary's startup drops privileges to group `nobody` unless `--uid=` is
* empty, and on a host without that group it aborts before speaking ACP
* ("Check failed: LookupGIDByGroupName"). macOS and Windows take no args.
*/
function antigravityAcpArgs(platform = process.platform) {
	return platform === "linux" ? ["--uid="] : [];
}
/**
* agy_acp_server 1.2.1 lists `yolo` both as a session mode and as a value of
* its `mode` config option; either way `session/set_mode` applies it.
*/
function supportsAntigravityYolo(response) {
	const modes = asRecord(response.modes);
	if ((Array.isArray(modes?.availableModes) ? modes.availableModes : []).map((mode) => asRecord(mode)).some((mode) => mode?.id === "yolo")) return true;
	const mode = (Array.isArray(response.configOptions) ? response.configOptions : []).map((option) => asRecord(option)).find((option) => option?.id === "mode");
	return (Array.isArray(mode?.options) ? mode.options : []).map((value) => asRecord(value)).some((option) => option?.value === "yolo");
}
function antigravityToolDenials(options) {
	const unsupported = (options.disallowedTools ?? []).filter((name) => !ANTIGRAVITY_FILTER_NAMES.has(name));
	if (unsupported.length > 0) throw new UnsupportedOptionError("disallowedTools", `antigravity disabledTools only filters canonical built-in names; MCP, client tools and unknown names cannot be disabled: ${JSON.stringify(unsupported)}`);
}
/** 1.4.0 names session extensions under `_meta.antigravity`. */
function sessionMeta(options, initialized) {
	const { appendSystemPrompt, disallowedTools } = options;
	const native = asRecord(asRecord(asRecord(initialized.agentCapabilities)?._meta)?.antigravity);
	if (disallowedTools !== void 0 && disallowedTools.length > 0 && native === null) throw new UnsupportedOptionError("disallowedTools", "antigravity tool denials require the native antigravity metadata capability (server and harness 1.4.0 or newer)");
	if (appendSystemPrompt !== void 0 && asRecord(native?.systemPrompt)?.append !== true) throw new UnsupportedOptionError("appendSystemPrompt", "antigravity does not advertise systemPrompt.append");
	if (appendSystemPrompt === void 0 && disallowedTools === void 0) return;
	return { antigravity: {
		...appendSystemPrompt === void 0 ? {} : { systemPrompt: { append: appendSystemPrompt } },
		...disallowedTools === void 0 ? {} : { disabledTools: [...disallowedTools] }
	} };
}
var ANTIGRAVITY_FILTER_NAMES, antigravityAcpProfile, antigravitySession;
var init_session$3 = __esmMin((() => {
	init_options$3();
	init_errors$1();
	init_session$4();
	init_json();
	init_session_options();
	ANTIGRAVITY_FILTER_NAMES = new Set([
		"list_directory",
		"search_directory",
		"find_file",
		"view_file",
		"create_file",
		"edit_file",
		"run_command",
		"ask_question",
		"start_subagent",
		"generate_image",
		"search_web",
		"read_url_content",
		"schedule",
		"finish"
	]);
	antigravityAcpProfile = {
		args: () => antigravityAcpArgs(),
		isResumeNotFound: (native) => native.code === -32002,
		capabilities: {
			queue: { durable: false },
			attribution: "opaque"
		},
		requestTimeoutMs: 3e4,
		validateOptions: (options) => {
			refuseSessionOptions(antigravityRefusedSessionOptions, options);
			antigravityToolDenials(options);
		},
		sessionMeta,
		modelViaConfigOption: true,
		configureSession: async ({ request, sessionId, response }) => {
			if (supportsAntigravityYolo(response)) await request("session/set_mode", {
				sessionId,
				modeId: "yolo"
			});
		}
	};
	antigravitySession = acpSession(antigravityAcpProfile);
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/listing-cwd.js
/** `ListModelsOptions.cwd` resolved against the host's cwd, which is also its default. */
function listingCwd(options) {
	return resolve(options.cwd ?? process.cwd());
}
var init_listing_cwd = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/antigravity/list-models.js
var list_models_exports$2 = /* @__PURE__ */ __exportAll({
	antigravityListModels: () => antigravityListModels,
	projectAntigravityModels: () => projectAntigravityModels
});
function text$13(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Project a `session/new` response. agy_acp_server 1.4.0 has no model-list
* method; the account's models ride on every new session as the
* `configOptions` entry with id `model`, the option the session switches
* through `session/set_config_option`. Its `thought_level` menu belongs only
* to the current model, so only that entry gets levels and a default.
*/
function projectAntigravityModels(response) {
	const root = asRecord(response);
	const modelOption = asRecordList(root?.configOptions).find((option) => option.id === "model");
	if (modelOption === void 0) return;
	const current = text$13(modelOption.currentValue);
	const thinking = acpThoughtLevelOption(root);
	const effortLevels = asRecordList(thinking?.options).map((option) => text$13(option.value)).filter((value) => value !== void 0);
	const defaultEffort = text$13(thinking?.currentValue);
	const entries = [];
	for (const model of asRecordList(modelOption.options)) {
		const id = text$13(model.value);
		if (id === void 0) continue;
		const displayName = text$13(model.name);
		entries.push({
			id,
			...displayName === void 0 || displayName === id ? {} : { displayName },
			...id === current ? { default: true } : {},
			...id === current && effortLevels.length > 0 ? { effortLevels } : {},
			...id === current && defaultEffort !== void 0 ? { defaultEffort } : {}
		});
	}
	return entries;
}
async function readNewSession$1(command, cwd, timeoutMs) {
	const runtime = startAcpProcess(command, antigravityAcpArgs(), client({ name: "oar" }), {
		cwd,
		env: process.env
	});
	try {
		const initialize = methods.agent.initialize;
		await withAcpDeadline(runtime, initialize, timeoutMs, (requestOptions) => runtime.connection.agent.request(initialize, {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {
				fs: {
					readTextFile: false,
					writeTextFile: false
				},
				terminal: false
			},
			clientInfo: {
				name: "oar",
				version: "0.0.0"
			}
		}, requestOptions));
		const newSession = methods.agent.session.new;
		return asRecord(await withAcpDeadline(runtime, newSession, timeoutMs, (requestOptions) => runtime.connection.agent.request(newSession, {
			cwd,
			mcpServers: []
		}, requestOptions))) ?? {};
	} finally {
		runtime.kill();
		await runtime.exited;
	}
}
var antigravityListModels;
var init_list_models$2 = __esmMin((() => {
	init_process();
	init_model();
	init_json();
	init_listing_cwd();
	init_session$3();
	antigravityListModels = async (installation, options = {}) => {
		if (installation.via !== "executable") return {
			kind: "unsupported",
			reason: "antigravity model listing requires the agy_acp_server executable"
		};
		try {
			const models = projectAntigravityModels(await readNewSession$1(installation.command, listingCwd(options), options.timeoutMs ?? 3e4));
			if (models === void 0) return {
				kind: "unsupported",
				reason: "this agy_acp_server build returns no model config option on session/new"
			};
			return {
				kind: "ok",
				models
			};
		} catch (error) {
			if (error instanceof RequestError && (error.code === -32e3 || /auth(?:entication)?|log(?:ged)? ?in/iu.test(error.message))) return {
				kind: "unauthenticated",
				detail: error.message
			};
			throw new Error("Failed to list Antigravity models", { cause: error });
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/antigravity/index.js
init_options$3();
const antigravityRuntime = defineRuntime({
	id: "antigravity",
	brand: runtimeBrands.antigravity,
	installation: antigravityInstallation,
	installPlan: antigravityInstallPlan,
	install: antigravityInstall,
	session: onFirstCall(async () => {
		const { antigravitySession } = await Promise.resolve().then(() => (init_session$3(), session_exports$3));
		return antigravitySession;
	}),
	listModels: onFirstCall(async () => {
		const { antigravityListModels } = await Promise.resolve().then(() => (init_list_models$2(), list_models_exports$2));
		return antigravityListModels;
	}),
	checkUpdate: antigravityCheckUpdate,
	refusedSessionOptions: antigravityRefusedSessionOptions,
	mcpToolsListChanged: "full"
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/inventory.js
init_json();
function workspaceScope(options = {}) {
	return {
		kind: "workspace",
		cwd: resolve(options.cwd ?? process.cwd())
	};
}
function inventoryOk(scope, view, items, partial = false) {
	return {
		kind: "ok",
		scope,
		observedAt: (/* @__PURE__ */ new Date()).toISOString(),
		view,
		items,
		partial
	};
}
function unsupportedInventory(code, reason) {
	return {
		kind: "unsupported",
		code,
		reason
	};
}
function unavailableInventory(code, reason) {
	return {
		kind: "unavailable",
		code,
		reason
	};
}
function nativeRows(value) {
	if (!Array.isArray(value)) throw new TypeError("Native inventory response has no list");
	return value.map((item) => {
		const row = asRecord(item);
		if (row === null) throw new TypeError("Native inventory entry is not an object");
		return row;
	});
}
function named(row) {
	if (typeof row.name !== "string") throw new TypeError("Native inventory entry has no name");
	return row.name;
}
function textField(key, value) {
	return typeof value === "string" ? { [key]: value } : {};
}
function boolField(key, value) {
	return typeof value === "boolean" ? { [key]: value } : {};
}
/** Bound a read with a deadline; subprocess callers dispose their owned process in finally. */
async function inventoryRead(read, timeoutMs = 15e3) {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be positive and finite");
	let timer = void 0;
	const deadline = new Promise((resolve) => {
		timer = setTimeout(() => {
			resolve(unavailableInventory("timeout", "Native inventory query timed out"));
		}, timeoutMs);
	});
	try {
		return await Promise.race([read(), deadline]);
	} catch {
		return unavailableInventory("query_failed", "Native inventory query failed");
	} finally {
		clearTimeout(timer);
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/environment.js
/**
* Variables a running Claude Code session sets for its own child processes
* (its Bash tool, hooks): markers of that parent session, not configuration.
* A host started from inside Claude Code inherits them, and a claude it
* launches then believes it is part of that session
* (`CLAUDE_CODE_CHILD_SESSION`: skill proposals off, org memory refused, no
* prompt history), runs under its entrypoint, or receives the parent's
* messaging credential. The list is the one claude itself drops when it
* launches an independent claude (its daemon launcher, 2.1.292), plus the
* messaging socket and token. `TRACEPARENT` (trace context) and an
* `AI_AGENT` set by another tool are configuration and pass through (#309).
*/
const CLAUDE_PARENT_SESSION_MARKERS = [
	"CLAUDECODE",
	"CLAUDE_CODE_SESSION_ID",
	"CLAUDE_CODE_CHILD_SESSION",
	"CLAUDE_CODE_SESSION_ATTENDED",
	"CLAUDE_CODE_CHROME_MCP_ORG_DENIED",
	"CLAUDE_CODE_EVAL_INTERVIEW_SESSION",
	"CLAUDE_CODE_BRIDGE_SESSION_ID",
	"CLAUDE_CODE_HOST_WORKTREE",
	"CLAUDE_CODE_HOST_WORKTREE_FENCE",
	"CLAUDE_CODE_ENTRYPOINT",
	"CLAUDE_CODE_MESSAGING_SOCKET",
	"CLAUDE_CODE_MESSAGING_TOKEN"
];
const removed = Object.fromEntries(CLAUDE_PARENT_SESSION_MARKERS.map((name) => [name, null]));
/**
* A session's environment changes: every inherited parent-session marker
* removed, then the host's own `SessionOptions.env`, which can set any of them
* again except `CLAUDECODE` (claude refuses to start nested under it).
*/
function claudeSessionEnv(env) {
	return {
		...removed,
		...env,
		CLAUDECODE: null
	};
}
/** The environment for the claude subcommands OAR runs (auth, usage, model list, inventory): the host's, without parent-session markers. */
function claudeEnv() {
	const env = { ...process.env };
	for (const name of CLAUDE_PARENT_SESSION_MARKERS) env[name] = void 0;
	return env;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/inventory.js
init_executable();
init_json();
function projectClaudeSkills(payload) {
	return nativeRows(asRecord(payload.skills)?.skillFrontmatter).map((skill) => ({
		name: named(skill),
		...textField("source", skill.source)
	}));
}
function projectClaudeCommands(payload) {
	return nativeRows(payload.commands).map((command) => {
		const aliases = command.aliases;
		if (aliases !== void 0 && (!Array.isArray(aliases) || !aliases.every((alias) => typeof alias === "string"))) throw new TypeError("Native command aliases are not strings");
		return {
			name: named(command),
			...textField("description", command.description),
			...command.argumentHint === "" ? {} : textField("argumentHint", command.argumentHint),
			...command.builtin === true ? { source: "builtin" } : {},
			...aliases === void 0 ? {} : { aliases }
		};
	});
}
function projectClaudeServers(servers) {
	return servers.map((server) => ({
		id: named(server),
		name: named(server),
		...textField("status", server.status),
		...textField("source", server.scope),
		...Array.isArray(server.tools) ? { toolCount: server.tools.length } : {},
		...server.error === null || server.error === void 0 ? {} : { error: "Native MCP connection failed" }
	}));
}
function projectClaudeTools(servers) {
	return servers.flatMap((server) => server.tools === void 0 ? [] : nativeRows(server.tools).map((tool) => ({
		name: named(tool),
		mcpServerId: named(server),
		source: "mcp",
		...textField("description", tool.description)
	})));
}
var UnsupportedControlError = class extends Error {
	name = "UnsupportedControlError";
};
function reader$3(read) {
	return async (installation, options = {}) => {
		if (installation.via !== "executable") return unsupportedInventory("installation_unsupported", "Claude inventory requires an executable");
		const scope = workspaceScope(options);
		const child = spawnLineProcess(installation.command, [
			"-p",
			"--input-format",
			"stream-json",
			"--output-format",
			"stream-json",
			"--verbose",
			"--no-session-persistence"
		], {
			cwd: scope.cwd,
			env: claudeEnv(),
			killTree: true
		});
		let pending = null;
		let closed = false;
		child.onLine((line) => {
			const message = asRecord(parseJson(line));
			const response = asRecord(message?.response);
			if (message?.type === "control_response" && response !== null && response.request_id === pending?.id && pending !== null) {
				const waiter = pending;
				pending = null;
				if (response.subtype === "success") waiter.resolve(asRecord(response.response) ?? {});
				else if (typeof response.error === "string" && /unsupported|not supported|unknown control/iu.test(response.error)) waiter.reject(new UnsupportedControlError());
				else waiter.reject(/* @__PURE__ */ new Error("Native control query failed"));
			}
		});
		child.onExit(() => {
			closed = true;
			pending?.reject(/* @__PURE__ */ new Error("Native process exited"));
			pending = null;
		});
		const request = async (method, params) => {
			if (closed) throw new Error("Native process exited");
			const id = randomUUID();
			const { promise, resolve, reject } = Promise.withResolvers();
			pending = {
				id,
				resolve,
				reject
			};
			child.write(`${JSON.stringify({
				type: "control_request",
				request_id: id,
				request: {
					subtype: method,
					...params
				}
			})}\n`);
			return await promise;
		};
		try {
			return await inventoryRead(async () => {
				try {
					await child.spawned;
					return await read(request, scope, await request("initialize", {}));
				} catch (error) {
					if (error instanceof UnsupportedControlError) return unsupportedInventory("native_query_unavailable", "This Claude build does not expose the inventory query");
					throw error;
				}
			}, options.timeoutMs);
		} finally {
			child.kill();
			await child.exited;
		}
	};
}
async function readServers(request) {
	let payload = await request("mcp_status", {});
	let servers = nativeRows(payload.mcpServers);
	for (let attempt = 0; attempt < 10 && servers.some((server) => server.status === "pending"); attempt += 1) {
		await setTimeout$1(200);
		payload = await request("mcp_status", {});
		servers = nativeRows(payload.mcpServers);
	}
	return servers;
}
function partial(servers) {
	return servers.some((server) => server.status === "pending" || server.status === "failed");
}
const claudeSkills = reader$3(async (request, scope) => {
	return inventoryOk(scope, "context", projectClaudeSkills(await request("get_context_usage", { detail: "summary" })));
});
const claudeCommands = reader$3((_request, scope, initialized) => inventoryOk(scope, "discovered", projectClaudeCommands(initialized)));
const claudeMcpServers = reader$3(async (request, scope) => {
	const servers = await readServers(request);
	return inventoryOk(scope, "discovered", projectClaudeServers(servers), partial(servers));
});
const claudeTools = reader$3(async (request, scope) => {
	const servers = await readServers(request);
	return inventoryOk(scope, "mcp-only", projectClaudeTools(servers), partial(servers));
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/login.js
init_executable();
const ESC = String.fromCodePoint(27);
const BEL = String.fromCodePoint(7);
const TERMINAL_ESCAPES = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}[ -/]*[0-~]`, "gu");
/** Terminal escapes removed: colors, cursor movement, and OSC 8 hyperlinks (their visible text stays). */
function stripTerminalEscapes(text) {
	return text.replace(TERMINAL_ESCAPES, "");
}
const TOKEN_SHAPES = [/\bsk-[\w-]{16,}/gu, /\beyJ[\w-]+\.[\w-]+\.[\w-]+/gu];
const SECRET_MIN_LENGTH = 6;
const DETAIL_LIMIT = 500;
/**
* Values that must never leave a login: the codes a person pasted, and any
* token-shaped text. Everything oar reports from runtime output goes through
* `redact`.
*/
var LoginSecrets = class {
	#values = /* @__PURE__ */ new Set();
	/** Values too short to be secret on their own (a separator, a single word) are ignored. */
	add(value) {
		if (value.length >= SECRET_MIN_LENGTH) this.#values.add(value);
	}
	redact(text) {
		let redacted = text;
		for (const value of [...this.#values].toSorted((left, right) => right.length - left.length)) redacted = redacted.replaceAll(value, "[redacted]");
		for (const shape of TOKEN_SHAPES) redacted = redacted.replace(shape, "[redacted]");
		return redacted.length > DETAIL_LIMIT ? `${redacted.slice(0, DETAIL_LIMIT)}...` : redacted;
	}
	/** The first non-blank line of `text`, redacted: a runtime's one-line reason, never a log tail. */
	line(text) {
		return this.redact(text.split(/\r?\n/u).map((line) => line.trim()).find((line) => line !== "") ?? "");
	}
};
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/** After the command exits, how long something it started may keep the output pipes. */
const PIPE_DRAIN_MS = 2e3;
function readStream(stream, name, handlers) {
	if (stream === null) return;
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	stream.on("data", (chunk) => {
		buffer += decoder.write(chunk);
		const lines = buffer.split(/\r\n|\n|\r/u);
		buffer = (lines.pop() ?? "").slice(-65536);
		for (const raw of lines) {
			const line = stripTerminalEscapes(raw).trim();
			if (line !== "") handlers.onLine(line, name);
		}
		if (buffer !== "") handlers.onPartial?.(stripTerminalEscapes(buffer), name);
	});
	stream.on("end", () => {
		const line = stripTerminalEscapes(buffer + decoder.end()).trim();
		buffer = "";
		if (line !== "") handlers.onLine(line, name);
	});
}
function stopTree(child) {
	if (process.platform === "win32") {
		killProcessTree(child);
		return;
	}
	signalProcessGroup(child, "SIGTERM");
	setTimeout(() => {
		signalProcessGroup(child, "SIGKILL");
	}, killGraceMs()).unref();
}
/**
* Run a login command over pipes (no terminal), in its own process group on
* POSIX, reading stdout and stderr alike. Nothing it prints is logged or
* forwarded except through `handlers`. Throws when the command cannot be
* spawned at all (an invalid path on Windows).
*/
function spawnLoginProcess(command, args, env, handlers) {
	const child = spawn(command, [...args], {
		env,
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		],
		detached: OWN_PROCESS_GROUP,
		windowsHide: true
	});
	trackOwnedProcess(child);
	let running = true;
	let stopped = false;
	child.stdin?.on("error", () => {});
	readStream(child.stdout, "stdout", handlers);
	readStream(child.stderr, "stderr", handlers);
	return {
		exited: new Promise((resolve) => {
			child.once("error", (error) => {
				running = false;
				resolve({
					exitCode: null,
					signal: null,
					error: error.message
				});
			});
			child.once("exit", (exitCode, signal) => {
				running = false;
				setTimeout(() => {
					resolve({
						exitCode,
						signal
					});
				}, PIPE_DRAIN_MS).unref();
			});
			child.once("close", (exitCode, signal) => {
				running = false;
				resolve({
					exitCode,
					signal
				});
			});
		}),
		write(text) {
			if (running && child.stdin?.writable === true) child.stdin.write(text);
		},
		closeInput() {
			child.stdin?.end();
		},
		stop() {
			if (stopped) return;
			stopped = true;
			child.stdin?.end();
			if (running) stopTree(child);
		}
	};
}
/** The deadline and the caller's abort signal as one promise. */
function loginBounds(signal, timeoutMs) {
	const { promise, resolve } = Promise.withResolvers();
	const timer = setTimeout(() => {
		resolve("timed_out");
	}, timeoutMs);
	timer.unref();
	const onAbort = () => {
		resolve("cancelled");
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	if (signal?.aborted === true) resolve("cancelled");
	return {
		stopped: promise,
		dispose() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
	};
}
/** The result for a bounds stop: a timeout is a failure, an abort a cancellation. */
function stoppedResult(stop, timeoutMs) {
	return stop === "cancelled" ? { kind: "cancelled" } : {
		kind: "failed",
		reason: "timed_out",
		detail: `no sign-in within ${String(timeoutMs)} ms`
	};
}
/**
* The executable to sign in (or out), or the result that ends the login
* before anything runs: a bundled runtime or a version known to predate `floor` is
* unsupported, and an executable that is no longer there (found as the
* installation probe finds it, without spawning) fails alike on every
* platform, since a missing command started through a Windows shell would
* only exit. An unreadable version is tried, not refused: the login command
* itself then answers.
*/
function loginExecutable(installation, name, floor) {
	if (installation.via !== "executable") return {
		kind: "settled",
		result: {
			kind: "unsupported",
			reason: "unsupported_installation",
			detail: "not a machine-installed executable"
		}
	};
	const version = installation.version === void 0 ? void 0 : releaseVersion(installation.version);
	if (floor !== void 0 && version !== void 0 && !versionAtLeast(version, floor)) return {
		kind: "settled",
		result: {
			kind: "unsupported",
			reason: "version_unsupported",
			detail: `${name} ${floor} or later is required; this is ${version}`
		}
	};
	if (locateExecutable(installation.command) === null) return {
		kind: "settled",
		result: {
			kind: "failed",
			reason: "process_failed",
			detail: `${name} executable not found: ${installation.command}`
		}
	};
	return {
		kind: "executable",
		installation
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/auth-status.js
init_executable();
init_json();
const STATUS_TIMEOUT_MS$1 = 2e4;
const STATUS_SOURCE$1 = "claude auth status --json";
function text$12(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
/** `claude auth status --json`: `{ loggedIn, authMethod, email?, subscriptionType?, ... }`, exit 0 logged in, 1 logged out. */
function projectClaudeAuthStatus(stdout) {
	const status = asRecord(parseJson(stdout));
	if (status === null || typeof status.loggedIn !== "boolean") return {
		kind: "unknown",
		detail: "claude auth status gave no loggedIn field",
		source: STATUS_SOURCE$1
	};
	if (!status.loggedIn) return {
		kind: "logged_out",
		source: STATUS_SOURCE$1
	};
	const email = text$12(status.email);
	const plan = text$12(status.subscriptionType);
	const method = text$12(status.authMethod);
	const account = {
		...email === void 0 ? {} : { email },
		...plan === void 0 ? {} : { plan },
		...method === void 0 ? {} : { method }
	};
	return {
		kind: "logged_in",
		...Object.keys(account).length === 0 ? {} : { account },
		source: STATUS_SOURCE$1
	};
}
/** `signal` (internal: the login's own) stops the query; the answer is then `unknown`. */
async function readClaudeAuthStatus(installation, options = {}) {
	if (installation.via !== "executable") return { status: {
		kind: "unknown",
		detail: "not a machine-installed executable"
	} };
	const result = await runExecutable(installation.command, [
		"auth",
		"status",
		"--json"
	], {
		env: claudeEnv(),
		timeoutMs: options.timeoutMs ?? STATUS_TIMEOUT_MS$1,
		...options.signal === void 0 ? {} : { signal: options.signal }
	});
	if (!result.ok && result.exitCode !== 1) return { status: {
		kind: "unknown",
		detail: `claude auth status ended without an answer (exit ${String(result.exitCode)})`,
		source: STATUS_SOURCE$1
	} };
	const status = projectClaudeAuthStatus(result.stdout);
	const apiKeySource = status.kind === "logged_in" ? text$12(asRecord(parseJson(result.stdout))?.apiKeySource) : void 0;
	return {
		status,
		...apiKeySource === void 0 ? {} : { apiKeySource }
	};
}
async function claudeAuthStatus(installation, options = {}) {
	const { status } = await readClaudeAuthStatus(installation, options);
	return status;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/login.js
const PASTE_FLOOR = "2.1.126";
const LOGIN_TIMEOUT_MS$1 = 15 * 6e4;
const URL_LINE = /If the browser didn't open, visit:\s*(\S+)/u;
const PASTE_PROMPT = /Paste code here if prompted\s*>/u;
/** At the start of a stderr line only: `Login failed: Invalid code verifier` is a failure, not a retry. */
const INVALID_CODE = /^Invalid code\b/u;
const SUCCESS = /Login successful\b/u;
const FAILURE$1 = /Login failed:\s*(.*)$/u;
/**
* The status decides once claude has exited 0 or reported success. A query
* that cannot answer (it failed, or the caller aborted) leaves claude's own
* report: a success it printed is `logged_in`, an exit 0 without one is not.
*/
async function confirmed$1(installation, signal, reportedSuccess) {
	const status = signal?.aborted === true ? void 0 : await claudeAuthStatus(installation, signal === void 0 ? {} : { signal });
	if (status?.kind === "logged_in") return {
		kind: "logged_in",
		...status.account === void 0 ? {} : { account: status.account }
	};
	if (status?.kind === "logged_out") return {
		kind: "failed",
		reason: "not_logged_in",
		detail: "claude auth login reported success, yet claude auth status says logged out"
	};
	return reportedSuccess ? { kind: "logged_in" } : {
		kind: "failed",
		reason: "process_failed",
		detail: "claude auth login exited 0 without reporting success"
	};
}
/** A failed exit, in claude's words where it gave any. */
function failedExit(exit, flow, secrets) {
	if (exit.error !== void 0) return {
		kind: "failed",
		reason: "process_failed",
		detail: secrets.line(exit.error)
	};
	if (flow.failure !== void 0) return {
		kind: "failed",
		reason: "rejected",
		detail: secrets.line(flow.failure)
	};
	if (exit.exitCode === 1 && flow.lastStderr !== void 0) return {
		kind: "failed",
		reason: "rejected",
		detail: secrets.line(flow.lastStderr)
	};
	const ended = exit.exitCode === null ? `signal ${exit.signal ?? "unknown"}` : `code ${String(exit.exitCode)}`;
	return {
		kind: "failed",
		reason: "process_failed",
		detail: flow.lastStderr === void 0 ? `claude auth login exited with ${ended}` : secrets.line(flow.lastStderr)
	};
}
async function runClaudeLogin(installation, command, interaction, timeoutMs) {
	const secrets = new LoginSecrets();
	const interactionFailure = Promise.withResolvers();
	const flow = {
		urlSent: false,
		pasteOffered: false,
		promptOpen: false,
		settled: false,
		reportedSuccess: false,
		failure: void 0,
		lastStderr: void 0
	};
	let child = null;
	const ended = () => flow.settled;
	/** The caller failed: settled at once, so no answer still in flight reaches claude. */
	const interactionFailed = (error) => {
		flow.settled = true;
		interactionFailure.resolve({
			kind: "interaction_failed",
			message: errorMessage(error)
		});
	};
	const ask = async (message) => {
		if (flow.promptOpen || flow.settled) return;
		flow.promptOpen = true;
		let answer = "";
		try {
			answer = await interaction.prompt({
				kind: "manual_code",
				message,
				placeholder: "code#state"
			});
		} catch (error) {
			if (interaction.signal?.aborted !== true) interactionFailed(error);
			return;
		} finally {
			flow.promptOpen = false;
		}
		const code = answer.replaceAll(/\s+/gu, "");
		if (ended()) return;
		if (code === "") {
			await ask("No code was entered. Paste the code shown after signing in");
			return;
		}
		secrets.add(code);
		secrets.add(code.split("#")[0] ?? code);
		child?.write(`${code}\n`);
	};
	const offerPaste = () => {
		if (!flow.pasteOffered) {
			flow.pasteOffered = true;
			ask("Paste the code shown after signing in");
		}
	};
	try {
		child = spawnLoginProcess(command, ["auth", "login"], claudeEnv(), {
			onLine(line, stream) {
				const url = URL_LINE.exec(line)?.[1];
				if (url !== void 0 && !flow.urlSent) {
					flow.urlSent = true;
					try {
						interaction.onEvent({
							kind: "auth_url",
							url,
							instructions: "Open this URL and sign in; if the page then shows a code, paste it back."
						});
					} catch (error) {
						interactionFailed(error);
					}
				}
				if (PASTE_PROMPT.test(line)) offerPaste();
				if (stream === "stderr") {
					flow.lastStderr = line;
					if (INVALID_CODE.test(line)) ask("That code was not accepted. Paste the full code shown after signing in");
				}
				if (SUCCESS.test(line)) flow.reportedSuccess = true;
				const failed = FAILURE$1.exec(line)?.[1];
				if (failed !== void 0) flow.failure = failed;
			},
			onPartial(partial) {
				if (PASTE_PROMPT.test(partial)) offerPaste();
			}
		});
	} catch (error) {
		return {
			kind: "failed",
			reason: "process_failed",
			detail: secrets.line(errorMessage(error))
		};
	}
	const bounds = loginBounds(interaction.signal, timeoutMs);
	try {
		const ending = await Promise.race([
			child.exited.then((exit) => ({
				kind: "exit",
				exit
			})),
			bounds.stopped.then((stop) => ({
				kind: "stop",
				stop
			})),
			interactionFailure.promise
		]);
		flow.settled = true;
		if (ending.kind !== "exit") {
			child.stop();
			await child.exited;
		}
		if (flow.reportedSuccess) return await confirmed$1(installation, interaction.signal, true);
		switch (ending.kind) {
			case "stop": return stoppedResult(ending.stop, timeoutMs);
			case "interaction_failed": return {
				kind: "failed",
				reason: "interaction_failed",
				detail: secrets.line(ending.message)
			};
			case "exit": break;
		}
		return ending.exit.exitCode === 0 && ending.exit.error === void 0 ? await confirmed$1(installation, interaction.signal, false) : failedExit(ending.exit, flow, secrets);
	} finally {
		flow.settled = true;
		bounds.dispose();
	}
}
/** Signs claude in with `claude auth login`, relaying its URL and writing the pasted code to its stdin. */
async function claudeLogin(installation, interaction, options = {}) {
	const target = loginExecutable(installation, "claude", PASTE_FLOOR);
	if (target.kind === "settled") return target.result;
	if (interaction.signal?.aborted === true) return { kind: "cancelled" };
	return await runClaudeLogin(installation, target.installation.command, interaction, options.timeoutMs ?? LOGIN_TIMEOUT_MS$1);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/logout.js
const KEPT_LINES = 20;
function ended$1(exit, stderr) {
	return exit.error === void 0 ? {
		kind: "exit",
		exitCode: exit.exitCode,
		signal: exit.signal,
		stderr
	} : {
		kind: "not_started",
		detail: new LoginSecrets().line(exit.error)
	};
}
/** The started command, or why it could not start (an invalid path on Windows throws). */
function spawned(command, args, env, onStderr) {
	try {
		return spawnLoginProcess(command, args, env, { onLine(line, stream) {
			if (stream === "stderr") onStderr(line);
		} });
	} catch (error) {
		return {
			kind: "not_started",
			detail: new LoginSecrets().line(errorMessage(error))
		};
	}
}
/**
* Runs a logout command over pipes with its stdin closed, in its own process
* group on POSIX; nothing it prints is logged or forwarded. Past `timeoutMs`
* it is stopped with everything it started (its group, its tree on Windows).
*/
async function runLogoutCommand(command, args, env, timeoutMs) {
	const stderr = [];
	const child = spawned(command, args, env, (line) => {
		stderr.push(line);
		stderr.splice(0, stderr.length - KEPT_LINES);
	});
	if (!("exited" in child)) return child;
	child.closeInput();
	const bounds = loginBounds(void 0, timeoutMs);
	try {
		const ending = await Promise.race([child.exited, bounds.stopped.then(() => "timed_out")]);
		if (ending !== "timed_out") return ended$1(ending, stderr);
		child.stop();
		await child.exited;
		return { kind: "timed_out" };
	} finally {
		bounds.dispose();
	}
}
/** A logout that did not finish within the deadline. */
function logoutTimedOut(command, timeoutMs) {
	return {
		kind: "failed",
		reason: "timed_out",
		detail: `${command} did not finish within ${String(timeoutMs)} ms`
	};
}
/**
* A logout command's end: exit 0 is the runtime's success. Exit 1 with a
* stderr line is its reported failure, in its words (the capture of
* `failure` when a line matches it, else its last stderr line); any other
* end is `process_failed`.
*/
function commandLogout(end, command, timeoutMs, failure) {
	if (end.kind === "timed_out") return logoutTimedOut(command, timeoutMs);
	if (end.exitCode === 0) return { kind: "done" };
	const secrets = new LoginSecrets();
	const { stderr } = end;
	const words = (failure === void 0 ? void 0 : stderr.map((line) => failure.exec(line)?.[1]).findLast((message) => message !== void 0)) ?? stderr.at(-1);
	if (end.exitCode === 1 && words !== void 0) return {
		kind: "failed",
		reason: "rejected",
		detail: secrets.line(words)
	};
	const how = end.exitCode === null ? `signal ${end.signal ?? "unknown"}` : `code ${String(end.exitCode)}`;
	return {
		kind: "failed",
		reason: "process_failed",
		detail: words === void 0 ? `${command} exited with ${how}` : secrets.line(words)
	};
}
/** What a logged-in status names: the method and the email, then `notes` (claude's API key source). */
function readsAs(status, notes) {
	const words = [
		status.account?.method,
		status.account?.email,
		...notes
	].filter((word) => word !== void 0);
	return words.length === 0 ? "" : ` (${words.join(", ")})`;
}
/**
* The status read after the runtime's logout ran decides: logged out is
* `logged_out`, whatever the logout answered. Otherwise a failed logout is
* its own failure, and one that succeeded is `still_logged_in` when the
* status reads logged in (credentials from the environment or another
* source), never `logged_out`. When the status cannot tell (it failed or
* gave an answer oar cannot read), a logout that succeeded is `logged_out`
* on the runtime's own report, as a login's success is `logged_in`.
*/
function confirmedLogout(native, status, command, notes = []) {
	if (status.kind === "logged_out") return { kind: "logged_out" };
	if (native.kind === "failed") return {
		kind: "failed",
		reason: native.reason,
		detail: native.detail
	};
	if (status.kind === "unknown") return { kind: "logged_out" };
	return {
		kind: "failed",
		reason: "still_logged_in",
		detail: new LoginSecrets().redact(`${command} succeeded, yet ${status.source} still reads logged in${readsAs(status, notes)}`)
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/logout.js
const LOGOUT_FLOOR$1 = "2.1.41";
const LOGOUT_COMMAND$1 = "claude auth logout";
/** The revoke has 5 s; telemetry is flushed before and after. */
const LOGOUT_TIMEOUT_MS$1 = 6e4;
const FAILURE = /^Logout failed:\s*(.*)$/u;
/** Signs claude out with `claude auth logout`; `claude auth status --json` decides. */
async function claudeLogout(installation, options = {}) {
	const target = loginExecutable(installation, "claude", LOGOUT_FLOOR$1);
	if (target.kind === "settled") return target.result;
	const timeoutMs = options.timeoutMs ?? LOGOUT_TIMEOUT_MS$1;
	const end = await runLogoutCommand(target.installation.command, ["auth", "logout"], claudeEnv(), timeoutMs);
	if (end.kind === "not_started") return {
		kind: "failed",
		reason: "process_failed",
		detail: end.detail
	};
	const native = commandLogout(end, LOGOUT_COMMAND$1, timeoutMs, FAILURE);
	const read = await readClaudeAuthStatus(installation);
	return confirmedLogout(native, read.status, LOGOUT_COMMAND$1, read.apiKeySource === void 0 ? [] : [`from ${read.apiKeySource}`]);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/deadline.js
/**
* What is left of a budget that ends at `deadline` (epoch milliseconds). None
* left is a timeout, which rejects: `${name} timed out`.
*/
function remainingMs(deadline, name) {
	const remaining = deadline - Date.now();
	if (remaining <= 0) throw new Error(`${name} timed out`);
	return remaining;
}
var init_deadline = __esmMin((() => {}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/account-usage.js
init_executable();
init_diagnostics();
init_deadline();
init_instant();
init_json();
const HOUR_MS = 36e5;
const WEEK_MS = 168 * HOUR_MS;
function windowOf$1(label, value, key) {
	const entry = asRecord(value);
	const percent = asNumber(entry?.utilization);
	if (percent === null || percent < 0) return null;
	const reset = typeof entry?.resets_at === "string" ? utcInstantFromDate(new Date(entry.resets_at)) : null;
	return {
		label,
		usedRatio: Math.min(1, Number((percent / 100).toFixed(6))),
		...reset === null ? {} : { resetsAt: reset },
		...key === void 0 ? {} : { id: key.id },
		...key?.durationMs === void 0 ? {} : { durationMs: key.durationMs }
	};
}
/** Native get_usage reply, not the HTTP endpoint's unrelated limits[] shape. */
function projectClaudeUsage(payload, email) {
	const root = asRecord(payload);
	if (root?.rate_limits_available === false) return {
		kind: "unsupported",
		reason: "quota_unavailable"
	};
	if (root?.rate_limits_available !== true) throw new Error("Claude get_usage returned an invalid availability flag");
	const limits = asRecord(root.rate_limits);
	if (limits === null) throw new Error("Claude get_usage did not return account rate limits");
	const windows = [];
	const add = (label, value, key) => {
		const window = windowOf$1(label, value, key);
		if (window !== null) windows.push(window);
	};
	add("Current session", limits.five_hour, {
		id: "five_hour",
		durationMs: 5 * HOUR_MS
	});
	add("Current week (all models)", limits.seven_day, {
		id: "seven_day",
		durationMs: WEEK_MS
	});
	add("Current week (OAuth apps)", limits.seven_day_oauth_apps, {
		id: "seven_day_oauth_apps",
		durationMs: WEEK_MS
	});
	if (Array.isArray(limits.model_scoped)) {
		for (const entry of asRecordList(limits.model_scoped)) if (typeof entry.display_name === "string" && entry.display_name.trim().length > 0) add(`Current week (${entry.display_name})`, entry, {
			id: `model_scoped:${entry.display_name}`,
			durationMs: WEEK_MS
		});
	} else {
		add("Current week (Opus)", limits.seven_day_opus, {
			id: "seven_day_opus",
			durationMs: WEEK_MS
		});
		add("Current week (Sonnet)", limits.seven_day_sonnet, {
			id: "seven_day_sonnet",
			durationMs: WEEK_MS
		});
	}
	const includedExhausted = windows.some((window) => window.usedRatio >= 1);
	const extra = asRecord(limits.extra_usage);
	const extraWindow = extra?.is_enabled === true ? windowOf$1("Extra usage", extra, { id: "extra_usage" }) : null;
	if (extraWindow !== null) windows.push(extraWindow);
	if (windows.length === 0) throw new Error("Claude get_usage returned no usable windows");
	const plan = typeof root.subscription_type === "string" ? root.subscription_type.trim() : "";
	return {
		kind: "available",
		...plan.length === 0 ? {} : { plan },
		...email === void 0 ? {} : { email },
		rateLimited: includedExhausted && !(extraWindow !== null && extraWindow.usedRatio < 1),
		windows
	};
}
function controlFailure(reply) {
	const detail = typeof reply.error === "string" ? reply.error : "Malformed control response";
	if (/unsupported control request subtype|unknown control request|not supported in this context|not available on this connection/iu.test(detail)) return {
		kind: "unsupported",
		reason: "endpoint_unavailable"
	};
	if (/not logged in|authentication required|please (?:run )?\/login/iu.test(detail)) return {
		kind: "reauth_required",
		reason: "not_authenticated"
	};
	throw new Error(`Claude usage control request failed: ${detail}`);
}
/**
* A usage read must not run the user's hooks or start their MCP servers, so the
* query process runs with --safe-mode. A CLI that lacks the flag is reported as
* unsupported rather than launched without isolation. A help probe that timed
* out or never ran is an operational failure and rejects, like the query's own
* timeout. Only a successful help probe is cached, so a failed one is retried
* on the next read.
*/
const USAGE$1 = "Claude account usage";
const safeModeSupport = /* @__PURE__ */ new Map();
async function supportsSafeMode(command, version, deadline) {
	const key = `${command}\0${version ?? ""}`;
	const known = safeModeSupport.get(key);
	if (known !== void 0) return known;
	const help = await runExecutable(command, ["--help"], {
		env: claudeEnv(),
		timeoutMs: remainingMs(deadline, USAGE$1)
	});
	assertRan(help, `Failed to run ${command} --help`);
	if (!help.ok) return false;
	const supported = /(?:^|\s)--safe-mode\b/u.test(help.stdout);
	safeModeSupport.set(key, supported);
	return supported;
}
/**
* Only native control queries; no prompt, credential reads or direct HTTP.
* Fresh-process session totals are deliberately not exposed as account usage.
* initialize provides optional account identity; get_usage owns quota access.
*/
const claudeAccountUsage = async (installation, options = {}) => {
	if (installation.via !== "executable") return {
		kind: "unsupported",
		reason: "unsupported_installation"
	};
	const deadline = Date.now() + (options.timeoutMs ?? 3e4);
	if (!await supportsSafeMode(installation.command, installation.version, deadline)) return {
		kind: "unsupported",
		reason: "unsupported_installation"
	};
	const queryMs = remainingMs(deadline, USAGE$1);
	const child = spawnLineProcess(installation.command, [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--no-session-persistence",
		"--safe-mode"
	], {
		env: claudeEnv(),
		killTree: true
	});
	let pending = null;
	let ended = false;
	let timedOut = false;
	child.onLine((line) => {
		const message = asRecord(parseJson(line));
		const inner = asRecord(message?.response);
		if (message?.type === "control_response" && pending !== null && inner?.request_id === pending.id) pending.resolve(inner);
	});
	child.onExit(() => {
		ended = true;
		pending?.resolve(null);
	});
	child.stdin.on("error", () => {
		ended = true;
		pending?.resolve(null);
	});
	const timer = setTimeout(() => {
		timedOut = true;
		pending?.resolve(null);
		child.kill();
	}, queryMs);
	const query = async (request) => {
		if (ended || timedOut) throw new Error("Claude exited or timed out before answering usage queries");
		const id = `oar-usage-${randomUUID()}`;
		const { promise, resolve } = Promise.withResolvers();
		pending = {
			id,
			resolve
		};
		child.write(`${JSON.stringify({
			type: "control_request",
			request_id: id,
			request
		})}\n`);
		const reply = await promise;
		pending = null;
		if (reply === null) throw new Error("Claude exited or timed out before answering usage query");
		return reply;
	};
	try {
		await child.spawned;
		const initialized = await query({ subtype: "initialize" });
		if (initialized.subtype !== "success") return controlFailure(initialized);
		const account = asRecord(asRecord(initialized.response)?.account);
		const email = typeof account?.email === "string" && account.email.trim().length > 0 ? account.email.trim() : void 0;
		const reply = await query({
			subtype: "get_usage",
			skip_behaviors: true
		});
		if (reply.subtype !== "success") return controlFailure(reply);
		return projectClaudeUsage(reply.response, email);
	} finally {
		clearTimeout(timer);
		child.kill();
		await child.exited;
	}
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/installation.js
/**
* Where the native installer puts the launcher (`~/.local/bin/claude`, a link
* into `~/.local/share/claude/versions/<version>`; `%USERPROFILE%\.local\bin\claude.exe`
* on Windows), which a GUI or service process's PATH can miss: the installer
* only prints a note when that folder is not on PATH
* (https://code.claude.com/docs/en/troubleshoot-install). npm, Homebrew and
* WinGet copies are on PATH.
*/
function claudeInstalledExecutableCandidates(platform = process.platform, home = homedir()) {
	return [(platform === "win32" ? path.win32 : path.posix).join(home, ".local", "bin", platform === "win32" ? "claude.exe" : "claude")];
}
const claudeInstallation = executableInstallation("OAR_CLAUDE_BIN", "claude", claudeInstalledExecutableCandidates);
const claudeInstallPlan = scriptInstallPlan({
	source: "https://code.claude.com/docs/en/setup",
	line: "curl -fsSL https://claude.ai/install.sh | bash",
	tools: ["curl", "bash"],
	writes: () => {
		const home = homedir();
		return [
			path.join(home, ".local", "bin"),
			path.join(home, ".local", "share", "claude"),
			path.join(home, ".claude")
		];
	},
	windows: "Anthropic documents, in PowerShell: irm https://claude.ai/install.ps1 | iex"
});
const claudeInstall = planInstaller(claudeInstallation, claudeInstallPlan);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/effort-levels.js
/**
* Reasoning-effort menu as plain level names. Runtimes disagree on the entry
* shape: codex ships `{effort, description}` objects, claude ships strings,
* grok's ACP extension may ship either. Returns `undefined` when the runtime
* exposes no menu at all, so callers can omit the field rather than emit `[]`.
*/
function effortLevelsOf(value) {
	if (!Array.isArray(value)) return;
	const entries = value;
	const levels = [];
	for (const entry of entries) {
		const level = typeof entry === "string" ? entry : effortName(asRecord(entry));
		if (level !== void 0) levels.push(level);
	}
	return levels;
}
function effortName(record) {
	const candidate = record?.effort ?? record?.id;
	return typeof candidate === "string" && candidate.length > 0 ? candidate : void 0;
}
/** A single effort name, or `undefined` when absent or not a non-empty string. */
function effortLevelOf(value) {
	if (typeof value === "string" && value.length > 0) return value;
	return effortName(asRecord(value));
}
var init_effort_levels = __esmMin((() => {
	init_json();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/list-models.js
init_effort_levels();
init_executable();
init_json();
init_listing_cwd();
function text$11(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Project the `list_models` control response. `value` is the selector the
* session accepts (an alias such as `sonnet` or a concrete ID); `resolvedModel`
* is what that alias means today. A `disabled` entry is still listed because
* claude shows it, with its description as the reason (typically a required
* CLI upgrade).
*/
function projectClaudeModels(payload) {
	const models = asRecordList(asRecord(payload)?.models);
	const entries = [];
	for (const model of models) {
		const id = text$11(model.value);
		if (id === void 0) continue;
		const resolvedId = text$11(model.resolvedModel);
		const displayName = text$11(model.displayName);
		const effortLevels = effortLevelsOf(model.supportedEffortLevels);
		const reason = text$11(model.description) ?? "disabled by claude";
		entries.push({
			id,
			...resolvedId === void 0 ? {} : { resolvedId },
			...displayName === void 0 ? {} : { displayName },
			...effortLevels === void 0 ? {} : { effortLevels },
			...model.supportsFastMode === true ? { serviceTiers: ["fast"] } : {},
			...model.disabled === true ? { disabled: { reason } } : {}
		});
	}
	return entries;
}
function controlError(inner) {
	return text$11(inner.error) ?? text$11(inner.message) ?? "claude rejected the list_models control request";
}
/**
* Claude answers `list_models` on the stream-json control channel before any
* turn runs, so this costs no tokens. `--verbose` is mandatory for stream-json
* output in print mode. Matching is by `request_id`; other control traffic
* (for example hooks or permission prompts) is ignored.
*/
async function readListModels(command, cwd, timeoutMs) {
	const child = spawnLineProcess(command, [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose"
	], {
		cwd,
		env: claudeEnv(),
		killTree: true
	});
	const requestId = `oar-list-models-${randomUUID()}`;
	const { promise: answered, resolve } = Promise.withResolvers();
	child.onLine((line) => {
		const message = asRecord(parseJson(line));
		if (message?.type !== "control_response") return;
		const inner = asRecord(message.response);
		if (inner?.request_id === requestId) resolve(inner);
	});
	child.onExit(() => {
		resolve(null);
	});
	const timer = setTimeout(() => {
		child.kill();
	}, timeoutMs);
	try {
		await child.spawned;
		child.write(`${JSON.stringify({
			type: "control_request",
			request_id: requestId,
			request: { subtype: "list_models" }
		})}\n`);
		const inner = await answered;
		if (inner === null) return {
			kind: "error",
			detail: "claude exited before answering list_models"
		};
		if (inner.subtype === "success") return {
			kind: "ok",
			payload: inner.response
		};
		const detail = controlError(inner);
		if (/log(?:ged)? ?in|auth|api key/iu.test(detail)) return {
			kind: "unauthenticated",
			detail
		};
		return {
			kind: "error",
			detail
		};
	} finally {
		clearTimeout(timer);
		child.kill();
		await child.exited;
	}
}
async function readOutcome(command, cwd, timeoutMs) {
	try {
		return await readListModels(command, cwd, timeoutMs);
	} catch (error) {
		throw new Error("Failed to list Claude models", { cause: error });
	}
}
const claudeListModels = async (installation, options = {}) => {
	if (installation.via !== "executable") return {
		kind: "unsupported",
		reason: "claude model listing requires the claude executable"
	};
	const outcome = await readOutcome(installation.command, listingCwd(options), options.timeoutMs ?? 15e3);
	if (outcome.kind === "ok") return {
		kind: "ok",
		models: projectClaudeModels(outcome.payload)
	};
	if (outcome.kind === "unauthenticated") return {
		kind: "unauthenticated",
		detail: outcome.detail
	};
	throw new Error(`Failed to list Claude models: ${outcome.detail}`);
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/update.js
init_json();
const sources$1 = {
	releases: "https://downloads.claude.ai/claude-code-releases",
	npm: "https://registry.npmjs.org/@anthropic-ai/claude-code",
	configDir: () => process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
	globalConfig: () => path.join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json")
};
const PACKAGE_MANAGED = [
	"/Caskroom/",
	"/Cellar/",
	"/mise/",
	"/asdf/",
	"/WinGet/",
	"/winget/"
];
/**
* The layout decides where it is unambiguous (the native versions directory,
* an npm package, a package manager's tree). A shim the path does not
* explain (a pnpm bin, a Windows `claude.cmd`) falls back to the
* `installMethod` claude recorded: `global` is its npm method.
*/
function claudeInstallMethod(realPath, recorded) {
	if (realPath.includes("/claude/versions/")) return "native";
	if (realPath.includes("/node_modules/@anthropic-ai/claude-code/")) return "npm";
	if (PACKAGE_MANAGED.some((segment) => realPath.includes(segment))) return "package_manager";
	return recorded === "global" ? "npm" : "native";
}
function readJsonRecord(file) {
	try {
		return asRecord(parseJson(readFileSync(file, "utf8"))) ?? {};
	} catch {
		return {};
	}
}
function updatesDisabled(settings) {
	const fromEnv = process.env.DISABLE_UPDATES;
	const flag = fromEnv === void 0 || fromEnv === "" ? asRecord(settings.env)?.DISABLE_UPDATES : fromEnv;
	return flag !== void 0 && flag !== "" && flag !== "0" && flag !== false;
}
/** claude stays on its version when the channel is below settings `minimumVersion`. */
function withMinimum(check, minimum) {
	return check.kind === "ok" && typeof minimum === "string" && !versionAtLeast(check.latest, minimum) ? {
		...check,
		updateAvailable: false
	} : check;
}
async function npmCheck(installed, channel, source) {
	const read = await readReleaseSource(source.url, source.timeoutMs);
	if (!read.ok) return read.check;
	const version = asRecord(parseJson(read.text))?.version;
	return comparedCheck(installed, typeof version === "string" ? version : "", source.url, channel);
}
function claudeUpdateCheck(from = sources$1) {
	return async (installation, options = {}) => {
		const update = executableUpdate(installation);
		if (update.kind === "unavailable") return update.check;
		const recorded = readJsonRecord(from.globalConfig()).installMethod;
		const method = claudeInstallMethod(installedPath(update.installation.command), recorded);
		if (method === "package_manager") return {
			kind: "unavailable",
			reason: "package_manager",
			detail: "this copy updates through its package manager"
		};
		const settings = readJsonRecord(path.join(from.configDir(), "settings.json"));
		if (updatesDisabled(settings)) return {
			kind: "unavailable",
			reason: "updates_disabled",
			detail: "DISABLE_UPDATES is set"
		};
		const channel = settings.autoUpdatesChannel === "stable" ? "stable" : "latest";
		const timeoutMs = options.timeoutMs ?? 2e4;
		if (method === "npm") return withMinimum(await npmCheck(update.installed, channel, {
			url: `${from.npm}/${channel}`,
			timeoutMs
		}), settings.minimumVersion);
		const url = `${from.releases}/${channel}`;
		const read = await readReleaseSource(url, timeoutMs);
		return read.ok ? withMinimum(comparedCheck(update.installed, read.text.trim(), url, channel), settings.minimumVersion) : read.check;
	};
}
const claudeCheckUpdate = claudeUpdateCheck();
async function claudeUpgrade(installation, options) {
	return await upgradeExecutable(installation, {
		check: claudeCheckUpdate,
		args: ["update"],
		env: claudeEnv
	}, options);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/abort-fallback.js
/**
* Bound interruption independently of its acknowledgement. Repeated aborts
* cannot postpone the first deadline. An explicit refusal withdraws only
* that attempt; a turn end or process exit clears every attempt. The process
* owner supplies its normal SIGTERM/SIGKILL teardown.
*/
function createAbortFallback(kill, timeoutMs = 1e4) {
	let timer = null;
	let triggered = false;
	const attempts = /* @__PURE__ */ new Map();
	const clear = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		attempts.clear();
		triggered = false;
	};
	return {
		arm(onFallback) {
			if (triggered) {
				onFallback?.();
				return () => {};
			}
			const attempt = Symbol("abort");
			attempts.set(attempt, onFallback);
			if (timer === null) {
				timer = setTimeout(() => {
					triggered = true;
					const takeovers = [...attempts.values()];
					for (const accept of takeovers) accept?.();
					kill();
				}, timeoutMs);
				timer.unref();
			}
			return () => {
				if (attempts.delete(attempt) && attempts.size === 0) clear();
			};
		},
		clear
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/input-lifecycle.js
/** Control plane → state: a prompt clears stale abort intent and starts a new native input attempt. */
function claudePrompted(state, inputId, prompted = true) {
	return {
		...state,
		abortRequested: false,
		turnActive: prompted,
		unclaimedInit: false,
		promptInputId: inputId ?? null,
		pendingInputId: null,
		promptInputs: inputId === void 0 ? state.promptInputs : new Set([...state.promptInputs, inputId]),
		unstartedInputs: inputId === void 0 ? state.unstartedInputs : new Set([...state.unstartedInputs, inputId]),
		unacknowledgedInputs: inputId === void 0 ? state.unacknowledgedInputs : new Set([...state.unacknowledgedInputs, inputId])
	};
}
/** Keep an unclaimed root init until queued can prove it belongs to a spontaneous turn. */
function claudeInitialized(state, root) {
	if (!root) return {
		state,
		events: []
	};
	const spontaneous = !state.turnActive;
	const unclaimedInit = state.unclaimedInit || !spontaneous && !state.nativeTurnActive && state.promptInputId !== null && state.unstartedInputs.has(state.promptInputId);
	return {
		state: {
			...state,
			turnActive: true,
			nativeTurnActive: true,
			unclaimedInit
		},
		events: spontaneous ? [{ kind: "turn_active" }] : []
	};
}
function forgetInput(state, inputId) {
	const promptInputs = new Set(state.promptInputs);
	promptInputs.delete(inputId);
	const unstartedInputs = new Set(state.unstartedInputs);
	unstartedInputs.delete(inputId);
	const unacknowledgedInputs = new Set(state.unacknowledgedInputs);
	unacknowledgedInputs.delete(inputId);
	return {
		...state,
		promptInputs,
		unstartedInputs,
		unacknowledgedInputs,
		...state.promptInputId === inputId ? {
			promptInputId: null,
			turnActive: state.nativeTurnActive,
			unclaimedInit: false
		} : {},
		...state.pendingInputId === inputId ? { pendingInputId: null } : {}
	};
}
/** A replay/completed without queued or started since this write is Claude's duplicate-id refusal. */
function claudeDuplicateInput(state, inputId, root) {
	return root && state.promptInputs.has(inputId) && state.unacknowledgedInputs.has(inputId) ? {
		state: forgetInput(state, inputId),
		events: [{
			kind: "input_dropped",
			inputId,
			reason: "runtime_refused",
			failure: "invalid_request",
			message: "claude ignored the input: its inputId was already used in this session"
		}]
	} : {
		state,
		events: []
	};
}
/** Only prompt-like writes own a turn. A steer can be started inside the current turn. */
function claudeInputLifecycle(state, message, root) {
	const inputId = typeof message.command_uuid === "string" ? message.command_uuid : null;
	if (inputId === null || !state.promptInputs.has(inputId) || !root) return {
		state,
		events: []
	};
	const unacknowledgedInputs = new Set(state.unacknowledgedInputs);
	unacknowledgedInputs.delete(inputId);
	if (message.state === "queued") {
		const spontaneous = inputId === state.promptInputId && state.unclaimedInit;
		return {
			events: [{
				kind: "input_queued",
				inputId
			}, ...spontaneous ? [{ kind: "turn_active" }] : []],
			state: {
				...state,
				unacknowledgedInputs,
				...inputId === state.promptInputId ? {
					turnActive: state.nativeTurnActive,
					unclaimedInit: false,
					pendingInputId: inputId
				} : {}
			}
		};
	}
	if (message.state === "started") {
		const unstartedInputs = new Set(state.unstartedInputs);
		unstartedInputs.delete(inputId);
		return {
			events: [{
				kind: "turn_active",
				inputId
			}],
			state: {
				...state,
				turnActive: true,
				nativeTurnActive: true,
				unclaimedInit: false,
				unstartedInputs,
				unacknowledgedInputs,
				...state.pendingInputId === inputId ? { pendingInputId: null } : {}
			}
		};
	}
	if (message.state === "cancelled") return {
		events: state.unstartedInputs.has(inputId) ? [{
			kind: "input_dropped",
			inputId,
			reason: "turn_interrupted"
		}] : [],
		state: forgetInput(state, inputId)
	};
	if (message.state === "completed") {
		const duplicate = claudeDuplicateInput(state, inputId, root);
		return {
			events: duplicate.events,
			state: forgetInput(duplicate.state, inputId)
		};
	}
	return {
		state,
		events: []
	};
}
/** One stream-json user message; images go before the text, as the Messages API recommends. */
function claudeUserMessage(text, inputId, images = []) {
	return `${JSON.stringify({
		type: "user",
		...inputId === void 0 ? {} : { uuid: inputId },
		message: {
			role: "user",
			content: [...images.map((image) => ({
				type: "image",
				source: {
					type: "base64",
					media_type: image.mediaType,
					data: image.data
				}
			})), ...text === "" ? [] : [{
				type: "text",
				text
			}]]
		}
	})}\n`;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/effort.js
init_json();
/** How long the adapter waits for claude to answer its `get_settings` read-back (after the SessionStart hooks). */
const CLAUDE_EFFORT_READBACK_MS = 3e4;
/** The `get_settings` control request the adapter writes to stdin, under its own request id. */
function claudeSettingsRequest(requestId) {
	return `${JSON.stringify({
		type: "control_request",
		request_id: requestId,
		request: { subtype: "get_settings" }
	})}\n`;
}
/** The request id a `control_response` frame answers, or null for any other frame. */
function claudeControlResponseId(message) {
	if (message.type !== "control_response") return null;
	const id = asRecord(message.response)?.request_id;
	return typeof id === "string" ? id : null;
}
/**
* Why claude will not run `requested`, read off its `get_settings` answer, or
* null when `applied.effort` is exactly the requested level. The message
* names the requested level and what claude said instead.
*/
function claudeEffortRefusal(requested, answer) {
	const response = asRecord(answer.response);
	if (response?.subtype !== "success") return `claude could not report the effort it runs (get_settings: ${typeof response?.error === "string" ? response.error : "no success answer"}), so effort ${requested} cannot be confirmed`;
	const applied = asRecord(asRecord(response.response)?.applied);
	if (applied === null || !("effort" in applied)) return `claude's get_settings answer names no applied effort, so effort ${requested} cannot be confirmed`;
	const model = typeof applied.model === "string" ? ` for ${applied.model}` : "";
	const effort = applied.effort;
	if (effort === requested) return null;
	if (effort === null) return `claude sends no effort${model} (the model takes none), so effort ${requested} would be dropped`;
	return `claude applies effort ${typeof effort === "string" ? effort : JSON.stringify(effort)}${model} although ${requested} was requested`;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/service-tier.js
init_json();
/** Flags apply to this process only; user settings files are never edited. */
function claudeServiceTierArgs(requested) {
	if (requested === void 0) return [];
	if (requested !== "fast" && requested !== "default") throw new Error(`claude cannot apply serviceTier ${requested}; its tiers are default and fast (on supported models)`);
	return ["--settings", JSON.stringify({ fastMode: requested === "fast" })];
}
/** Claude's native fast-mode status, including a temporary downgrade during cooldown. */
function claudeServiceTierEvents(message) {
	const status = message.fast_mode_state;
	if (status === "on") return [{
		kind: "service_tier",
		serviceTier: "fast"
	}];
	if (status === "off" || status === "cooldown") return [{
		kind: "service_tier",
		serviceTier: "default"
	}];
	return [];
}
/** Initialization reports applied state; get_settings.effective.fastMode is only configuration intent. */
function claudeServiceTierRefusal(requested, answer) {
	const response = asRecord(answer.response);
	const applied = asRecord(response?.response);
	const status = applied?.fast_mode_state;
	if (response?.subtype === "success" && status === (requested === "fast" ? "on" : "off")) return null;
	const actual = typeof status === "string" ? status : "unreported";
	const reason = response?.subtype === "success" ? applied?.fast_mode_disabled_reason : response?.error;
	return `claude reports fast_mode_state ${actual} although serviceTier ${requested} was requested${typeof reason === "string" ? ` (${reason})` : ""}`;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/token-usage.js
init_json();
init_token_totals();
/**
* `previous` plus one result's main-loop tokens (`result.usage`, per turn),
* or null when the frame carries no usage. `input_tokens` excludes the cache
* reads and writes, so input counts them back in; each also stands as its
* own part when the frame reports it.
*/
function withMainLoop(previous, message) {
	const usage = asRecord(message.usage);
	if (usage === null) return null;
	const cache = cacheParts(usage, {
		read: "cache_read_input_tokens",
		write: "cache_creation_input_tokens"
	});
	return addTokens(previous ?? noTokens, {
		input: (asNumber(usage.input_tokens) ?? 0) + (cache.cacheRead ?? 0) + (cache.cacheWrite ?? 0),
		output: asNumber(usage.output_tokens) ?? 0,
		...cache
	});
}
const none = /* @__PURE__ */ new Map();
/** A new session: claude's running total and this Session's share both start at zero. */
const freshModelUsage = {
	baseline: {
		kind: "known",
		models: none
	},
	last: none,
	carried: noTokens
};
/** A resume: nothing is counted until the baseline is known. */
const resumedModelUsage = {
	...freshModelUsage,
	baseline: { kind: "awaiting" }
};
/**
* One model's entry: `inputTokens` excludes the cache reads and writes (as
* `result.usage.input_tokens` does), so input counts them back in, and each
* stands as its own part. Null when the entry lacks a count.
*/
function modelTokens(entry) {
	const input = asNumber(entry.inputTokens);
	const output = asNumber(entry.outputTokens);
	if (input === null || output === null) return null;
	const cache = cacheParts(entry, {
		read: "cacheReadInputTokens",
		write: "cacheCreationInputTokens"
	});
	return {
		input: input + (cache.cacheRead ?? 0) + (cache.cacheWrite ?? 0),
		output,
		...cache
	};
}
/** A `modelUsage` (or `get_usage` `model_usage`) map read per model; null when it is not one or an entry lacks its counts. */
function modelTotals(value) {
	const record = asRecord(value);
	if (record === null) return null;
	const models = /* @__PURE__ */ new Map();
	for (const [model, raw] of Object.entries(record)) {
		const entry = asRecord(raw);
		const tokens = entry === null ? null : modelTokens(entry);
		if (tokens === null) return null;
		models.set(model, tokens);
	}
	return models;
}
/**
* The baseline a `get_usage` control_response sets: its
* `response.session.model_usage` (`{}` for a session with nothing saved).
* Anything else (an error answer, a timeout or exit, a reply without session
* totals) leaves it unknown.
*/
function claudeUsageBaseline(answer) {
	const response = answer instanceof Error ? null : asRecord(answer.response);
	const session = response?.subtype === "success" ? asRecord(asRecord(response.response)?.session) : null;
	const models = session === null ? null : modelTotals(session.model_usage);
	return models === null ? { kind: "unknown" } : {
		kind: "known",
		models
	};
}
function withBaseline(usage, baseline) {
	return {
		...usage,
		baseline,
		last: baseline.kind === "known" ? baseline.models : usage.last
	};
}
/** What `models` holds beyond `baseline`, summed over models. */
function shareOf(models, baseline) {
	let share = noTokens;
	for (const [model, tokens] of models) {
		const start = baseline.get(model);
		share = addTokens(share, start === void 0 ? tokens : subtractTokens(tokens, start));
	}
	return share;
}
/** A running total below the last one: claude reset it (a mid-session /clear). */
function wentBack(models, last) {
	return [...last].some(([model, before]) => {
		const now = models.get(model);
		return now === void 0 || now.input < before.input || now.output < before.output;
	});
}
/**
* Fold one result's `modelUsage`: this Session's total so far, or null when
* it is not known (a resume without a baseline) or the frame says nothing
* (no `modelUsage`, or the zeroed one of a crash or startup-error result,
* which must not move the total back). A total below the last one is claude
* resetting its running total (its schema: "a mid-session /clear resets the
* running total"): the share counted so far is kept and counting restarts
* from zero.
*/
function foldModelUsage(usage, message) {
	const models = modelTotals(message.modelUsage);
	if (usage.baseline.kind !== "known" || models === null) return {
		usage,
		total: null
	};
	const reported = shareOf(models, none);
	if (reported.input === 0 && reported.output === 0) return {
		usage,
		total: null
	};
	const reset = wentBack(models, usage.last);
	const baseline = reset ? none : usage.baseline.models;
	const carried = reset ? addTokens(usage.carried, shareOf(usage.last, usage.baseline.models)) : usage.carried;
	return {
		usage: {
			baseline: {
				kind: "known",
				models: baseline
			},
			last: models,
			carried
		},
		total: addTokens(carried, shareOf(models, baseline))
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/open-settings.js
init_session_not_found_error();
init_credential_redactor();
init_json();
init_native_error();
function failedInitialization(message) {
	return message.type === "result" && message.subtype === "error_during_execution";
}
function refusalFor(answer, option, requested, options) {
	if (answer instanceof Error) return `${answer.message}, so ${option} ${requested} cannot be confirmed`;
	if (failedInitialization(answer)) return (Array.isArray(answer.errors) ? answer.errors.filter((error) => typeof error === "string") : []).join("\n") || "claude initialization failed (result/error_during_execution)";
	if (option === "effort") return claudeEffortRefusal(requested, answer);
	if (option === "serviceTier") return claudeServiceTierRefusal(requested, answer);
	const response = asRecord(answer.response);
	if (response?.subtype !== "success") return `claude could not resume ${requested} (initialize: ${typeof response?.error === "string" ? response.error : "no success answer"})`;
	return options.serviceTier === void 0 ? null : claudeServiceTierRefusal(options.serviceTier, answer);
}
/** Successful readbacks contain private configuration or account details, never error diagnostics. */
function failureNative(answer) {
	if (answer instanceof Error) return;
	if (failedInitialization(answer)) return answer;
	const response = asRecord(answer.response);
	return response?.subtype === "error" ? response : void 0;
}
/** Bounded native readbacks at open, consumed before the ordinary projection stream. */
function claudeOpenSettings(child) {
	let pending = null;
	const privateIds = /* @__PURE__ */ new Set();
	const lifetime = {
		exited: false,
		code: null,
		failure: null
	};
	let opening = true;
	const exitError = (method) => /* @__PURE__ */ new Error(`claude exited (code ${String(lifetime.code)}) before answering ${method}`);
	const confirm = async (method, option, options) => {
		const requested = options[option];
		if (requested === void 0) return;
		const { redact } = sessionCredentialRedactor(options);
		const { promise, resolve } = Promise.withResolvers();
		const id = `oar-${option}-${randomUUID()}`;
		pending = {
			id,
			method,
			settle: resolve
		};
		privateIds.add(id);
		const timer = setTimeout(() => {
			resolve(/* @__PURE__ */ new Error(`claude did not answer ${method} within ${String(CLAUDE_EFFORT_READBACK_MS)} ms`));
		}, CLAUDE_EFFORT_READBACK_MS);
		try {
			if (lifetime.failure !== null) resolve(lifetime.failure);
			else if (lifetime.exited) resolve(exitError(method));
			else child.write(method === "get_settings" ? claudeSettingsRequest(id) : `${JSON.stringify({
				type: "control_request",
				request_id: id,
				request: { subtype: method }
			})}\n`);
			const answer = await promise;
			const refusal = refusalFor(answer, option, requested, options);
			if (refusal !== null) {
				const native = failureNative(answer);
				const cause = native === void 0 ? void 0 : nativeErrorCause(method, native, redact);
				if (option === "resume" && method === "initialize" && native !== void 0 && failedInitialization(native) && Array.isArray(native.errors) && typeof native.errors[0] === "string" && native.errors[0].startsWith("No conversation found with session ID") && cause !== void 0) throw new SessionNotFoundError(requested, redact(refusal), cause);
				throw new Error(redact(refusal), cause === void 0 ? void 0 : { cause });
			}
		} catch (error) {
			child.kill();
			await child.exited;
			throw error;
		} finally {
			clearTimeout(timer);
			pending = null;
		}
	};
	return {
		consume(message) {
			if (opening && failedInitialization(message)) {
				lifetime.failure = message;
				pending?.settle(message);
			}
			const id = claudeControlResponseId(message);
			if (pending !== null && id === pending.id) pending.settle(message);
			return id !== null && privateIds.has(id);
		},
		exited(code) {
			lifetime.exited = true;
			lifetime.code = code;
			if (pending !== null) pending.settle(exitError(pending.method));
		},
		async usageBaseline() {
			if (lifetime.exited) return { kind: "unknown" };
			const { promise, resolve } = Promise.withResolvers();
			const id = `oar-usage-${randomUUID()}`;
			pending = {
				id,
				method: "get_usage",
				settle: resolve
			};
			privateIds.add(id);
			const timer = setTimeout(() => {
				resolve(/* @__PURE__ */ new Error(`claude did not answer get_usage within ${String(CLAUDE_EFFORT_READBACK_MS)} ms`));
			}, CLAUDE_EFFORT_READBACK_MS);
			try {
				child.write(`${JSON.stringify({
					type: "control_request",
					request_id: id,
					request: {
						subtype: "get_usage",
						skip_behaviors: true
					}
				})}\n`);
				return claudeUsageBaseline(await promise);
			} finally {
				clearTimeout(timer);
				pending = null;
			}
		},
		async confirm(options) {
			try {
				if (options.resume !== void 0) await confirm("initialize", "resume", options);
				if (options.effort !== void 0) await confirm("get_settings", "effort", options);
				if (options.serviceTier !== void 0 && options.resume === void 0) await confirm("initialize", "serviceTier", options);
			} finally {
				opening = false;
				lifetime.failure = null;
			}
		}
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/context-breakdown.js
init_json();
/**
* How long claude gets to answer. It answered in 0.5 s, mid-turn too
* (2.1.292). No model call, but each read sends the provider a batch of
* `count_tokens` requests (16 to 28 for a small setup, more with more tools
* and skills), so a host reads on demand and does not poll.
*/
const CLAUDE_CONTEXT_BREAKDOWN_MS = 1e4;
const KINDS = {
	used: "used",
	deferred: "deferred",
	buffer: "reserved",
	free: "free"
};
function item(name, tokens) {
	const count = asNumber(tokens);
	return typeof name === "string" && count !== null ? [{
		name,
		tokens: count
	}] : [];
}
const MCP_LOADED = "MCP tools";
const MCP_DEFERRED = "MCP tools (deferred)";
/**
* claude's MCP tools under the MCP category its answer has. `isLoaded` does
* not follow the category on 2.1.292: with tool search off the only category
* is MCP tools, yet every tool says `isLoaded: false`. So `isLoaded` splits
* them only when both categories are there.
*/
function mcpItems(payload, names) {
	const tools = asRecordList(payload.mcpTools);
	const listed = (filter) => tools.filter((tool) => filter(tool)).flatMap((tool) => item(tool.name, tool.tokens));
	if (names.has(MCP_LOADED) && names.has(MCP_DEFERRED)) return [[MCP_LOADED, listed((tool) => tool.isLoaded === true)], [MCP_DEFERRED, listed((tool) => tool.isLoaded !== true)]];
	return [[names.has(MCP_LOADED) ? MCP_LOADED : MCP_DEFERRED, listed(() => true)]];
}
/** claude's per-entry lists, under the category each one makes up. */
function itemsByCategory(payload, names) {
	return new Map([
		["Memory files", asRecordList(payload.memoryFiles).flatMap((file) => item(file.path, file.tokens))],
		["Skills", asRecordList(asRecord(payload.skills)?.skillFrontmatter).flatMap((skill) => item(skill.name, skill.tokens))],
		["Custom agents", asRecordList(payload.agents).flatMap((agent) => item(agent.agentType, agent.tokens))],
		...mcpItems(payload, names)
	]);
}
/** claude's `get_context_usage` (`detail: "full"`) answer, read: its categories in its order and words, with the lists that itemize them. */
function claudeContextBreakdown(payload) {
	const tokens = asNumber(payload.totalTokens);
	const contextWindow = asNumber(payload.maxTokens);
	if (tokens === null || contextWindow === null) throw new Error("claude's get_context_usage answer has no totalTokens or maxTokens");
	const native = asRecordList(payload.categories);
	const items = itemsByCategory(payload, new Set(native.flatMap((category) => typeof category.name === "string" ? [category.name] : [])));
	return {
		tokens,
		contextWindow,
		categories: native.flatMap((category) => {
			const tokensIn = asNumber(category.tokens);
			if (typeof category.name !== "string" || tokensIn === null) return [];
			const listed = items.get(category.name) ?? [];
			return [{
				name: category.name,
				tokens: tokensIn,
				kind: typeof category.kind === "string" ? KINDS[category.kind] ?? "unknown" : "unknown",
				...listed.length === 0 ? {} : { items: listed }
			}];
		})
	};
}
function claudeContextBreakdownReader(child) {
	let pending = null;
	let inFlight = null;
	let gone = false;
	const ask = async () => {
		const id = `oar-context-${randomUUID()}`;
		const { promise, resolve } = Promise.withResolvers();
		pending = {
			id,
			settle: resolve
		};
		const timer = setTimeout(() => {
			resolve({
				subtype: "error",
				error: `no answer within ${String(CLAUDE_CONTEXT_BREAKDOWN_MS)} ms`
			});
		}, CLAUDE_CONTEXT_BREAKDOWN_MS);
		try {
			child.write(`${JSON.stringify({
				type: "control_request",
				request_id: id,
				request: {
					subtype: "get_context_usage",
					detail: "full"
				}
			})}\n`);
			const response = await promise;
			if (response === null) return null;
			if (response.subtype !== "success") throw new Error(`claude did not answer get_context_usage: ${typeof response.error === "string" ? response.error : "error"}`);
			return claudeContextBreakdown(asRecord(response.response) ?? {});
		} finally {
			clearTimeout(timer);
			pending = null;
		}
	};
	const shared = async () => {
		try {
			return await ask();
		} finally {
			inFlight = null;
		}
	};
	return {
		consume(message) {
			const id = claudeControlResponseId(message);
			if (id === null || !id.startsWith("oar-context-")) return false;
			if (pending?.id === id) pending.settle(asRecord(message.response));
			return true;
		},
		exited() {
			gone = true;
			pending?.settle(null);
		},
		read: async () => {
			if (gone || child.stdin.writableEnded || child.stdin.destroyed) return null;
			inFlight ??= shared();
			return await inFlight;
		}
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/launch-args.js
init_errors$1();
/**
* claude flags OAR sets itself, which a host's `launchArgs` would contradict
* (#336): with `--continue` claude exits next to OAR's `--session-id`; after
* `--fork-session` claude runs under a new id while `Session.id` keeps the
* old one; `--dangerously-skip-permissions` overrides `--permission-mode`.
* Each maps to the reason the open is refused. A short alias is checked as
* a whole argument, a long flag also in its `--flag=value` form.
*/
const MANAGED = new Map([
	["--continue", "OAR assigns the session id; use SessionOptions.resume with the id to continue"],
	["-c", "OAR assigns the session id; use SessionOptions.resume with the id to continue"],
	["--resume", "use SessionOptions.resume"],
	["-r", "use SessionOptions.resume"],
	["--session-id", "OAR assigns the session id"],
	["--fork-session", "a fork runs under a new native id that Session.id would not report"],
	["--print", "OAR drives claude in print mode over stream-json already"],
	["-p", "OAR drives claude in print mode over stream-json already"],
	["--input-format", "OAR drives claude over stream-json"],
	["--output-format", "OAR drives claude over stream-json"],
	["--json-schema", "use SessionOptions.outputSchema"]
]);
/** Refuse, before claude starts, a `launchArgs` entry that collides with a flag OAR manages. */
function refuseManagedLaunchArgs(launchArgs) {
	for (const arg of launchArgs ?? []) {
		const flag = arg.startsWith("--") ? arg.split("=", 1)[0] ?? arg : arg;
		const reason = MANAGED.get(flag);
		if (reason !== void 0) throw new UnsupportedOptionError("launchArgs", `claude launchArgs cannot include ${flag}: ${reason}`);
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/private-temp.js
function releaseFifos(directory) {
	let names = [];
	try {
		names = readdirSync(directory);
	} catch {
		return;
	}
	for (const name of names) {
		const file = path.join(directory, name);
		try {
			if (lstatSync(file).isFIFO()) closeSync(openSync(file, constants.O_WRONLY | constants.O_NONBLOCK));
		} catch {}
	}
}
function removeDirectory(directory) {
	releaseFifos(directory);
	rmSync(directory, {
		recursive: true,
		force: true
	});
}
function removeLive() {
	for (const directory of live) removeDirectory(directory);
	live.clear();
}
function running(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}
/** Remove `prefix` directories whose host pid no longer runs, releasing their FIFOs first; one that cannot be removed (another user's) stays. */
async function sweepPrivateTempDirs(prefix) {
	const root = tmpdir();
	const names = await readdir(root).catch(() => []);
	await Promise.all(names.map(async (name) => {
		const pid = name.startsWith(prefix) ? /^(\d+)-/u.exec(name.slice(prefix.length))?.[1] : void 0;
		if (pid === void 0 || Number(pid) === process.pid || running(Number(pid))) return;
		const directory = path.join(root, name);
		releaseFifos(directory);
		await rm(directory, {
			recursive: true,
			force: true
		}).catch(() => void 0);
	}));
}
/** A fresh 0700 directory for one runtime process, removed by `remove()` or, failing that, by the backstops above. */
async function privateTempDir(prefix) {
	await sweepPrivateTempDirs(prefix);
	const directory = await mkdtemp(path.join(tmpdir(), `${prefix}${String(process.pid)}-`));
	if (!hooked) {
		process.on("exit", removeLive);
		hooked = true;
	}
	live.add(directory);
	return {
		path: directory,
		remove: () => {
			live.delete(directory);
			removeDirectory(directory);
		}
	};
}
var live, hooked;
var init_private_temp = __esmMin((() => {
	live = /* @__PURE__ */ new Set();
	hooked = false;
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/mcp-config.js
init_run();
init_mcp_servers$1();
init_private_temp();
/** claude's `--mcp-config` document for the entries: stdio `{type, command, args, env}`, http `{type, url, headers}`. */
function claudeMcpConfig(servers) {
	return { mcpServers: Object.fromEntries(servers.map((server) => [server.name, isHttpMcpServer(server) ? {
		type: "http",
		url: server.url,
		...server.headers === void 0 ? {} : { headers: server.headers }
	} : {
		type: "stdio",
		command: server.command,
		args: server.args ?? [],
		...server.env === void 0 ? {} : { env: server.env }
	}])) };
}
function errorCode(error) {
	return error instanceof Error && "code" in error ? error.code : void 0;
}
/** A 0600 FIFO at `file`; false where none can be made. */
async function makeFifo(file) {
	if (process.platform === "win32") return false;
	return (await runExecutable("mkfifo", [
		"-m",
		"600",
		file
	])).ok;
}
/** The write end once a reader has the FIFO open; undefined when `stopped()` first. */
async function openWhenRead(file, stopped) {
	let wait = 5;
	while (!stopped()) {
		try {
			return await open(file, constants.O_WRONLY | constants.O_NONBLOCK);
		} catch (error) {
			if (errorCode(error) !== "ENXIO") throw error;
		}
		await setTimeout$1(wait, void 0, { ref: false });
		wait = Math.min(wait * 2, 100);
	}
}
/** Write all of `content` to a non-blocking pipe: a full pipe answers EAGAIN until the reader drains it. */
async function writeAll(handle, content, stopped) {
	let rest = content;
	while (rest.length > 0 && !stopped()) try {
		const { bytesWritten } = await handle.write(rest);
		rest = rest.subarray(bytesWritten);
	} catch (error) {
		if (errorCode(error) !== "EAGAIN") throw error;
		await setTimeout$1(5, void 0, { ref: false });
	}
}
function fifoHandoff(file, content, directory) {
	let ended = false;
	const stopped = () => ended;
	const end = () => {
		ended = true;
		directory.remove();
	};
	const feed = async () => {
		const handle = await openWhenRead(file, stopped);
		if (handle === void 0) return;
		try {
			await writeAll(handle, Buffer.from(content), stopped);
		} finally {
			await handle.close();
		}
	};
	return {
		path: file,
		start: () => {
			(async () => {
				try {
					await feed();
				} catch {} finally {
					end();
				}
			})();
		},
		end
	};
}
const PREFIX = "oar-claude-mcp-";
/**
* Before any claude starts, with servers or without: remove what hosts that
* died left behind, letting a claude still waiting on such a FIFO go.
*/
async function sweepAbandonedMcpConfigs() {
	await sweepPrivateTempDirs(PREFIX);
}
/** The handoff for these entries (sweeping as above first). Rejects on an empty or repeated name before anything is created. */
async function handOverMcpConfig(servers) {
	checkMcpServerNames(servers);
	const directory = await privateTempDir(PREFIX);
	const file = path.join(directory.path, "mcp.json");
	const content = JSON.stringify(claudeMcpConfig(servers));
	try {
		if (await makeFifo(file)) return fifoHandoff(file, content, directory);
		await writeFile(file, content, {
			mode: 384,
			flag: "wx"
		});
	} catch (error) {
		directory.remove();
		throw error;
	}
	return {
		path: file,
		start: () => {},
		end: () => {
			directory.remove();
		}
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/launch.js
init_additional_directories$1();
init_environment();
init_executable();
init_mcp_servers$1();
init_session_options();
function spawnClaude(command, sessionId, options, mcpConfig, tierArgs) {
	const directories = resolvedAdditionalDirectories(options);
	return spawnLineProcess(command, [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--replay-user-messages",
		"--include-partial-messages",
		...(options.launchArgs ?? []).some((arg) => arg === "--permission-mode" || arg.startsWith("--permission-mode=")) ? [] : ["--dangerously-skip-permissions"],
		...options.resume === void 0 ? ["--session-id", sessionId] : ["--resume", sessionId],
		...options.resume !== void 0 || options.name === void 0 ? [] : ["--name", options.name],
		...options.model === void 0 ? [] : ["--model", options.model],
		...options.effort === void 0 ? [] : ["--effort", options.effort],
		...tierArgs,
		...options.outputSchema === void 0 ? [] : ["--json-schema", JSON.stringify(options.outputSchema)],
		...options.systemPrompt === void 0 ? [] : ["--system-prompt", options.systemPrompt],
		...options.appendSystemPrompt === void 0 ? [] : ["--append-system-prompt", options.appendSystemPrompt],
		...options.launchArgs ?? [],
		...directories.length === 0 ? [] : ["--add-dir", ...directories],
		...mcpConfig === null ? [] : ["--mcp-config", mcpConfig],
		...(options.disallowedTools?.length ?? 0) === 0 ? [] : ["--disallowed-tools", ...options.disallowedTools ?? []]
	], {
		cwd: options.cwd,
		env: sessionEnvironment(claudeSessionEnv(options.env)),
		killTree: true
	});
}
/**
* Start claude for a session (`--session-id`, or `--resume` an existing one)
* and wait until it runs; with MCP servers, their config is handed over as
* mcp-config.ts describes and gone at the latest when the process exits.
* Rejects on a list with an empty or repeated name, or `launchArgs` that
* collide with a flag OAR manages (launch-args.ts), before anything starts,
* and when claude cannot be spawned.
*/
async function launchClaude(command, sessionId, options) {
	refuseManagedLaunchArgs(options.launchArgs);
	checkSessionName(options);
	const tierArgs = claudeServiceTierArgs(options.serviceTier);
	const servers = givenMcpServers(options.mcpServers);
	const mcpConfig = servers === null ? null : await handOverMcpConfig(servers);
	if (mcpConfig === null) await sweepAbandonedMcpConfigs();
	let child = null;
	try {
		child = spawnClaude(command, sessionId, options, mcpConfig?.path ?? null, tierArgs);
	} finally {
		if (child === null) mcpConfig?.end();
	}
	if (mcpConfig !== null) {
		child.onExit(() => {
			mcpConfig.end();
		});
		mcpConfig.start();
	}
	await child.spawned;
	return child;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/failure.js
init_failure_class();
init_instant();
init_json();
/** The categories observed, by what they mean; `server_error` is decided by its status (a 529 is overload). */
const CATEGORIES = {
	authentication_failed: "auth",
	model_not_found: "model_unavailable",
	rate_limit: "rate_limited",
	billing_error: "billing",
	invalid_request: "invalid_request"
};
/** Result subtypes for a limit or schema the host set (#339): the session's own options stopped the turn. */
const SUBTYPES = {
	error_max_turns: "limit_reached",
	error_max_budget_usd: "limit_reached",
	error_max_structured_output_retries: "output_schema"
};
/**
* When the subscription limit claude reports refusing requests resets: a
* `rate_limit_event`'s `rate_limit_info` (Agent SDK 0.3.295
* `SDKRateLimitInfo`, [sym] 2.1.289) with `status: "rejected"` and its
* `resetsAt`, unix seconds. claude sends one whenever its view of the
* limits changes, a refused request (a 429 carrying the
* `anthropic-ratelimit-unified-*` headers) included, before that request's
* error frame and the turn's `result`; an unchanged rejection need not be
* sent again, so the latest event stands until another replaces it. Null
* when the limit refuses nothing (`allowed`, `allowed_warning`), when paid
* overage still takes the requests (`overageStatus` allowed or
* allowed_warning), or when the event names no reset: claude also marks a
* subscriber's 429 without limit headers `rejected`, with no reset, and
* words that one a temporary capacity issue. `overageResetsAt` is not read.
* The time is kept as claude sent it, so it may already be past when a
* later turn fails; no clock is read here. From the SDK types and the
* binary only: oar never triggers a limit on a real account to observe it.
*/
function claudeLimitReset(info) {
	if (info?.status !== "rejected" || info.overageStatus === "allowed" || info.overageStatus === "allowed_warning") return null;
	const seconds = asNumber(info.resetsAt);
	return seconds === null ? null : utcInstantFromDate(/* @__PURE__ */ new Date(seconds * 1e3));
}
/** An error result's own words: the subtype, then claude's `errors` text when it gives any (#339). */
function claudeResultReason(subtype, errors) {
	const detail = Array.isArray(errors) ? errors.filter((error) => typeof error === "string" && error.length > 0).join("; ") : "";
	if (subtype === void 0) return detail.length > 0 ? detail : "error";
	return detail.length > 0 ? `${subtype}: ${detail}` : subtype;
}
/** Classify a failed claude turn whose `result` says `reason`. */
function claudeFailure(reason, facts) {
	const { category, status, terminalReason, limitResetsAt } = facts;
	const withStatus = status === null ? {} : { status };
	const failed = (failure) => ({
		kind: "failed",
		reason,
		failure,
		...withStatus
	});
	if (terminalReason === "prompt_too_long") return failed("input_too_large");
	const limit = facts.subtype === void 0 || facts.subtype === null ? void 0 : SUBTYPES[facts.subtype];
	if (limit !== void 0) return failed(limit);
	if (category === "authentication_failed") {
		if (status === null) return {
			kind: "failed",
			reason,
			failure: "auth",
			credential: "missing"
		};
		return {
			kind: "failed",
			reason,
			failure: "auth",
			status,
			...status === 401 ? { credential: "rejected" } : {}
		};
	}
	if (category === "rate_limit" && limitResetsAt !== null) return {
		kind: "failed",
		reason,
		failure: "quota",
		...withStatus,
		resetsAt: limitResetsAt
	};
	const named = category === null ? void 0 : CATEGORIES[category];
	if (named !== void 0) return failed(named);
	if (status === null) return failed("unknown");
	return failed(status === 400 ? anthropicLimitText(reason) ?? "invalid_request" : failureFromStatus(status));
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/context-usage.js
init_json();
const initialClaudeContext = {
	kind: "unchanged",
	model: null
};
/** claude's model for the messages it makes up itself (an interrupted or errored turn's reply): no model call. */
const SYNTHETIC_MODEL = "<synthetic>";
/** A root `assistant` frame: the context its model call sent. Every frame of one message repeats the same usage. */
function claudeContextSent(reading, message) {
	const body = asRecord(message.message);
	const usage = asRecord(body?.usage);
	const model = typeof body?.model === "string" ? body.model : null;
	if (usage === null || model === SYNTHETIC_MODEL) return reading;
	return {
		kind: "sent",
		tokens: (asNumber(usage.input_tokens) ?? 0) + (asNumber(usage.cache_read_input_tokens) ?? 0) + (asNumber(usage.cache_creation_input_tokens) ?? 0),
		model: model ?? reading.model
	};
}
/** A root `compact_boundary`: what the context holds is unknown until claude's next call. */
function claudeContextCompacted(reading) {
	return {
		kind: "compacted",
		model: reading.model
	};
}
function windowOf(result, model) {
	const modelUsage = asRecord(result.modelUsage);
	if (modelUsage === null) return null;
	const entry = asRecord((model === null ? void 0 : modelUsage[model]) ?? Object.values(modelUsage)[0]);
	return entry === null ? null : asNumber(entry.contextWindow);
}
/** A root `result`: the turn's context reading, null when nothing changed it; the reading starts over for the next turn. */
function claudeContextUsage(reading, result) {
	const next = {
		kind: "unchanged",
		model: reading.model
	};
	if (reading.kind === "unchanged") return {
		context: null,
		reading: next
	};
	const contextWindow = windowOf(result, reading.model);
	const tokens = reading.kind === "sent" ? reading.tokens : null;
	return {
		context: {
			tokens,
			contextWindow,
			percent: tokens === null || contextWindow === null || contextWindow === 0 ? null : Math.round(tokens / contextWindow * 100)
		},
		reading: next
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/tasks.js
init_json();
/**
* claude's task frames (stream-json `system/task_started`, `task_updated`,
* `task_progress`, `task_notification`; observed on 2.1.284 and 2.1.292, shapes as documented for the
* Agent SDK): background and foreground commands (`local_bash`), subagents
* (`local_agent`, `remote_agent`), and MCP calls moved to the background
* (`mcp_task`), workflow runs (`local_workflow`) and agent teammates.
* `workflow_progress` stays native: it is outside the SDK schema. Its
* last-call token counts are not spend; only result.modelUsage is.
* `background_tasks_changed` repeats the live set and maps to
* nothing: the per-task frames carry starts, status changes and ends, though
* a change of `ambient` alone shows only there.
*/
const TASK_TYPES = {
	local_bash: "shell",
	local_agent: "agent",
	remote_agent: "agent",
	in_process_teammate: "agent",
	mcp_task: "tool",
	local_workflow: "workflow"
};
const STATUSES = {
	pending: "pending",
	running: "running",
	paused: "paused",
	completed: "completed",
	failed: "failed",
	killed: "stopped",
	stopped: "stopped"
};
function text$10(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
function flag(value) {
	return typeof value === "boolean" ? value : void 0;
}
function started(message, taskId) {
	const nativeType = text$10(message.task_type);
	const description = text$10(message.description);
	const toolCallId = text$10(message.tool_use_id);
	const background = flag(message.is_backgrounded);
	const ambient = flag(message.ambient);
	return {
		kind: "task_started",
		taskId,
		taskType: nativeType === void 0 ? "other" : TASK_TYPES[nativeType] ?? "other",
		...nativeType === void 0 ? {} : { nativeType },
		...description === void 0 ? {} : { description },
		...toolCallId === void 0 ? {} : { toolCallId },
		...background === void 0 ? {} : { background },
		...ambient === void 0 ? {} : { ambient }
	};
}
function updated(message, taskId) {
	const patch = asRecord(message.patch) ?? {};
	const status = typeof patch.status === "string" ? STATUSES[patch.status] : void 0;
	const background = flag(patch.is_backgrounded);
	const description = text$10(patch.description);
	const error = text$10(patch.error);
	return {
		kind: "task_updated",
		taskId,
		...status === void 0 ? {} : { status },
		...background === void 0 ? {} : { background },
		...description === void 0 ? {} : { description },
		...error === void 0 ? {} : { error }
	};
}
function ended(message, taskId) {
	const status = typeof message.status === "string" ? STATUSES[message.status] : void 0;
	if (status !== "completed" && status !== "failed" && status !== "stopped") return [];
	const summary = text$10(message.summary);
	const outputFile = text$10(message.output_file);
	return [{
		kind: "task_ended",
		taskId,
		status,
		...summary === void 0 ? {} : { summary },
		...outputFile === void 0 ? {} : { outputFile }
	}];
}
function taskEvents(message, previousDescription) {
	const taskId = text$10(message.task_id);
	if (taskId === void 0) return [];
	switch (message.subtype) {
		case "task_started": return [started(message, taskId)];
		case "task_updated": return [updated(message, taskId)];
		case "task_progress": return typeof message.description === "string" && message.description !== previousDescription ? [{
			kind: "task_updated",
			taskId,
			description: message.description
		}] : [];
		case "task_notification": return ended(message, taskId);
		default: return [];
	}
}
/** Progress repeats often; remember each task's last reported description across turns. */
function claudeTaskViews(message, descriptions, agentPath) {
	const key = JSON.stringify([...agentPath, message.task_id]);
	const events = taskEvents(message, descriptions.get(key));
	const description = events.find((event) => event.kind !== "task_ended" && event.description !== void 0);
	if (description?.kind !== "task_ended" && description?.description !== void 0 && description.description !== descriptions.get(key)) return {
		events,
		descriptions: new Map([...descriptions, [key, description.description]])
	};
	return {
		events,
		descriptions
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/content.js
init_tool_output();
init_json();
function contentBlocks(message) {
	const content = asRecord(message.message)?.content;
	return Array.isArray(content) ? content.map((block) => asRecord(block)).filter((block) => block !== null) : [];
}
function textEvent(type, text, id) {
	const identity = id === void 0 ? {} : { messageId: id };
	return type === "text" ? {
		kind: "text_delta",
		text,
		...identity
	} : {
		kind: "reasoning",
		content: {
			kind: "text",
			text
		},
		...identity
	};
}
/** Keep only a tool's identity: argument fragments are emitted, never parsed or accumulated here. */
function streamContent(previous, event) {
	if (event.type === "message_start") {
		const id = asRecord(event.message)?.id;
		return {
			message: {
				...typeof id === "string" ? { id } : {},
				blocks: /* @__PURE__ */ new Map()
			},
			events: []
		};
	}
	const message = previous ?? { blocks: /* @__PURE__ */ new Map() };
	const body = event.type === "content_block_start" ? asRecord(event.content_block) : event.type === "content_block_delta" ? asRecord(event.delta) : null;
	if (typeof event.index !== "number") return {
		message: previous,
		events: []
	};
	const blocks = new Map(message.blocks);
	if (body?.type === "tool_use" && typeof body.id === "string" && typeof body.name === "string") {
		const prior = blocks.get(event.index);
		blocks.set(event.index, {
			type: "tool_use",
			callId: body.id
		});
		return {
			message: {
				...message,
				blocks
			},
			events: prior?.type === "tool_use" && prior.callId === body.id ? [] : [{
				kind: "tool_call_started",
				callId: body.id,
				tool: body.name
			}]
		};
	}
	if (body?.type === "input_json_delta" && typeof body.partial_json === "string") {
		const tool = blocks.get(event.index);
		return {
			message: previous,
			events: tool?.type === "tool_use" ? [{
				kind: "tool_call_input_delta",
				callId: tool.callId,
				delta: body.partial_json
			}] : []
		};
	}
	const type = body?.type === "text" || body?.type === "text_delta" ? "text" : body?.type === "thinking" || body?.type === "thinking_delta" ? "thinking" : null;
	if (type === null) return {
		message: previous,
		events: []
	};
	const value = body?.[type];
	const text = typeof value === "string" ? value : "";
	const prior = event.type === "content_block_start" ? void 0 : blocks.get(event.index);
	blocks.set(event.index, {
		type,
		text: (prior?.type === type ? prior.text : "") + text,
		finalized: false
	});
	return {
		message: {
			...message,
			blocks
		},
		events: text.length === 0 ? [] : [textEvent(type, text, message.id)]
	};
}
/** Native 2.1.293 emits one completed block just before its content_block_stop,
* with the same API id for every block. Consume that block's streamed prefix
* once, rather than treating an entire message id as already projected. */
function finalContent(message, partial) {
	const id = asRecord(message.message)?.id;
	const identity = typeof id === "string" ? { messageId: id } : {};
	const blocks = new Map(partial?.blocks);
	const remainder = (type, full) => {
		if (typeof id !== "string" || partial?.id !== id) return full;
		const pending = [...blocks].find((entry) => entry[1].type === type && !entry[1].finalized);
		if (pending === void 0) return full;
		const [index, block] = pending;
		blocks.set(index, {
			...block,
			finalized: true
		});
		if (block.text.length === 0 || !full.startsWith(block.text)) return full;
		const suffix = full.slice(block.text.length);
		return suffix.length === 0 ? null : suffix;
	};
	const events = [];
	for (const block of contentBlocks(message)) switch (block.type) {
		case "text": {
			const text = typeof block.text === "string" ? remainder("text", block.text) : null;
			if (text !== null) events.push({
				kind: "text_delta",
				text,
				...identity
			});
			break;
		}
		case "thinking": {
			const text = remainder("thinking", typeof block.thinking === "string" ? block.thinking : "");
			if (text !== null) events.push({
				kind: "reasoning",
				content: text.length > 0 ? {
					kind: "text",
					text
				} : { kind: "empty" },
				...identity
			});
			break;
		}
		case "redacted_thinking":
			events.push({
				kind: "reasoning",
				content: { kind: "redacted" },
				...identity
			});
			break;
		case "tool_use":
			if ((partial?.id === id || partial?.id === void 0) && [...blocks.values()].some((item) => item.type === "tool_use" && item.callId === block.id)) {
				if (block.input !== void 0) events.push({
					kind: "tool_call_input",
					callId: String(block.id),
					input: JSON.stringify(block.input)
				});
				break;
			}
			events.push({
				kind: "tool_call_started",
				callId: typeof block.id === "string" ? block.id : "unknown",
				tool: typeof block.name === "string" ? block.name : "unknown",
				...block.input === void 0 ? {} : { input: JSON.stringify(block.input) }
			});
			break;
		default: break;
	}
	return {
		message: partial === void 0 ? void 0 : {
			...partial,
			blocks
		},
		events
	};
}
/** Pure content projection; the caller records the original frame even if events is empty. */
function claudeContent(partials, message, agentPath) {
	const lane = JSON.stringify(agentPath);
	if (message.type === "stream_event" && asRecord(message.event)?.type === "message_stop") {
		const remaining = new Map(partials);
		remaining.delete(lane);
		return {
			partials: remaining,
			events: []
		};
	}
	const previous = partials.get(lane);
	const next = message.type === "stream_event" ? streamContent(previous, asRecord(message.event) ?? {}) : finalContent(message, previous);
	return {
		partials: next.message === void 0 ? partials : new Map([...partials, [lane, next.message]]),
		events: next.events
	};
}
function claudeToolResults(message) {
	const out = [];
	for (const block of contentBlocks(message)) if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
		const content = toolContent(block.content);
		out.push({
			kind: "tool_call_ended",
			callId: block.tool_use_id,
			...content === void 0 ? {} : { content },
			result: block.is_error === true ? "failed" : "ok"
		});
	}
	return out;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/projection.js
init_json();
/** A new session's fold. */
const initialClaudeProjection = {
	abortRequested: false,
	turnActive: false,
	nativeTurnActive: false,
	unclaimedInit: false,
	promptInputId: null,
	promptInputs: /* @__PURE__ */ new Set(),
	unstartedInputs: /* @__PURE__ */ new Set(),
	unacknowledgedInputs: /* @__PURE__ */ new Set(),
	pendingInputId: null,
	agents: /* @__PURE__ */ new Map(),
	tokens: /* @__PURE__ */ new Map(),
	modelUsage: freshModelUsage,
	context: initialClaudeContext,
	partials: /* @__PURE__ */ new Map(),
	taskDescriptions: /* @__PURE__ */ new Map(),
	failureCategory: null,
	limitResetsAt: null
};
/** A resumed session's fold: it counts no tokens until `claudeUsageBaselined` says where its share starts. */
const resumedClaudeProjection = {
	...initialClaudeProjection,
	modelUsage: resumedModelUsage
};
/** The adapter's `get_usage` read-back at open: where a resumed Session's share of claude's running total starts. */
function claudeUsageBaselined(state, baseline) {
	return {
		...state,
		modelUsage: withBaseline(state.modelUsage, baseline)
	};
}
function claudeAbortRequested(state) {
	return {
		...state,
		abortRequested: true
	};
}
function resultOutcome(state, message) {
	if (state.abortRequested) return { kind: "aborted" };
	if (message.is_error === true) {
		const text = typeof message.result === "string" && message.result.length > 0 ? message.result : void 0;
		const subtype = typeof message.subtype === "string" && message.subtype !== "success" ? message.subtype : void 0;
		return claudeFailure(text ?? claudeResultReason(subtype, message.errors), {
			category: state.failureCategory,
			status: asNumber(message.api_error_status),
			terminalReason: typeof message.terminal_reason === "string" ? message.terminal_reason : null,
			limitResetsAt: state.limitResetsAt,
			subtype: subtype ?? null
		});
	}
	return {
		kind: "completed",
		...Object.hasOwn(message, "structured_output") ? { structuredOutput: message.structured_output } : {}
	};
}
function pathKey(agentPath) {
	return JSON.stringify(agentPath);
}
/** The agent a frame belongs to: root, or the Task call that spawned it (nested through the call's own agent). */
function attributionOf(state, message) {
	const parent = message.parent_tool_use_id;
	if (typeof parent !== "string" || parent.length === 0) return [];
	return [...state.agents.get(parent) ?? [], parent];
}
function rememberToolUses(state, message, agentPath) {
	const event = asRecord(message.event);
	const partial = event?.type === "content_block_start" ? asRecord(event.content_block) : null;
	const ids = (partial === null ? contentBlocks(message) : [partial]).filter((block) => block.type === "tool_use" && typeof block.id === "string").map((block) => String(block.id));
	if (ids.length === 0) return state;
	const agents = new Map(state.agents);
	for (const id of ids) agents.set(id, agentPath);
	return {
		...state,
		agents
	};
}
function frameType(message) {
	const type = typeof message.type === "string" ? message.type : "unknown";
	return typeof message.subtype === "string" ? `${type}/${message.subtype}` : type;
}
/**
* Cumulative per-agent tokens after folding this result frame's own turn
* usage: the main loop's (claude's word), so the root agent's. None while a
* resumed Session's share is unknown. Subagents get no entry: only a
* subagent's first assistant frame carries `parent_tool_use_id`, and its
* `message.usage` is the stream-start value, not final ([env] 2.1.292), so
* their spend stays in the session total, unattributed.
*/
function accumulate$1(state, agentPath, message) {
	const tokens = state.modelUsage.baseline.kind === "known" ? withMainLoop(state.tokens.get(pathKey(agentPath)), message) : null;
	if (tokens === null) return null;
	const next = new Map([...state.tokens, [pathKey(agentPath), tokens]]);
	return {
		state: {
			...state,
			tokens: next
		},
		tokens
	};
}
/** Fold one parsed claude stdout frame into the next state plus commands. */
function foldClaudeStdout(state, message) {
	const type = frameType(message);
	const agentPath = attributionOf(state, message);
	const event = (body, next = state) => ({
		state: next,
		commands: [{
			kind: "frame",
			body: {
				type,
				native: message,
				...body
			},
			agentPath
		}]
	});
	switch (String(message.type)) {
		case "command_lifecycle": {
			const folded = claudeInputLifecycle(state, message, agentPath.length === 0);
			return event({ events: folded.events }, folded.state);
		}
		case "assistant":
		case "stream_event": {
			const content = claudeContent(state.partials, message, agentPath);
			const next = rememberToolUses({
				...state,
				partials: content.partials
			}, message, agentPath);
			if (message.type !== "assistant" || agentPath.length > 0) return event({ events: content.events }, next);
			return event({ events: content.events }, {
				...next,
				failureCategory: typeof message.error === "string" ? message.error : next.failureCategory,
				context: claudeContextSent(next.context, message)
			});
		}
		case "user": {
			const views = [...claudeToolResults(message)];
			const body = asRecord(message.message);
			if (message.isReplay === true && typeof message.uuid === "string" && Array.isArray(body?.content)) {
				const input = body.content.map((part) => asRecord(part)).filter((part) => part?.type === "text").map((part) => typeof part?.text === "string" ? part.text : "").join("");
				views.push({
					kind: "user_message",
					input,
					inputId: message.uuid,
					nativeMessageId: message.uuid,
					evidence: "acknowledged"
				});
			}
			const duplicate = message.isReplay === true && typeof message.uuid === "string" ? claudeDuplicateInput(state, message.uuid, agentPath.length === 0) : {
				state,
				events: []
			};
			return event({ events: [...views, ...duplicate.events] }, duplicate.state);
		}
		case "result": {
			const events = [...claudeServiceTierEvents(message), {
				kind: "turn_ended",
				outcome: resultOutcome(state, message)
			}];
			const accumulated = accumulate$1(state, agentPath, message);
			const running = foldModelUsage(state.modelUsage, message);
			const { context, reading } = claudeContextUsage(state.context, message);
			if (accumulated !== null || context !== null || running.total !== null) events.push({
				kind: "usage",
				usage: {
					...context === null ? {} : { context },
					...accumulated === null ? {} : { tokens: accumulated.tokens },
					...running.total === null ? {} : { total: running.total }
				}
			});
			return event({ events }, {
				...accumulated?.state ?? state,
				modelUsage: running.usage,
				context: reading,
				...agentPath.length === 0 ? {
					turnActive: false,
					nativeTurnActive: false,
					unclaimedInit: false,
					...state.pendingInputId === null ? { promptInputId: null } : {}
				} : {},
				abortRequested: false,
				failureCategory: null
			});
		}
		case "system": {
			if (message.subtype === "compact_boundary") {
				const trigger = asRecord(message.compact_metadata)?.trigger;
				return event({ events: [{
					kind: "compaction_ended",
					outcome: "completed",
					...typeof trigger === "string" ? { trigger } : {}
				}] }, agentPath.length === 0 ? {
					...state,
					context: claudeContextCompacted(state.context)
				} : state);
			}
			if (message.subtype === "init") {
				const initialized = claudeInitialized(state, agentPath.length === 0);
				return event({ events: [
					...initialized.events,
					...typeof message.model === "string" ? [{
						kind: "model",
						model: message.model
					}] : [],
					...claudeServiceTierEvents(message)
				] }, initialized.state);
			}
			const task = claudeTaskViews(message, state.taskDescriptions, agentPath);
			return event({ events: [...task.events, ...claudeServiceTierEvents(message)] }, task.descriptions === state.taskDescriptions ? state : {
				...state,
				taskDescriptions: task.descriptions
			});
		}
		case "control_response": {
			const response = asRecord(message.response);
			const requestId = typeof response?.request_id === "string" ? response.request_id : null;
			if (requestId === null) return event({ events: [] });
			const error = typeof response?.error === "string" ? response.error : null;
			return {
				state,
				commands: [{
					kind: "respond",
					requestId,
					body: response?.subtype === "error" || error !== null ? {
						kind: "rejected",
						code: "runtime_refused",
						reason: error ?? "control request failed",
						native: message
					} : {
						kind: "accepted",
						native: message
					}
				}]
			};
		}
		case "control_request": {
			const id = typeof message.request_id === "string" ? message.request_id : `claude-${String(Date.now())}`;
			const request = asRecord(message.request);
			const subtype = typeof request?.subtype === "string" ? request.subtype : "control_request";
			return {
				state,
				commands: [{
					kind: "frame",
					body: {
						type,
						native: message,
						events: []
					},
					agentPath
				}, {
					kind: "toApp",
					id,
					type: subtype,
					native: message
				}]
			};
		}
		case "rate_limit_event": return event({ events: [] }, {
			...state,
			limitResetsAt: claudeLimitReset(asRecord(message.rate_limit_info))
		});
		case "control_cancel_request": return event({ events: typeof message.request_id === "string" ? [{
			kind: "app_request_cancelled",
			requestId: message.request_id
		}] : [] });
		default: return event({ events: [] });
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/session.js
init_input_images();
init_held_input();
init_json();
init_session_credentials();
const claudeSession = withSessionCredentials(async (installation, options, credentials) => {
	if (installation.via !== "executable") throw new Error("The claude session adapter needs an executable installation");
	const sessionId = options.resume ?? randomUUID();
	const child = await launchClaude(installation.command, sessionId, options);
	const kernel = credentials.kernel(sessionId);
	const state = {
		child,
		active: null,
		spontaneous: false,
		projection: options.resume === void 0 ? initialClaudeProjection : resumedClaudeProjection,
		disposed: false
	};
	const writtenQueues = /* @__PURE__ */ new Map();
	const heldQueue = [];
	const busy = () => state.active !== null || state.spontaneous;
	let canCancelQueued = false;
	const abortFallback = createAbortFallback(() => {
		child.kill();
	});
	const pendingInterrupts = /* @__PURE__ */ new Map();
	let disposeRequest = null;
	const readback = claudeOpenSettings(child);
	const contextBreakdown = claudeContextBreakdownReader(child);
	child.onLine((line) => {
		const message = asRecord(parseJson(line));
		if (message === null) return;
		if (message.type === "system" && message.subtype === "init" && typeof message.parent_tool_use_id !== "string" && Array.isArray(message.capabilities)) canCancelQueued = message.capabilities.includes("interrupt_cancel_queued_v1");
		if (readback.consume(message) || contextBreakdown.consume(message)) return;
		const { state: nextProjection, commands } = foldClaudeStdout(state.projection, message);
		state.projection = nextProjection;
		if (message.type === "command_lifecycle" && message.state === "queued" && typeof message.command_uuid === "string") {
			const queued = writtenQueues.get(message.command_uuid);
			if (queued !== void 0 && state.active === null) state.active = queued;
		}
		if (message.type === "command_lifecycle" && (message.state === "completed" || message.state === "cancelled") && typeof message.command_uuid === "string") writtenQueues.delete(message.command_uuid);
		if (message.type === "command_lifecycle" && message.state === "started" && state.active !== null && "inputId" in state.active.body && message.command_uuid === state.active.body.inputId) state.spontaneous = false;
		let ended = false;
		let dropped = false;
		for (const command of commands) switch (command.kind) {
			case "frame": {
				if (command.agentPath.length === 0 && command.body.events.some((event) => event.kind === "turn_active" && event.inputId === void 0)) state.spontaneous = true;
				if (kernel.frame(command.body, { agentPath: command.agentPath }).agentPath.length > 0) break;
				ended ||= command.body.events.some((event) => event.kind === "turn_ended");
				const cancelled = command.body.events.find((event) => event.kind === "input_dropped");
				dropped ||= cancelled !== void 0;
				if (cancelled?.kind === "input_dropped") writtenQueues.delete(cancelled.inputId);
				if (cancelled?.kind === "input_dropped" && state.active !== null && "inputId" in state.active.body && cancelled.inputId === state.active.body.inputId) state.active = null;
				break;
			}
			case "respond": {
				const refused = pendingInterrupts.get(command.requestId);
				if (refused !== void 0) {
					pendingInterrupts.delete(command.requestId);
					if (command.body.kind === "rejected") refused();
					kernel.respond(command.requestId, command.body);
				} else kernel.frame({
					type: "control_response",
					native: message,
					events: []
				});
				break;
			}
			case "toApp":
				kernel.request("toApp", {
					kind: "native",
					type: command.type,
					native: command.native
				}, { id: command.id });
				break;
			default: break;
		}
		if (ended || dropped && !busy()) {
			abortFallback.clear();
			if (state.projection.pendingInputId === null) state.active = null;
			state.spontaneous = false;
			if (!state.disposed && !busy()) {
				const next = heldQueue.shift();
				if (next !== void 0) {
					if (next.inputId !== void 0) writtenQueues.set(next.inputId, next.request);
					state.projection = claudePrompted(state.projection, next.inputId, false);
					child.write(claudeUserMessage(next.input, next.inputId, next.images));
				}
			}
		}
	});
	child.onExit((code) => {
		abortFallback.clear();
		kernel.respond(disposeRequest?.id ?? "", {
			kind: "exited",
			code
		});
		state.active = null;
		state.spontaneous = false;
		for (const requestId of pendingInterrupts.keys()) {
			pendingInterrupts.delete(requestId);
			kernel.respond(requestId, {
				kind: "rejected",
				code: "runtime_exited",
				reason: "runtime exited"
			});
		}
		readback.exited(code);
		contextBreakdown.exited();
	});
	await readback.confirm(options);
	if (options.resume !== void 0) state.projection = claudeUsageBaselined(state.projection, await readback.usageBaseline());
	let interruptCounter = 0;
	const capabilities = {
		queue: { durable: false },
		attribution: "attributed",
		images: true
	};
	return credentials.seal({
		id: kernel.sessionId,
		capabilities,
		prompt: async (input, inputOptions) => {
			const body = {
				kind: "prompt",
				input,
				...inputOptions
			};
			return await kernel.control(body, (request) => {
				if (busy()) return {
					kind: "rejected",
					code: "busy",
					reason: "busy"
				};
				return withInputImages(capabilities, inputOptions?.images, (images) => {
					state.active = request;
					state.projection = claudePrompted(state.projection, inputOptions?.inputId);
					child.write(claudeUserMessage(input, inputOptions?.inputId, images));
					return { kind: "accepted" };
				});
			});
		},
		steer: async (input, inputOptions) => {
			return await kernel.control({
				kind: "steer",
				input,
				...inputOptions
			}, () => {
				if (!busy()) return {
					kind: "rejected",
					code: "no_active_turn",
					reason: "not_steerable: no active turn"
				};
				return withInputImages(capabilities, inputOptions?.images, (images) => {
					child.write(claudeUserMessage(input, inputOptions?.inputId, images));
					return { kind: "accepted" };
				});
			});
		},
		queue: async (input, inputOptions) => {
			return await kernel.control({
				kind: "queue",
				input,
				...inputOptions
			}, (request) => withInputImages(capabilities, inputOptions?.images, (images) => {
				if (busy()) heldQueue.push({
					request,
					input,
					...inputOptions?.inputId === void 0 ? {} : { inputId: inputOptions.inputId },
					images
				});
				else {
					if (inputOptions?.inputId !== void 0) writtenQueues.set(inputOptions.inputId, request);
					state.projection = claudePrompted(state.projection, inputOptions?.inputId, false);
					child.write(claudeUserMessage(input, inputOptions?.inputId, images));
				}
				return { kind: "accepted" };
			}));
		},
		withdraw: withdrawControl(kernel, heldQueue),
		abort: async () => {
			interruptCounter += 1;
			const requestId = `interrupt-${interruptCounter}`;
			const blocked = kernel.unreachable();
			const request = kernel.request("toRuntime", { kind: "abort" }, { id: requestId });
			if (blocked !== null || !busy() && !(canCancelQueued && state.projection.unstartedInputs.size > 0)) return {
				request,
				response: kernel.respond(request.id, blocked ?? {
					kind: "rejected",
					code: "no_active_turn",
					reason: "no active turn"
				})
			};
			state.projection = claudeAbortRequested(state.projection);
			const { promise, resolve } = Promise.withResolvers();
			const unsubscribe = kernel.rawEvents((record) => {
				if (record.kind === "response" && record.requestId === requestId) resolve({
					request,
					response: record
				});
			});
			pendingInterrupts.set(requestId, () => {});
			const refuse = abortFallback.arm(() => {
				if (pendingInterrupts.delete(requestId)) kernel.respond(requestId, { kind: "accepted" });
			});
			if (pendingInterrupts.has(requestId)) pendingInterrupts.set(requestId, refuse);
			child.write(`${JSON.stringify({
				type: "control_request",
				request_id: requestId,
				request: {
					subtype: "interrupt",
					...canCancelQueued && state.projection.unstartedInputs.size > 0 ? { cancel_queued: true } : {}
				}
			})}\n`);
			const result = await promise;
			unsubscribe();
			return result;
		},
		rawEvents: (observer, cursor) => kernel.rawEvents(observer, cursor),
		records: () => kernel.records(),
		graph: () => kernel.graph(),
		resources: child.resources,
		contextBreakdown: contextBreakdown.read,
		dispose: async () => {
			if (state.disposed) return;
			state.disposed = true;
			contextBreakdown.exited();
			const gone = kernel.unreachable() !== null;
			disposeRequest = kernel.request("toRuntime", { kind: "dispose" });
			if (gone) {
				kernel.respond(disposeRequest.id, { kind: "accepted" });
				return;
			}
			child.kill();
			await child.exited;
		}
	});
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/claude/index.js
const claudeRuntime = defineRuntime({
	id: "claude",
	brand: runtimeBrands.claude,
	skills: claudeSkills,
	commands: claudeCommands,
	mcpServers: claudeMcpServers,
	tools: claudeTools,
	mcpToolsListChanged: "additions",
	installation: claudeInstallation,
	installPlan: claudeInstallPlan,
	install: claudeInstall,
	accountUsage: claudeAccountUsage,
	listModels: claudeListModels,
	checkUpdate: claudeCheckUpdate,
	upgrade: claudeUpgrade,
	login: claudeLogin,
	logout: claudeLogout,
	authStatus: claudeAuthStatus,
	session: claudeSession
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/home-initialization.js
const initializing = /* @__PURE__ */ new Map();
const initialized = /* @__PURE__ */ new Map();
function homePath(env, cwd) {
	const userHome = process.platform === "win32" ? homedir() : env.HOME;
	const fallback = path.join(userHome === void 0 || userHome === "" ? homedir() : userHome, ".codex");
	const configured = env.CODEX_HOME;
	const directory = path.resolve(cwd, configured === void 0 || configured === "" ? fallback : configured);
	try {
		return realpathSync(directory);
	} catch {
		return directory;
	}
}
function identity(home) {
	try {
		const stat = statSync(home);
		return stat.isDirectory() ? `${String(stat.dev)}:${String(stat.ino)}:${String(stat.birthtimeMs)}` : null;
	} catch {
		return null;
	}
}
/** A queued reader's existing deadline can cancel it before any process starts. */
function queuedClient(state, start) {
	const ready = Promise.withResolvers();
	const subscriptions = [];
	const exitHandlers = [];
	let actual = null;
	let cancelled = false;
	let handled = false;
	async function spawned() {
		await (await ready.promise).spawned;
	}
	async function exited() {
		try {
			return await (await ready.promise).exited;
		} catch {
			return null;
		}
	}
	const spawn = spawned();
	spawn.catch(() => {});
	const exit = exited();
	const begin = () => {
		if (cancelled) return;
		try {
			actual = start();
			for (const subscribe of subscriptions.splice(0)) subscribe(actual);
			exitHandlers.length = 0;
			ready.resolve(actual);
		} catch (error) {
			ready.reject(error);
			for (const handler of exitHandlers.splice(0)) handler(null);
		}
	};
	state.waiting.add(begin);
	const subscribe = (callback) => {
		if (actual !== null) callback(actual);
		else if (!cancelled) subscriptions.push(callback);
	};
	return {
		spawned: spawn,
		exited: exit,
		async request(method, params, onSettled) {
			let client = null;
			try {
				client = await ready.promise;
			} catch (error) {
				const failure = error instanceof Error ? error : new Error(String(error));
				onSettled?.({
					kind: "error",
					error: failure
				});
				throw failure;
			}
			return client.request(method, params, onSettled);
		},
		notify(method, params) {
			subscribe((client) => {
				client.notify(method, params);
			});
		},
		handle(handlers) {
			if (handled) throw new Error("app-server handlers are already registered");
			handled = true;
			subscribe((client) => {
				client.handle(handlers);
			});
		},
		mark(callback) {
			subscribe((client) => {
				client.mark(callback);
			});
		},
		onExit(handler) {
			if (cancelled) {
				queueMicrotask(() => {
					handler(null);
				});
				return;
			}
			if (actual === null) exitHandlers.push(handler);
			subscribe((client) => {
				client.onExit(handler);
			});
		},
		kill() {
			if (actual !== null) {
				actual.kill();
				return;
			}
			if (cancelled) return;
			cancelled = true;
			state.waiting.delete(begin);
			subscriptions.length = 0;
			ready.reject(/* @__PURE__ */ new Error("Codex app-server startup cancelled before spawn"));
			for (const handler of exitHandlers.splice(0)) handler(null);
		},
		resources: async () => {
			return actual === null ? null : await actual.resources();
		}
	};
}
/** Coordinate first initialization among this module's app-server clients only. */
function coordinateHomeInitialization(env, cwd, create) {
	const home = homePath(env, cwd);
	const active = initializing.get(home);
	if (active !== void 0) return queuedClient(active, () => coordinateHomeInitialization(env, cwd, create));
	const current = identity(home);
	if (current !== null && initialized.get(home) === current) return create();
	initialized.delete(home);
	const state = { waiting: /* @__PURE__ */ new Set() };
	initializing.set(home, state);
	let released = false;
	const release = (success) => {
		if (released) return;
		released = true;
		const observed = success ? identity(home) : null;
		if (observed !== null) initialized.set(home, observed);
		initializing.delete(home);
		for (const begin of state.waiting) begin();
		state.waiting.clear();
	};
	const createOwner = () => {
		try {
			return create();
		} catch (error) {
			release(false);
			throw error;
		}
	};
	const client = createOwner();
	client.onExit(() => {
		release(false);
	});
	let accepted = false;
	return {
		...client,
		async request(method, params, onSettled) {
			try {
				return await client.request(method, params, (outcome) => {
					if (method === "initialize" && outcome.kind === "result") accepted = true;
					onSettled?.(outcome);
				});
			} catch (error) {
				if (method === "initialize") {
					client.kill();
					await client.exited;
					release(false);
				}
				throw error;
			}
		},
		notify(method, params) {
			client.notify(method, params);
			if (method === "initialized" && accepted) release(true);
		}
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/app-server-client.js
init_environment();
init_executable();
init_diagnostics();
init_json();
init_native_error();
function startAppServerClient(command, env, configOverrides = {}, cwd, processOptions = {}) {
	const environment = sessionEnvironment(env);
	const directory = cwd ?? process.cwd();
	return coordinateHomeInitialization(environment, directory, () => createAppServerClient(command, environment, configOverrides, directory, processOptions));
}
function createAppServerClient(command, env, configOverrides, cwd, processOptions) {
	const overrideArgs = Object.entries(configOverrides).flatMap(([key, value]) => ["-c", `${key}=${value}`]);
	const { launchArgs = [], ...lineOptions } = processOptions;
	const child = spawnLineProcess(command, [
		"app-server",
		...overrideArgs,
		...launchArgs,
		"--listen",
		"stdio://"
	], {
		cwd,
		env,
		killTree: true,
		...lineOptions
	});
	child.spawned.catch(() => {});
	const pending = /* @__PURE__ */ new Map();
	const held = [];
	let handlers = null;
	const deliver = (delivery) => {
		if (handlers === null) held.push(delivery);
		else delivery(handlers);
	};
	let nextId = 1;
	let exitFailure = null;
	const redact = processOptions.redact ?? ((text) => text);
	child.onLine((line) => {
		const message = asRecord(parseJson(line));
		if (message === null) return;
		const hasId = typeof message.id === "number" || typeof message.id === "string";
		if (typeof message.method === "string") {
			const params = asRecord(message.params) ?? {};
			const { method } = message;
			if (hasId) {
				const id = String(message.id);
				deliver((target) => {
					target.onServerRequest(id, method, params);
				});
			} else deliver((target) => {
				target.onNotification(method, params);
			});
			return;
		}
		if (typeof message.id === "number" && pending.has(message.id)) {
			const waiter = pending.get(message.id);
			if (waiter === void 0) return;
			pending.delete(message.id);
			const error = asRecord(message.error);
			if (error !== null) {
				const cause = nativeErrorCause(waiter.method, error, redact);
				const failure = new Error(redact(typeof error.message === "string" ? error.message : "app-server error"), { cause });
				waiter.settled({
					kind: "error",
					error: failure,
					native: cause.native
				});
				waiter.reject(failure);
			} else {
				const result = asRecord(message.result) ?? {};
				waiter.settled({
					kind: "result",
					result
				});
				waiter.resolve(result);
			}
		}
	});
	child.onExit(() => {
		const diagnostics = child.diagnostics();
		exitFailure = processFailure("app-server exited", {
			...diagnostics,
			stderr: redact(diagnostics.stderr),
			...diagnostics.error === void 0 ? {} : { error: {
				...diagnostics.error,
				message: redact(diagnostics.error.message)
			} }
		});
		for (const waiter of pending.values()) {
			const error = exitFailure;
			waiter.settled({
				kind: "exited",
				error
			});
			waiter.reject(error);
		}
	});
	return {
		spawned: child.spawned,
		exited: child.exited,
		async request(method, params, onSettled) {
			const settled = onSettled ?? (() => {});
			if (exitFailure !== null) {
				const error = exitFailure;
				settled({
					kind: "exited",
					error
				});
				throw error;
			}
			const id = nextId;
			nextId += 1;
			return await new Promise((resolve, reject) => {
				pending.set(id, {
					method,
					resolve,
					reject,
					settled
				});
				child.write(`${JSON.stringify({
					id,
					method,
					params
				})}\n`);
			});
		},
		notify(method, params) {
			child.write(`${JSON.stringify({
				method,
				params
			})}\n`);
		},
		handle(registered) {
			if (handlers !== null) throw new Error("app-server handlers are already registered");
			handlers = registered;
			for (const delivery of held.splice(0)) delivery(registered);
		},
		mark(callback) {
			deliver(() => {
				callback();
			});
		},
		onExit(handler) {
			child.onExit(handler);
		},
		kill() {
			child.kill();
		},
		resources: child.resources
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/inventory.js
init_json();
function projectCodexSkills(payload) {
	return nativeRows(payload.data).flatMap((entry) => nativeRows(entry.skills).map((skill) => ({
		name: named(skill),
		...textField("description", skill.description),
		...textField("path", skill.path),
		...textField("source", skill.scope),
		...boolField("enabled", skill.enabled)
	})));
}
function projectCodexServers(servers) {
	return servers.map((server) => ({
		id: named(server),
		name: named(server),
		...textField("status", server.runtimeStatus),
		...textField("authStatus", server.authStatus),
		...asRecord(server.tools) === null ? {} : { toolCount: Object.keys(asRecord(server.tools) ?? {}).length },
		...server.toolsError === null || server.toolsError === void 0 ? {} : { error: "Native tool discovery failed" }
	}));
}
function projectCodexTools(servers) {
	return servers.flatMap((server) => Object.values(asRecord(server.tools) ?? {}).map((value) => {
		const tool = asRecord(value) ?? {};
		const schema = asRecord(tool.inputSchema);
		return {
			name: named(tool),
			mcpServerId: named(server),
			source: "mcp",
			...textField("description", tool.description),
			...schema === null ? {} : { inputSchema: schema }
		};
	}));
}
async function serversOf(request) {
	const servers = [];
	const seen = /* @__PURE__ */ new Set();
	let cursor = null;
	while (seen.size <= 100) {
		const page = await request("mcpServerStatus/list", {
			detail: "full",
			limit: 100,
			cursor
		});
		servers.push(...nativeRows(page.data));
		if (page.nextCursor === null) return servers;
		if (typeof page.nextCursor !== "string" || seen.has(page.nextCursor) || seen.size >= 100) throw new Error("Invalid MCP pagination");
		cursor = page.nextCursor;
		seen.add(cursor);
	}
	throw new Error("MCP pagination exceeded limit");
}
async function readCodexSkills(request, scope, cwd) {
	const result = await request("skills/list", { cwds: [cwd] });
	const partial = nativeRows(result.data).some((entry) => Array.isArray(entry.errors) && entry.errors.length > 0);
	return inventoryOk(scope, "discovered", projectCodexSkills(result), partial);
}
function reader$2(read) {
	return async (installation, options = {}) => {
		if (installation.via !== "executable") return unsupportedInventory("installation_unsupported", "Codex inventory requires an executable");
		const scope = workspaceScope(options);
		const client = startAppServerClient(installation.command, void 0, {}, scope.cwd);
		client.handle({
			onNotification: () => {},
			onServerRequest: () => {}
		});
		try {
			return await inventoryRead(async () => {
				await client.spawned;
				await client.request("initialize", {
					clientInfo: {
						name: "oar-inventory",
						version: "0.0.0"
					},
					capabilities: { experimentalApi: true }
				});
				client.notify("initialized", {});
				return read(async (method, params) => {
					return await client.request(method, params);
				}, scope, scope.cwd);
			}, options.timeoutMs);
		} finally {
			client.kill();
			await client.exited;
		}
	};
}
const codexSkills = reader$2(readCodexSkills);
const codexMcpServers = reader$2(async (request, scope) => {
	const servers = await serversOf(request);
	return inventoryOk(scope, "discovered", projectCodexServers(servers), servers.some((server) => server.toolsError !== null && server.toolsError !== void 0));
});
const codexTools = reader$2(async (request, scope) => {
	const servers = await serversOf(request);
	return inventoryOk(scope, "mcp-only", projectCodexTools(servers), servers.some((server) => server.toolsError !== null && server.toolsError !== void 0));
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/login.js
init_executable();
init_json();
const DEVICE_CODE_FLOOR = "0.118.0";
/** Past the code's 15 minutes, so codex reports the expiry itself. */
const LOGIN_TIMEOUT_MS = 16 * 6e4;
const STATUS_TIMEOUT_MS = 2e4;
const STATUS_SOURCE = "codex login status";
const DEVICE_CODE_SETTING = "Device code sign-in must be allowed in your ChatGPT security settings (for a workspace account, by its admin).";
function text$9(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
/**
* `codex login status` prints to stderr and exits 0 when logged in
* (`Logged in using ChatGPT`, or `Logged in using an API key - <masked>`),
* 1 with `Not logged in` when logged out, and 1 with another message when
* it cannot tell (an unreadable configuration or credential store).
*/
function projectCodexLoginStatus(exitCode, output) {
	if (exitCode === 0) {
		const method = /Logged in using ChatGPT/u.test(output) ? "chatgpt" : /Logged in using an API key/u.test(output) ? "apiKey" : void 0;
		return {
			kind: "logged_in",
			...method === void 0 ? {} : { account: { method } },
			source: STATUS_SOURCE
		};
	}
	if (exitCode === 1 && /^Not logged in\b/mu.test(output)) return {
		kind: "logged_out",
		source: STATUS_SOURCE
	};
	const line = output.trim().split(/\r?\n/u).at(-1) ?? "";
	return {
		kind: "unknown",
		detail: new LoginSecrets().redact(line === "" ? `exit ${String(exitCode)}` : line),
		source: STATUS_SOURCE
	};
}
async function codexAuthStatus(installation, options = {}) {
	if (installation.via !== "executable") return {
		kind: "unknown",
		detail: "not a machine-installed executable"
	};
	const result = await runExecutable(installation.command, ["login", "status"], { timeoutMs: options.timeoutMs ?? STATUS_TIMEOUT_MS });
	return projectCodexLoginStatus(result.ok ? 0 : result.exitCode, `${result.stdout}\n${result.stderr}`);
}
/** `account/read` after the sign-in; null when codex reports no account. */
function projectCodexAccount(result) {
	const account = asRecord(asRecord(result)?.account);
	if (account === null) return null;
	const email = text$9(account.email);
	const plan = text$9(account.planType);
	const method = text$9(account.type);
	return {
		...email === void 0 ? {} : { email },
		...plan === void 0 ? {} : { plan },
		...method === void 0 ? {} : { method }
	};
}
/** `account/read` on the same app-server, bounded by the status deadline and the caller's abort; undefined when it gave no answer. */
async function readAccount(client, signal) {
	if (signal?.aborted === true) return;
	const bounds = loginBounds(signal, STATUS_TIMEOUT_MS);
	try {
		return await Promise.race([client.request("account/read", {}).catch(() => void 0), bounds.stopped.then(() => void 0)]);
	} finally {
		bounds.dispose();
	}
}
/** After codex reported success: logged in, with the account when `account/read` names one. */
async function confirmed(client, signal) {
	const read = await readAccount(client, signal);
	if (read === void 0) return { kind: "logged_in" };
	const account = projectCodexAccount(read);
	return account === null ? {
		kind: "failed",
		reason: "not_logged_in",
		detail: "codex reported success, yet account/read shows no account"
	} : {
		kind: "logged_in",
		...Object.keys(account).length === 0 ? {} : { account }
	};
}
function exitDetail(code) {
	return `codex app-server exited${code === null || code === void 0 ? "" : ` with code ${String(code)}`}`;
}
async function runCodexLogin(command, interaction, timeoutMs) {
	const secrets = new LoginSecrets();
	let client = null;
	try {
		client = startAppServerClient(command, void 0, {}, void 0, {
			inheritStderr: false,
			killTree: true
		});
	} catch (error) {
		return {
			kind: "failed",
			reason: "process_failed",
			detail: secrets.line(errorMessage(error))
		};
	}
	const app = client;
	const completion = Promise.withResolvers();
	const flow = {
		loginId: void 0,
		early: [],
		exitCode: void 0,
		settled: false,
		confirmation: void 0
	};
	const ours = (params) => {
		const id = params.loginId;
		return id === void 0 || id === null || id === flow.loginId;
	};
	const complete = (params) => {
		if (params.success === true) flow.confirmation ??= confirmed(app, interaction.signal);
		completion.resolve({
			kind: "completed",
			params
		});
	};
	app.onExit((code) => {
		flow.exitCode = code;
		completion.resolve({
			kind: "exited",
			code
		});
	});
	app.handle({
		onNotification(method, params) {
			if (method !== "account/login/completed") return;
			if (flow.loginId === void 0) flow.early.push(params);
			else if (ours(params)) complete(params);
		},
		onServerRequest() {}
	});
	const run = async () => {
		try {
			await app.spawned;
		} catch (error) {
			return {
				kind: "failed",
				reason: "process_failed",
				detail: secrets.line(errorMessage(error))
			};
		}
		try {
			await app.request("initialize", {
				clientInfo: {
					name: "oar",
					version: "0.0.0"
				},
				capabilities: { experimentalApi: true }
			});
			app.notify("initialized", {});
			const started = await app.request("account/login/start", { type: "chatgptDeviceCode" }, (outcome) => {
				if (outcome.kind === "result") {
					flow.loginId = text$9(outcome.result.loginId);
					for (const params of flow.early.splice(0)) if (ours(params)) complete(params);
				}
			});
			const verificationUri = text$9(started.verificationUrl);
			const userCode = text$9(started.userCode);
			if (flow.loginId === void 0 || verificationUri === void 0 || userCode === void 0) return {
				kind: "failed",
				reason: "process_failed",
				detail: "codex answered account/login/start without a device code"
			};
			const early = flow.confirmation;
			if (early !== void 0) return await early;
			if (!flow.settled) try {
				interaction.onEvent({
					kind: "device_code",
					userCode,
					verificationUri
				});
				interaction.onEvent({
					kind: "info",
					message: DEVICE_CODE_SETTING
				});
			} catch (error) {
				return {
					kind: "failed",
					reason: "interaction_failed",
					detail: secrets.line(errorMessage(error))
				};
			}
			const done = await completion.promise;
			if (flow.confirmation !== void 0) return await flow.confirmation;
			if (done.kind === "exited") return {
				kind: "failed",
				reason: "process_failed",
				detail: `${exitDetail(done.code)} before the sign-in completed`
			};
			return {
				kind: "failed",
				reason: "rejected",
				detail: secrets.line(text$9(done.params.error) ?? "codex reported that the sign-in failed")
			};
		} catch (error) {
			return flow.exitCode === void 0 ? {
				kind: "failed",
				reason: "rejected",
				detail: secrets.line(errorMessage(error))
			} : {
				kind: "failed",
				reason: "process_failed",
				detail: exitDetail(flow.exitCode)
			};
		}
	};
	const bounds = loginBounds(interaction.signal, timeoutMs);
	try {
		const ending = await Promise.race([run(), bounds.stopped.then((stop) => stop)]);
		flow.settled = true;
		if (typeof ending !== "string") return ending;
		return flow.confirmation === void 0 ? stoppedResult(ending, timeoutMs) : await flow.confirmation;
	} finally {
		flow.settled = true;
		bounds.dispose();
		app.kill();
		await app.exited;
	}
}
/** Signs codex in with the app-server's ChatGPT device code flow, relaying the code and its URL. */
async function codexLogin(installation, interaction, options = {}) {
	const target = loginExecutable(installation, "codex", DEVICE_CODE_FLOOR);
	if (target.kind === "settled") return target.result;
	if (interaction.signal?.aborted === true) return { kind: "cancelled" };
	return await runCodexLogin(target.installation.command, interaction, options.timeoutMs ?? LOGIN_TIMEOUT_MS);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/logout.js
const LOGOUT_FLOOR = "0.15.0";
const LOGOUT_COMMAND = "codex logout";
/** The revoke has 10 s. */
const LOGOUT_TIMEOUT_MS = 6e4;
/** Signs codex out with `codex logout`; `codex login status` decides. */
async function codexLogout(installation, options = {}) {
	const target = loginExecutable(installation, "codex", LOGOUT_FLOOR);
	if (target.kind === "settled") return target.result;
	const timeoutMs = options.timeoutMs ?? LOGOUT_TIMEOUT_MS;
	const end = await runLogoutCommand(target.installation.command, ["logout"], process.env, timeoutMs);
	if (end.kind === "not_started") return {
		kind: "failed",
		reason: "process_failed",
		detail: end.detail
	};
	return confirmedLogout(commandLogout(end, LOGOUT_COMMAND, timeoutMs), await codexAuthStatus(installation), LOGOUT_COMMAND);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/account-usage.js
init_json();
function text$8(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= 80 ? trimmed : void 0;
}
function windowLabel(value) {
	const minutes = asNumber(value);
	if (minutes === null || minutes <= 0) return "Usage limit";
	if (minutes % 10080 === 0) {
		const weeks = minutes / 10080;
		return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
	}
	if (minutes % 1440 === 0) {
		const days = minutes / 1440;
		return `${days} ${days === 1 ? "day" : "days"}`;
	}
	if (minutes % 60 === 0) {
		const hours = minutes / 60;
		return `${hours} ${hours === 1 ? "hour" : "hours"}`;
	}
	return `${minutes} minutes`;
}
function limitLabel(bucket) {
	const name = text$8(bucket.limitName);
	if (name !== void 0) return name;
	const id = text$8(bucket.limitId);
	return id === "codex" ? "Codex" : id;
}
/**
* Mirrors Codex TUI's `app_server_rate_limit_snapshots` merge and deduplication.
* Source (2026-08-22):
* https://github.com/openai/codex/blob/4f39251a010a8bd7d692d25fb33832ff06f1635a/codex-rs/tui/src/app_server_session.rs#L2084-L2103
*/
function rateLimitBuckets(historical, indexed) {
	const primaryLimitId = text$8(historical?.limitId);
	const buckets = historical === null ? [] : [historical];
	if (indexed === null) return buckets;
	for (const [limitId, value] of Object.entries(indexed)) {
		const bucket = asRecord(value);
		if (bucket === null) continue;
		if (primaryLimitId !== void 0 && (primaryLimitId === limitId || primaryLimitId === text$8(bucket.limitId))) continue;
		buckets.push(bucket);
	}
	return buckets;
}
/**
* Native evidence comes from `codex app-server --listen stdio://`, followed by
* `initialize` and `account/rateLimits/read`. `rateLimits` is the
* backward-compatible single-bucket view; `rateLimitsByLimitId` is the
* optional multi-bucket view. A representative response is:
*
* ```json
* {
*   "rateLimits": {
*     "limitId": "codex",
*     "limitName": null,
*     "primary": { "usedPercent": 50, "windowDurationMins": 10080, "resetsAt": 1787820410 },
*     "secondary": null,
*     "planType": "pro",
*     "rateLimitReachedType": null
*   },
*   "rateLimitsByLimitId": {
*     "codex_bengalfox": {
*       "limitId": "codex_bengalfox",
*       "limitName": "GPT-5.3-Codex-Spark",
*       "primary": { "usedPercent": 0, "windowDurationMins": 300, "resetsAt": 1787322278 },
*       "secondary": { "usedPercent": 0, "windowDurationMins": 10080, "resetsAt": 1787909078 },
*       "planType": "pro"
*     },
*     "codex": {
*       "limitId": "codex",
*       "limitName": null,
*       "primary": { "usedPercent": 50, "windowDurationMins": 10080, "resetsAt": 1787820410 },
*       "secondary": null,
*       "planType": "pro",
*       "rateLimitReachedType": null
*     }
*   }
* }
* ```
*/
function projectCodexUsage(result, email) {
	const root = asRecord(result);
	const buckets = rateLimitBuckets(asRecord(root?.rateLimits), asRecord(root?.rateLimitsByLimitId));
	const windows = [];
	let rateLimited = false;
	let plan = void 0;
	for (const bucket of buckets) {
		const sourceLabel = limitLabel(bucket);
		plan ??= text$8(bucket.planType);
		rateLimited ||= bucket.rateLimitReachedType !== null && bucket.rateLimitReachedType !== void 0;
		for (const kind of ["primary", "secondary"]) {
			const candidate = asRecord(bucket[kind]);
			if (candidate === null) continue;
			const usedPercent = asNumber(candidate.usedPercent);
			if (usedPercent === null || usedPercent < 0 || usedPercent > 100) continue;
			const resetsAt = asEpochInstant(candidate.resetsAt);
			const durationLabel = windowLabel(candidate.windowDurationMins);
			const minutes = asNumber(candidate.windowDurationMins);
			const limitId = text$8(bucket.limitId);
			windows.push({
				label: sourceLabel === void 0 ? durationLabel : `${sourceLabel} · ${durationLabel}`,
				usedRatio: Number((usedPercent / 100).toFixed(6)),
				...resetsAt === null ? {} : { resetsAt },
				...limitId === void 0 ? {} : { id: `${limitId}:${kind}` },
				...minutes === null || minutes <= 0 ? {} : { durationMs: minutes * 6e4 }
			});
			rateLimited ||= usedPercent >= 100;
		}
	}
	if (windows.length === 0) throw new Error("Codex returned no usable account usage windows");
	return {
		kind: "available",
		...plan === void 0 ? {} : { plan },
		...email === void 0 ? {} : { email },
		rateLimited,
		windows
	};
}
/**
* Native evidence from `account/read` on the same app-server session:
*
* ```json
* { "account": { "type": "chatgpt", "email": "user@example.com", "planType": "pro" },
*   "requiresOpenaiAuth": true }
* ```
*
* Only a ChatGPT (subscription) login carries a meaningful account email; an
* API-key account is dropped per the owner's `type === "chatgpt"` requirement.
*/
function accountEmail(result) {
	const account = asRecord(asRecord(result)?.account);
	if (account?.type !== "chatgpt" || typeof account.email !== "string") return;
	return account.email;
}
/**
* Codex exposes ChatGPT rate-limit windows only for a ChatGPT account. API-key
* and provider-managed runtimes are valid, but have no subscription usage for
* this capability to report.
*/
function isNonSubscriptionAccount(result) {
	const root = asRecord(result);
	const account = asRecord(root?.account);
	return account?.type === "apiKey" || account?.type === "amazonBedrock" || root?.requiresOpenaiAuth === false;
}
async function readFromAppServer(command, timeoutMs, startClient = startAppServerClient) {
	const client = startClient(command);
	const deadline = setTimeout(() => {
		client.kill();
	}, timeoutMs);
	try {
		await client.request("initialize", {
			clientInfo: {
				name: "oar",
				version: "0.0.0"
			},
			capabilities: { experimentalApi: true }
		});
		client.notify("initialized", {});
		let account = void 0;
		try {
			account = await client.request("account/read", {});
		} catch {}
		if (isNonSubscriptionAccount(account)) return {
			kind: "unsupported",
			reason: "unsupported_auth_mode"
		};
		return {
			kind: "ok",
			result: await client.request("account/rateLimits/read", {}),
			email: accountEmail(account)
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (/authentication required/iu.test(message)) return {
			kind: "reauth_required",
			reason: "not_authenticated"
		};
		if (/method not found|not supported/iu.test(message)) return {
			kind: "unsupported",
			reason: "endpoint_unavailable"
		};
		return { kind: "error" };
	} finally {
		clearTimeout(deadline);
		client.kill();
	}
}
const codexAccountUsage = async (installation, options = {}) => {
	if (installation.via !== "executable") return {
		kind: "unsupported",
		reason: "unsupported_installation"
	};
	const outcome = await readFromAppServer(installation.command, options.timeoutMs ?? 8e3);
	switch (outcome.kind) {
		case "ok": return projectCodexUsage(outcome.result, outcome.email);
		case "reauth_required": return outcome;
		case "unsupported": return outcome;
		case "error": break;
	}
	throw new Error("Failed to read Codex account usage");
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/installation.js
/**
* Copies a process's PATH can miss. The macOS Desktop app bundles the Codex
* CLI instead of putting it on PATH; OpenAI relocated the app from Codex.app
* to ChatGPT.app, so the new bundle is tried before the legacy one, and
* system installs before per-user installs. Then the standalone installer's
* launcher (https://chatgpt.com/codex/install.sh: `$CODEX_INSTALL_DIR/codex`,
* by default `~/.local/bin/codex`, a link into
* `$CODEX_HOME/packages/standalone/current`), which it adds to PATH only in
* shell profiles.
*/
function codexInstalledExecutableCandidates(platform = process.platform, home = homedir(), env = process.env) {
	if (platform === "win32") return [];
	const paths = path.posix;
	const bundles = platform === "darwin" ? [
		"/Applications/ChatGPT.app/Contents/Resources/codex",
		"/Applications/Codex.app/Contents/Resources/codex",
		paths.join(home, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
		paths.join(home, "Applications", "Codex.app", "Contents", "Resources", "codex")
	] : [];
	const installDir = env.CODEX_INSTALL_DIR === void 0 || env.CODEX_INSTALL_DIR === "" ? [] : [paths.join(env.CODEX_INSTALL_DIR, "codex")];
	return [
		...bundles,
		...installDir,
		paths.join(home, ".local", "bin", "codex")
	];
}
const codexInstallation = executableInstallation("OAR_CODEX_BIN", "codex", codexInstalledExecutableCandidates, ["app-server", "--help"]);
const codexInstallPlan = scriptInstallPlan({
	source: "https://github.com/openai/codex#installing-and-running-codex-cli",
	line: "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh",
	tools: ["curl"],
	writes: () => [installDir(process.env.CODEX_INSTALL_DIR, path.join(homedir(), ".local", "bin")), installDir(process.env.CODEX_HOME, path.join(homedir(), ".codex"))],
	windows: "OpenAI documents: powershell -ExecutionPolicy ByPass -c \"irm https://chatgpt.com/codex/install.ps1 | iex\""
});
const codexInstall = planInstaller(codexInstallation, codexInstallPlan);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/list-models.js
init_effort_levels();
init_json();
init_listing_cwd();
function text$7(value) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
}
/** `model/list` is the native picker, including service tiers; `debug models` is not. */
function projectCodexModels(payload) {
	const entries = [];
	for (const model of asRecordList(asRecord(payload)?.data)) {
		const id = text$7(model.model);
		if (id === void 0 || model.hidden === true) continue;
		const displayName = text$7(model.displayName);
		const effortLevels = effortLevelsOf(Array.isArray(model.supportedReasoningEfforts) ? asRecordList(model.supportedReasoningEfforts).map((level) => level.reasoningEffort) : void 0);
		const defaultEffort = text$7(model.defaultReasoningEffort);
		const serviceTiers = Array.isArray(model.serviceTiers) ? [...new Set(asRecordList(model.serviceTiers).flatMap((tier) => text$7(tier.id) ?? []))] : void 0;
		const defaultServiceTier = text$7(model.defaultServiceTier);
		entries.push({
			id,
			...displayName === void 0 ? {} : { displayName },
			...effortLevels === void 0 ? {} : { effortLevels },
			...defaultEffort === void 0 ? {} : { defaultEffort },
			...serviceTiers === void 0 ? {} : { serviceTiers },
			...defaultServiceTier === void 0 ? {} : { defaultServiceTier },
			...model.isDefault === true ? { default: true } : {}
		});
	}
	return entries;
}
/**
* The model a session with no `model` runs on (#347): the one codex's own
* configuration sets (`config/read`, user and project config for the
* listing's cwd) when it is listed, else the catalog's `isDefault`. A
* configured model that is not listed marks nothing.
*/
function codexDefaultModel(models, configured) {
	if (configured === void 0) return [...models];
	const listed = models.some((model) => model.id === configured);
	return models.map((model) => {
		const { default: _catalog, ...rest } = model;
		return listed && model.id === configured ? {
			...rest,
			default: true
		} : rest;
	});
}
const codexListModels = async (installation, options = {}) => {
	if (installation.via !== "executable") return {
		kind: "unsupported",
		reason: "codex model listing requires the codex executable"
	};
	const cwd = listingCwd(options);
	const client = startAppServerClient(installation.command);
	const timeoutMs = options.timeoutMs ?? 15e3;
	const deadline = { timedOut: false };
	const timer = setTimeout(() => {
		deadline.timedOut = true;
		client.kill();
	}, timeoutMs);
	try {
		await client.spawned;
		client.handle({
			onNotification: () => {},
			onServerRequest: () => {}
		});
		await client.request("initialize", {
			clientInfo: {
				name: "oar-models",
				version: "0"
			},
			capabilities: { experimentalApi: true }
		});
		client.notify("initialized", {});
		const models = [];
		const cursors = /* @__PURE__ */ new Set();
		let cursor = null;
		do {
			const page = await client.request("model/list", cursor === null ? {} : { cursor });
			if (!Array.isArray(page.data)) throw new TypeError("codex model/list returned no data array");
			models.push(...projectCodexModels(page));
			cursor = text$7(page.nextCursor) ?? null;
			if (cursor !== null && cursors.has(cursor)) throw new Error("codex model/list repeated a pagination cursor");
			if (cursor !== null) cursors.add(cursor);
		} while (cursor !== null);
		return {
			kind: "ok",
			models: codexDefaultModel(models, text$7(asRecord((await client.request("config/read", {
				cwd,
				includeLayers: false
			})).config)?.model))
		};
	} catch (error) {
		throw new Error(deadline.timedOut ? `Failed to list Codex models: timed out after ${String(timeoutMs)} ms` : "Failed to list Codex models", { cause: error });
	} finally {
		clearTimeout(timer);
		client.kill();
		await client.exited;
	}
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/update.js
init_json();
const SOURCE$1 = "codex doctor --json";
/**
* Codex's own check is the `updates.status` row of `codex doctor --json`
* (codex 0.158.0): `latest version` and a `latest version status` verdict.
* doctor exits 1 whenever any other row fails (no login, for one), so the
* JSON decides, not the exit code. Its `update action` is `manual or unknown`
* for a copy `codex update` cannot update (a copied binary, an app bundle).
*/
function projectCodexUpdateStatus(installed, doctor) {
	const details = asRecord(asRecord(asRecord(asRecord(doctor)?.checks)?.["updates.status"])?.details);
	const latest = details?.["latest version"];
	if (typeof latest !== "string") return {
		kind: "unavailable",
		reason: "lookup_failed",
		detail: "codex doctor --json reports no latest version",
		source: SOURCE$1
	};
	if (details?.["update action"] === "manual or unknown") return {
		kind: "unavailable",
		reason: "unmanaged_installation",
		detail: "codex update cannot update this copy",
		source: SOURCE$1
	};
	const check = comparedCheck(installed, latest, SOURCE$1);
	const status = details?.["latest version status"];
	if (check.kind !== "ok" || typeof status !== "string") return check;
	if (status.includes("newer version is available")) return {
		...check,
		updateAvailable: true
	};
	return status.includes("not older") ? {
		...check,
		updateAvailable: false
	} : check;
}
async function codexCheckUpdate(installation, options = {}) {
	const update = executableUpdate(installation);
	if (update.kind === "unavailable") return update.check;
	const { json } = await runCheckCommand(update.installation.command, ["doctor", "--json"], options.timeoutMs ?? 2e4);
	if (json === void 0) return {
		kind: "unavailable",
		reason: "lookup_failed",
		detail: "codex doctor --json printed no JSON",
		source: SOURCE$1
	};
	return projectCodexUpdateStatus(update.installed, json);
}
/** `codex update` never checks and reports success even when its download failed, hence the version read-back. */
async function codexUpgrade(installation, options) {
	return await upgradeExecutable(installation, {
		check: codexCheckUpdate,
		args: ["update"]
	}, options);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/input-delivery.js
init_json();
/** Called synchronously at the accepted steer RPC reply, before subsequent notifications. */
function acceptCodexSteer(inputs, turnId, inputId) {
	const turn = inputs.get(turnId) ?? {
		steers: /* @__PURE__ */ new Set(),
		echoed: /* @__PURE__ */ new Set()
	};
	if (turn.echoed.has(inputId)) return inputs;
	return new Map(inputs).set(turnId, {
		...turn,
		steers: new Set([...turn.steers, inputId])
	});
}
/**
* Root-thread native evidence only. Codex clears pending steering on abort;
* its TUI restores precisely the unacknowledged steers at interrupted completion.
* Source and native probe: docs/runtimes/codex.md, "Interrupted input".
*/
function foldCodexInputs(inputs, method, params) {
	const turnId = typeof params.turnId === "string" ? params.turnId : asRecord(params.turn)?.id;
	if (typeof turnId !== "string") return {
		inputs,
		events: []
	};
	const next = new Map(inputs);
	const item = asRecord(params.item);
	if (method === "item/started" && item?.type === "userMessage" && typeof item.clientId === "string") {
		const turn = inputs.get(turnId) ?? {
			steers: /* @__PURE__ */ new Set(),
			echoed: /* @__PURE__ */ new Set()
		};
		const steers = new Set(turn.steers);
		steers.delete(item.clientId);
		next.set(turnId, {
			steers,
			echoed: new Set([...turn.echoed, item.clientId])
		});
	} else if (method === "turn/completed") {
		const pending = asRecord(params.turn)?.status === "interrupted" ? inputs.get(turnId)?.steers ?? [] : [];
		next.delete(turnId);
		return {
			inputs: next,
			events: [...pending].map((inputId) => ({
				kind: "input_dropped",
				inputId,
				reason: "turn_interrupted"
			}))
		};
	}
	return {
		inputs: next,
		events: []
	};
}
/** Text followed by each local image, matching Codex's composer. */
function codexUserInput(input, images = []) {
	return [...input === "" ? [] : [{
		type: "text",
		text: input
	}], ...images.map((image) => ({
		type: "localImage",
		path: image.path
	}))];
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/tool-denials.js
init_errors$1();
init_json();
init_mcp_servers$1();
/** No builtin deny channel in app-server. MCP names must identify a server
* and its native tool; the server is resolved against effective config. */
function validateCodexToolDenials(options) {
	const unsupported = (options.disallowedTools ?? []).filter((name) => !/^mcp__[\w]+__.+$/u.test(name));
	if (unsupported.length > 0) throw new UnsupportedOptionError("disallowedTools", `codex only filters MCP tools qualified as mcp__server__tool; built-in or unqualified names have no native deny channel: ${JSON.stringify(unsupported)}`);
}
/** Keep existing native denies, emit only per-server disabled_tools overrides.
* No credentials or other user configuration from config/read are copied. */
function codexToolDenialsConfig(options, effective) {
	validateCodexToolDenials(options);
	const configured = asRecord(effective.mcp_servers) ?? {};
	const servers = [...new Set([...Object.keys(configured), ...(options.mcpServers ?? []).map((server) => server.name)])];
	const groups = /* @__PURE__ */ new Map();
	const unsupported = [];
	for (const name of options.disallowedTools ?? []) {
		const matching = servers.filter((server) => /^\w+$/u.test(server) && name.startsWith(`mcp__${server}__`));
		const server = matching.length === 1 ? matching[0] : void 0;
		if (server === void 0) {
			unsupported.push(name);
			continue;
		}
		const tool = name.slice(`mcp__${server}__`.length);
		if (tool.length === 0) {
			unsupported.push(name);
			continue;
		}
		if (RESERVED_MCP_SERVER_NAMES.has(server)) throw new UnsupportedOptionError("disallowedTools", `codex cannot disable tools of the MCP server ${JSON.stringify(server)}: the name is reserved and the denial would be dropped`);
		const tools = groups.get(server) ?? [];
		tools.push(tool);
		groups.set(server, tools);
	}
	if (unsupported.length > 0) throw new UnsupportedOptionError("disallowedTools", `codex cannot identify one configured MCP server with an unmodified native namespace for: ${JSON.stringify(unsupported)}`);
	return Object.fromEntries([...groups].map(([server, names]) => {
		const prior = asRecord(configured[server])?.disabled_tools;
		if (prior !== void 0 && prior !== null && (!Array.isArray(prior) || prior.some((name) => typeof name !== "string"))) throw new UnsupportedOptionError("disallowedTools", `codex cannot preserve the existing disabled_tools for server ${JSON.stringify(server)} while disabling ${JSON.stringify(names)}`);
		const previous = Array.isArray(prior) ? prior.filter((name) => typeof name === "string") : [];
		return [server, { disabled_tools: [...new Set([...previous, ...names])] }];
	}));
}
/** Add denials without dropping session MCP launch configuration. */
function withCodexToolDenials(params, denials) {
	const config = asRecord(params.config) ?? {};
	const servers = { ...asRecord(config.mcp_servers) };
	for (const [server, denied] of Object.entries(denials)) servers[server] = {
		...asRecord(servers[server]),
		...asRecord(denied)
	};
	return {
		...params,
		config: {
			...config,
			mcp_servers: servers
		}
	};
}
/** Resolve session filters before thread creation; release the process on refusal. */
async function prepareCodexToolDenials(client, options, params) {
	if ((options.disallowedTools?.length ?? 0) === 0) return params;
	try {
		return withCodexToolDenials(params, codexToolDenialsConfig(options, asRecord((await client.request("config/read", {
			cwd: options.cwd,
			includeLayers: false
		})).config) ?? {}));
	} catch (error) {
		client.kill();
		await client.exited;
		throw error;
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/open.js
init_credential_redactor();
init_additional_directories$1();
init_json();
init_mcp_servers$1();
init_session_options();
/** The names codex starts an MCP server under; any other fails that server's startup after the thread opened ([env] 0.160.1). */
const CODEX_MCP_SERVER_NAME = /^[\w:@/.-]+$/u;
/**
* SessionOptions.mcpServers as codex's `mcp_servers` config table, one
* entry per server: stdio `{command, args, env}`, http `{url, http_headers}`
* ([env] 0.160.1 against a scripted provider: both start and their tools are
* called). codex merges config overrides into the user's config.toml field
* by field, so an entry named like one of the user's own is merged into it:
* oar sets `args` (an array is replaced whole) and `enabled = true` so the
* user's `args` or `enabled = false` cannot change or silently drop the
* session's server; the user's other fields of that entry (more `env` keys,
* `env_vars`, `cwd`, timeouts, tool filters) stay, and an entry of the other
* transport fails the open ("url is not supported for stdio"). Nested under
* one `mcp_servers` key rather than dotted `mcp_servers.<name>` keys, which
* a `.` in a name would split. Throws on a list with an empty, repeated or
* codex-invalid name.
*/
function codexMcpServersConfig(servers) {
	checkMcpServerNames(servers);
	const invalid = servers.find((server) => !CODEX_MCP_SERVER_NAME.test(server.name));
	if (invalid !== void 0) throw new Error(`codex starts no MCP server named ${JSON.stringify(invalid.name)}: its names match ${CODEX_MCP_SERVER_NAME.source}`);
	return Object.fromEntries(servers.map((server) => [server.name, isHttpMcpServer(server) ? {
		url: server.url,
		...server.headers === void 0 ? {} : { http_headers: server.headers },
		enabled: true
	} : {
		command: server.command,
		args: server.args ?? [],
		...server.env === void 0 ? {} : { env: server.env },
		enabled: true
	}]));
}
/** A `config` param holding these overrides, or none when there are none. */
function configParams(config) {
	return Object.keys(config).length === 0 ? {} : { config };
}
/** Native runtime roots replace the list, so retain the primary cwd too. */
function workspaceRoots(options) {
	const directories = resolvedAdditionalDirectories(options);
	return directories.length === 0 ? null : [...new Set([path.resolve(options.cwd), ...directories])];
}
/**
* The open request for these options: a new thread, or a resume of
* `options.resume`; and the redactor for the MCP credentials its `config`
* carries, through which every error codex reports for this session goes.
*/
function codexThreadOpen(options) {
	validateCodexToolDenials(options);
	checkSessionName(options);
	const { redact } = sessionCredentialRedactor(options);
	const instructionParams = {
		...options.systemPrompt === void 0 ? {} : { baseInstructions: options.systemPrompt },
		...options.appendSystemPrompt === void 0 ? {} : { developerInstructions: options.appendSystemPrompt }
	};
	const effortConfig = options.effort === void 0 ? {} : { model_reasoning_effort: options.effort };
	const mcpServers = givenMcpServers(options.mcpServers);
	const mcpConfig = mcpServers === null ? {} : { mcp_servers: codexMcpServersConfig(mcpServers) };
	const tierParams = options.serviceTier === void 0 ? {} : { serviceTier: options.serviceTier };
	const modelParams = options.model === void 0 ? {} : { model: options.model };
	const roots = workspaceRoots(options);
	const directoryParams = roots === null ? {} : { runtimeWorkspaceRoots: roots };
	if (options.resume === void 0) return {
		method: "thread/start",
		redact,
		params: {
			cwd: options.cwd,
			...directoryParams,
			...modelParams,
			...tierParams,
			approvalPolicy: "never",
			experimentalRawEvents: true,
			...instructionParams,
			...configParams({
				...effortConfig,
				...mcpConfig
			})
		}
	};
	return {
		method: "thread/resume",
		redact,
		params: {
			threadId: options.resume,
			excludeTurns: true,
			cwd: options.cwd,
			...directoryParams,
			...modelParams,
			...tierParams,
			approvalPolicy: "never",
			...instructionParams,
			...configParams(mcpConfig)
		}
	};
}
/**
* SessionOptions.name (#368): the name to give the opened thread, or null. A
* new thread gets it; a resumed one only when the resume reply shows no name,
* so a name the user gave in their app is kept. The name reads back on the
* thread ([env] codex 0.162.0, experiments/codex-session-name.ts).
*/
function codexThreadName(method, options, reply) {
	if (options.name === void 0) return null;
	const current = method === "thread/resume" ? asRecord(reply.thread)?.name : void 0;
	return typeof current === "string" && current.length > 0 ? null : options.name;
}
/** A reply's `reasoningEffort` (or `threadSettings.effort`): null when codex runs no explicit level (the model's default). */
function effortIn(record) {
	const effort = record?.reasoningEffort ?? record?.effort;
	return typeof effort === "string" && effort.length > 0 ? effort : null;
}
/**
* The open reply read back: the model and effort codex says the thread runs
* (the open frame's events), why that is not what was requested, if it is
* not, and the effort a resume still has to set on the loaded thread.
*
* Both replies report the model actually active. Still check it against the
* request: codex's resume_running_thread ignores overrides for a thread that
* is already loaded and busy (warn "thread/resume overrides ignored for
* loaded thread") and answers with the old model; a caller who asked for a
* model must not get one silently running another. The same holds for
* effort: `reasoningEffort` is the level the thread runs (null: no explicit
* level, the model's default). A resume answers the level the thread last
* ran with; when that is not the requested one, it is set next
* (`resumeEffort`). codex echoes an unknown level as given and forwards it
* to the provider, whose refusal then fails the first turn.
*/
function codexOpenReadback(method, options, reply) {
	const model = typeof reply.model === "string" ? reply.model : null;
	const effort = effortIn(reply);
	const events = [
		...model === null ? [] : [{
			kind: "model",
			model
		}],
		...effort === null ? [] : [{
			kind: "effort",
			effort
		}],
		...codexServiceTierEvents(reply)
	];
	const roots = workspaceRoots(options);
	const reportedRoots = reply.runtimeWorkspaceRoots;
	if (roots !== null && (!Array.isArray(reportedRoots) || roots.some((root) => !reportedRoots.includes(root)))) return {
		events,
		refusal: `codex ${method} did not confirm the requested additionalDirectories in runtimeWorkspaceRoots`,
		resumeEffort: null
	};
	if (options.model !== void 0 && model !== null && model !== options.model) return {
		events,
		refusal: `codex ${method} kept model ${model} although ${options.model} was requested`,
		resumeEffort: null
	};
	if (options.serviceTier !== void 0 && codexServiceTier(reply) !== options.serviceTier) return {
		events,
		refusal: `codex ${method} reports serviceTier ${codexServiceTier(reply) ?? "unreported"} although ${options.serviceTier} was requested`,
		resumeEffort: null
	};
	if (options.effort === void 0 || effort === options.effort) return {
		events,
		refusal: null,
		resumeEffort: null
	};
	if (method === "thread/resume") return {
		events,
		refusal: null,
		resumeEffort: options.effort
	};
	return {
		events,
		refusal: `codex ${method} ${"reasoningEffort" in reply ? `kept effort ${effort ?? "none (the model's default)"}` : "reports no reasoningEffort"} although effort ${options.effort} was requested`,
		resumeEffort: null
	};
}
/** How long a resume waits for codex's `thread/settings/updated` after its `thread/settings/update`. */
const CODEX_SETTINGS_REPORT_MS = 1e4;
/**
* Why the resumed thread does not run `requested` after
* `thread/settings/update {effort}` ([env] 0.155.1: answered `{}`, then
* `thread/settings/updated` with the thread's settings), or null when codex
* reports exactly that level. `update` is the RPC's outcome, `settings` the
* notification's params, or null when none came.
*/
function codexResumeEffortRefusal(requested, update, settings) {
	if (update !== null) return `codex thread/settings/update effort=${requested} failed: ${update.error}`;
	if (settings === null) return `codex reported no thread/settings/updated within ${String(CODEX_SETTINGS_REPORT_MS)} ms, so effort ${requested} cannot be confirmed`;
	const effort = effortIn(asRecord(settings.threadSettings));
	return effort === requested ? null : `codex thread/settings/update left effort ${effort ?? "none (the model's default)"} although ${requested} was requested`;
}
/** Null explicitly means no tier; an absent field is no evidence. */
function codexServiceTier(record) {
	const value = record?.serviceTier;
	if (value === null) return "default";
	return typeof value === "string" && value.length > 0 ? value : null;
}
function codexServiceTierEvents(record) {
	const serviceTier = codexServiceTier(record);
	return serviceTier === null ? [] : [{
		kind: "service_tier",
		serviceTier
	}];
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/failure.js
init_failure_class();
init_json();
const NAMED = {
	usageLimitExceeded: "quota",
	rateLimitExceeded: "rate_limited",
	serverOverloaded: "overloaded",
	internalServerError: "provider",
	contextWindowExceeded: "input_too_large"
};
const TRANSPORT = [
	"httpConnectionFailed",
	"responseStreamConnectionFailed",
	"responseStreamDisconnected",
	"responseTooManyFailedAttempts"
];
/** What `codexErrorInfo` says: a class, and the HTTP status a transport variant carries. */
function fromInfo(info, message) {
	if (typeof info === "string") {
		const named = NAMED[info];
		if (named !== void 0) return { failure: named };
		return { failure: info === "other" ? failureFromErrorBody(message) ?? "unknown" : "unknown" };
	}
	const record = asRecord(info);
	for (const variant of TRANSPORT) {
		const status = asNumber(asRecord(record?.[variant])?.httpStatusCode);
		if (status !== null) return {
			failure: failureFromStatus(status),
			status
		};
	}
	return { failure: "unknown" };
}
/** Classify a failed codex turn whose reason is `reason`, from its `turn.error`. */
function codexFailure(reason, turnError) {
	const error = asRecord(turnError);
	const message = typeof error?.message === "string" ? error.message : "";
	return {
		kind: "failed",
		reason,
		...fromInfo(error?.codexErrorInfo, message)
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/item-detail.js
init_json();
init_tool_output();
function codexItemInput(item) {
	switch (item.type) {
		case "commandExecution": return typeof item.command === "string" ? item.command : void 0;
		case "fileChange": return Array.isArray(item.changes) ? JSON.stringify(item.changes) : void 0;
		case "mcpToolCall": return item.arguments === void 0 ? void 0 : JSON.stringify(item.arguments);
		case "webSearch": return typeof item.query === "string" ? item.query : void 0;
		case "sleep": return typeof item.durationMs === "number" ? JSON.stringify({ durationMs: item.durationMs }) : void 0;
		default: return;
	}
}
/** The exit status of a `commandExecution` item; `null` is codex's own "no code" (a signal), absent means the item carries none (still running, declined). */
function codexItemExitCode(item) {
	if (item.type !== "commandExecution" || !("exitCode" in item)) return;
	return typeof item.exitCode === "number" ? item.exitCode : null;
}
/** A status word (`declined`, `completed`) when a command or file change reported nothing else. */
function statusOf(item) {
	return typeof item.status === "string" ? item.status : void 0;
}
/**
* An `mcpToolCall` result (`{content, structuredContent?, _meta?}`, the
* content being MCP blocks [src] app-server v2 `McpToolCallResult`): its
* blocks, or the whole result when it has none; an error is its message.
*/
function mcpContent(item) {
	const error = asRecord(item.error);
	if (typeof error?.message === "string") return [{
		type: "text",
		text: `error: ${error.message}`
	}];
	const result = asRecord(item.result);
	if (result === null) return;
	return (Array.isArray(result.content) ? toolContent(result.content) : void 0) ?? [{
		type: "other",
		value: result
	}];
}
/** A finished tool item's `tool_call_ended.content`. */
function codexToolContent(item) {
	switch (item.type) {
		case "commandExecution": return toolContent((typeof item.aggregatedOutput === "string" && item.aggregatedOutput.length > 0 ? item.aggregatedOutput : void 0) ?? statusOf(item));
		case "fileChange": return toolContent(statusOf(item));
		case "mcpToolCall": return mcpContent(item);
		case "webSearch": return Array.isArray(item.results) ? [{
			type: "other",
			value: item.results
		}] : void 0;
		default: return;
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/reasoning.js
init_json();
function textParts(value) {
	if (!Array.isArray(value)) return [];
	return value.flatMap((part) => {
		const text = asRecord(part)?.text;
		return typeof text === "string" && text.length > 0 ? [text] : [];
	});
}
function codexReasoningContent(item) {
	if (item?.type !== "reasoning") return null;
	const text = [...textParts(item.summary), ...textParts(item.content)].join("\n");
	if (text.length > 0) return {
		kind: "text",
		text
	};
	return typeof item.encrypted_content === "string" ? { kind: "redacted" } : { kind: "empty" };
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/tasks.js
/**
* codex reports its subagents on the parent thread as `subAgentActivity`
* items (0.149.0 to 0.158.0): `kind` started, interacted, interrupted, and
* (0.158.0) completed, with the child's `agentThreadId` and its canonical
* `agentPath` (`/root/name`). The child thread is its own session, so it is
* the task id and the `childSessionId`. A codex subagent can be given more
* work after it completed, which `interacted` reports. The projection passes
* only items about the reporting thread's own child: a thread messaging the
* root or a sibling reports `interacted` too, and that changes no task.
*/
function codexTaskViews(item) {
	const taskId = typeof item.agentThreadId === "string" && item.agentThreadId !== "" ? item.agentThreadId : void 0;
	if (item.type !== "subAgentActivity" || taskId === void 0) return [];
	switch (item.kind) {
		case "started": return [{
			kind: "task_started",
			taskId,
			taskType: "agent",
			nativeType: "subAgent",
			childSessionId: taskId,
			background: true,
			...typeof item.agentPath === "string" ? { description: item.agentPath } : {},
			...typeof item.id === "string" ? { toolCallId: item.id } : {}
		}];
		case "interacted": return [{
			kind: "task_updated",
			taskId,
			status: "running"
		}];
		case "completed": return [{
			kind: "task_ended",
			taskId,
			status: "completed"
		}];
		case "interrupted": return [{
			kind: "task_ended",
			taskId,
			status: "stopped"
		}];
		default: return [];
	}
}
/** The root thread's canonical path (0.158.0: gamma's `interacted` naming the root says `/root`). */
const ROOT_PATH = "/root";
/** `threads` plus the child a `started` item reported on `reporter`'s thread names. */
function withStartedChild(threads, reporter, item) {
	const child = item?.type === "subAgentActivity" && item.kind === "started" ? item.agentThreadId : void 0;
	if (typeof child !== "string" || child.length === 0 || threads.has(child)) return threads;
	const entry = typeof item?.agentPath === "string" ? {
		parent: reporter,
		path: item.agentPath
	} : { parent: reporter };
	return new Map([...threads, [child, entry]]);
}
/** The thread at a canonical path, when the stream has named it. */
function threadAt(threads, rootThreadId, path) {
	return path === ROOT_PATH ? rootThreadId : [...threads].find(([, thread]) => thread.path === path)?.[0];
}
/**
* Whether `path` names a child of `reporter`, judged by the parent path:
* decided when the parent path's thread is known, or when the reporter's own
* path is (then the parent is someone else); null when neither is.
*/
function childByPath(threads, rootThreadId, reporter, path) {
	const parent = threadAt(threads, rootThreadId, path.slice(0, path.lastIndexOf("/")));
	if (parent !== void 0) return parent === reporter;
	return reporter === rootThreadId || threads.get(reporter)?.path !== void 0 ? false : null;
}
/**
* A thread reports `subAgentActivity` on its own thread for its own children
* and for the messages it sends to peers: on 0.158.0 alpha's `interacted
* /root/beta` (a sibling) and gamma's `interacted /root` (the root) arrived
* on alpha's and gamma's threads. Only an item about the reporting thread's
* own child is a task change or an edge. The child's recorded start decides;
* without one (started before a resume) its `agentPath` does; when neither
* the parent path's thread nor the reporter's path is known, the child is
* taken to be the reporter's.
*/
function aboutOwnChild(threads, rootThreadId, reporter, item) {
	const child = item.agentThreadId;
	if (item.kind === "started" || typeof child !== "string") return item.kind === "started";
	const started = threads.get(child);
	if (child === rootThreadId || started !== void 0) return started?.parent === reporter;
	return (typeof item.agentPath === "string" ? childByPath(threads, rootThreadId, reporter, item.agentPath) : null) ?? true;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/token-usage.js
init_json();
init_token_totals();
const fromZero = {
	kind: "known",
	tokens: noTokens
};
function initialTokenBaseline(resumed) {
	return resumed ? { kind: "awaiting" } : fromZero;
}
/** What root totals count from; null when unknown (no `tokens` then). */
function baselineTokens(baseline) {
	return baseline.kind === "known" ? baseline.tokens : null;
}
/** codex's own running total in a `thread/tokenUsage/updated`; null when it carries none. */
function reportedTotal(params) {
	const total = asRecord(asRecord(params.tokenUsage)?.total);
	const input = asNumber(total?.inputTokens);
	const output = asNumber(total?.outputTokens);
	if (total === null || input === null || output === null) return null;
	return {
		input,
		output,
		...cacheParts(total, {
			read: "cachedInputTokens",
			write: "cacheWriteInputTokens"
		}),
		...reasoningPart(total, "reasoningOutputTokens")
	};
}
/**
* The baseline after one root-thread notification: while a resume awaits it,
* the first root total is the re-report and becomes the baseline, and a root
* `turn/started` arriving first leaves it unknown. Unchanged otherwise (the
* same object).
*/
function nextTokenBaseline(baseline, method, params) {
	if (baseline.kind !== "awaiting") return baseline;
	if (method === "turn/started") return { kind: "unknown" };
	const reported = method === "thread/tokenUsage/updated" ? reportedTotal(params) : null;
	return reported === null ? baseline : {
		kind: "known",
		tokens: reported
	};
}
/**
* `tokenUsage.total` accumulates over every model call of the thread's life
* (input 12.6k → 28.4k → 44.2k across three one-word turns, codex 0.154.0),
* so it is the running spend, not what the context holds; less `baseline`
* (the thread's total before this Session opened) it is this Session's
* `tokens`, so the re-report itself reads zero, and with no known baseline
* (null) there are no `tokens`. `tokenUsage.last` is the
* most recent model call, and `modelContextWindow` the window it fit in;
* those two are the context reading, whatever the baseline. Codex's own
* occupancy figure is `last.total_tokens`
* (`TokenUsage::tokens_in_context_window`, protocol.rs at 4f39251a; the
* TUI's status card reads it off `last_token_usage`; its percent also
* subtracts a 12k baseline). oar reads the same field, `last.totalTokens`:
* the last call's input (cached tokens included) plus its output, which is
* what the context holds once the reply is in, matching the runtime's own
* reading rather than undercounting by the last output. When `last` is
* absent (older builds) the occupancy is unknown: the cumulative input
* stands in as `tokens` and the window and percent are null: the cumulative
* total is never read against the window.
*/
function codexUsageViews(params, baseline) {
	const tokenUsage = asRecord(params.tokenUsage);
	const total = asRecord(tokenUsage?.total);
	if (total === null) return [];
	const input = asNumber(total.inputTokens);
	const reported = reportedTotal(params);
	const tokens = reported === null || baseline === null ? {} : { tokens: subtractTokens(reported, baseline) };
	const last = asRecord(tokenUsage?.last);
	if (last === null) return [{
		kind: "usage",
		usage: {
			context: {
				tokens: input,
				contextWindow: null,
				percent: null
			},
			...tokens
		}
	}];
	const contextTokens = asNumber(last.totalTokens);
	const contextWindow = asNumber(tokenUsage?.modelContextWindow);
	return [{
		kind: "usage",
		usage: {
			context: {
				tokens: contextTokens,
				contextWindow,
				percent: contextTokens === null || contextWindow === null || contextWindow <= 0 ? null : Math.round(contextTokens / contextWindow * 100)
			},
			...tokens
		}
	}];
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/projection.js
init_json();
init_token_totals();
/**
* The codex notification → record projection as a PURE FOLD (see
* runtimes/claude/projection.ts for the shape). Every notification becomes
* exactly one frame command: verbatim `native`, events in oar's vocabulary,
* the runtime's own turn id as `spanId`. Plus, for collaboration items that
* name other threads, a link command for the session graph. Nothing is gated
* on turn state and nothing is dropped; the adapter applies the commands and
* separately owns the transport-only turn id (steer/abort identity), which is
* not part of the projection. Behavior is pinned by tests/replay against
* recorded fixtures.
*/
const TOOL_ITEM_TYPES = new Set([
	"commandExecution",
	"fileChange",
	"mcpToolCall",
	"webSearch",
	"sleep"
]);
const COLLAB_ITEM_TYPES = new Set([
	"collabAgentToolCall",
	"collabToolCall",
	"subAgentActivity"
]);
/** The projection of a Session opened by `opened`: a resume awaits codex's re-reported token total. */
function initialCodexProjection(rootThreadId, opened = "thread/start") {
	return {
		inputs: /* @__PURE__ */ new Map(),
		rootThreadId,
		lastErrorDetail: null,
		compacting: false,
		subagents: /* @__PURE__ */ new Map(),
		tokenBaseline: initialTokenBaseline(opened === "thread/resume")
	};
}
const COMPACTION_ITEM_TYPE = "contextCompaction";
function isCompactionItem(params) {
	return asRecord(params.item)?.type === COMPACTION_ITEM_TYPE;
}
function outcomeFromTurn(state, turn) {
	const status = turn?.status;
	switch (status) {
		case "interrupted": return { kind: "aborted" };
		case "completed": return { kind: "completed" };
		default: {
			const word = typeof status === "string" ? status : "unknown";
			return codexFailure(state.lastErrorDetail === null ? word : `${word}: ${state.lastErrorDetail}`, turn?.error);
		}
	}
}
function toolViews(method, item) {
	const itemType = typeof item?.type === "string" ? item.type : "";
	if (!TOOL_ITEM_TYPES.has(itemType)) return [];
	const itemId = typeof item?.id === "string" ? item.id : "unknown";
	if (method === "item/started") {
		const input = item === null ? void 0 : codexItemInput(item);
		return [input === void 0 ? {
			kind: "tool_call_started",
			callId: itemId,
			tool: itemType
		} : {
			kind: "tool_call_started",
			callId: itemId,
			tool: itemType,
			input
		}];
	}
	const content = item === null ? void 0 : codexToolContent(item);
	const exitCode = item === null ? void 0 : codexItemExitCode(item);
	const status = typeof item?.status === "string" ? item.status : void 0;
	let result = void 0;
	if (status === "completed") result = "ok";
	else if (status === "failed") result = "failed";
	return [{
		kind: "tool_call_ended",
		callId: itemId,
		...content === void 0 ? {} : { content },
		...result === void 0 ? {} : { result },
		...exitCode === void 0 ? {} : { exitCode }
	}];
}
/**
* `thread/settings/updated` is codex's own report of the thread's settings
* after a change ([env] 0.155.1: pushed when a turn/start carries an `effort`
* or `model` override, "for this turn and subsequent turns"):
* `threadSettings.model` and `threadSettings.effort` (null: no explicit
* level) are the model and effort now in effect.
*/
function settingsViews(params) {
	const settings = asRecord(params.threadSettings);
	const events = [...codexServiceTierEvents(settings)];
	if (typeof settings?.model === "string" && settings.model.length > 0) events.push({
		kind: "model",
		model: settings.model
	});
	if (typeof settings?.effort === "string" && settings.effort.length > 0) events.push({
		kind: "effort",
		effort: settings.effort
	});
	return events;
}
/** Edges a collaboration item establishes: the sender thread (the reporting thread unless the item names one) spawned or addressed the named threads. */
function collabEdges(state, reporter, item) {
	if (item === null || typeof item.type !== "string" || !COLLAB_ITEM_TYPES.has(item.type)) return [];
	if (item.type === "subAgentActivity" && !aboutOwnChild(state.subagents, state.rootThreadId, reporter, item)) return [];
	const parent = typeof item.senderThreadId === "string" ? item.senderThreadId : reporter;
	return [...Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : [], item.agentThreadId].filter((id) => typeof id === "string" && id.length > 0 && id !== parent).map((child) => ({
		parent,
		child,
		via: "tool_call"
	}));
}
function spanIdOf(params) {
	if (typeof params.turnId === "string") return params.turnId;
	const turnId = asRecord(params.turn)?.id;
	return typeof turnId === "string" ? turnId : void 0;
}
function viewsFor(state, reporter, method, params) {
	switch (method) {
		case "turn/started": return [{ kind: "turn_active" }];
		case "item/agentMessage/delta": return typeof params.delta === "string" ? [{
			kind: "text_delta",
			text: params.delta,
			...typeof params.itemId === "string" ? { messageId: params.itemId } : {}
		}] : [];
		case "item/commandExecution/outputDelta": return typeof params.itemId === "string" ? [{
			kind: "tool_call_progress",
			callId: params.itemId,
			...typeof params.delta === "string" ? { outputDelta: params.delta } : {}
		}] : [];
		case "serverRequest/resolved": {
			const id = params.requestId;
			return typeof id === "string" || typeof id === "number" ? [{
				kind: "app_request_cancelled",
				requestId: String(id)
			}] : [];
		}
		case "thread/compacted": return state.compacting ? [{
			kind: "compaction_ended",
			outcome: "completed"
		}] : [];
		case "rawResponseItem/completed": {
			const content = codexReasoningContent(asRecord(params.item));
			return content === null ? [] : [{
				kind: "reasoning",
				content
			}];
		}
		case "item/started": {
			const item = asRecord(params.item);
			if (item?.type === "userMessage" && Array.isArray(item.content)) return [{
				kind: "user_message",
				input: item.content.map((part) => asRecord(part)).filter((part) => part?.type === "text").map((part) => typeof part?.text === "string" ? part.text : "").join(""),
				evidence: "turn_item",
				...typeof item.clientId === "string" ? { inputId: item.clientId } : {},
				...typeof item.id === "string" ? { nativeMessageId: item.id } : {},
				...typeof params.turnId === "string" ? { turnId: params.turnId } : {}
			}];
			return isCompactionItem(params) ? [{ kind: "compaction_started" }] : toolViews(method, asRecord(params.item));
		}
		case "item/completed": {
			if (isCompactionItem(params)) return [{
				kind: "compaction_ended",
				outcome: "completed"
			}];
			const item = asRecord(params.item);
			if (item?.type === "subAgentActivity") return aboutOwnChild(state.subagents, state.rootThreadId, reporter, item) ? codexTaskViews(item) : [];
			return toolViews(method, item);
		}
		case "turn/completed": return [{
			kind: "turn_ended",
			outcome: outcomeFromTurn(state, asRecord(params.turn))
		}];
		case "thread/tokenUsage/updated": return codexUsageViews(params, reporter === state.rootThreadId ? baselineTokens(state.tokenBaseline) : noTokens);
		case "thread/settings/updated": return settingsViews(params);
		default: return [];
	}
}
/** Fold one codex notification into the next state plus commands. */
function foldCodexNotification(previous, method, params) {
	const threadId = typeof params.threadId === "string" ? params.threadId : previous.rootThreadId;
	const tokenBaseline = threadId === previous.rootThreadId ? nextTokenBaseline(previous.tokenBaseline, method, params) : previous.tokenBaseline;
	const input = threadId === previous.rootThreadId ? foldCodexInputs(previous.inputs, method, params) : {
		inputs: previous.inputs,
		events: []
	};
	const state = {
		...previous,
		tokenBaseline,
		inputs: input.inputs
	};
	const spanId = spanIdOf(params);
	const event = {
		kind: "frame",
		body: {
			type: method,
			native: params,
			events: [...input.events, ...viewsFor(state, threadId, method, params)]
		},
		...spanId === void 0 ? {} : { spanId },
		...threadId === state.rootThreadId ? {} : { sessionId: threadId }
	};
	const links = method === "item/started" || method === "item/completed" ? collabEdges(state, threadId, asRecord(params.item)).map((edge) => ({
		kind: "link",
		edge
	})) : [];
	let next = state;
	if (method === "error") {
		const error = asRecord(params.error);
		const combined = [typeof error?.message === "string" ? error.message : "", typeof error?.additionalDetails === "string" ? error.additionalDetails : ""].filter((part) => part.length > 0).join(": ");
		if (combined.length > 0) next = {
			...state,
			lastErrorDetail: combined
		};
	} else if (method === "turn/completed" && threadId === state.rootThreadId) next = {
		...state,
		lastErrorDetail: null
	};
	else if (threadId === state.rootThreadId && isCompactionItem(params) && (method === "item/started" || method === "item/completed")) next = {
		...state,
		compacting: method === "item/started"
	};
	else if (method === "thread/compacted" && threadId === state.rootThreadId) next = {
		...state,
		compacting: false
	};
	const subagents = withStartedChild(next.subagents, threadId, asRecord(params.item));
	if (subagents !== next.subagents) next = {
		...next,
		subagents
	};
	return {
		state: next,
		commands: [event, ...links]
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/contracts/session-unavailable-error.js
/**
* `session({ resume })` found the native conversation but the runtime will
* not open it now. Only the documented runtime signals produce this error;
* `message` keeps the runtime's own words. No turn exists yet: this is not a
* FailureClass. See docs/spec/runtime-matrix.md#unavailable-resume-targets.
*/
var SessionUnavailableError = class extends Error {
	name = "SessionUnavailableError";
	sessionId;
	reason;
	constructor(sessionId, message, details) {
		super(message, { cause: {
			method: details.method,
			native: details.native
		} });
		this.sessionId = sessionId;
		this.reason = details.reason;
	}
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/rpc-control.js
init_session_not_found_error();
init_control_input();
init_json();
/**
* A control action backed by one app-server RPC: record the request; when the
* stream already says the runtime is unreachable (`kernel.unreachable()`:
* exited or disposed), or input is empty with no images, record that
* rejection without running the plan; if the
* plan's gate refuses, record that; otherwise send and record the reply AS
* the reply line is read (synchronously, through the client's onSettled hook)
* so the response sits in the stream before any notification codex wrote
* after it; a promise continuation would land after notifications from the
* same chunk.
*/
async function rpcControl(kernel, client, plan) {
	const blocked = kernel.unreachable();
	const request = kernel.request("toRuntime", plan.body);
	const refused = blocked ?? emptyInputRefusal(plan.body) ?? plan.gate(request);
	if (refused !== null) return {
		request,
		response: kernel.respond(request.id, refused)
	};
	const { promise, resolve } = Promise.withResolvers();
	let recorded = false;
	const record = (decided) => {
		if (!recorded) {
			recorded = true;
			resolve(kernel.respond(request.id, decided));
		}
	};
	plan.onPending?.(() => {
		record({ kind: "accepted" });
	});
	const send = async () => {
		try {
			await client.request(plan.method, plan.params(), (outcome) => {
				if (recorded) {
					const native = outcome.kind === "result" ? outcome.result : outcome.kind === "error" ? outcome.native : void 0;
					if (native !== void 0) kernel.frame({
						type: plan.method,
						native,
						events: []
					});
				} else if (outcome.kind === "exited") record({
					kind: "rejected",
					code: "runtime_exited",
					reason: outcome.error.message
				});
				else record(outcome.kind === "result" ? plan.onReply(outcome.result) : plan.onError(outcome.error.message));
			});
		} catch (error) {
			if (!recorded) record(plan.onError(error instanceof Error ? error.message : String(error)));
		}
	};
	send();
	return {
		request,
		response: await promise
	};
}
/**
* A resume target codex keeps but will not open now, by its words on the
* `-32600` it shares with a missing rollout ([env] codex 0.162.0,
* experiments/codex-session-name.ts): the user archived it in their app, or
* another app-server (their app) is its writer.
*/
function unavailableReason(message) {
	if (/^session \S+ is archived\./u.test(message)) return "archived";
	return /^thread \S+ already has an active writer$/u.test(message) ? "in_use" : null;
}
/**
* The typed error for a resume codex refused, or null. Codex 0.162.0 uses
* -32600 for a missing rollout, an archived thread, an active writer and
* unloaded sub-agents alike, so its words are the last resort: the missing
* rollout's are pinned by missing-resume-errors.json, the other two by the
* codex-session-name vendor test.
*/
function resumeError(method, resumeId, cause, message) {
	const native = asRecord(cause?.native);
	if (method !== "thread/resume" || resumeId === void 0 || cause?.method !== method || native?.code !== -32600 || typeof native.message !== "string") return null;
	const text = `codex ${method} failed: ${message}`;
	if (native.message.startsWith("no rollout found for thread id")) return new SessionNotFoundError(resumeId, text, {
		method,
		native
	});
	const reason = unavailableReason(native.message);
	return reason === null ? null : new SessionUnavailableError(resumeId, text, {
		reason,
		method,
		native
	});
}
/**
* The open RPCs, with their failure named after the method (a refused resume
* must say `thread/resume`: "no rollout found for thread id …" alone does
* not) and the app-server that was started for them killed.
*/
async function openThread(client, method, send, serviceTier, resumeId) {
	try {
		return await send();
	} catch (error) {
		client.kill();
		await client.exited;
		const message = error instanceof Error ? error.message : String(error);
		const typed = resumeError(method, resumeId, asRecord(error instanceof Error ? error.cause : void 0), message);
		if (typed !== null) throw typed;
		const detail = serviceTier === void 0 ? message : `serviceTier ${serviceTier} could not be confirmed (actual unreported): ${message}`;
		throw new Error(`codex ${method} failed: ${detail}`, { cause: error instanceof Error ? error.cause ?? error : error });
	}
}
/** SessionOptions.name (#368) on the opened thread, when there is one to set (open.ts `codexThreadName`); a name codex refuses fails the open. */
async function nameThread(client, threadId, name) {
	if (name === null) return;
	await openThread(client, "thread/name/set", async () => {
		return await client.request("thread/name/set", {
			threadId,
			name
		});
	});
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/session.js
init_input_images();
init_json();
init_session_credentials();
init_session_links();
const codexSession = withSessionCredentials(async (installation, options, credentials) => {
	if (installation.via !== "executable") throw new Error("The codex session adapter needs an executable installation");
	const { method: openMethod, params: openParams, redact } = codexThreadOpen(options);
	const sandboxMode = process.env.OAR_CODEX_SANDBOX ?? "danger-full-access";
	const configOverrides = sandboxMode === "inherit" ? {} : { sandbox_mode: `"${sandboxMode}"` };
	const client = startAppServerClient(installation.command, options.env, configOverrides, void 0, {
		redact,
		...options.launchArgs === void 0 ? {} : { launchArgs: options.launchArgs }
	});
	try {
		await client.request("initialize", {
			clientInfo: {
				name: "oar",
				version: "0.0.0"
			},
			capabilities: { experimentalApi: true }
		});
	} catch (error) {
		client.kill();
		await client.exited;
		throw error;
	}
	client.notify("initialized", {});
	const filteredOpenParams = await prepareCodexToolDenials(client, options, openParams);
	let recordOpen = null;
	const markOpen = (outcome) => {
		if (outcome.kind === "result") client.mark(() => recordOpen?.());
	};
	const started = await openThread(client, openMethod, async () => {
		return await client.request(openMethod, filteredOpenParams, markOpen);
	}, options.serviceTier, options.resume);
	const threadId = asRecord(started.thread)?.id;
	if (typeof threadId !== "string") {
		client.kill();
		await client.exited;
		throw new TypeError("codex thread start/resume returned no thread id");
	}
	const readback = codexOpenReadback(openMethod, options, started);
	if (readback.refusal !== null) {
		client.kill();
		await client.exited;
		throw new Error(readback.refusal);
	}
	const kernel = credentials.kernel(threadId);
	const state = {
		active: null,
		spontaneous: false,
		codexTurnId: null,
		projection: initialCodexProjection(threadId, openMethod)
	};
	const busy = () => state.active !== null || state.spontaneous;
	const abortFallback = createAbortFallback(() => {
		client.kill();
	});
	let disposeRequest = null;
	let settingsWaiter = null;
	recordOpen = () => {
		kernel.frame({
			type: openMethod,
			native: started,
			events: readback.events
		});
	};
	const onNotification = (method, params) => {
		const isRoot = typeof params.threadId !== "string" || params.threadId === threadId;
		if (isRoot && method === "turn/started") {
			const startedTurn = asRecord(params.turn)?.id;
			if (!busy()) state.spontaneous = true;
			if (typeof startedTurn === "string") state.codexTurnId = startedTurn;
		}
		const { state: nextProjection, commands } = foldCodexNotification(state.projection, method, params);
		state.projection = nextProjection;
		const links = newSessionLinks(kernel, commands.flatMap((command) => command.kind === "link" ? [command.edge] : []));
		for (const command of commands) switch (command.kind) {
			case "frame":
				kernel.frame({
					...command.body,
					events: [...command.body.events, ...links]
				}, {
					...command.sessionId === void 0 ? {} : { sessionId: command.sessionId },
					...command.spanId === void 0 ? {} : { spanId: command.spanId }
				});
				break;
			case "link": break;
			default: break;
		}
		if (isRoot && method === "turn/completed") {
			abortFallback.clear();
			state.active = null;
			state.spontaneous = false;
			state.codexTurnId = null;
		}
		if (isRoot && method === "thread/settings/updated") settingsWaiter?.(params);
	};
	const onServerRequest = (id, method, params) => {
		kernel.request("toApp", {
			kind: "native",
			type: method,
			native: params
		}, { id });
	};
	client.handle({
		onNotification,
		onServerRequest
	});
	client.onExit((code) => {
		abortFallback.clear();
		kernel.respond(disposeRequest?.id ?? "", {
			kind: "exited",
			code
		});
		state.active = null;
		state.spontaneous = false;
		state.codexTurnId = null;
	});
	if (readback.resumeEffort !== null) {
		const requested = readback.resumeEffort;
		const { promise: reported, resolve } = Promise.withResolvers();
		settingsWaiter = resolve;
		const timer = setTimeout(() => {
			resolve(null);
		}, CODEX_SETTINGS_REPORT_MS);
		const update = await client.request("thread/settings/update", {
			threadId,
			effort: requested
		}).then(() => null, (error) => ({ error: error instanceof Error ? error.message : String(error) }));
		const refusal = codexResumeEffortRefusal(requested, update, update === null ? await reported : null);
		clearTimeout(timer);
		settingsWaiter = null;
		if (refusal !== null) {
			client.kill();
			await client.exited;
			throw new Error(refusal);
		}
	}
	await nameThread(client, threadId, codexThreadName(openMethod, options, started));
	/** Turn a plan builder into a Session control member. */
	const via = (plan) => async (...args) => {
		return await rpcControl(kernel, client, plan(...args));
	};
	const capabilities = {
		queue: { durable: true },
		attribution: "nested",
		images: true
	};
	const promptPlan = (input, inputOptions) => ({
		body: {
			kind: "prompt",
			input,
			...inputOptions
		},
		gate: (request) => {
			const refused = busy() ? {
				kind: "rejected",
				code: "busy",
				reason: "busy"
			} : inputImagesRefusal(capabilities, inputOptions?.images);
			if (refused !== null) return refused;
			state.active = request;
			return null;
		},
		method: "turn/start",
		params: () => ({
			threadId,
			input: codexUserInput(input, inputOptions?.images),
			clientUserMessageId: inputOptions?.inputId,
			...options.outputSchema === void 0 ? {} : { outputSchema: options.outputSchema }
		}),
		onReply: (reply) => {
			const turnId = asRecord(reply.turn)?.id;
			if (typeof turnId !== "string") {
				state.active = null;
				return {
					kind: "rejected",
					code: "runtime_refused",
					reason: "codex turn/start returned no turn id",
					native: reply
				};
			}
			state.codexTurnId = turnId;
			return {
				kind: "accepted",
				native: reply
			};
		},
		onError: (message) => {
			state.active = null;
			return {
				kind: "rejected",
				code: "runtime_refused",
				reason: message
			};
		}
	});
	const steerPlan = (input, inputOptions) => {
		const expectedTurnId = state.codexTurnId;
		return {
			body: {
				kind: "steer",
				input,
				...inputOptions
			},
			gate: () => !busy() || expectedTurnId === null ? {
				kind: "rejected",
				code: "no_active_turn",
				reason: "not_steerable: no active turn"
			} : inputImagesRefusal(capabilities, inputOptions?.images),
			method: "turn/steer",
			params: () => ({
				threadId,
				input: codexUserInput(input, inputOptions?.images),
				expectedTurnId,
				clientUserMessageId: inputOptions?.inputId
			}),
			onReply: (reply) => {
				if (expectedTurnId !== null && inputOptions?.inputId !== void 0) state.projection = {
					...state.projection,
					inputs: acceptCodexSteer(state.projection.inputs, expectedTurnId, inputOptions.inputId)
				};
				return {
					kind: "accepted",
					native: reply
				};
			},
			onError: (message) => ({
				kind: "rejected",
				code: "runtime_refused",
				reason: `not_steerable: ${message}`
			})
		};
	};
	const queuePlan = (input, inputOptions) => ({
		body: {
			kind: "queue",
			input,
			...inputOptions
		},
		gate: () => options.outputSchema === void 0 ? inputImagesRefusal(capabilities, inputOptions?.images) : {
			kind: "rejected",
			code: "unsupported",
			reason: "codex queued input cannot carry outputSchema; use prompt after the current turn ends"
		},
		method: "thread/queue/add",
		params: () => ({
			threadId,
			input: codexUserInput(input, inputOptions?.images),
			clientUserMessageId: inputOptions?.inputId ?? randomUUID()
		}),
		onReply: (reply) => ({
			kind: "accepted",
			native: reply
		}),
		onError: (message) => ({
			kind: "rejected",
			code: "runtime_refused",
			reason: message
		})
	});
	const abortPlan = () => {
		let refused = null;
		return {
			body: { kind: "abort" },
			gate: () => {
				if (!busy() || state.codexTurnId === null) return {
					kind: "rejected",
					code: "no_active_turn",
					reason: "no active turn"
				};
				return null;
			},
			onPending: (accept) => {
				refused = abortFallback.arm(accept);
			},
			method: "turn/interrupt",
			params: () => ({
				threadId,
				turnId: state.codexTurnId
			}),
			onReply: (reply) => ({
				kind: "accepted",
				native: reply
			}),
			onError: (message) => {
				refused?.();
				return {
					kind: "rejected",
					code: "runtime_refused",
					reason: message
				};
			}
		};
	};
	return credentials.seal({
		id: kernel.sessionId,
		capabilities,
		prompt: via(promptPlan),
		steer: via(steerPlan),
		queue: via(queuePlan),
		abort: via(abortPlan),
		rawEvents: (observer, cursor) => kernel.rawEvents(observer, cursor),
		records: () => kernel.records(),
		graph: () => kernel.graph(),
		resources: client.resources,
		dispose: async () => {
			if (disposeRequest !== null) return;
			const gone = kernel.unreachable() !== null;
			disposeRequest = kernel.request("toRuntime", { kind: "dispose" });
			if (gone) {
				kernel.respond(disposeRequest.id, { kind: "accepted" });
				return;
			}
			client.kill();
			await client.exited;
		}
	});
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/codex/index.js
const codexRuntime = defineRuntime({
	id: "codex",
	brand: runtimeBrands.codex,
	skills: codexSkills,
	mcpServers: codexMcpServers,
	tools: codexTools,
	mcpToolsListChanged: "none",
	installation: codexInstallation,
	installPlan: codexInstallPlan,
	install: codexInstall,
	accountUsage: codexAccountUsage,
	listModels: codexListModels,
	checkUpdate: codexCheckUpdate,
	upgrade: codexUpgrade,
	login: codexLogin,
	logout: codexLogout,
	authStatus: codexAuthStatus,
	session: codexSession
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/inventory.js
init_executable();
init_json();
function projectGrokSkills(payload) {
	return nativeRows(payload.skills).map((skill) => ({
		name: named(skill),
		...textField("description", skill.description),
		...textField("source", skill.source)
	}));
}
function projectGrokServers(payload) {
	return nativeRows(payload.mcpServers).map((server) => ({
		id: named(server),
		name: named(server),
		...textField("source", server.source)
	}));
}
/** inspect is cwd-scoped discovery including compatibility entries, not live connections. */
function reader$1(project) {
	return async (installation, options = {}) => {
		if (installation.via !== "executable") return unsupportedInventory("installation_unsupported", "Grok inventory requires an executable");
		const scope = workspaceScope(options);
		const child = spawnLineProcess(installation.command, ["inspect", "--json"], {
			cwd: scope.cwd,
			killTree: true
		});
		let stdout = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		try {
			return await inventoryRead(async () => {
				await child.spawned;
				if (await child.exited !== 0) throw new Error("Grok inspect failed");
				const payload = asRecord(parseJson(stdout));
				if (payload === null) throw new TypeError("Invalid Grok inspect result");
				return inventoryOk(scope, "discovered", project(payload));
			}, options.timeoutMs);
		} finally {
			child.kill();
			await child.exited;
		}
	};
}
const grokSkills = reader$1(projectGrokSkills);
const grokMcpServers = reader$1(projectGrokServers);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/installation.js
/** Official script/npm layouts that can be invisible to GUI-process PATH. */
function grokInstalledExecutableCandidates(platform = process.platform, home = homedir(), env = process.env) {
	const paths = platform === "win32" ? path.win32 : path.posix;
	const executable = platform === "win32" ? "grok.exe" : "grok";
	return [
		...env.GROK_BIN_DIR === void 0 || env.GROK_BIN_DIR === "" ? [] : [paths.join(env.GROK_BIN_DIR, executable)],
		...env.GROK_HOME === void 0 || env.GROK_HOME === "" ? [] : [paths.join(env.GROK_HOME, "bin", executable)],
		paths.join(home, ".grok", "bin", executable)
	];
}
const grokInstallation = executableInstallation("OAR_GROK_BIN", "grok", grokInstalledExecutableCandidates, [
	"agent",
	"stdio",
	"--help"
]);
const grokInstallPlan = scriptInstallPlan({
	source: "https://docs.x.ai/build/overview",
	line: "curl -fsSL https://x.ai/cli/install.sh | bash",
	tools: ["curl", "bash"],
	writes: () => {
		const home = path.join(homedir(), ".grok");
		return [installDir(process.env.GROK_BIN_DIR, path.join(home, "bin")), home];
	},
	windows: "xAI documents, in PowerShell: irm https://x.ai/cli/install.ps1 | iex"
});
const grokInstall = planInstaller(grokInstallation, grokInstallPlan);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/update.js
init_json();
const SOURCE = "grok update --check --json";
/**
* grok 1.0.46 answers `update --check --json` with `currentVersion`,
* `latestVersion`, `updateAvailable`, `installer`, `channel` and `error`,
* and always exits 0: a failed lookup shows only in `error`. The check never
* passes `--alpha`/`--stable`, which would persist a channel switch.
*/
function projectGrokUpdateCheck(installed, report) {
	const fields = asRecord(report);
	if (fields === null) return {
		kind: "unavailable",
		reason: "lookup_failed",
		detail: "grok update --check --json printed no JSON",
		source: SOURCE
	};
	const { error, latestVersion, updateAvailable, channel } = fields;
	if (typeof error === "string" && error !== "") return {
		kind: "unavailable",
		reason: "lookup_failed",
		detail: error,
		source: SOURCE
	};
	if (typeof latestVersion !== "string") return {
		kind: "unavailable",
		reason: "lookup_failed",
		detail: "grok reported no latest version",
		source: SOURCE
	};
	const check = comparedCheck(installed, latestVersion, SOURCE, typeof channel === "string" ? channel : void 0);
	return check.kind === "ok" && typeof updateAvailable === "boolean" ? {
		...check,
		updateAvailable
	} : check;
}
async function grokCheckUpdate(installation, options = {}) {
	const update = executableUpdate(installation);
	if (update.kind === "unavailable") return update.check;
	const { json } = await runCheckCommand(update.installation.command, [
		"update",
		"--check",
		"--json"
	], options.timeoutMs ?? 2e4);
	return projectGrokUpdateCheck(update.installed, json);
}
async function grokUpgrade(installation, options) {
	return await upgradeExecutable(installation, {
		check: grokCheckUpdate,
		args: ["update"]
	}, options);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/options.js
var grokRefusedSessionOptions;
var init_options$2 = __esmMin((() => {
	grokRefusedSessionOptions = {
		additionalDirectories: "grok ACP exposes no effective additional workspace directory setting",
		serviceTier: "grok exposes no verified per-session service-tier setting and readback",
		name: "grok exposes no verified session name setting",
		disallowedTools: "grok agent stdio does not forward the CLI tool denylist; supplying an agent profile would replace the user's selected harness rather than overlay its tools"
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/failure.js
/** The last `retry_state` update that ended grok's retries (`failed` or `exhausted`). */
function finalRetryState(frames) {
	for (const frame of frames.toReversed()) {
		const update = frame.type === "_x.ai/session_notification" ? asRecord(asRecord(frame.native)?.update) : null;
		if (update?.sessionUpdate === "retry_state" && (update.type === "failed" || update.type === "exhausted")) return update;
	}
	return null;
}
/** Grok validates its schema and reports either a value or a typed error field, even with end_turn. */
function grokPromptOutcome(response) {
	if (response.stopReason === "cancelled") return { kind: "aborted" };
	const meta = asRecord(response._meta);
	if (typeof meta?.structuredOutputError === "string") return {
		kind: "failed",
		failure: "output_schema",
		reason: meta.structuredOutputError
	};
	return {
		kind: "completed",
		...meta !== null && Object.hasOwn(meta, "structuredOutput") ? { structuredOutput: meta.structuredOutput } : {}
	};
}
var RATE_LIMITED, ERROR_TYPES, grokFailureOutcome;
var init_failure = __esmMin((() => {
	init_failure$1();
	init_json();
	RATE_LIMITED = -32003;
	ERROR_TYPES = {
		auth: "auth",
		rate_limited: "rate_limited",
		context_length: "input_too_large",
		api: "provider"
	};
	grokFailureOutcome = (error, frames) => {
		const reason = acpErrorReason(error);
		if (rpcErrorCode(error) === RATE_LIMITED) return {
			kind: "failed",
			reason,
			failure: "rate_limited"
		};
		const update = finalRetryState(frames);
		const named = typeof update?.error_type === "string" ? ERROR_TYPES[update.error_type] : void 0;
		return named === void 0 ? null : {
			kind: "failed",
			reason,
			failure: named
		};
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/spontaneous-usage.js
/**
* Grok injects these prompts directly into its session actor, outside ACP
* session/prompt (spawn.rs::inject_subagent_completed_prompt). Their terminal
* ledger is independent of RPC prompt ledgers. Never apply this to ordinary
* turn_completed or child frames; the ACP recorder enforces root attribution.
*/
function grokSpontaneousTokens(method, params) {
	if (method !== "_x.ai/session_notification") return null;
	const update = asRecord(params.update);
	if (update?.sessionUpdate !== "turn_completed" || typeof update.prompt_id !== "string" || !update.prompt_id.startsWith("subagent-completed-") || update.prompt_id === "subagent-completed-") return null;
	const meta = asRecord(params._meta);
	const key = meta?.eventId;
	const usage = asRecord(update.usage);
	const input = asNumber(usage?.inputTokens);
	const output = asNumber(usage?.outputTokens);
	if (typeof key !== "string" || key === "" || usage === null || input === null || output === null) return null;
	return {
		key,
		tokens: {
			input,
			output,
			...cacheParts(usage, {
				read: "cachedReadTokens",
				write: "cacheCreationTokens"
			}),
			...reasoningPart(usage, "reasoningTokens")
		},
		...meta?.isReplay === true ? { replayed: true } : {}
	};
}
var init_spontaneous_usage = __esmMin((() => {
	init_json();
	init_token_totals();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/shared/credential-redaction.js
/** Keep credential names and the native array/map shape, never their values. */
function redactNamedValues(value) {
	if (Array.isArray(value)) return value.map((entry) => {
		const record = asRecord(entry);
		return record !== null && Object.hasOwn(record, "value") ? {
			...redactMcpFields(record),
			value: "[redacted]"
		} : redactMcpTree(entry);
	});
	const record = asRecord(value);
	return record === null ? value : Object.fromEntries(Object.keys(record).map((key) => [key, "[redacted]"]));
}
function redactMcpFields(record) {
	return Object.fromEntries(Object.entries(record).map(([key, value]) => {
		if (key === "env" || key === "headers" || key === "http_headers") return [key, redactNamedValues(value)];
		if (key === "bearer_token" || key === "bearerToken") return [key, value === null ? null : "[redacted]"];
		return [key, redactMcpTree(value)];
	}));
}
function redactMcpTree(value) {
	if (Array.isArray(value)) return value.map((entry) => redactMcpTree(entry));
	const record = asRecord(value);
	return record === null ? value : redactMcpFields(record);
}
/** Whether a frame `type` is one the redaction rules cover. */
function redactionCovers(type) {
	return REDACTION_RULES.frameTypePrefixes.some((prefix) => type.startsWith(prefix));
}
/**
* Grok 1.0.46's servers_updated reports the user's stdio env verbatim.
* The other registered MCP notifications currently carry status/counters,
* but apply the same credential rule if they include these fields. Do not
* edit free-form text, other field names, other notifications or the received object.
*/
function redactGrokNotification(method, params) {
	return redactionCovers(method) ? redactMcpFields(params) : params;
}
var REDACTION_RULES;
var init_credential_redaction = __esmMin((() => {
	init_json();
	REDACTION_RULES = {
		version: 1,
		frameTypePrefixes: ["_x.ai/mcp/", "_x.ai/mcp_initialized"]
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/session.js
var session_exports$2 = /* @__PURE__ */ __exportAll({
	GROK_EXTENSION_NOTIFICATIONS: () => GROK_EXTENSION_NOTIFICATIONS,
	grokAcpProfile: () => grokAcpProfile,
	grokContextUsage: () => grokContextUsage,
	grokInitializeMeta: () => grokInitializeMeta,
	grokPromptTokens: () => grokPromptTokens,
	grokSession: () => grokSession,
	selectGrokAuthMethod: () => selectGrokAuthMethod
});
function authMethodIds(initialized) {
	return (Array.isArray(initialized.authMethods) ? initialized.authMethods : []).map((method) => asRecord(method)).map((method) => method?.id).filter((id) => typeof id === "string");
}
function selectGrokAuthMethod(initialized) {
	const ids = authMethodIds(initialized);
	const preferred = asRecord(initialized._meta)?.defaultAuthMethodId;
	if (typeof preferred === "string" && ids.includes(preferred)) return preferred;
	return ids.includes("cached_token") ? "cached_token" : void 0;
}
function grokInitializeMeta(options) {
	return {
		clientIdentifier: "oar",
		clientType: "generic",
		startupHints: {
			nonInteractive: true,
			skipGitStatus: true,
			skipProjectLayout: true
		},
		...options.systemPrompt === void 0 ? {} : { systemPromptOverride: options.systemPrompt },
		...options.appendSystemPrompt === void 0 ? {} : { rules: options.appendSystemPrompt }
	};
}
function firstNumber(record, names) {
	for (const name of names) {
		const value = asNumber(record?.[name]);
		if (value !== null) return value;
	}
	return null;
}
/** Grok prompt responses carry an authoritative usage snapshot in `_meta`. */
function grokContextUsage(response) {
	const meta = asRecord(response._meta);
	const tokens = firstNumber(meta, ["totalTokens", "contextTokens"]);
	const contextWindow = firstNumber(meta, [
		"contextWindow",
		"context_window",
		"maxContextTokens"
	]);
	if (tokens === null && contextWindow === null) return null;
	return {
		tokens,
		contextWindow,
		percent: tokens === null || contextWindow === null || contextWindow === 0 ? null : Math.round(tokens / contextWindow * 100)
	};
}
/**
* The tokens one prompt answer bills: `_meta.usage` is the prompt's ledger
* summed over its model calls (grok 1.0.25, live 2026-09-11: three one-word
* turns billed ~16.8k input each, not a growing total; a steered turn's
* closing answer summed its two calls). `inputTokens` includes the cached
* reads (`cachedReadTokens` ≤ it) and may include a child's model calls
* when it finishes during the parent prompt (live-grok-c/subagent seq 159 = the four
* `response_completed` frames 48+78+119+155, two of them the child's). The
* turn machinery shares its accumulator with independent root wake ledgers
* (spontaneous-usage.ts). Late background child usage can still be absent;
* will_wake does not identify ledger inclusion
* (experiments/grok-background-usage-2026-10-10.md).
* The same ledger's `cachedReadTokens`
* is the cache-read part of that input and `cacheCreationTokens` the
* cache-write part (live 1.0.25 basic answer: 1280 and 0); each is read only
* when the ledger carries it.
*/
function grokPromptTokens(response) {
	const usage = asRecord(asRecord(response._meta)?.usage);
	const input = firstNumber(usage, ["inputTokens", "input_tokens"]);
	const output = firstNumber(usage, ["outputTokens", "output_tokens"]);
	if (usage === null || input === null || output === null) return null;
	return {
		input,
		output,
		...cacheParts(usage, {
			read: "cachedReadTokens",
			write: "cacheCreationTokens"
		}),
		...reasoningPart(usage, "reasoningTokens")
	};
}
var GROK_EXTENSION_NOTIFICATIONS, grokAcpProfile, grokSession;
var init_session$2 = __esmMin((() => {
	init_session_options();
	init_options$2();
	init_errors$1();
	init_session$4();
	init_json();
	init_token_totals();
	init_failure();
	init_spontaneous_usage();
	init_credential_redaction();
	GROK_EXTENSION_NOTIFICATIONS = [
		"_x.ai/session_notification",
		"_x.ai/sessions/changed",
		"_x.ai/session/prompt_complete",
		"_x.ai/queue/changed",
		"_x.ai/models/update",
		"_x.ai/settings/update",
		"_x.ai/announcements/update",
		"_x.ai/mcp/servers_updated",
		"_x.ai/mcp/init_progress",
		"_x.ai/mcp/server_status",
		"_x.ai/mcp_initialized",
		"_x.ai/session/update",
		"_x.ai/task_backgrounded",
		"_x.ai/task_completed",
		"_x.ai/session/usage"
	];
	grokAcpProfile = {
		args: [
			"agent",
			"--always-approve",
			"--no-leader",
			"stdio"
		],
		isResumeNotFound: (native) => asRecord(native.data)?.code === "FS_NOT_FOUND",
		withLaunchArgs: (args, launchArgs) => [
			...args.slice(0, -1),
			...launchArgs,
			...args.slice(-1)
		],
		capabilities: {
			queue: { durable: false },
			attribution: "nested",
			images: true
		},
		extensionNotifications: GROK_EXTENSION_NOTIFICATIONS,
		redactExtensionNotification: redactGrokNotification,
		failureOutcome: grokFailureOutcome,
		terminalShellCommand: true,
		initializeMeta: grokInitializeMeta,
		validateOptions: (options) => {
			refuseSessionOptions(grokRefusedSessionOptions, options);
			if (options.systemPrompt !== void 0 && options.systemPrompt.trim() === "") throw new UnsupportedOptionError("systemPrompt", "grok treats a blank systemPrompt as omitted (observed on 1.0.52)");
			if (options.resume !== void 0 && options.appendSystemPrompt !== void 0 && options.systemPrompt === void 0) throw new UnsupportedOptionError("appendSystemPrompt", "grok does not reapply rules when resuming a session (observed on 1.0.52)");
		},
		sessionMeta: () => ({ yoloMode: true }),
		selectAuthMethod: selectGrokAuthMethod,
		steerParams: () => ({ _meta: { sendNow: true } }),
		steerSupersedesPrompt: true,
		promptMeta: (options) => options.outputSchema === void 0 ? void 0 : { outputSchema: options.outputSchema },
		promptOutcome: grokPromptOutcome,
		promptContextUsage: grokContextUsage,
		promptTokenUsage: grokPromptTokens,
		spontaneousTokenUsage: grokSpontaneousTokens
	};
	grokSession = acpSession(grokAcpProfile);
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/account-usage.js
var account_usage_exports = /* @__PURE__ */ __exportAll({
	grokAccountEmail: () => grokAccountEmail,
	grokAccountUsage: () => grokAccountUsage,
	projectGrokUsage: () => projectGrokUsage
});
function centValue(value) {
	return asNumber(asRecord(value)?.val);
}
function resetInstant$1(value) {
	if (typeof value !== "string") return;
	return utcInstantFromDate(new Date(value)) ?? void 0;
}
function periodLabel(value) {
	if (typeof value !== "string") return "Included usage";
	const normalized = value.replace(/^USAGE_PERIOD_TYPE_/u, "").toLowerCase();
	return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)} included usage`;
}
/** Extract identity only from Grok's authenticated `_x.ai/auth/info` result. */
function grokAccountEmail(result) {
	const email = asRecord(result)?.email;
	if (typeof email !== "string") return;
	const trimmed = email.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function projectGrokUsage(result, email) {
	const root = asRecord(result);
	const config = asRecord(root?.config);
	if (config === null) return {
		kind: "unsupported",
		reason: "quota_unavailable"
	};
	const missingMetrics = [
		config.creditUsagePercent,
		config.used,
		config.monthlyLimit
	].every((value) => value === null || value === void 0);
	const explicitPercent = asNumber(config.creditUsagePercent);
	const used = centValue(config.used);
	const limit = centValue(config.monthlyLimit);
	const usedPercent = explicitPercent ?? (used !== null && limit !== null && limit > 0 ? used / limit * 100 : null) ?? (missingMetrics ? 0 : null);
	if (usedPercent === null || usedPercent < 0) throw new Error("Grok returned no usable account usage percentage");
	const period = asRecord(config.currentPeriod);
	const resetsAt = resetInstant$1(period?.end ?? config.billingPeriodEnd);
	const prepaidBalance = Math.abs(centValue(config.prepaidBalance) ?? 0);
	const onDemandCap = centValue(config.onDemandCap) ?? 0;
	const legacyOnDemandUsed = used !== null && limit !== null ? Math.max(0, used - limit) : 0;
	const onDemandUsed = centValue(config.onDemandUsed) ?? legacyOnDemandUsed;
	const onDemandRatio = onDemandCap > 0 ? Math.max(0, Math.min(1, onDemandUsed / onDemandCap)) : null;
	const windows = [{
		label: periodLabel(period?.type),
		usedRatio: Number(Math.min(1, usedPercent / 100).toFixed(6)),
		...resetsAt === void 0 ? {} : { resetsAt }
	}, ...onDemandRatio === null ? [] : [{
		label: "Pay-as-you-go",
		usedRatio: Number(onDemandRatio.toFixed(6)),
		...resetsAt === void 0 ? {} : { resetsAt }
	}]];
	const rawPlan = root?.subscription_tier ?? root?.subscriptionTier;
	const plan = typeof rawPlan === "string" && rawPlan.trim().length > 0 ? rawPlan.trim() : void 0;
	const rateLimited = usedPercent >= 100 && prepaidBalance === 0 && (onDemandRatio === null || onDemandRatio >= 1);
	return {
		kind: "available",
		...plan === void 0 ? {} : { plan },
		...email === void 0 ? {} : { email },
		rateLimited,
		windows
	};
}
async function readBilling(command, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	const runtime = startAcpProcess(command, [
		"agent",
		"--always-approve",
		"--no-leader",
		"stdio"
	], client({ name: "oar" }), { env: process.env });
	try {
		const initialize = methods.agent.initialize;
		const method = selectGrokAuthMethod(asRecord(await withAcpDeadline(runtime, initialize, remainingMs(deadline, USAGE), (requestOptions) => runtime.connection.agent.request(initialize, {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {
				fs: {
					readTextFile: false,
					writeTextFile: false
				},
				terminal: false
			},
			clientInfo: {
				name: "oar",
				version: "0.0.0"
			},
			_meta: grokInitializeMeta({ cwd: process.cwd() })
		}, requestOptions))) ?? {});
		if (method !== void 0) {
			const authenticate = methods.agent.authenticate;
			await withAcpDeadline(runtime, authenticate, remainingMs(deadline, USAGE), (requestOptions) => runtime.connection.agent.request(authenticate, { methodId: method }, requestOptions));
		}
		const billing = await withAcpDeadline(runtime, "_x.ai/billing", remainingMs(deadline, USAGE), (requestOptions) => runtime.connection.agent.request("_x.ai/billing", {}, requestOptions));
		let email = void 0;
		try {
			email = grokAccountEmail(await withAcpDeadline(runtime, "_x.ai/auth/info", remainingMs(deadline, USAGE), (requestOptions) => runtime.connection.agent.request("_x.ai/auth/info", {}, requestOptions)));
		} catch {
			email = void 0;
		}
		return {
			billing,
			...email === void 0 ? {} : { email }
		};
	} finally {
		runtime.kill();
		await runtime.exited;
	}
}
var USAGE, grokAccountUsage;
var init_account_usage = __esmMin((() => {
	init_process();
	init_deadline();
	init_instant();
	init_json();
	init_session$2();
	USAGE = "Grok account usage";
	grokAccountUsage = async (installation, options = {}) => {
		if (installation.via !== "executable") return {
			kind: "unsupported",
			reason: "unsupported_installation"
		};
		try {
			const payload = await readBilling(installation.command, options.timeoutMs ?? 3e4);
			return projectGrokUsage(payload.billing, payload.email);
		} catch (error) {
			if (error instanceof RequestError) {
				if (error.code === -32601) return {
					kind: "unsupported",
					reason: "endpoint_unavailable"
				};
				if (error.code === -32e3 || /auth(?:entication)?|log(?:ged)? ?in/iu.test(error.message)) return {
					kind: "reauth_required",
					reason: "not_authenticated"
				};
			}
			throw new Error("Failed to read Grok account usage", { cause: error });
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/list-models.js
var list_models_exports$1 = /* @__PURE__ */ __exportAll({
	grokListModels: () => grokListModels,
	grokModelState: () => grokModelState,
	projectGrokModels: () => projectGrokModels
});
function text$6(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Unwrap the `_x.ai/models/list` result. The JSON-RPC result carries a second
* envelope, `{result: SessionModelState}` or `{error}`; a handler error wins
* over any result, matching grok's own client.
*/
function grokModelState(result) {
	const envelope = asRecord(result) ?? {};
	if (envelope.error !== void 0) {
		const detail = text$6(asRecord(envelope.error)?.message) ?? text$6(envelope.error) ?? JSON.stringify(envelope.error);
		throw new Error(`grok models/list handler error: ${detail}`);
	}
	return asRecord(envelope.result) ?? envelope;
}
/**
* Project a `SessionModelState`. Grok already filters to what the current
* auth can use; entries still flagged `hidden` or not `user_selectable` are
* dropped here as well. Both camel- and snake-case field spellings are read
* because the extension's Rust serialization has changed between releases.
*
* The effort menu moved under the entry's `_meta` ([env] grok 1.0.41,
* 2026-09-29: `_meta: {supportsReasoningEffort, reasoningEffort: "high",
* reasoningEfforts: [{id, value, label, description, default}]}`); the
* top-level spellings of older builds are still read. It is the same menu
* the session's `reasoning_effort` config option offers for that model.
*/
function projectGrokModels(state) {
	const root = asRecord(state) ?? {};
	const models = asRecordList(root.availableModels ?? root.available_models);
	const current = text$6(root.currentModelId ?? root.current_model_id);
	const entries = [];
	for (const model of models) {
		const id = text$6(model.modelId ?? model.model_id ?? model.id);
		if (id === void 0) continue;
		if (model.hidden === true || model.user_selectable === false || model.userSelectable === false) continue;
		const displayName = text$6(model.displayName ?? model.display_name ?? model.name);
		const meta = asRecord(model._meta) ?? {};
		const supportsEffort = meta.supportsReasoningEffort !== false;
		const effortLevels = supportsEffort ? effortLevelsOf(model.reasoningEfforts ?? model.reasoning_efforts ?? meta.reasoningEfforts ?? meta.reasoning_efforts) : void 0;
		const defaultEffort = supportsEffort ? effortLevelOf(model.defaultReasoningEffort ?? model.default_reasoning_effort ?? model.reasoningEffort ?? model.reasoning_effort ?? meta.reasoningEffort ?? meta.reasoning_effort) : void 0;
		entries.push({
			id,
			...displayName === void 0 ? {} : { displayName },
			...effortLevels === void 0 ? {} : { effortLevels },
			...defaultEffort === void 0 ? {} : { defaultEffort },
			...id === current ? { default: true } : {}
		});
	}
	return entries;
}
async function readModelState(command, cwd, timeoutMs) {
	const runtime = startAcpProcess(command, [
		"agent",
		"--always-approve",
		"--no-leader",
		"stdio"
	], client({ name: "oar" }), {
		cwd,
		env: process.env
	});
	try {
		const initialize = methods.agent.initialize;
		const method = selectGrokAuthMethod(asRecord(await withAcpDeadline(runtime, initialize, timeoutMs, (requestOptions) => runtime.connection.agent.request(initialize, {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {
				fs: {
					readTextFile: false,
					writeTextFile: false
				},
				terminal: false
			},
			clientInfo: {
				name: "oar",
				version: "0.0.0"
			},
			_meta: grokInitializeMeta({ cwd })
		}, requestOptions))) ?? {});
		if (method !== void 0) {
			const authenticate = methods.agent.authenticate;
			await withAcpDeadline(runtime, authenticate, timeoutMs, (requestOptions) => runtime.connection.agent.request(authenticate, { methodId: method }, requestOptions));
		}
		return grokModelState(await withAcpDeadline(runtime, "_x.ai/models/list", timeoutMs, (requestOptions) => runtime.connection.agent.request("_x.ai/models/list", {}, requestOptions)));
	} finally {
		runtime.kill();
		await runtime.exited;
	}
}
var grokListModels;
var init_list_models$1 = __esmMin((() => {
	init_process();
	init_effort_levels();
	init_json();
	init_listing_cwd();
	init_session$2();
	grokListModels = async (installation, options = {}) => {
		if (installation.via !== "executable") return {
			kind: "unsupported",
			reason: "grok model listing requires the grok executable"
		};
		try {
			return {
				kind: "ok",
				models: projectGrokModels(await readModelState(installation.command, listingCwd(options), options.timeoutMs ?? 1e4))
			};
		} catch (error) {
			if (error instanceof RequestError) {
				if (error.code === -32601) return {
					kind: "unsupported",
					reason: "this grok build has no _x.ai/models/list method"
				};
				if (error.code === -32e3 || /auth(?:entication)?|log(?:ged)? ?in/iu.test(error.message)) return {
					kind: "unauthenticated",
					detail: error.message
				};
			}
			throw new Error("Failed to list Grok models", { cause: error });
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/grok/index.js
init_options$2();
const grokRuntime = defineRuntime({
	id: "grok",
	brand: runtimeBrands.grok,
	refusedSessionOptions: grokRefusedSessionOptions,
	mcpToolsListChanged: "none",
	skills: grokSkills,
	mcpServers: grokMcpServers,
	installation: grokInstallation,
	installPlan: grokInstallPlan,
	install: grokInstall,
	accountUsage: onFirstCall(async () => {
		const { grokAccountUsage } = await Promise.resolve().then(() => (init_account_usage(), account_usage_exports));
		return grokAccountUsage;
	}),
	listModels: onFirstCall(async () => {
		const { grokListModels } = await Promise.resolve().then(() => (init_list_models$1(), list_models_exports$1));
		return grokListModels;
	}),
	checkUpdate: grokCheckUpdate,
	upgrade: grokUpgrade,
	session: onFirstCall(async () => {
		const { grokSession } = await Promise.resolve().then(() => (init_session$2(), session_exports$2));
		return grokSession;
	})
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/auth-config.js
init_executable();
init_diagnostics();
init_deadline();
init_json();
const MANAGED_PROVIDER = "managed:kimi-code";
const DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";
const DEFAULT_OAUTH_HOST = "https://auth.kimi.com";
const DEFAULT_OAUTH_KEY = "oauth/kimi-code";
function text$5(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function normalizedEndpoint(value) {
	return value.trim().replace(/\/+$/u, "");
}
function oauthKey(oauthHost, baseUrl) {
	const normalizedHost = normalizedEndpoint(oauthHost);
	const normalizedBase = normalizedEndpoint(baseUrl);
	if (normalizedHost === DEFAULT_OAUTH_HOST && normalizedBase === DEFAULT_BASE_URL) return DEFAULT_OAUTH_KEY;
	return `oauth/kimi-code-env-${createHash("sha256").update(JSON.stringify({
		oauthHost: normalizedHost,
		baseUrl: normalizedBase
	})).digest("hex").slice(0, 16)}`;
}
function storageName(key) {
	const candidate = key.startsWith("oauth/") ? key.slice(6) : key;
	if (candidate.length === 0 || candidate.startsWith(".") || basename(candidate) !== candidate) throw new Error("Kimi returned an invalid OAuth credential key");
	return candidate;
}
const KIMI_USAGE = "Kimi account usage";
/**
* Resolve Kimi's own managed provider, environment, and credential slot. Null
* when kimi answers without one; a run that timed out or never ran rejects.
*/
async function resolveKimiAuth(command, deadline) {
	const result = await runExecutable(command, [
		"provider",
		"list",
		"--json"
	], {
		env: process.env,
		timeoutMs: remainingMs(deadline, KIMI_USAGE)
	});
	assertRan(result, `Failed to run ${command} provider list --json`);
	if (!result.ok) return null;
	const provider = asRecord(asRecord(asRecord(parseJson(result.stdout))?.providers)?.[MANAGED_PROVIDER]);
	if (provider === null || provider.type !== "kimi") return null;
	const configuredOAuth = asRecord(provider.oauth);
	const envBaseUrl = text$5(process.env.KIMI_CODE_BASE_URL);
	const envOAuthHost = text$5(process.env.KIMI_CODE_OAUTH_HOST ?? process.env.KIMI_OAUTH_HOST);
	const hasEnvironmentOverride = envBaseUrl !== void 0 || envOAuthHost !== void 0;
	const baseUrl = normalizedEndpoint(envBaseUrl ?? text$5(provider.baseUrl) ?? DEFAULT_BASE_URL);
	const oauthHost = normalizedEndpoint(envOAuthHost ?? text$5(configuredOAuth?.oauthHost) ?? DEFAULT_OAUTH_HOST);
	const expectedKey = oauthKey(oauthHost, baseUrl);
	const configuredKey = text$5(configuredOAuth?.key);
	const selectedKey = !hasEnvironmentOverride && configuredKey === expectedKey ? configuredKey : expectedKey;
	const configuredStorage = text$5(configuredOAuth?.storage);
	const selectedStorage = !hasEnvironmentOverride && configuredKey === expectedKey && configuredStorage !== void 0 && configuredStorage !== "file" ? "other" : "file";
	const home = text$5(process.env.KIMI_CODE_HOME) ?? join(homedir(), ".kimi-code");
	const selectedStorageName = storageName(selectedKey);
	return {
		baseUrl,
		oauthHost,
		storage: selectedStorage,
		storageName: selectedStorageName,
		home,
		credentialPath: join(home, "credentials", `${selectedStorageName}.json`)
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/oauth-token.js
init_json();
/** The stored credential is unusable; the account needs `kimi` re-auth. */
var KimiReauthError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "KimiReauthError";
	}
};
function text$4(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Read Kimi's stored OAuth access token as-is. The credential store belongs to
* the Kimi CLI, so oar never refreshes or rewrites it; a stale token surfaces
* as the usage endpoint's 401/403, which callers map to reauth_required.
*/
async function storedKimiAccessToken(auth) {
	const accessToken = await readAccessToken(auth.credentialPath);
	if (accessToken === void 0) throw new KimiReauthError("No Kimi OAuth token is stored");
	return accessToken;
}
async function readAccessToken(path) {
	try {
		return text$4(asRecord(parseJson(await readFile(path, "utf8")))?.access_token);
	} catch {
		return;
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/profile.js
init_deadline();
init_json();
function text$3(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/** Extract identity only from Kimi's authenticated `/me` profile shape. */
function kimiAccountEmail(payload) {
	const profile = asRecord(payload);
	return text$3(profile?.user_id) === void 0 ? void 0 : text$3(profile?.email);
}
/** Extract the human-readable membership level reported by Kimi's `/me` profile. */
function kimiAccountPlan(payload) {
	const profile = asRecord(payload);
	return text$3(profile?.user_id) === void 0 ? void 0 : text$3(profile?.user_level_name);
}
/**
* Extract the profile nickname from Kimi's authenticated `/me` profile. Phone or
* WeChat sign-ins have no email, so this is often the only readable identity.
*/
function kimiAccountDisplayName(payload) {
	const profile = asRecord(payload);
	return text$3(profile?.user_id) === void 0 ? void 0 : text$3(profile?.nickname);
}
async function fetchKimiAccountIdentity(auth, accessToken, deadline) {
	try {
		const response = await fetch(`${auth.baseUrl}/me`, {
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"Accept": "application/json"
			},
			signal: AbortSignal.timeout(remainingMs(deadline, KIMI_USAGE))
		});
		if (!response.ok) return {};
		const profile = parseJson(await response.text());
		const email = kimiAccountEmail(profile);
		const plan = kimiAccountPlan(profile);
		const displayName = kimiAccountDisplayName(profile);
		return {
			...email === void 0 ? {} : { email },
			...plan === void 0 ? {} : { plan },
			...displayName === void 0 ? {} : { displayName }
		};
	} catch {
		return {};
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/account-usage.js
init_instant();
init_deadline();
init_json();
function text$2(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function numeric(value) {
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
	}
	const parsed = asNumber(value);
	return parsed === null ? null : Math.trunc(parsed);
}
function resetInstant(value) {
	if (typeof value !== "string") return;
	return utcInstantFromDate(new Date(value)) ?? void 0;
}
function usageUnit(value) {
	switch (value) {
		case "TIME_UNIT_MINUTE": return "minute";
		case "TIME_UNIT_HOUR": return "hour";
		case "TIME_UNIT_DAY": return "day";
		case "TIME_UNIT_WEEK": return "week";
		default: return;
	}
}
function usageWindow(value) {
	const record = asRecord(value);
	const duration = numeric(record?.duration);
	const unit = usageUnit(record?.timeUnit);
	if (duration === null || duration <= 0 || unit === void 0) return;
	if (unit === "minute" && duration >= 60 && duration % 60 === 0) return {
		duration: duration / 60,
		unit: "hour"
	};
	return {
		duration,
		unit
	};
}
function usageRow(value, extra = {}) {
	const record = asRecord(value);
	const used = numeric(record?.used);
	const limit = numeric(record?.limit);
	if (used === null && limit === null) return null;
	const name = extra.name ?? text$2(record?.name);
	const resetsAt = resetInstant(record?.resetTime);
	return {
		...name === void 0 ? {} : { name },
		...extra.window === void 0 ? {} : { window: extra.window },
		used: used ?? 0,
		limit: limit ?? 0,
		...resetsAt === void 0 ? {} : { resetsAt }
	};
}
function usageLabel(row) {
	const window = row.window;
	if (window !== void 0) {
		if (window.unit === "week") return "Weekly limit";
		return `${window.duration}${window.unit.charAt(0)} limit`;
	}
	return row.name ?? "Limit";
}
function projectWindow(row) {
	if (row.limit <= 0 || row.used < 0) return null;
	return {
		label: usageLabel(row),
		usedRatio: Number(Math.max(0, Math.min(1, row.used / row.limit)).toFixed(6)),
		...row.resetsAt === void 0 ? {} : { resetsAt: row.resetsAt }
	};
}
function moneyCents(value) {
	const cents = numeric(asRecord(value)?.priceInCents);
	return cents === null || cents < 0 ? null : cents;
}
function boosterWallet(value) {
	const record = asRecord(value);
	const balance = asRecord(record?.balance);
	const total = numeric(balance?.amount);
	if (balance?.type !== "BOOSTER" || total === null || total <= 0) return null;
	const amountLeft = numeric(balance.amountLeft) ?? 0;
	const limit = record?.monthlyChargeLimitEnabled === true ? moneyCents(record.monthlyChargeLimit) : null;
	return {
		balance: Math.max(0, amountLeft),
		monthlyLimit: limit !== null && limit > 0 ? limit : null,
		monthlyUsed: moneyCents(record?.monthlyUsed) ?? 0
	};
}
/** Project the same managed quota rows that Kimi Code 0.38.0 renders in `/usage`. */
function projectKimiUsage(payload, email, plan, displayName) {
	const root = asRecord(payload);
	const rows = [];
	const summary = usageRow(root?.usage, { window: {
		duration: 1,
		unit: "week"
	} });
	if (summary !== null) rows.push(summary);
	const limits = root?.limits;
	if (Array.isArray(limits)) for (const value of limits) {
		const limit = asRecord(value);
		const name = text$2(limit?.name);
		const window = usageWindow(limit?.window);
		const row = usageRow(limit?.detail, {
			...name === void 0 ? {} : { name },
			...window === void 0 ? {} : { window }
		});
		if (row !== null) rows.push(row);
	}
	const windows = rows.map((row) => projectWindow(row)).filter((window) => window !== null);
	const extraUsage = boosterWallet(root?.boosterWallet);
	if (extraUsage?.monthlyLimit !== null && extraUsage?.monthlyLimit !== void 0) windows.push({
		label: "Extra Usage monthly limit",
		usedRatio: Number(Math.min(1, extraUsage.monthlyUsed / extraUsage.monthlyLimit).toFixed(6))
	});
	const extraUsageHeadroom = extraUsage !== null && extraUsage.balance > 0 && (extraUsage.monthlyLimit === null || extraUsage.monthlyUsed < extraUsage.monthlyLimit);
	return {
		kind: "available",
		...plan === void 0 ? {} : { plan },
		...email === void 0 ? {} : { email },
		...displayName === void 0 ? {} : { displayName },
		rateLimited: rows.some((row) => projectWindow(row)?.usedRatio === 1) && !extraUsageHeadroom,
		windows
	};
}
async function fetchUsage(auth, accessToken, deadline) {
	try {
		return await fetch(`${auth.baseUrl}/usages`, {
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"Accept": "application/json"
			},
			signal: AbortSignal.timeout(remainingMs(deadline, KIMI_USAGE))
		});
	} catch (error) {
		throw new Error("Failed to reach Kimi usage endpoint", { cause: error });
	}
}
const kimiAccountUsage = async (installation, options = {}) => {
	if (installation.via !== "executable") return {
		kind: "unsupported",
		reason: "unsupported_installation"
	};
	const deadline = Date.now() + (options.timeoutMs ?? 3e4);
	const auth = await resolveKimiAuth(installation.command, deadline);
	if (auth === null) return {
		kind: "unsupported",
		reason: "auth_configuration_unavailable"
	};
	if (auth.storage !== "file") return {
		kind: "unsupported",
		reason: "unsupported_auth_storage"
	};
	try {
		const accessToken = await storedKimiAccessToken(auth);
		const [response, identity] = await Promise.all([fetchUsage(auth, accessToken, deadline), fetchKimiAccountIdentity(auth, accessToken, deadline)]);
		if (response.status === 401 || response.status === 403) return {
			kind: "reauth_required",
			reason: "credentials_rejected"
		};
		if (response.status === 404) return {
			kind: "unsupported",
			reason: "endpoint_unavailable"
		};
		if (!response.ok) throw new Error(`Kimi usage endpoint returned HTTP ${response.status}`);
		return projectKimiUsage(parseJson(await response.text()), identity.email, identity.plan, identity.displayName);
	} catch (error) {
		if (error instanceof KimiReauthError) return {
			kind: "reauth_required",
			reason: "credentials_missing"
		};
		throw new Error("Failed to read Kimi account usage", { cause: error });
	}
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/installation.js
/** Official native-installer layouts that can be invisible to GUI-process PATH. */
function kimiInstalledExecutableCandidates(platform = process.platform, home = homedir(), env = process.env) {
	const paths = platform === "win32" ? path.win32 : path.posix;
	const executable = platform === "win32" ? "kimi.exe" : "kimi";
	return [
		...env.KIMI_INSTALL_DIR === void 0 || env.KIMI_INSTALL_DIR === "" ? [] : [paths.join(env.KIMI_INSTALL_DIR, "bin", executable)],
		paths.join(home, ".kimi-code", "bin", executable),
		"kimi-code"
	];
}
const kimiInstallation = executableInstallation("OAR_KIMI_BIN", "kimi", kimiInstalledExecutableCandidates, ["acp", "--help"], {
	readinessTimeoutMs: 3e4,
	versionTimeoutMs: 3e4
});
const kimiInstallPlan = scriptInstallPlan({
	source: "https://github.com/MoonshotAI/kimi-code#install",
	line: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
	tools: ["curl", "bash"],
	writes: () => {
		const home = path.join(homedir(), ".kimi-code");
		return [installDir(process.env.KIMI_INSTALL_DIR, home), installDir(process.env.KIMI_CODE_HOME, home)];
	},
	windows: "Moonshot documents, in PowerShell: irm https://code.kimi.com/kimi-code/install.ps1 | iex"
});
const kimiInstall = planInstaller(kimiInstallation, kimiInstallPlan);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/update.js
const sources = {
	mainland: "https://code.kimi.com/kimi-code/latest",
	global: "https://code.kimi.ai/kimi-code/latest",
	home: () => process.env.KIMI_CODE_HOME ?? path.join(homedir(), ".kimi-code")
};
/** `upgrade -y` arrived in kimi 0.43.0; before it the upgrade only runs from a terminal prompt. */
const NON_INTERACTIVE_UPGRADE = "0.43.0";
function region(home) {
	try {
		return readFileSync(path.join(home, "region"), "utf8").trim();
	} catch {
		return "";
	}
}
function kimiUpdateCheck(from = sources) {
	return async (installation, options = {}) => {
		const update = executableUpdate(installation);
		if (update.kind === "unavailable") return update.check;
		if (installedPath(update.installation.command).includes("/Cellar/")) return {
			kind: "unavailable",
			reason: "package_manager",
			detail: "this copy updates through Homebrew"
		};
		const url = region(from.home()) === "global" ? from.global : from.mainland;
		const read = await readReleaseSource(url, options.timeoutMs ?? 2e4);
		if (!read.ok) return read.check;
		const check = comparedCheck(update.installed, read.text.trim(), url);
		return check.kind === "ok" ? {
			...check,
			updateAvailable: !versionAtLeast(check.installed, check.latest)
		} : check;
	};
}
const kimiCheckUpdate = kimiUpdateCheck();
function kimiUpgrader(check = kimiCheckUpdate) {
	return async (installation, options) => {
		const update = executableUpdate(installation);
		if (update.kind === "executable" && !versionAtLeast(update.installed, NON_INTERACTIVE_UPGRADE)) return {
			kind: "unsupported",
			reason: "requires_terminal",
			detail: `kimi ${update.installed} has no non-interactive upgrade (added in ${NON_INTERACTIVE_UPGRADE}); run kimi upgrade in a terminal`
		};
		return await upgradeExecutable(installation, {
			check,
			args: ["upgrade", "-y"]
		}, options);
	};
}
const kimiUpgrade = kimiUpgrader();
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/options.js
var kimiRefusedSessionOptions;
var init_options$1 = __esmMin((() => {
	kimiRefusedSessionOptions = {
		outputSchema: "Kimi ACP and launch configuration expose no final-output schema channel",
		name: "kimi exposes no verified session name setting",
		serviceTier: "kimi exposes no verified per-session service-tier setting and readback",
		disallowedTools: "kimi ACP exposes no session tool denylist; its agent-profile disallowedTools cannot be overlaid through the ACP launch or session options",
		systemPrompt: "kimi acp has no per-session system prompt input; its launcher does not forward --agent-file or --agent",
		appendSystemPrompt: "kimi acp has no per-session system prompt append input; its launcher does not forward --agent-file or --agent"
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/session.js
var session_exports$1 = /* @__PURE__ */ __exportAll({
	kimiAcpProfile: () => kimiAcpProfile,
	kimiSession: () => kimiSession,
	selectKimiAuthMethod: () => selectKimiAuthMethod,
	supportsKimiYolo: () => supportsKimiYolo
});
function selectKimiAuthMethod(initialized) {
	return (Array.isArray(initialized.authMethods) ? initialized.authMethods : []).map((method) => asRecord(method)).some((method) => method?.id === "login") ? "login" : void 0;
}
function supportsKimiYolo(response) {
	const modes = asRecord(response.modes);
	if ((Array.isArray(modes?.availableModes) ? modes.availableModes : []).map((mode) => asRecord(mode)).some((mode) => mode?.id === "yolo")) return true;
	const mode = (Array.isArray(response.configOptions) ? response.configOptions : []).map((option) => asRecord(option)).find((option) => option?.id === "mode");
	return (Array.isArray(mode?.options) ? mode.options : []).map((value) => asRecord(value)).some((option) => option?.value === "yolo");
}
var kimiAcpProfile, kimiSession;
var init_session$1 = __esmMin((() => {
	init_session$4();
	init_options$1();
	init_json();
	init_session_options();
	init_errors$1();
	kimiAcpProfile = {
		args: ["acp"],
		capabilities: {
			queue: { durable: false },
			attribution: "opaque"
		},
		requestTimeoutMs: 3e4,
		selectAuthMethod: selectKimiAuthMethod,
		validateOptions: (options) => {
			refuseSessionOptions(kimiRefusedSessionOptions, options);
			if (options.resume !== void 0 && (options.additionalDirectories?.length ?? 0) > 0) throw new UnsupportedOptionError("additionalDirectories", "kimi applies additionalDirectories only when creating a session; they have no effect on resume");
		},
		usageUpdateAfterPrompt: true,
		resumeKeepsSessionCwd: true,
		isResumeNotFound: (_native, listed) => listed === false,
		configureSession: async ({ request, sessionId, response }) => {
			if (supportsKimiYolo(response)) await request("session/set_mode", {
				sessionId,
				modeId: "yolo"
			});
		}
	};
	kimiSession = acpSession(kimiAcpProfile);
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/list-models.js
var list_models_exports = /* @__PURE__ */ __exportAll({
	kimiListModels: () => kimiListModels,
	projectKimiModels: () => projectKimiModels
});
function text$1(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function configOption(response, id) {
	return asRecordList(response.configOptions).find((option) => option.id === id);
}
/**
* Project a `session/new` response. Kimi has no model-list method; the usable
* list for the logged-in account rides on every new session as the
* `configOptions` entry with id `model` (acp-server config-options.ts). The
* effort menu is the option in ACP's `thought_level` category (kimi 2.0.0:
* id `thinking`, low/high/max on k3), the same lookup the session uses to
* apply `SessionOptions.effort` (shared/acp/model.ts), so what is listed is
* what a session accepts. It is only emitted for the currently selected
* model, so effort levels can only be attached to that entry; an `off` value
* is a toggle, not an effort level, and is dropped.
*/
function projectKimiModels(response) {
	const root = asRecord(response) ?? {};
	const modelOption = configOption(root, "model");
	if (modelOption === void 0) return;
	const current = text$1(modelOption.currentValue);
	const thinking = acpThoughtLevelOption(root) ?? void 0;
	const effortLevels = thinking === void 0 ? void 0 : asRecordList(thinking.options).map((option) => effortLevelOf(option.value)).filter((level) => level !== void 0 && level !== "off");
	const defaultEffort = thinking === void 0 ? void 0 : effortLevelOf(thinking.currentValue);
	const entries = [];
	for (const model of asRecordList(modelOption.options)) {
		const id = text$1(model.value);
		if (id === void 0) continue;
		const displayName = text$1(model.name);
		const isCurrent = id === current;
		entries.push({
			id,
			...displayName === void 0 ? {} : { displayName },
			...isCurrent && effortLevels !== void 0 && effortLevels.length > 0 ? { effortLevels } : {},
			...isCurrent && defaultEffort !== void 0 && defaultEffort !== "off" ? { defaultEffort } : {},
			...isCurrent ? { default: true } : {}
		});
	}
	return entries;
}
async function readNewSession(command, cwd, timeoutMs) {
	const runtime = startAcpProcess(command, ["acp"], client({ name: "oar" }), {
		cwd,
		env: process.env
	});
	try {
		const initialize = methods.agent.initialize;
		const method = selectKimiAuthMethod(asRecord(await withAcpDeadline(runtime, initialize, timeoutMs, (requestOptions) => runtime.connection.agent.request(initialize, {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: {
				fs: {
					readTextFile: false,
					writeTextFile: false
				},
				terminal: false
			},
			clientInfo: {
				name: "oar",
				version: "0.0.0"
			}
		}, requestOptions))) ?? {});
		if (method !== void 0) {
			const authenticate = methods.agent.authenticate;
			await withAcpDeadline(runtime, authenticate, timeoutMs, (requestOptions) => runtime.connection.agent.request(authenticate, { methodId: method }, requestOptions));
		}
		const newSession = methods.agent.session.new;
		const record = asRecord(await withAcpDeadline(runtime, newSession, timeoutMs, (requestOptions) => runtime.connection.agent.request(newSession, {
			cwd,
			mcpServers: []
		}, requestOptions))) ?? {};
		const sessionId = text$1(record.sessionId);
		if (sessionId !== void 0) await closeAcpSession(runtime, sessionId).catch(() => {});
		return record;
	} finally {
		runtime.kill();
		await runtime.exited;
	}
}
var kimiListModels;
var init_list_models = __esmMin((() => {
	init_process();
	init_model();
	init_profile();
	init_effort_levels();
	init_json();
	init_listing_cwd();
	init_session$1();
	kimiListModels = async (installation, options = {}) => {
		if (installation.via !== "executable") return {
			kind: "unsupported",
			reason: "kimi model listing requires the kimi executable"
		};
		try {
			const models = projectKimiModels(await readNewSession(installation.command, listingCwd(options), options.timeoutMs ?? 3e4));
			if (models === void 0) return {
				kind: "unsupported",
				reason: "this kimi build returns no model config option on session/new"
			};
			return {
				kind: "ok",
				models
			};
		} catch (error) {
			if (error instanceof RequestError) {
				if (error.code === -32601) return {
					kind: "unsupported",
					reason: "this kimi build has no session/new method"
				};
				if (error.code === -32e3 || /auth(?:entication)?|log(?:ged)? ?in/iu.test(error.message)) return {
					kind: "unauthenticated",
					detail: error.message
				};
			}
			throw new Error("Failed to list Kimi models", { cause: error });
		}
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/kimi/index.js
init_options$1();
const kimiRuntime = defineRuntime({
	id: "kimi",
	brand: runtimeBrands.kimi,
	installation: kimiInstallation,
	installPlan: kimiInstallPlan,
	install: kimiInstall,
	accountUsage: kimiAccountUsage,
	listModels: onFirstCall(async () => {
		const { kimiListModels } = await Promise.resolve().then(() => (init_list_models(), list_models_exports));
		return kimiListModels;
	}),
	checkUpdate: kimiCheckUpdate,
	upgrade: kimiUpgrade,
	session: onFirstCall(async () => {
		const { kimiSession } = await Promise.resolve().then(() => (init_session$1(), session_exports$1));
		return kimiSession;
	}),
	refusedSessionOptions: kimiRefusedSessionOptions,
	mcpToolsListChanged: "none"
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/installation.js
/**
* The install script's directory, `~/.opencode/bin`, which a GUI process's
* PATH can miss. npm (`opencode-ai`), Homebrew and Scoop copies are on PATH.
*/
function opencodeInstalledExecutableCandidates(platform = process.platform, home = homedir()) {
	return [(platform === "win32" ? path.win32 : path.posix).join(home, ".opencode", "bin", platform === "win32" ? "opencode.exe" : "opencode")];
}
/** `opencode --version` is retained verbatim: v1 prints 1.x; v2 prints "opencode v2.x". */
const opencodeInstallation = executableInstallation("OAR_OPENCODE_BIN", "opencode", opencodeInstalledExecutableCandidates, void 0, { versionTimeoutMs: 15e3 });
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/install.js
/**
* OpenCode ships two major lines of the same `opencode` command in parallel:
* OpenCode 1 (npm `opencode-ai`, 1.x) and OpenCode 2 (npm `@opencode/cli`,
* 2.x, a rewrite with a new plugin and server API). They do not install side
* by side: both install scripts write `~/.opencode/bin/opencode`; the 2
* installer replaces a 1 binary (https://opencode.ai/v2/docs/migrate-v1),
* and the 1 script silently replaces a 2 binary with 1
* (https://github.com/anomalyco/opencode/issues/54084).
* So oar never chooses a line for the person, and an install never runs over
* a copy of either line: the probe finds it first (`already_installed`).
*/
const opencodeInstallLines = [{
	line: "v1",
	description: "OpenCode 1: the opencode-ai 1.x releases"
}, {
	line: "v2",
	description: "OpenCode 2: the @opencode/cli 2.x releases, with a new plugin and server API"
}];
const writes = () => [path.join(homedir(), ".opencode", "bin")];
/**
* Each line's install script as OpenCode documents it first, downloading
* that line's latest release to `~/.opencode/bin/opencode`, never prompting,
* and adding the folder to the shell profile when one exists (it creates
* none). Chosen because each line's own `opencode upgrade` takes that path as
* its `curl` method (v1: packages/opencode/src/installation/index.ts) and
* stays on the line: in the sandbox both answered "Using method: curl".
* OpenCode documents no script for Windows.
*/
const opencodeInstallMethods = {
	v1: {
		source: "https://opencode.ai/docs/#install",
		line: "curl -fsSL https://opencode.ai/install | bash",
		tools: ["curl", "bash"],
		writes,
		windows: "OpenCode recommends WSL, or npm install -g opencode-ai, Scoop or Chocolatey"
	},
	v2: {
		source: "https://opencode.ai/v2/docs/",
		line: "curl -fsSL https://opencode.ai/v2/install | bash",
		tools: ["curl", "bash"],
		writes,
		windows: "OpenCode documents no script for OpenCode 2 there; its packages (npm install -g @opencode/cli) are on https://opencode.ai/v2/docs/"
	}
};
/** `opencode --version`: `1.18.35` on line 1, `opencode v2.0.26` on line 2. */
function opencodeLineOf(installation) {
	const major = (installation.via === "executable" && installation.version !== void 0 ? releaseVersion(installation.version) : void 0)?.split(".")[0];
	return major === void 0 ? void 0 : opencodeInstallLines.find((entry) => entry.line === `v${major}`)?.line;
}
const opencodeInstallPlan = linedInstallPlan({
	lines: opencodeInstallLines,
	methods: opencodeInstallMethods
});
const opencodeInstall = planInstaller(opencodeInstallation, opencodeInstallPlan, opencodeLineOf);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/version.js
/** The two independently maintained native lines share one command name. */
async function opencodeMajor(installation, options) {
	let version = installation.version;
	if (version === void 0) {
		const result = await runExecutable(installation.command, ["--version"], {
			timeoutMs: 15e3,
			...options === void 0 ? {} : {
				cwd: options.cwd,
				env: sessionEnvironment(options.env)
			}
		});
		if (!result.ok) throw processFailure("Failed to identify the opencode release line", result.diagnostics ?? {
			exitCode: result.exitCode,
			signal: null,
			stderr: result.stderr
		});
		version = result.stdout.trim();
	}
	const major = /^(?:opencode\s+)?v?([12])\.\d+\.\d+(?:\S*)$/u.exec(version.trim())?.[1];
	if (major === "1" || major === "2") return major === "1" ? 1 : 2;
	throw new Error(`Unrecognized opencode release line: ${JSON.stringify(version)}`);
}
var init_version = __esmMin((() => {
	init_diagnostics();
	init_run();
	init_environment();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/list-models.js
init_executable();
init_diagnostics();
init_json();
init_listing_cwd();
init_version();
function text(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Project `opencode models --verbose` (1.18.30, cli/cmd/models.ts): for each
* model of every configured provider, a `provider/model` line, then the
* model as indented JSON closed by a `}` line. The `provider/model` line is
* the id `opencode acp` offers in its `model` config option. The model's
* `variants` keys are the values of its `effort` (`thought_level`) option,
* which `SessionOptions.effort` sets (later builds add a `default` value
* there, meaning no variant, which is not a level). No `defaultEffort`: which
* variant a new session starts on is the session's to report.
*/
function projectOpencodeModels(stdout) {
	const lines = stdout.split(/\r?\n/u);
	const entries = [];
	let index = 0;
	while (index < lines.length) {
		const id = /^(\S+\/\S+)$/u.exec(lines[index] ?? "")?.[1];
		index += 1;
		if (id === void 0 || lines[index] !== "{") continue;
		const body = [];
		while (index < lines.length) {
			const line = lines[index] ?? "";
			body.push(line);
			index += 1;
			if (line === "}") break;
		}
		const model = asRecord(parseJson(body.join("\n")));
		const displayName = text(model?.name);
		const effortLevels = Object.keys(asRecord(model?.variants) ?? {});
		const providerId = text(model?.providerID);
		entries.push({
			id,
			...displayName === void 0 ? {} : { displayName },
			...effortLevels.length === 0 ? {} : { effortLevels },
			...providerId === void 0 ? {} : { provider: { id: providerId } }
		});
	}
	return entries;
}
/**
* Reads opencode's model catalog in the listing's cwd, whose project config can
* add providers; the first run after an install also fetches models.dev.
*/
const opencodeListModels = async (installation, options = {}) => {
	if (installation.via !== "executable") return {
		kind: "unsupported",
		reason: "opencode model listing requires the opencode executable"
	};
	const major = await opencodeMajor(installation);
	const result = await runExecutable(installation.command, ["models", major === 2 ? "--standalone" : "--verbose"], {
		cwd: listingCwd(options),
		timeoutMs: options.timeoutMs ?? 3e4
	});
	if (!result.ok) throw processFailure("Failed to list opencode models", result.diagnostics ?? {
		exitCode: result.exitCode,
		signal: null,
		stderr: stderrTail(result.stderr)
	});
	if (major === 1) return {
		kind: "ok",
		models: projectOpencodeModels(result.stdout)
	};
	const ids = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
	if (ids.length === 0) return {
		kind: "unsupported",
		reason: "opencode 2.0.26 models --standalone exits before the cold catalog finishes loading; an empty response does not establish that no models exist (https://github.com/anomalyco/opencode/issues/53724)"
	};
	if (ids.some((id) => !/^\S+\/\S+$/u.test(id))) throw new Error("opencode models --standalone returned an unrecognized model listing");
	return {
		kind: "ok",
		models: ids.map((id) => ({ id }))
	};
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/options.js
var opencodeRefusedSessionOptions, opencodeV1RefusedSessionOptions;
var init_options = __esmMin((() => {
	opencodeRefusedSessionOptions = {
		outputSchema: "OpenCode ACP exposes no final-output schema channel; its HTTP prompt format is not configurable through ACP",
		name: "opencode ACP exposes no verified session name setting",
		serviceTier: "opencode exposes no verified per-session service-tier setting and readback",
		disallowedTools: "opencode ACP has no session tool denylist; global permission rules can be overridden by agent rules and do not use the tool-name vocabulary consistently"
	};
	opencodeV1RefusedSessionOptions = {
		...opencodeRefusedSessionOptions,
		additionalDirectories: "opencode v1 ACP exposes no additional workspace directory setting"
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/attribution.js
var opencodeChildAttribution;
var init_attribution = __esmMin((() => {
	init_json();
	opencodeChildAttribution = (notification) => {
		const envelope = asRecord(notification);
		const update = asRecord(envelope?.update);
		const child = asRecord(asRecord(update?._meta)?.["opencode/child-session"]) ?? asRecord(asRecord(envelope?._meta)?.["opencode/child-session"]);
		if (update === null || typeof child?.id !== "string" || child.id === "" || typeof child.parentID !== "string" || child.parentID === "" || child.id === child.parentID) return null;
		return {
			sessionId: child.id,
			parent: child.parentID
		};
	};
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/prompt-config.js
function validateOpenCodePrompts(options) {
	const option = options.systemPrompt !== void 0 ? "systemPrompt" : "appendSystemPrompt";
	if (options.systemPrompt === void 0 && options.appendSystemPrompt === void 0) return;
	if (sessionEnvironment(options.env).OPENCODE_CONFIG_CONTENT !== void 0) throw new UnsupportedOptionError(option, "opencode prompt options require OPENCODE_CONFIG_CONTENT, which is already set in the effective session environment");
	if (options.systemPrompt === "") throw new UnsupportedOptionError("systemPrompt", "opencode treats an empty agent prompt as its built-in prompt, so it cannot replace the system prompt with an empty string");
}
async function query(command, args, options, run) {
	const result = await run(command, args, {
		cwd: options.cwd,
		env: sessionEnvironment(options.env),
		timeoutMs: 3e4
	});
	const label = `opencode ${args[0] ?? "query"}`;
	if (!result.ok) throw processFailure(`${label} failed while resolving the session's agent`, result.diagnostics ?? {
		exitCode: result.exitCode,
		signal: null,
		stderr: result.stderr
	});
	let parsed = null;
	try {
		parsed = asRecord(JSON.parse(result.stdout));
	} catch {
		throw new Error(`${label} returned invalid JSON while resolving the session's agent`);
	}
	if (parsed === null) throw new Error(`${label} returned no object while resolving the session's agent`);
	return parsed;
}
function savedAgent(exported) {
	const durable = asRecord(exported.info)?.agent;
	if (typeof durable === "string") return durable;
	const messages = Array.isArray(exported.messages) ? exported.messages.map((message) => asRecord(asRecord(message)?.info)) : [];
	const user = messages.findLast((message) => message?.role === "user" && typeof asRecord(message.model)?.providerID === "string" && typeof asRecord(message.model)?.modelID === "string");
	if (user !== void 0) return typeof user?.agent === "string" ? user.agent : void 0;
	const assistant = messages.findLast((message) => typeof message?.providerID === "string" && typeof message.modelID === "string");
	const agent = assistant?.mode ?? assistant?.agent;
	return typeof agent === "string" ? agent : void 0;
}
function existingAgent(config, agent) {
	if (agent !== "build" && agent !== "plan" && asRecord(asRecord(config.agent)?.[agent]) === null) throw new UnsupportedOptionError("systemPrompt", `opencode does not define agent ${JSON.stringify(agent)} in its resolved configuration; refusing to create an agent just to override its prompt`);
	return agent;
}
async function activeAgent(command, options, run) {
	const config = await query(command, ["debug", "config"], options, run);
	if (options.resume !== void 0) {
		const agent = savedAgent(await query(command, [
			"export",
			options.resume,
			"--sanitize"
		], options, run));
		if (agent !== void 0) return existingAgent(config, agent);
	}
	return existingAgent(config, typeof config.default_agent === "string" && config.default_agent !== "" ? config.default_agent : "build");
}
/** Native config overlay only; never copy, merge or rewrite user config. */
async function prepareOpenCodePrompts(command, options, run = runExecutable) {
	validateOpenCodePrompts(options);
	const agent = options.systemPrompt === void 0 ? void 0 : await activeAgent(command, options, run);
	const directory = options.appendSystemPrompt === void 0 ? void 0 : await privateTempDir("oar-opencode-prompt-");
	let removal = void 0;
	const cleanup = async () => {
		if (directory !== void 0) {
			removal ??= rm(directory.path, {
				recursive: true,
				force: true
			});
			await removal;
			directory.remove();
		}
	};
	try {
		const instructions = directory === void 0 ? void 0 : path.join(directory.path, "instructions.md");
		if (instructions !== void 0) await writeFile(instructions, options.appendSystemPrompt ?? "", { mode: 384 });
		const overlay = {
			...agent === void 0 ? {} : { agent: { [agent]: { prompt: options.systemPrompt } } },
			...instructions === void 0 ? {} : { instructions: [instructions] }
		};
		const content = JSON.stringify(overlay).replaceAll(/\{(?=env:|file:)/gu, String.raw`\u007b`);
		return {
			options: {
				...options,
				env: {
					...options.env,
					OPENCODE_CONFIG_CONTENT: content
				}
			},
			...agent === void 0 ? {} : { agent },
			cleanup
		};
	} catch (error) {
		await cleanup();
		throw error;
	}
}
function verifyOpenCodeAgent(response, expected) {
	const actual = (Array.isArray(response.configOptions) ? response.configOptions.map((option) => asRecord(option)) : []).find((option) => option?.category === "mode")?.currentValue ?? asRecord(response.modes)?.currentModeId;
	if (actual !== expected) throw new Error(`opencode selected agent ${actual === void 0 ? "<unreported>" : JSON.stringify(actual)}, but the system prompt was configured for ${JSON.stringify(expected)}`);
}
var init_prompt_config = __esmMin((() => {
	init_environment();
	init_errors$1();
	init_diagnostics();
	init_run();
	init_json();
	init_private_temp();
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/session.js
var session_exports = /* @__PURE__ */ __exportAll({
	opencodeAcpProfile: () => opencodeAcpProfile,
	opencodeSession: () => opencodeSession,
	opencodeV2AcpProfile: () => opencodeV2AcpProfile,
	opencodeV2RefusedSessionOptions: () => opencodeV2RefusedSessionOptions
});
function withPromptCleanup(session, cleanup) {
	let unsubscribe = void 0;
	const observeCleanup = async () => {
		try {
			await cleanup();
		} catch {}
	};
	unsubscribe = session.rawEvents((record) => {
		if (record.kind === "response" && record.body.kind === "exited") {
			observeCleanup();
			unsubscribe?.();
		}
	}, {
		sessionId: session.id,
		afterSeq: -1
	});
	if (session.records().some((record) => record.kind === "response" && record.body.kind === "exited")) unsubscribe();
	let disposal = void 0;
	const release = async () => {
		try {
			await session.dispose();
		} finally {
			unsubscribe();
			await cleanup();
		}
	};
	return {
		...session,
		dispose: async () => {
			disposal ??= release();
			await disposal;
		}
	};
}
var opencodeAcpProfile, directSession, _v1SteerParams, commonProfile, opencodeV2RefusedSessionOptions, opencodeV2AcpProfile, directV2Session, opencodeSession;
var init_session = __esmMin((() => {
	init_session_credentials();
	init_options();
	init_version();
	init_attribution();
	init_session_options();
	init_session$4();
	init_mcp_servers$1();
	init_prompt_config();
	opencodeAcpProfile = {
		args: ["acp"],
		validateOptions: (options) => {
			refuseSessionOptions(opencodeV1RefusedSessionOptions, options);
		},
		capabilities: {
			queue: { durable: false },
			attribution: "opaque"
		},
		requestTimeoutMs: 3e4,
		modelViaConfigOption: true,
		steerParams: () => ({}),
		resumeKeepsSessionCwd: true,
		isResumeNotFound: (_native, listed) => listed === false
	};
	directSession = acpSession(opencodeAcpProfile);
	({steerParams: _v1SteerParams, ...commonProfile} = opencodeAcpProfile);
	opencodeV2RefusedSessionOptions = {
		...opencodeRefusedSessionOptions,
		appendSystemPrompt: "opencode v2 does not load the instructions configuration used for session-local appended prompts; ACP exposes no equivalent transient instruction channel",
		systemPrompt: "opencode v2 uses agents.<id>.system, but ACP exposes no per-session replacement and OAR cannot yet safely resolve and override the selected agent across new sessions and resume"
	};
	opencodeV2AcpProfile = {
		...commonProfile,
		capabilities: {
			queue: { durable: false },
			attribution: "nested"
		},
		attributeUpdate: opencodeChildAttribution,
		validateOptions: (options) => {
			refuseSessionOptions(opencodeV2RefusedSessionOptions, options);
		}
	};
	directV2Session = acpSession(opencodeV2AcpProfile);
	opencodeSession = withSessionCredentials(async (installation, options) => {
		refuseSessionOptions(opencodeRefusedSessionOptions, options);
		checkMcpServerNames(options.mcpServers ?? []);
		if (installation.via !== "executable") throw new Error("opencode requires an executable installation");
		if (await opencodeMajor(installation, options) === 2) return directV2Session(installation, options);
		refuseSessionOptions(opencodeV1RefusedSessionOptions, options);
		if (options.systemPrompt === void 0 && options.appendSystemPrompt === void 0) return directSession(installation, options);
		validateOpenCodePrompts(options);
		const prepared = await prepareOpenCodePrompts(installation.command, options);
		try {
			return withPromptCleanup(await acpSession({
				...opencodeAcpProfile,
				configureSession: ({ response }) => {
					if (prepared.agent !== void 0) verifyOpenCodeAgent(response, prepared.agent);
					return Promise.resolve();
				}
			})(installation, prepared.options), prepared.cleanup);
		} catch (error) {
			await prepared.cleanup();
			throw error;
		}
	});
}));
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/opencode/index.js
init_options();
const opencodeRuntime = defineRuntime({
	id: "opencode",
	brand: runtimeBrands.opencode,
	refusedSessionOptions: opencodeRefusedSessionOptions,
	mcpToolsListChanged: "full",
	installation: opencodeInstallation,
	installPlan: opencodeInstallPlan,
	install: opencodeInstall,
	installLines: opencodeInstallLines,
	session: onFirstCall(async () => {
		const { opencodeSession } = await Promise.resolve().then(() => (init_session(), session_exports));
		return opencodeSession;
	}),
	listModels: opencodeListModels
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/resolve.js
init_session_not_found_error();
init_runtime_failure_error();
/**
* pi's global config home (auth.json, models.json, settings, sessions) for
* every pi entry point: `OAR_PI_AGENT_DIR`, else pi's own (`fallback`, pi's
* `getAgentDir`: `PI_CODING_AGENT_DIR` or `~/.pi/agent`). Empty counts as
* unset, as pi treats an empty `PI_CODING_AGENT_DIR`; kept, it would join
* into relative paths and put auth.json in the working directory. Here, free
* of pi imports, so the entry points that load pi lazily can share it.
*/
function piAgentDir(fallback) {
	const pinned = process.env.OAR_PI_AGENT_DIR;
	return pinned === void 0 || pinned === "" ? fallback() : pinned;
}
/**
* Mirrors pi's unexported `getDefaultSessionDirPath` (session-manager.js
* 0.84.2): the cwd is resolved, its leading separator dropped, every `/ \ :`
* turned into `-`, and wrapped in `--…--` under `<agentDir>/sessions`. Kept
* in lock-step so the agent-dir pin (OAR_PI_AGENT_DIR) and pi's own CLI land
* sessions in the same directory.
*/
function piSessionDir(cwd, agentDir) {
	const slug = resolve(cwd).replace(/^[/\\]/u, "").replaceAll(/[/\\:]/gu, "-");
	return join(resolve(agentDir), "sessions", `--${slug}--`);
}
/**
* Session id → session file. Listing is per cwd because pi's directory is
* per cwd: a session started elsewhere is not found here, and the error says
* where it looked so the caller can tell "wrong cwd" from "never persisted"
* (pi writes the file on the first message, so an unused session has none).
*/
async function piFindSessionFile(lister, id, cwd, sessionDir) {
	const sessions = await lister.list(cwd, sessionDir);
	const found = sessions.find((session) => session.id === id);
	if (found === void 0) throw new SessionNotFoundError(id, `pi session ${id} not found: no session file with that id under ${sessionDir} (${sessions.length} session(s) there for cwd ${cwd}; pi persists a session on its first message)`, {
		method: "SessionManager.list",
		native: {
			cwd,
			sessionDir,
			sessionCount: sessions.length
		}
	});
	return found.path;
}
/** Splits `provider/model` at the first slash; model ids may themselves contain slashes. */
function splitPiModelId(model) {
	const slash = model.indexOf("/");
	if (slash <= 0 || slash === model.length - 1) throw new Error(`pi model must be spelled provider/model as listed by \`oar models pi\`; got ${JSON.stringify(model)}`);
	return {
		provider: model.slice(0, slash),
		modelId: model.slice(slash + 1)
	};
}
/**
* `provider/model` → pi Model through the session's ModelRuntime (extension
* registrations included, since the runtime comes from
* createAgentSessionServices). Unknown is an error rather than a fallback:
* pi would otherwise pick its own default and the caller's choice would
* silently not apply.
*/
function piResolveModel(lookup, model) {
	const { provider, modelId } = splitPiModelId(model);
	const found = lookup.getModel(provider, modelId);
	if (found === void 0) throw new RuntimeFailureError("model_unavailable", `pi model ${model} is not registered: provider ${provider} has no model ${modelId} (see \`oar models pi\` for the usable list)`);
	return found;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/theme.js
/**
* pi's theme, set up as pi's own print and rpc modes set it up. pi's CLI calls
* `initTheme(<settings theme>, interactive)` in every mode before anything
* runs (pi-coding-agent 1.1.0 main.js), and only interactive mode adds the
* file watcher. The theme is a process-wide global that extensions read
* through `ctx.ui.theme`; without it an extension tool that colors its output
* throws "Theme not initialized. Call initTheme() first." OAR loads pi in this
* process, so it makes the same call wherever it loads extensions, from that
* load's settings, as each pi start does. A theme pi cannot load falls back
* to pi's system theme.
*/
function initPiTheme(initTheme, settings) {
	initTheme(settings.getTheme(), false);
}
async function preparePiTheme(settings) {
	const { initTheme } = await import("@earendil-works/pi-coding-agent");
	initPiTheme(initTheme, settings);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/inventory.js
init_json();
function piInventories(session, scope) {
	return {
		skills: () => {
			const result = session.resourceLoader.getSkills();
			return inventoryOk(scope, "discovered", result.skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				path: skill.filePath,
				disableModelInvocation: skill.disableModelInvocation,
				source: skill.sourceInfo.source
			})), result.diagnostics.length > 0);
		},
		commands: () => {
			const runner = session.extensionRunner;
			const result = session.resourceLoader.getPrompts();
			return inventoryOk(scope, "discovered", [...runner.getRegisteredCommands().map((command) => ({
				name: command.invocationName,
				source: "extension",
				...command.description === void 0 ? {} : { description: command.description }
			})), ...result.prompts.map((template) => ({
				name: template.name,
				description: template.description,
				source: "prompt",
				...template.argumentHint === void 0 ? {} : { argumentHint: template.argumentHint }
			}))], result.diagnostics.length > 0 || session.resourceLoader.getExtensions().errors.length > 0 || runner.getCommandDiagnostics().length > 0);
		},
		tools: () => {
			const active = new Set(session.getActiveToolNames());
			return inventoryOk(scope, "registered", session.getAllTools().map((tool) => {
				const schema = asRecord(tool.parameters);
				return {
					name: tool.name,
					description: tool.description,
					active: active.has(tool.name),
					...schema === null ? {} : { inputSchema: schema }
				};
			}));
		}
	};
}
function reader(select) {
	return async (installation, options = {}) => {
		if (installation.via !== "bundled") return unsupportedInventory("installation_unsupported", "Pi inventory requires the bundled SDK");
		const scope = workspaceScope(options);
		return await inventoryRead(async () => {
			const sdk = await import("@earendil-works/pi-coding-agent");
			const agentDir = piAgentDir(() => sdk.getAgentDir());
			const settingsManager = sdk.SettingsManager.create(scope.cwd, agentDir);
			initPiTheme(sdk.initTheme, settingsManager);
			const services = await sdk.createAgentSessionServices({
				cwd: scope.cwd,
				agentDir,
				settingsManager
			});
			const { session } = await sdk.createAgentSessionFromServices({
				services,
				sessionManager: sdk.SessionManager.inMemory(scope.cwd)
			});
			try {
				return select(piInventories(session, scope))();
			} finally {
				session.dispose();
			}
		}, options.timeoutMs);
	};
}
const piSkills = reader((readers) => readers.skills);
const piCommands = reader((readers) => readers.commands);
const piTools = reader((readers) => readers.tools);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/installation.js
const SDK_PACKAGE = "@earendil-works/pi-coding-agent";
async function sdkLoads() {
	try {
		await import("@earendil-works/pi-coding-agent");
		return true;
	} catch {
		return false;
	}
}
/**
* Pi ships inside this package as an sdk dependency; there is no executable to
* probe and no version to report (the embedder pins the sdk version). Normal
* installs resolve the specifier; bundled/SEA deployments have no node_modules
* on disk, so fall back to actually importing the compiled-in sdk. An install
* where neither works (a bundle that left the sdk out) is an honest not_found.
*/
const piInstallation = async () => {
	if ((() => {
		try {
			import.meta.resolve(SDK_PACKAGE);
			return true;
		} catch {
			return false;
		}
	})() || await sdkLoads()) return {
		kind: "available",
		via: "bundled"
	};
	return { kind: "not_found" };
};
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/http.js
function settingProxy(settings) {
	const proxy = settings?.getGlobalSettings().httpProxy?.trim();
	return proxy === void 0 || proxy.length === 0 ? void 0 : proxy;
}
/**
* pi's precedence (main.js `applyHttpProxySettings`: `process.env.HTTP_PROXY
* ??= setting`): an env proxy wins, the settings' `httpProxy` fills BOTH
* http and https when the env names none. Pure, and the env is not written.
*/
function planPiHttp(settings, env = process.env) {
	const fallback = settingProxy(settings);
	return {
		httpProxy: env.http_proxy ?? env.HTTP_PROXY ?? fallback,
		httpsProxy: env.https_proxy ?? env.HTTPS_PROXY ?? fallback,
		idleTimeoutMs: settings?.getHttpIdleTimeoutMs()
	};
}
/** undici's own default when nothing is configured; pi's getHttpIdleTimeoutMs() default is the same. */
const UNDICI_DEFAULT_TIMEOUT_MS = 3e5;
let loading = null;
let warned$1 = false;
/** What this module installed, so repeated calls with the same plan are no-ops and another owner's dispatcher is never replaced. */
let installed = null;
/** Whether the plan changes anything over Node's default dispatcher. */
function planNeedsDispatcher(plan) {
	return plan.httpProxy !== void 0 || plan.httpsProxy !== void 0 || plan.idleTimeoutMs !== void 0 && plan.idleTimeoutMs !== UNDICI_DEFAULT_TIMEOUT_MS;
}
/** Warn once per process; the session then runs on Node's default dispatcher, as before the plane existed. */
function warnOnce$1(error) {
	if (warned$1) return;
	warned$1 = true;
	const detail = error instanceof Error ? error.message : String(error);
	process.emitWarning(`pi proxy plane not installed (${detail}): provider requests use Node's default dispatcher, which ignores HTTP_PROXY/HTTPS_PROXY`, { code: "OAR_PI_PROXY_PLANE" });
}
/** undici, loaded lazily; a failed load is not cached, so a transient failure is retried on the next call. */
async function loadUndici() {
	const attempt = loading ?? import("undici");
	loading = attempt;
	try {
		return await attempt;
	} catch (error) {
		if (loading === attempt) loading = null;
		throw error;
	}
}
/**
* The dispatcher's options: the plan, plus the connection behavior pi's own
* dispatcher keeps (pi-coding-agent 1.2.0 core/http-dispatcher.js), so an
* embedded pi talks to providers and proxies the way `pi` does, and the host's
* global fetch keeps Node's protocol: HTTP/1.1 only (undici 8 would otherwise
* negotiate HTTP/2), CONNECT tunnels for http targets behind a proxy (as
* before undici 8.7), and pi's 2 s address-family attempt timeout.
*/
function piDispatcherOptions(plan) {
	return {
		allowH2: false,
		proxyTunnel: true,
		connect: { autoSelectFamilyAttemptTimeout: 2e3 },
		...plan.httpProxy === void 0 ? {} : { httpProxy: plan.httpProxy },
		...plan.httpsProxy === void 0 ? {} : { httpsProxy: plan.httpsProxy },
		...plan.idleTimeoutMs === void 0 ? {} : {
			headersTimeout: plan.idleTimeoutMs,
			bodyTimeout: plan.idleTimeoutMs
		}
	};
}
/**
* Install the proxy plane before the first provider request: undici's
* global dispatcher becomes an `EnvHttpProxyAgent` built from the plan.
* Nothing is installed when the plan changes nothing over Node's default
* (no proxy, default timeout): the host keeps its stock dispatcher. Repeated
* calls with the same plan are no-ops; a dispatcher this module did not
* install (the host's own) is never replaced; a one-time warning says so.
* True when the plane is in place, false otherwise.
*/
async function configurePiHttp(settings) {
	try {
		const plan = planPiHttp(settings);
		if (!planNeedsDispatcher(plan)) return false;
		const undici = await loadUndici();
		const key = JSON.stringify(plan);
		const current = undici.getGlobalDispatcher();
		if (installed !== null && installed.plan === key && current === installed.dispatcher) return true;
		if (!(current.constructor.name === "Agent" || current instanceof undici.Agent) && current !== installed?.dispatcher) {
			warnOnce$1(/* @__PURE__ */ new Error("the host already set a global dispatcher"));
			return false;
		}
		const dispatcher = new undici.EnvHttpProxyAgent(piDispatcherOptions(plan));
		undici.setGlobalDispatcher(dispatcher);
		installed = {
			plan: key,
			dispatcher
		};
		return true;
	} catch (error) {
		warnOnce$1(error);
		return false;
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/static-modules.js
let provided = null;
let warned = false;
async function registerSignInFlows() {
	const { registerBunOAuthFlows } = await import("@earendil-works/pi-ai/bun-oauth");
	registerBunOAuthFlows();
}
async function registerBedrock() {
	const [{ bedrockProviderModule }, { setBedrockProviderModule }] = await Promise.all([import("@earendil-works/pi-ai/bedrock-provider"), import("@earendil-works/pi-ai/compat")]);
	setBedrockProviderModule(bedrockProviderModule);
}
function warnOnce(reason) {
	if (warned) return;
	warned = true;
	const detail = reason instanceof Error ? reason.message : String(reason);
	process.emitWarning(`pi provider modules not all handed to pi-ai (${detail}): pi loads those itself, which a single-file host cannot`, { code: "OAR_PI_MODULES" });
}
async function provide() {
	const failure = (await Promise.allSettled([registerSignInFlows(), registerBedrock()])).find((result) => result.status === "rejected");
	if (failure !== void 0) {
		warnOnce(failure.reason);
		provided = null;
	}
}
/** Hand pi-ai its sign-in flows and Bedrock module, once per process; never throws. */
async function providePiModules() {
	provided ??= provide();
	await provided;
}
/**
* pi's process-wide setup before it first reaches a provider or runs an
* extension: the proxy plane (http.ts), pi-ai's provider modules and the
* theme (theme.ts).
*/
async function preparePi(settings) {
	await Promise.all([
		configurePiHttp(settings),
		providePiModules(),
		preparePiTheme(settings)
	]);
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/model-projection.js
/**
* Pi model ids are only unique per provider, so the session-facing id is
* `provider/model`, the same spelling Pi's own `--model` flag accepts.
*
* `effortLevels` is pi's thinking-level menu for a reasoning model, exactly
* as pi derives it (`thinkingLevelMap` drops levels mapped to null and adds
* `xhigh`/`max` only where mapped; `off` is one of pi's levels and stays
* where pi offers it), the levels `SessionOptions.effort` accepts on pi. A
* model without `reasoning` runs only `off` and lists no menu. No
* `defaultEffort`: pi's default is a settings value clamped per model at
* session creation, and the session's `effort()` reports it.
*
* `provider` is the model's provider id with pi's display name for it.
* `default` marks the default saved in pi's settings when it is listed; with
* none saved, pi picks the first available model at session creation, which
* OAR does not guess. pi reads those settings globally and from the project
* at the host's own cwd, so a session opened in another project can start on
* that project's default instead.
*/
function projectPiModels(models, thinkingLevelsOf, context = {}) {
	return models.map((model) => {
		const effortLevels = model.reasoning === true && thinkingLevelsOf !== void 0 ? thinkingLevelsOf(model) : [];
		const providerName = context.providerName?.(model.provider)?.trim();
		const isDefault = context.savedDefault?.provider === model.provider && context.savedDefault.id === model.id;
		return {
			id: `${model.provider}/${model.id}`,
			displayName: model.name === void 0 || model.name.trim().length === 0 ? model.id : model.name.trim(),
			...effortLevels.length === 0 ? {} : { effortLevels: [...effortLevels] },
			provider: {
				id: model.provider,
				...providerName === void 0 || providerName.length === 0 || providerName === model.provider ? {} : { displayName: providerName }
			},
			...isDefault ? { default: true } : {}
		};
	});
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/list-models.js
init_listing_cwd();
/**
* In-process through the bundled SDK, built the way `pi --list-models` builds
* its own runtime: `createAgentSessionServices` loads the extensions under the
* agent dir and applies their provider registrations to the ModelRuntime
* before anything is listed. That matters because extensions can be the ONLY
* source of providers (on exe.dev every listed provider comes from the exe-dev
* extension; auth.json is empty). A bare `ModelRuntime.create()` sees none of
* them and prints "no models" while `pi --list-models` prints dozens.
*
* The list itself comes from `getAvailable()`, which computes availability on
* demand. Do NOT read `ModelRegistry.getAvailable()` / `getAvailableSnapshot()`
* here: that snapshot starts empty and is only filled by an availability
* refresh (the other half of the 2026-09-05 "no models" bug).
*
* It is built for the listing's cwd, as a session there would be: the
* project's settings can save another default, and its extensions (under
* `.pi/extensions`) load and run like the agent dir's. Skills, prompt
* templates, themes, and context files are skipped: they cannot register
* providers, and listing must not read the project's prompt files.
* `OAR_PI_AGENT_DIR` pins the agent dir exactly as the session adapter does,
* so the list and the session see the same providers.
*
* Pi keys on provider API keys rather than one login, so "nothing configured"
* is an `ok` empty list, not `unauthenticated`.
*/
function createPiListModels(createRuntime, thinkingLevelsOf) {
	return async (installation, options = {}) => {
		if (installation.via !== "bundled") return {
			kind: "unsupported",
			reason: "pi model listing runs through the bundled Pi SDK"
		};
		try {
			const signal = AbortSignal.timeout(options.timeoutMs ?? 15e3);
			const runtime = await createRuntime(signal, listingCwd(options));
			const available = await runtime.getAvailable(void 0, { signal });
			const context = {
				providerName: (providerId) => runtime.getProvider?.(providerId)?.name,
				...runtime.savedDefault === void 0 ? {} : { savedDefault: runtime.savedDefault }
			};
			return {
				kind: "ok",
				models: projectPiModels(available, await thinkingLevelsOf?.(), context)
			};
		} catch (error) {
			return {
				kind: "unsupported",
				reason: `pi SDK could not list available models: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	};
}
const piListModels = createPiListModels(async (signal, cwd) => {
	const { createAgentSessionServices, getAgentDir, SettingsManager } = await import("@earendil-works/pi-coding-agent");
	const agentDir = piAgentDir(getAgentDir);
	const settingsManager = SettingsManager.create(cwd, agentDir);
	await preparePi(settingsManager);
	const modelRuntime = (await createAgentSessionServices({
		cwd,
		agentDir,
		settingsManager,
		modelRuntimeSignal: signal,
		resourceLoaderOptions: {
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true
		}
	})).modelRuntime;
	const provider = settingsManager.getDefaultProvider();
	const id = settingsManager.getDefaultModel();
	return {
		getAvailable: async (providerId, options) => {
			return await modelRuntime.getAvailable(providerId, options);
		},
		getProvider: (providerId) => modelRuntime.getProvider(providerId),
		...provider === void 0 || id === void 0 ? {} : { savedDefault: {
			provider,
			id
		} }
	};
}, async () => {
	const { getSupportedThinkingLevels } = await import("@earendil-works/pi-ai");
	return getSupportedThinkingLevels;
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/credentials.js
/** Resolve only the selected model through the SDK's auth API. OAR never opens credential files. */
async function rememberPiKey(registry, model, add) {
	if (model === void 0) return;
	const auth = await registry.getApiKeyAndHeaders(model);
	if (auth.ok) add(auth.apiKey);
}
/** Pi awaits model_select before returning from a model change, before its next provider request. */
function piCredentialExtension(add) {
	return (pi) => {
		pi.on("model_select", async (event, context) => {
			await rememberPiKey(context.modelRegistry, event.model, add);
		});
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/lifecycle.js
const SHUTDOWN_TIMEOUT_MS = 1e4;
/** Await native extension shutdown while its context is live, but never let an async hook hold the host forever. */
async function disposePiAgentSession(session) {
	let timer = void 0;
	try {
		const deadline = new Promise((resolve) => {
			timer = setTimeout(() => {
				resolve(false);
			}, SHUTDOWN_TIMEOUT_MS);
		});
		if (!await Promise.race([session.extensionRunner.emit({
			type: "session_shutdown",
			reason: "quit"
		}).then(() => true), deadline])) process.emitWarning(`pi session_shutdown hooks timed out after ${String(SHUTDOWN_TIMEOUT_MS)} ms for session ${session.sessionId}; releasing the session without waiting for remaining hooks`, { code: "OAR_PI_SHUTDOWN_TIMEOUT" });
	} finally {
		clearTimeout(timer);
		session.dispose();
	}
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/mcp.js
init_credential_redactor();
init_errors$1();
init_mcp_servers$1();
/** The names pi takes (`validateMcpServerConfig`); its tool namespace folds `-` into `_`, so `a-b` and `a_b` would be one server. */
const PI_MCP_SERVER_NAME = /^[\w-]+$/u;
/**
* A value as pi reads it literally: pi resolves `env` and `headers` values
* (`resolveConfigValue`), running one that starts with `!` as a shell
* command and interpolating `$NAME`; `$$` and `$!` are its escapes for a
* literal `$` and `!`.
*/
function piLiteralConfigValue(value) {
	return value.replaceAll(/[$!]/gu, (character) => `$${character}`);
}
function literalValues(values) {
	return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, piLiteralConfigValue(value)]));
}
/**
* One entry as pi's MCP server config: http `{type, url, headers}`, stdio
* `{type, command, args, env}` whose env is `SessionOptions.env` with the
* entry's on top (pi starts it with the host's environment under that, like
* the bash tool's). Every value literal, every tool declared directly.
*/
function piMcpServerConfig(server, sessionEnv = {}) {
	if (isHttpMcpServer(server)) return {
		type: "http",
		url: server.url,
		...server.headers === void 0 ? {} : { headers: literalValues(server.headers) },
		exposure: "direct"
	};
	const env = {
		...piMcpEnvironment(sessionEnv),
		...server.env
	};
	return {
		type: "stdio",
		command: server.command,
		args: [...server.args ?? []],
		...Object.keys(env).length === 0 ? {} : { env: literalValues(env) },
		exposure: "direct"
	};
}
/** Pi's MCP config can override strings but cannot remove inherited variables. */
function piMcpEnvironment(env) {
	const values = {};
	for (const [key, value] of Object.entries(env ?? {})) {
		if (value === null) throw new UnsupportedOptionError("env", "pi's stdio MCP servers re-inherit the host environment and cannot remove variables; env removals cannot be combined with stdio mcpServers");
		values[key] = value;
	}
	return values;
}
/**
* Refuse names and the environment combination before pi opens resources,
* trusts the cwd or loads extensions.
*/
function validatePiMcpEnvironment(options) {
	const servers = givenMcpServers(options.mcpServers);
	if (servers === null) return;
	checkPiMcpServerNames(servers);
	if (servers.some((server) => !isHttpMcpServer(server))) piMcpEnvironment(options.env);
}
/** Throw on a list pi cannot register as given: an empty or repeated name, one pi refuses, or two pi would fold into one. */
function checkPiMcpServerNames(servers) {
	checkMcpServerNames(servers);
	const namespaces = /* @__PURE__ */ new Map();
	for (const { name } of servers) {
		if (!PI_MCP_SERVER_NAME.test(name)) throw new Error(`pi registers no MCP server named ${JSON.stringify(name)}: its names match ${PI_MCP_SERVER_NAME.source}`);
		const namespace = name.replaceAll("-", "_");
		const other = namespaces.get(namespace);
		if (other !== void 0) throw new Error(`pi would give the MCP servers ${JSON.stringify(other)} and ${JSON.stringify(name)} one tool namespace (mcp__${namespace})`);
		namespaces.set(namespace, name);
	}
}
const MCP_EXTENSION = "oar-mcp";
const REGISTER_EXTENSION = "oar-mcp-servers";
/**
* The inline extensions attaching `options.mcpServers` to a pi session, or
* null when it has none. Throws before anything opens on a name pi would
* refuse or fold into another. pi's MCP server log goes to `<agentDir>/mcp.log`.
*/
async function piMcpExtensions(options, agentDir) {
	const servers = givenMcpServers(options.mcpServers);
	if (servers === null) return null;
	checkPiMcpServerNames(servers);
	const sdk = await import("@earendil-works/pi-coding-agent");
	const { redact } = sessionCredentialRedactor(options);
	const failures = [];
	const register = (pi) => {
		for (const server of servers) try {
			pi.registerMcpServer(server.name, piMcpServerConfig(server, options.env));
		} catch (error) {
			failures.push(redact(error instanceof Error ? error.message : String(error)));
		}
	};
	return {
		extensions: [{
			name: MCP_EXTENSION,
			factory: sdk.createMcpExtension({
				loadConfig: () => ({
					servers: [],
					errors: []
				}),
				logPath: path.join(agentDir, "mcp.log")
			}),
			hidden: true
		}, {
			name: REGISTER_EXTENSION,
			factory: register,
			hidden: true
		}],
		check: (loadErrors) => {
			const ours = new Set([`<inline:${MCP_EXTENSION}>`, `<inline:${REGISTER_EXTENSION}>`]);
			failures.push(...loadErrors.filter((entry) => ours.has(entry.path)).map((entry) => redact(entry.error)));
			if (failures.length > 0) throw new Error(`pi did not register the session's MCP servers: ${failures.join("; ")}`);
		}
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/open.js
init_session_options();
init_environment();
/**
* The bash tool that carries SessionOptions.env into the agent's spawned
* processes: same builtin bash, plus a spawnHook overlaying the env. pi's
* defineTool keeps the definition assignable to customTools, where it
* replaces the builtin by name. Exported for direct unit verification.
*/
async function piEnvBashTool(cwd, overlay) {
	const sdk = await import("@earendil-works/pi-coding-agent");
	return sdk.defineTool(sdk.createBashToolDefinition(cwd, { spawnHook: (context) => ({
		...context,
		env: sessionEnvironment(overlay, context.env)
	}) }));
}
const PI_THINKING_LEVELS = {
	off: true,
	minimal: true,
	low: true,
	medium: true,
	high: true,
	xhigh: true,
	max: true
};
/**
* `SessionOptions.effort` as a pi thinking level, or an Error naming pi's
* levels. Checked before pi sees it: pi's `clampThinkingLevel` turns a word
* it does not know into the model's lowest level without a word (pi-ai
* 0.84.2 models.js), which the read-back would catch only after the session
* was built.
*/
function piThinkingLevel(effort) {
	const level = Object.keys(PI_THINKING_LEVELS).find((candidate) => candidate === effort);
	if (level === void 0) throw new Error(`pi has no thinking level ${effort} (pi's levels: ${Object.keys(PI_THINKING_LEVELS).join(", ")})`);
	return level;
}
/**
* Why the opened pi session does not run the requested thinking level, read
* off pi's own state (`AgentSession.thinkingLevel`, what the next request
* sends), or null when it does. pi clamps a level the model does not offer to
* the nearest one it does (a non-reasoning model: `off`) without a word.
*/
function piEffortRefusal(requested, session) {
	if (session.thinkingLevel === requested) return null;
	const model = piEffectiveModel(session) ?? "no model";
	return `pi runs thinking level ${session.thinkingLevel} for ${model} although ${requested} was requested (the model offers ${session.getAvailableThinkingLevels().join(", ")})`;
}
/**
* pi's `AgentSession.model` (SDK 0.84.2 agent-session.d.ts: "Current model
* (may be undefined if not yet selected)") is the runtime-owned current
* model, updated by setModel/model switching; spelled `provider/id` like the
* list-models projection and pi's own `--model` flag.
*/
function piEffectiveModel(session) {
	const { model } = session;
	return model === void 0 ? null : `${model.provider}/${model.id}`;
}
/** Options the in-process SDK cannot honor, refused before anything opens. */
const piRefusedSessionOptions = {
	outputSchema: "Pi SDK exposes no final-output schema option",
	additionalDirectories: "pi's SDK configures one cwd and exposes no additional workspace directory option",
	launchArgs: "pi runs in this process through its SDK; there is no runtime command line to add arguments to",
	serviceTier: "pi exposes no verified per-session service-tier setting and readback"
};
/**
* Opens (or resumes) the pi AgentSession the adapter wraps. Services first
* (createAgentSessionServices loads the agent dir's extensions and their
* provider registrations into the ModelRuntime, exactly as `pi` itself does),
* then the session against an explicit SessionManager so resume and creation
* share one session directory.
*/
async function openPiAgentSession(options, rememberKey) {
	refuseSessionOptions(piRefusedSessionOptions, options);
	checkSessionName(options);
	validatePiMcpEnvironment(options);
	const thinkingLevel = options.effort === void 0 ? void 0 : piThinkingLevel(options.effort);
	const sdk = await import("@earendil-works/pi-coding-agent");
	const agentDir = piAgentDir(() => sdk.getAgentDir());
	new sdk.ProjectTrustStore(agentDir).set(options.cwd, true);
	const settingsManager = sdk.SettingsManager.create(options.cwd, agentDir);
	await preparePi(settingsManager);
	const mcp = await piMcpExtensions(options, agentDir);
	const services = await sdk.createAgentSessionServices({
		cwd: options.cwd,
		agentDir,
		settingsManager,
		resourceLoaderOptions: {
			...options.systemPrompt === void 0 ? {} : { systemPrompt: options.systemPrompt },
			...options.appendSystemPrompt === void 0 ? {} : { appendSystemPrompt: [options.appendSystemPrompt] },
			extensionFactories: [...mcp?.extensions ?? [], ...rememberKey === void 0 ? [] : [{
				name: "oar-credentials",
				factory: piCredentialExtension(rememberKey),
				hidden: true
			}]]
		}
	});
	mcp?.check(services.resourceLoader.getExtensions().errors);
	const sessionDir = piSessionDir(options.cwd, agentDir);
	const sessionManager = options.resume === void 0 ? sdk.SessionManager.create(options.cwd, sessionDir) : sdk.SessionManager.open(await piFindSessionFile(sdk.SessionManager, options.resume, options.cwd, sessionDir), sessionDir);
	const model = options.model === void 0 ? void 0 : piResolveModel(services.modelRuntime, options.model);
	const overlay = options.env;
	const { session } = await sdk.createAgentSessionFromServices({
		services,
		sessionManager,
		...options.disallowedTools === void 0 ? {} : { excludeTools: [...options.disallowedTools] },
		...model === void 0 ? {} : { model },
		...thinkingLevel === void 0 ? {} : { thinkingLevel },
		...overlay === void 0 ? {} : { customTools: [await piEnvBashTool(options.cwd, overlay)] }
	});
	if (options.resume !== void 0) {
		const defaults = settingsManager.getDefaultTools() ?? sdk.createCodingTools(options.cwd).map((tool) => tool.name);
		const extensions = session.getAllTools().filter((tool) => tool.sourceInfo.path !== `builtin:${tool.name}` && session.getToolDefinition(tool.name)?.defaultActive !== false && (tool.exposure === "direct" || tool.exposure === "model-only"));
		session.setActiveToolsByName([...defaults, ...extensions.map((tool) => tool.name)]);
	}
	const effective = piEffectiveModel(session);
	if (options.model !== void 0 && effective !== options.model) {
		session.dispose();
		throw new Error(`pi did not apply model ${options.model}: the session reports ${effective ?? "no model"}`);
	}
	const refusal = options.effort === void 0 ? null : piEffortRefusal(options.effort, session);
	if (refusal !== null) {
		session.dispose();
		throw new Error(refusal);
	}
	if (options.name !== void 0 && !sessionManager.getEntries().some((entry) => entry.type === "session_info")) sessionManager.appendSessionInfo(options.name);
	try {
		if (rememberKey !== void 0) await rememberPiKey(new sdk.ModelRegistry(session.modelRuntime), session.model, rememberKey);
		await session.bindExtensions({});
	} catch (error) {
		await disposePiAgentSession(session);
		throw error;
	}
	return session;
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/failure.js
init_failure_class();
/** Classify the run pi failed with `error`. */
function piFailure(error) {
	const { message, overflow } = error;
	const prefixed = /^(?<status>\d{3}) (?<body>[\s\S]*)$/u.exec(message);
	const status = prefixed?.groups?.status === void 0 ? null : Number(prefixed.groups.status);
	const body = prefixed?.groups?.body ?? message;
	const withStatus = status === null ? {} : { status };
	if (overflow) return {
		kind: "failed",
		reason: message,
		failure: "input_too_large",
		...withStatus
	};
	const named = failureFromErrorBody(body);
	if (named !== null) return {
		kind: "failed",
		reason: message,
		failure: named,
		...withStatus
	};
	return {
		kind: "failed",
		reason: message,
		failure: status === null ? "unknown" : failureFromStatus(status),
		...withStatus
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/projection.js
init_json();
init_token_totals();
init_tool_output();
const initialPiProjection = {
	reasoningHadText: false,
	providerError: void 0,
	tokens: noTokens
};
/** Control plane → state: a prompt (or a drained queue input) resets the per-run accumulators; the running token total stays. */
function piPrompted(state) {
	return {
		...initialPiProjection,
		tokens: state.tokens
	};
}
/** Pi's settlement reports cancellation; preceding provider events supply error details. */
function piRunOutcome(state, aborted) {
	if (aborted) return { kind: "aborted" };
	if (state.providerError !== void 0) return piFailure(state.providerError);
	return { kind: "completed" };
}
function jsonDetail(value) {
	if (value === void 0) return;
	try {
		return JSON.stringify(value);
	} catch {
		return;
	}
}
function foldMessageUpdate(state, inner, overflow) {
	switch (inner.type) {
		case "text_delta": return {
			state,
			events: [{
				kind: "text_delta",
				text: inner.delta
			}]
		};
		case "thinking_delta": return inner.delta.length > 0 ? {
			state: {
				...state,
				reasoningHadText: true
			},
			events: [{
				kind: "reasoning",
				content: {
					kind: "text",
					text: inner.delta
				}
			}]
		} : {
			state,
			events: []
		};
		case "error": return {
			state: {
				...state,
				providerError: {
					message: inner.error.errorMessage ?? inner.reason,
					overflow
				}
			},
			events: []
		};
		case "thinking_start": return {
			state: {
				...state,
				reasoningHadText: false
			},
			events: []
		};
		case "thinking_end": return state.reasoningHadText ? {
			state,
			events: []
		} : {
			state,
			events: [{
				kind: "reasoning",
				content: { kind: "empty" }
			}]
		};
		case "start":
		case "done":
		case "text_start":
		case "text_end":
		case "toolcall_start":
		case "toolcall_delta":
		case "toolcall_end": return {
			state,
			events: []
		};
	}
	return {
		state,
		events: []
	};
}
/** Cumulative per-session tokens after an assistant message's own usage. */
function accumulate(state, message) {
	const record = asRecord(message);
	const usage = asRecord(record?.usage);
	if (record?.role !== "assistant" || usage === null) return {
		state,
		events: []
	};
	const cache = cacheParts(usage, {
		read: "cacheRead",
		write: "cacheWrite"
	});
	const tokens = addTokens(state.tokens, {
		input: (asNumber(usage.input) ?? 0) + (cache.cacheRead ?? 0) + (cache.cacheWrite ?? 0),
		output: asNumber(usage.output) ?? 0,
		...reasoningPart(usage, "reasoning"),
		...cache
	});
	return {
		state: {
			...state,
			tokens
		},
		events: [{
			kind: "usage",
			usage: { tokens }
		}]
	};
}
function step(state, event, extra) {
	switch (event.type) {
		case "agent_settled": {
			const events = [{
				kind: "turn_ended",
				outcome: piRunOutcome(state, event.aborted)
			}];
			if (extra.context !== void 0 && extra.context !== null) events.push({
				kind: "usage",
				usage: { context: extra.context }
			});
			return {
				state: piPrompted(state),
				events
			};
		}
		case "message_update": return foldMessageUpdate(state, event.assistantMessageEvent, extra.overflow === true);
		case "message_end": return accumulate(state, event.message);
		case "tool_execution_start": {
			const input = jsonDetail(event.args);
			return {
				state,
				events: [input === void 0 ? {
					kind: "tool_call_started",
					callId: event.toolCallId,
					tool: event.toolName
				} : {
					kind: "tool_call_started",
					callId: event.toolCallId,
					tool: event.toolName,
					input
				}]
			};
		}
		case "tool_execution_update": {
			const output = jsonDetail(event.partialResult);
			return {
				state,
				events: [output === void 0 ? {
					kind: "tool_call_progress",
					callId: event.toolCallId
				} : {
					kind: "tool_call_progress",
					callId: event.toolCallId,
					output
				}]
			};
		}
		case "compaction_start": return {
			state,
			events: [{
				kind: "compaction_started",
				trigger: event.reason
			}]
		};
		case "compaction_end": {
			let outcome = "completed";
			if (event.aborted) outcome = "aborted";
			else if (event.errorMessage !== void 0) outcome = "failed";
			return {
				state,
				events: [{
					kind: "compaction_ended",
					outcome,
					trigger: event.reason,
					...event.errorMessage === void 0 ? {} : { reason: event.errorMessage }
				}]
			};
		}
		case "thinking_level_changed": return {
			state,
			events: [{
				kind: "effort",
				effort: event.level
			}]
		};
		case "auto_retry_start":
		case "summarization_retry_scheduled": return {
			state,
			events: [{
				kind: "retry",
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
				reason: event.errorMessage
			}]
		};
		case "tool_execution_end": {
			const blocks = asRecord(event.result)?.content;
			const content = Array.isArray(blocks) && blocks.length > 0 ? toolContent(blocks) : toolContent(event.result);
			const result = typeof event.isError === "boolean" ? event.isError ? "failed" : "ok" : void 0;
			const exit = asRecord(asRecord(event.result)?.structuredContent)?.exit_code;
			const exitCode = typeof exit === "number" ? exit : void 0;
			return {
				state,
				events: [{
					kind: "tool_call_ended",
					callId: event.toolCallId,
					...content === void 0 ? {} : { content },
					...result === void 0 ? {} : { result },
					...exitCode === void 0 ? {} : { exitCode }
				}]
			};
		}
		case "turn_end": return event.message.role === "assistant" && event.message.stopReason === "error" ? {
			state: {
				...state,
				providerError: {
					message: event.message.errorMessage ?? "provider error",
					overflow: extra.overflow === true
				}
			},
			events: []
		} : {
			state,
			events: []
		};
		case "message_start": return {
			state,
			events: event.message.role === "user" ? [{
				kind: "user_message",
				evidence: "conversation",
				input: typeof event.message.content === "string" ? event.message.content : event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("")
			}] : []
		};
		case "agent_start": return {
			state,
			events: [{ kind: "turn_active" }]
		};
		case "agent_end":
		case "turn_start":
		case "bash_execution_update":
		case "queue_update":
		case "entry_appended":
		case "session_info_changed":
		case "auto_retry_end":
		case "summarization_retry_attempt_start":
		case "summarization_retry_finished": return {
			state,
			events: []
		};
	}
	return {
		state,
		events: []
	};
}
/** Fold one pi SDK event into the next state plus the one frame command it produces. */
function foldPiEvent(state, event, extra = {}) {
	const next = step(state, event, extra);
	return {
		state: next.state,
		commands: [{
			kind: "frame",
			body: {
				type: event.type,
				native: event,
				events: next.events
			}
		}]
	};
}
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/session.js
init_failure_class();
init_held_input();
init_input_images();
init_session_credentials();
/** pi's ImageContent: base64 data and its type. */
const piImages = (images) => images.map((image) => ({
	type: "image",
	data: image.data,
	mimeType: image.mediaType
}));
const piSession = withSessionCredentials(async (installation, options, credentials) => {
	if (installation.via !== "bundled") throw new Error("The pi session adapter needs the bundled sdk installation");
	const piAgentSession = await openPiAgentSession(options, credentials.add);
	const { isContextOverflow } = await import("@earendil-works/pi-ai");
	const overflowOf = (event) => {
		if (event.type === "turn_end") return event.message.role === "assistant" && event.message.stopReason === "error" && isContextOverflow(event.message);
		return event.type === "message_update" && event.assistantMessageEvent.type === "error" && isContextOverflow(event.assistantMessageEvent.error);
	};
	const kernel = credentials.kernel(piAgentSession.sessionId);
	const abortNative = async () => {
		try {
			await piAgentSession.abort();
		} catch (error) {
			kernel.frame({
				type: "pi/abort_rejected",
				native: { message: error instanceof Error ? error.message : String(error) },
				events: []
			});
		}
	};
	let projection = initialPiProjection;
	const gate = { running: false };
	let launch = null;
	let disposeRequest = null;
	let pendingAbort = false;
	const held = [];
	const contextOf = () => {
		const usage = piAgentSession.getContextUsage();
		return usage === void 0 ? null : {
			tokens: usage.tokens,
			contextWindow: usage.contextWindow,
			percent: usage.percent
		};
	};
	const startWaiters = /* @__PURE__ */ new Set();
	const start = async (input, images) => {
		gate.running = true;
		projection = piPrompted(projection);
		const token = {};
		launch = token;
		const { promise: started, resolve: onStarted } = Promise.withResolvers();
		startWaiters.add(onStarted);
		const run = piAgentSession.prompt(input, images.length === 0 ? void 0 : { images: piImages(images) });
		const decided = await Promise.race([started.then(() => ({ kind: "accepted" })), run.then(() => ({ kind: "accepted" }), (error) => ({
			kind: "rejected",
			code: "runtime_refused",
			reason: error instanceof Error ? error.message : "pi prompt failed"
		}))]);
		startWaiters.delete(onStarted);
		if (decided.kind === "rejected") {
			gate.running = false;
			launch = null;
			return decided;
		}
		(async () => {
			try {
				await run;
			} catch (error) {
				if (launch === token && gate.running) {
					const reason = error instanceof Error ? error.message : "pi prompt failed";
					gate.running = false;
					kernel.frame({
						type: "pi/prompt_rejected",
						native: { message: reason },
						events: [{
							kind: "turn_ended",
							outcome: {
								kind: "failed",
								reason,
								failure: classifyFailure(reason)
							}
						}]
					});
					drainHeld();
				}
			}
		})();
		return decided;
	};
	function drainHeld() {
		if (disposeRequest !== null || gate.running) return;
		const next = held.shift();
		if (next === void 0) return;
		(async () => {
			const decided = await start(next.input, next.images);
			if (decided.kind === "rejected") {
				kernel.frame({
					type: "pi/prompt_rejected",
					native: {
						message: decided.reason,
						input: next
					},
					events: []
				});
				drainHeld();
			}
		})();
	}
	piAgentSession.subscribe((event) => {
		if (event.type === "agent_start") {
			gate.running = true;
			for (const waiter of startWaiters) waiter();
			if (pendingAbort) {
				pendingAbort = false;
				abortNative();
			}
		}
		const extra = event.type === "agent_settled" ? { context: contextOf() } : { overflow: overflowOf(event) };
		const { state: nextProjection, commands } = foldPiEvent(projection, event, extra);
		projection = nextProjection;
		for (const command of commands) {
			kernel.frame(command.body);
			if (command.body.events.some((item) => item.kind === "turn_ended")) {
				gate.running = false;
				drainHeld();
			}
		}
	});
	const openedModel = piEffectiveModel(piAgentSession);
	if (openedModel !== null) {
		const { thinkingLevel } = piAgentSession;
		kernel.frame({
			type: "pi/session_opened",
			native: {
				sessionId: piAgentSession.sessionId,
				model: openedModel,
				thinkingLevel
			},
			events: [{
				kind: "model",
				model: openedModel
			}, {
				kind: "effort",
				effort: thinkingLevel
			}]
		});
	}
	const capabilities = {
		queue: { durable: false },
		attribution: "none",
		images: true
	};
	return credentials.seal({
		id: kernel.sessionId,
		capabilities,
		prompt: async (input, inputOptions) => {
			const body = {
				kind: "prompt",
				input,
				...inputOptions
			};
			return await kernel.control(body, async () => {
				if (gate.running) return {
					kind: "rejected",
					code: "busy",
					reason: "busy"
				};
				return await withInputImages(capabilities, inputOptions?.images, async (images) => {
					return await start(input, images);
				});
			});
		},
		steer: async (input, inputOptions) => {
			return await kernel.control({
				kind: "steer",
				input,
				...inputOptions
			}, async () => {
				if (!gate.running) return {
					kind: "rejected",
					code: "no_active_turn",
					reason: "not_steerable: no active turn"
				};
				return await withInputImages(capabilities, inputOptions?.images, async (images) => {
					await piAgentSession.steer(input, images.length === 0 ? void 0 : piImages(images));
					return { kind: "accepted" };
				});
			});
		},
		queue: async (input, inputOptions) => {
			return await kernel.control({
				kind: "queue",
				input,
				...inputOptions
			}, () => withInputImages(capabilities, inputOptions?.images, (images) => {
				held.push({
					input,
					inputId: inputOptions?.inputId,
					images
				});
				drainHeld();
				return { kind: "accepted" };
			}));
		},
		withdraw: withdrawControl(kernel, held),
		abort: async () => {
			return await kernel.control({ kind: "abort" }, () => {
				if (!gate.running) return {
					kind: "rejected",
					code: "no_active_turn",
					reason: "no active turn"
				};
				if (piAgentSession.isStreaming) abortNative();
				else pendingAbort = true;
				return { kind: "accepted" };
			});
		},
		rawEvents: (observer, cursor) => kernel.rawEvents(observer, cursor),
		records: () => kernel.records(),
		graph: () => kernel.graph(),
		dispose: async () => {
			if (disposeRequest !== null) return;
			held.splice(0);
			const request = kernel.request("toRuntime", { kind: "dispose" });
			disposeRequest = request;
			if (gate.running) await piAgentSession.abort();
			await disposePiAgentSession(piAgentSession);
			kernel.respond(request.id, { kind: "accepted" });
		}
	});
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/pi/index.js
/**
* The bundled Pi runtime, embedded through the Pi SDK dependency. Account
* usage is intentionally absent: Pi runs on provider API keys and has no
* subscription usage surface to observe.
*/
const piRuntime = defineRuntime({
	id: "pi",
	brand: runtimeBrands.pi,
	refusedSessionOptions: piRefusedSessionOptions,
	mcpToolsListChanged: "full",
	skills: piSkills,
	commands: piCommands,
	tools: piTools,
	installation: piInstallation,
	listModels: piListModels,
	session: piSession
});
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/tool-paths.js
init_json();
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/observe/index.js
init_turns$1();
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/cursor/auth-status.js
init_list_models$2();
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/cursor/installation.js
/** The platforms `@cursor/sdk` 1.0.35 ships a native companion package for. */
const PLATFORMS = new Set([
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"win32-x64"
]);
/**
* Cursor runs in process through `@cursor/sdk`, the way pi does, on the SDK
* the host installs and hands over (`createCursorRuntime`): there is no
* executable to probe and no version to report (the embedder pins the SDK),
* and no package to look for: that would load the SDK, and the host's own
* compile already found it (a package missing anyway fails the first call
* that needs it, docs/runtimes/cursor.md). The SDK's agent
* needs its native companion package, which exists only for the platforms in
* `PLATFORMS`.
*/
function cursorInstallationFor(platform, arch) {
	const snapshot = PLATFORMS.has(`${platform}-${arch}`) ? {
		kind: "available",
		via: "bundled"
	} : {
		kind: "unsupported",
		reason: `@cursor/sdk has no native package for ${platform}-${arch}`
	};
	return async () => {
		await Promise.resolve();
		return snapshot;
	};
}
cursorInstallationFor(process.platform, process.arch);
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/runtimes/cursor/session.js
init_input_images();
//#endregion
//#region ../../../node_modules/.pnpm/@botiverse+oar@0.67.0_patch_hash=65de2ca1966421e30893d8d4fed6a3d88e4247e131e7575fe79124_6621304e21b60b972094103cd3520c0e/node_modules/@botiverse/oar/dist/index.js
init_session$3();
init_list_models$1();
init_session$2();
init_list_models();
init_session$1();
init_session();
/**
* The runtimes OAR builds without the host's help. Cursor is not one: its
* SDK is the host's to install, and a host that wants it adds
* `createCursorRuntime({ sdk: () => import("@cursor/sdk") })` to a registry
* of its own (`createRuntimeRegistry([...defaultRuntimes.list(), cursor])`).
*/
const defaultRuntimes = new RuntimeRegistry([
	antigravityRuntime,
	claudeRuntime,
	codexRuntime,
	grokRuntime,
	kimiRuntime,
	opencodeRuntime,
	piRuntime
]);
//#endregion
//#region lib/types/environment.js
/** Environment removals preserve the shared credential policy across OAR's overlay API. */
/**
* Translate the shared scrub into OAR's inherited-environment overlay.
* @param extra - explicit deployment entries; null removes an inherited value.
* @returns only scrub removals, changed proxy values, and explicit settings, preserving native removals.
*/
function oarEnvironment(extra) {
	const scrubbed = scrubbedParentEnv();
	const overlay = {};
	for (const key of Object.keys(process.env)) if (!Object.hasOwn(scrubbed, key)) overlay[key] = null;
	for (const [key, value] of Object.entries(scrubbed)) if (process.env[key] !== value) overlay[key] = value;
	return {
		...overlay,
		...extra
	};
}
//#endregion
//#region lib/types/run.js
/**
* One-shot OAR execution, root-answer selection, and owned session disposal.
* Native records remain in OAR; DSH receives assistant text and fixed failure facts.
*
* @module @deepseek-ai/dsh-experimental-subagent-oar/run
*/
const failureAdvice = {
	installation: "Install and authenticate the selected runtime before retrying.",
	startup: "Check the runtime installation, authentication, and launch settings.",
	turn: "Check the selected runtime and its account before retrying.",
	abort: "The runtime did not accept interruption; session disposal was requested.",
	dispose: "The runtime may still be active; check it before starting another task."
};
var OarFailure = class extends Error {
	stage;
	category;
	constructor(stage, category, options) {
		super(`OAR subagent failure (stage: ${stage}; category: ${category}). ${failureAdvice[stage]}`, options);
		this.stage = stage;
		this.category = category;
		this.name = "OarFailure";
	}
};
function reportFailure(spec, error) {
	try {
		spec.onError?.(error, "error");
	} catch (_error) {}
}
/**
* Validate one text task before opening a native session.
* @param prompt - content supplied by the shared subagent service.
* @returns the text blocks in their original order, without inserted separators.
*/
function textTask(prompt) {
	if (prompt.length === 0) throw new Error("subagent-oar: the one-shot task must contain only text blocks");
	const texts = [];
	for (const block of prompt) {
		if (block.type !== "text") throw new Error("subagent-oar: the one-shot task must contain only text blocks");
		texts.push(block.text);
	}
	if (texts.every((text) => text.trim().length === 0)) throw new Error("subagent-oar: the one-shot task must not be empty");
	return texts.join("");
}
/** Cancellation remains live across native startup and cleanup awaits. */
function isAborted(signal) {
	return signal.aborted;
}
function cancellationFailure() {
	return new OarFailure("startup", "cancelled");
}
async function disposeSession(session, spec) {
	try {
		await session.dispose();
	} catch (error) {
		const failure = new OarFailure("dispose", "unknown", { cause: error });
		reportFailure(spec, failure);
		throw failure;
	}
}
function completedTurn(outcome, output) {
	switch (outcome.kind) {
		case "completed": return {
			output,
			stopReason: "completed"
		};
		case "aborted": return {
			output,
			stopReason: "aborted"
		};
		case "failed": return {
			output,
			stopReason: "error",
			diagnostic: new OarFailure("turn", outcome.failure).message
		};
		/* v8 ignore next -- OAR supplies the closed TurnOutcome union; native parsing belongs to its adapters. */
		default: return assertNever(outcome);
	}
}
function publishRun(session, prompt, request, spec) {
	const stopped = Promise.withResolvers();
	const messages = /* @__PURE__ */ new Map();
	let streamedText = "";
	let phase = "running";
	let disposal;
	const collectOutput = () => {
		let answer = streamedText;
		for (const text of messages.values()) if (text.length > 0) answer = text;
		return answer.length === 0 ? [] : [{
			type: "text",
			text: answer
		}];
	};
	const dispose = () => disposal ??= disposeSession(session, spec);
	const abort = async () => {
		try {
			await session.abort();
		} catch (error) {
			reportFailure(spec, new OarFailure("abort", "unknown", { cause: error }));
		}
	};
	const interrupt = (reason) => {
		if (phase !== "running") return;
		phase = reason;
		stopped.resolve({
			output: collectOutput(),
			stopReason: reason === "cancelled" ? "aborted" : "error",
			...reason === "timeout" ? { diagnostic: "OAR subagent exceeded its execution timeout. Increase timeoutMs or use a smaller task." } : {}
		});
		abort();
		dispose().catch((_error) => {});
	};
	const onAbort = () => {
		interrupt("cancelled");
	};
	const unsubscribe = session.events((event) => {
		if (event.sessionId !== session.id || event.agentPath.length !== 0 || event.kind !== "text_delta") return;
		streamedText += event.text;
		if (event.messageId !== void 0) messages.set(event.messageId, (messages.get(event.messageId) ?? "") + event.text);
	}, { cursor: {
		sessionId: session.id,
		afterSeq: -1
	} });
	request.signal.addEventListener("abort", onAbort, { once: true });
	if (isAborted(request.signal)) onAbort();
	const timer = spec.timeoutMs === void 0 ? void 0 : setTimeout(() => {
		interrupt("timeout");
	}, spec.timeoutMs);
	const runTurn = async () => {
		const inputId = randomUUID();
		const admitted = await session.prompt(prompt, { inputId });
		if (admitted.kind === "rejected") return {
			output: collectOutput(),
			stopReason: "error",
			diagnostic: new OarFailure("turn", admitted.code).message
		};
		return completedTurn(await awaitTurnEnd(session, admitted.seq, inputId), collectOutput());
	};
	const result = settleRunResult({
		attempt: async () => {
			if (phase !== "running") return stopped.promise;
			try {
				return await Promise.race([runTurn(), stopped.promise]);
			} catch (error) {
				throw new OarFailure("turn", "unknown", { cause: error });
			}
		},
		collectOutput,
		collectDiagnostic: () => new OarFailure("turn", "unknown").message,
		cancelled: () => phase === "cancelled",
		onError: spec.onError,
		signal: request.signal,
		onAbort
	}).finally(() => {
		clearTimeout(timer);
		unsubscribe();
		if (phase === "running") phase = "settled";
	});
	return subprocessRunHandle({
		id: brandString(randomUUID()),
		result,
		signal: request.signal,
		onAbort,
		requestCancel: onAbort,
		teardown: async () => {
			await dispose();
			await result;
		}
	});
}
/**
* Open one OAR session and return a one-shot DSH run. OAR cannot interrupt session
* startup; cancellation during that await disposes the returned session before rejection.
* @param request - text task, resolved child directory, parent, and cancellation signal.
* @param spec - selected runtime, native settings, deadline, and safe diagnostic observer.
* @returns the run after native session creation; post-publication failures settle through result.
*/
async function startOarRun(request, spec) {
	const prompt = textTask(request.prompt);
	if (isAborted(request.signal)) throw cancellationFailure();
	const cwd = assertUsableCwd("subagent-oar", "child cwd", request.cwd);
	let installation;
	try {
		installation = await spec.runtime.installation?.({ env: oarEnvironment(spec.env) });
	} catch (error) {
		const failure = new OarFailure("installation", "unknown", { cause: error });
		reportFailure(spec, failure);
		throw failure;
	}
	if (isAborted(request.signal)) throw cancellationFailure();
	if (installation === void 0 || installation.kind === "unsupported") throw new OarFailure("installation", "unsupported");
	if (installation.kind === "not_found") throw new OarFailure("installation", "not-found");
	let session;
	try {
		session = await spec.runtime.session(installation, {
			cwd,
			...spec.model === void 0 ? {} : { model: spec.model },
			...spec.effort === void 0 ? {} : { effort: spec.effort },
			env: oarEnvironment(spec.env),
			launchArgs: spec.launchArgs
		});
	} catch (error) {
		if (isAborted(request.signal)) throw cancellationFailure();
		const failure = new OarFailure("startup", "unknown", { cause: error });
		reportFailure(spec, failure);
		throw failure;
	}
	if (isAborted(request.signal)) {
		await disposeSession(session, spec);
		throw cancellationFailure();
	}
	let run;
	try {
		run = publishRun(session, prompt, request, spec);
	} catch (error) {
		const failure = new OarFailure("startup", "unknown", { cause: error });
		reportFailure(spec, failure);
		await disposeSession(session, spec);
		throw failure;
	}
	if (isAborted(request.signal)) {
		await run.dispose();
		throw cancellationFailure();
	}
	return run;
}
//#endregion
//#region lib/types/index.js
/**
* Named one-shot subagent providers backed by OAR's default runtime registry.
* OAR owns native processes; installation checks occur on delegation.
*
* @module @deepseek-ai/dsh-experimental-subagent-oar
*/
const name = "experimental-subagent-oar";
const inject = ["subagents"];
const DEFAULT_PROVIDER_NAME = "oar";
const Config = z.object({
	runtime: z.string().min(1).required(),
	providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
	model: z.string().min(1),
	effort: z.string().min(1),
	env: z.dict(z.union([z.string(), z.const(null)])).default({}),
	launchArgs: z.array(z.string()).default([]),
	timeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS)
});
/**
* Register one provider using a runtime in OAR's default registry.
* @param ctx - context carrying the shared subagent service.
* @param config - runtime, registry name, native settings, and turn deadline.
*/
function apply(ctx, config) {
	const runtime = defaultRuntimes.require(config.runtime);
	const timeoutMs = config.timeoutMs;
	const providerName = config.providerName ?? DEFAULT_PROVIDER_NAME;
	if (timeoutMs !== void 0) {
		assertPositiveFinite("subagent-oar", "timeoutMs", timeoutMs);
		if (timeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`subagent-oar: timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
	}
	const spec = {
		runtime,
		...config.model === void 0 ? {} : { model: config.model },
		...config.effort === void 0 ? {} : { effort: config.effort },
		env: config.env ?? {},
		launchArgs: config.launchArgs ?? [],
		...timeoutMs === void 0 ? {} : { timeoutMs },
		onError: (error) => {
			ctx.logger.warn("subagent-oar \"%s\": %s", providerName, error.message);
		}
	};
	const provider = {
		name: providerName,
		capabilities: NO_START_CAPABILITIES,
		inheritsParentContext: false,
		start: (request) => startOarRun(request, spec)
	};
	ctx.subagents.registerProvider(provider);
}
//#endregion
export { Config, apply, inject, name };
