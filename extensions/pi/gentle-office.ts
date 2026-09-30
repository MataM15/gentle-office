// /office adds this Pi session to the shared Gentle Office hub and opens it in a
// browser window. One hub serves every session in a single page; it exits on its
// own a few seconds after the last registered session leaves.
//
// The hub is started from a gentle-office checkout: GENTLE_OFFICE_DIR when set,
// otherwise ~/gentle-office.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const viewerDir = process.env.GENTLE_OFFICE_DIR || join(homedir(), "gentle-office");
const stateFile = join(homedir(), ".local", "state", "gentle-office", "hub.json");
// Windows Edge as seen from WSL.
const edge = "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

let registered: { url: string; id: string } | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns the hub URL (with token) when a live hub answers, otherwise null.
async function liveHub(): Promise<string | null> {
	try {
		const { url } = JSON.parse(await readFile(stateFile, "utf8"));
		const target = new URL(url);
		if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || !target.port ||
			target.username || target.password || !/^[a-f0-9]{48}$/.test(target.searchParams.get("token") ?? "")) return null;
		// The authenticated loopback response, never a PID from disk, identifies the hub.
		const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(1500) });
		return response.ok ? url : null;
	} catch {
		return null;
	}
}

async function ensureHub(): Promise<{ url: string; started: boolean }> {
	const existing = await liveHub();
	if (existing) return { url: existing, started: false };
	// Detached so the hub outlives this Pi session while others still use it.
	const child = spawn(process.execPath, ["src/server.mjs", "--hub", "--exit-when-empty"], {
		cwd: viewerDir,
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	for (let i = 0; i < 25; i++) {
		await sleep(200);
		const url = await liveHub();
		if (url) return { url, started: true };
	}
	throw new Error("the server did not respond in time");
}

function endpoint(url: string, pathname: string): string {
	const target = new URL(url);
	target.pathname = pathname;
	return target.toString();
}

async function hubStatus(url: string) {
	const response = await fetch(endpoint(url, "/control/status"), { redirect: "error", signal: AbortSignal.timeout(2000) });
	if (response.status === 404) return null; // Legacy hubs cannot preserve their registrations on restart.
	if (!response.ok) throw new Error("could not query the office version");
	const status = await response.json();
	if (status.service !== "gentle-office" || status.protocol !== 1 || typeof status.generation !== "string" ||
		!/^[a-f0-9]{64}$/.test(status.revision)) throw new Error("unknown office protocol");
	return status;
}

async function currentRevision() {
	const hash = createHash("sha256");
	for (const file of ["src/server.mjs", "src/status.mjs", "public/index.html", "public/app.mjs", "public/layout.mjs", "public/office_scene.mjs", "public/style.css", "public/avatar.svg"])
		hash.update(file).update(await readFile(join(viewerDir, file)));
	return hash.digest("hex");
}

function openWindow(target: string) {
	// An Edge app window has no tabs or address bar; "Always on top" then pins the office.
	// Elsewhere the platform opener uses the default browser.
	const [command, args] = existsSync(edge)
		? [edge, [`--app=${target}`, "--window-size=900,640"]]
		: process.platform === "darwin" ? ["open", [target]]
		: process.platform === "win32" || process.env.WSL_DISTRO_NAME ? ["explorer.exe", [target]]
		: ["xdg-open", [target]];
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.on("error", () => {});
	child.unref();
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("office", {
		description: "Open Gentle Office; /office restart updates the office without interrupting Pi",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action && action !== "restart") {
				ctx.ui.notify("Use /office or /office restart.", "warning");
				return;
			}
			if (!existsSync(join(viewerDir, "src", "server.mjs"))) {
				ctx.ui.notify(`Gentle Office not found in ${viewerDir}; set GENTLE_OFFICE_DIR to your gentle-office checkout.`, "error");
				return;
			}
			const file = ctx.sessionManager.getSessionFile();
			if (!file) {
				ctx.ui.notify("This session is not saved to disk, so the office cannot follow it.", "error");
				return;
			}
			try {
				const { url, started } = await ensureHub();
				const status = await hubStatus(url);
				if (action === "restart" && !started) {
					if (!status) {
						ctx.ui.notify("Legacy office: update pending. It cannot be restarted without losing other sessions' registrations. Nothing was stopped; a coordinated initial migration is required.", "warning");
						return;
					}
					const restarted = await fetch(endpoint(url, "/control/restart"), {
						method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
					});
					if (!restarted.ok) throw new Error(`restart rejected (${restarted.status}); the previous office is still running`);
					const next = await hubStatus(url);
					if (!next || next.generation === status.generation) throw new Error("could not confirm the restart; it will not be retried automatically");
					openWindow(url);
					ctx.ui.notify("Office restarted; Pi and the agents keep working. Every session and its owner was kept. An updated window is open; older windows reconnect but need a reload to update the drawing.", "info");
					return;
				}
				if (!status || status.revision !== await currentRevision()) {
					ctx.ui.notify(status
						? "Office update pending. Run /office restart to apply it to every session without stopping Pi."
						: "Legacy office: update pending; /office restart explains the required migration without stopping sessions.", "warning");
				}
				const response = await fetch(endpoint(url, "/sessions"), {
					method: "POST",
					redirect: "error",
					signal: AbortSignal.timeout(5000),
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ file, cwd: ctx.cwd, owner: process.pid }),
				});
				if (!response.ok) throw new Error(`the server rejected the session (${response.status})`);
				const { id } = await response.json();
				const again = registered?.url === url && registered.id === id;
				registered = { url, id };
				// A new hub or a repeated /office opens a window; otherwise the open page picks the session up.
				if (started || again) openWindow(url);
				ctx.ui.notify(
					started || again ? "Office open." : "Session added to the open office. Run /office again to open another window.",
					"info",
				);
			} catch (error) {
				ctx.ui.notify(`Could not open the office: ${(error as Error).message}`, "error");
			}
		},
	});

	pi.on("session_shutdown", async () => {
		const current = registered;
		registered = null;
		if (!current) return;
		try {
			await fetch(endpoint(current.url, `/sessions/${current.id}`), {
				method: "DELETE",
				signal: AbortSignal.timeout(1000),
			});
		} catch {
			// The hub also drops sessions whose Pi process has exited.
		}
	});
}
