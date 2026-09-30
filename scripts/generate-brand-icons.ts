import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const brand = join(root, "assets/brand/cedia-terminal-d-v1");
const iconset = join(brand, "cedia.iconset");
const asset = (name: string) => join(brand, name);

await mkdir(iconset, { recursive: true });

// The owner's approved A reference is the geometry source. Remove its neutral
// presentation field, then derive transparency from image luminance so the white
// terminal glyphs become knockouts in the black silhouette.
execFileSync("ffmpeg", [
	"-y", "-i", asset("approved-reference-board.png"),
	"-vf",
		"crop=586:586:223:89,format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(lum(X,Y),48),255,if(lt(lum(X,Y),115),(115-lum(X,Y))*3.805,0))',scale=1024:1024:flags=lanczos,format=rgba",
	"-frames:v", "1", asset("cedia-mark.png"),
] , { stdio: "ignore" });
execFileSync("ffmpeg", [
	"-y", "-i", asset("cedia-mark.png"),
	"-vf", "lutrgb=r=255:g=255:b=255",
	"-frames:v", "1", asset("cedia-mask.png"),
], { stdio: "ignore" });

const maskData = (await readFile(asset("cedia-mask.png"))).toString("base64");
const maskedShape = (color: string) => `<defs><mask id="cedia-mark" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><image x="0" y="0" width="1024" height="1024" href="data:image/png;base64,${maskData}"/></mask></defs><rect width="1024" height="1024" fill="${color}" mask="url(#cedia-mark)"/>`;
const page = (title: string, contents: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>${title}</title>${contents}</svg>\n`;

await writeFile(asset("mark.svg"), page("Cedia A mark", maskedShape("#000")));
await writeFile(asset("cedia.svg"), page("Cedia mark", maskedShape("currentColor")));
await writeFile(asset("cedia-light.svg"), page("Cedia light mark", maskedShape("#000")));
await writeFile(asset("cedia-dark.svg"), page("Cedia dark mark", maskedShape("#fff")));
await writeFile(asset("app-light.svg"), page("Cedia light app icon", `<rect width="1024" height="1024" fill="#fff"/>${maskedShape("#000")}`));
await writeFile(asset("app-dark.svg"), page("Cedia dark app icon", `<rect width="1024" height="1024" fill="#000"/>${maskedShape("#fff")}`));
await writeFile(asset("app-macos.svg"), page("Cedia macOS app icon", `<rect x="64" y="64" width="896" height="896" rx="198" fill="#fff"/>${maskedShape("#000")}`));

function render(source: string, target: string, size = 1024): void {
	execFileSync("sips", ["-s", "format", "png", "-z", String(size), String(size), source, "--out", target], { stdio: "ignore" });
}

render(asset("app-light.svg"), asset("app-light.png"));
render(asset("app-dark.svg"), asset("app-dark.png"));
render(asset("app-macos.svg"), asset("app-macos.png"));

for (const [filename, size] of [
	["icon_16x16.png", 16],
	["icon_16x16@2x.png", 32],
	["icon_32x32.png", 32],
	["icon_32x32@2x.png", 64],
	["icon_128x128.png", 128],
	["icon_128x128@2x.png", 256],
	["icon_256x256.png", 256],
	["icon_256x256@2x.png", 512],
	["icon_512x512.png", 512],
	["icon_512x512@2x.png", 1024],
] as const) {
	render(asset("app-macos.png"), join(iconset, filename), size);
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", asset("cedia.icns")], { stdio: "ignore" });

const webPublic = join(root, "apps/macos/agent-window/vendor/synara/apps/web/public");
const agentWindow = join(root, "apps/macos/agent-window");
await cp(asset("cedia.svg"), join(webPublic, "cedia.svg"));
await cp(asset("cedia-light.svg"), join(webPublic, "cedia-light.svg"));
await cp(asset("cedia-dark.svg"), join(webPublic, "cedia-dark.svg"));
await cp(asset("cedia-mask.png"), join(webPublic, "cedia-mask.png"));
await cp(asset("cedia-light.svg"), join(agentWindow, "cedia-light.svg"));
await cp(asset("cedia-dark.svg"), join(agentWindow, "cedia-dark.svg"));
await cp(asset("cedia.svg"), join(root, "apps/macos/media/cedia.svg"));

const iosIcons = join(root, "apps/ios/ios/Cedia/Images.xcassets/AppIcon.appiconset");
await cp(asset("app-light.png"), join(iosIcons, "App-Icon-1024x1024@1x.png"));
await cp(asset("app-dark.png"), join(iosIcons, "App-Icon-dark-1024x1024@1x.png"));

const iconCopies = [
	[join(root, "VSCode-darwin-arm64/Cedia.app/Contents/Resources/Cedia.icns"), asset("cedia.icns")],
	[join(root, "desktop/resources/darwin/code.icns"), asset("cedia.icns")],
	[join(root, "dist/brand/cedia.icns"), asset("cedia.icns")],
	[join(root, "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/cedia/agent-ui/cedia.svg"), asset("cedia.svg")],
	[join(root, "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/cedia/agent-ui/cedia-light.svg"), asset("cedia-light.svg")],
	[join(root, "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/cedia/agent-ui/cedia-dark.svg"), asset("cedia-dark.svg")],
	[join(root, "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/cedia/agent-ui/cedia-mask.png"), asset("cedia-mask.png")],
	[join(root, "VSCode-darwin-arm64/Cedia.app/Contents/Resources/app/extensions/cedia/media/cedia.svg"), asset("cedia.svg")],
] as const;
for (const [target, source] of iconCopies) {
	if (existsSync(target)) await cp(source, target);
}

console.log(`Generated Cedia A icons from ${asset("approved-reference-board.png")}`);
