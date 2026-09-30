import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync(
  new URL("../src/components/ui/ui.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../src/components/ui/ui.module.css", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);
const shell = readFileSync(
  new URL("../src/components/auth-shell.tsx", import.meta.url),
  "utf8",
);
const branding = readFileSync(
  new URL("../src/components/branding.tsx", import.meta.url),
  "utf8",
);
const brandingPage = readFileSync(
  new URL("../src/app/admin/settings/branding/page.tsx", import.meta.url),
  "utf8",
);
for (const component of [
  "ButtonLink",
  "Field",
  "Card",
  "TableShell",
  "StatusBadge",
  "Alert",
  "Dialog",
  "EmptyState",
  "Skeleton",
  "PageHeader",
]) {
  assert.match(
    ui,
    new RegExp(`function ${component}\\b`),
    `${component} shared primitive missing`,
  );
}
assert.match(
  ui,
  /ButtonLink[\s\S]*?<a[\s\S]*?\{children\}[\s\S]*?<\/a>[\s\S]*?<Link[\s\S]*?\{children\}[\s\S]*?<\/Link>/,
  "ButtonLink must render its visible children",
);
assert.match(
  css,
  /\.buttonLink\.primary:visited\s*\{[^}]*color:\s*#fff[^}]*-webkit-text-fill-color:\s*#fff/,
  "visited primary links must retain visible high-contrast text",
);
assert.match(
  dashboard,
  /<ButtonLink href="\/batches\/new">[\s\S]*?Tạo phiên xử lý[\s\S]*?<\/ButtonLink>/,
  "dashboard primary action must render visible text through ButtonLink",
);
assert.match(
  shell,
  /user\.role\s*===\s*"ADMIN"/,
  "ADMIN navigation gate missing",
);
assert.match(
  shell,
  /\/admin\/settings\/branding/,
  "ADMIN branding navigation missing",
);
assert.match(
  branding,
  /name:\s*"Ecomkit"[\s\S]*?subtitle:\s*"Vui Khỏe"/,
  "branding fallback missing",
);
assert.match(
  branding,
  /onError=\{\(\) => setFailedSource\(source\)\}/,
  "broken logo fallback missing",
);
assert.match(
  brandingPage,
  /accept="image\/png,image\/jpeg,image\/webp"/,
  "safe logo file types missing",
);
assert.match(
  brandingPage,
  /user\.role\s*!==\s*"ADMIN"/,
  "branding UI role denial missing",
);
assert.doesNotMatch(
  dashboard,
  /pageSize=5/,
  "dashboard must not request unsupported page size",
);
assert.match(
  dashboard,
  /pageSize=20/,
  "dashboard must request a supported page size",
);
assert.match(
  dashboard,
  /title="Không thể tải dữ liệu tổng quan"/,
  "dashboard error title missing",
);
assert.match(
  dashboard,
  /loading=\{loading\}/,
  "dashboard retry loading guard missing",
);
assert.match(
  shell,
  /user\.role\s*===\s*"ADMIN"[\s\S]*?base\[0\][\s\S]*?base\[1\]/,
  "role-specific navigation order missing",
);
console.log("UI foundation contract tests passed");
