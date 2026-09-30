import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui=readFileSync(new URL("../src/components/ui/ui.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/components/ui/ui.module.css",import.meta.url),"utf8");
const dashboard=readFileSync(new URL("../src/app/page.tsx",import.meta.url),"utf8");
const shell=readFileSync(new URL("../src/components/auth-shell.tsx",import.meta.url),"utf8");
for(const component of ["ButtonLink","Field","Card","TableShell","StatusBadge","Alert","Dialog","EmptyState","Skeleton","PageHeader"]){assert.match(ui,new RegExp(`function ${component}\\b`),`${component} shared primitive missing`)}
assert.match(ui,/ButtonLink[\s\S]*?>\{children\}<\/a>:[\s\S]*?>\{children\}<\/Link>/,"ButtonLink must render its visible children");
assert.match(css,/\.buttonLink\.primary:visited\{[^}]*color:#fff[^}]*-webkit-text-fill-color:#fff/,"visited primary links must retain visible high-contrast text");
assert.match(dashboard,/<ButtonLink href="\/batches\/new">[\s\S]*?Tạo phiên xử lý<\/ButtonLink>/,"dashboard primary action must render visible text through ButtonLink");
assert.match(shell,/user\.role==="ADMIN"/,"ADMIN navigation gate missing");
assert.match(shell,/user\.role==="ADMIN"\?\[baseNav\[0\],baseNav\[1\]/,"role-specific navigation order missing");
console.log("UI foundation contract tests passed");
