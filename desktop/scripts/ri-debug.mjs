const { resolveInside } = await import("file:///C:/Users/xiaoy/Desktop/Hymnix%20AI%201.4.0/desktop/src/main/lsp.ts");
const root = process.cwd();
console.log("root=" + root);
console.log("pkg ->", resolveInside(root, "package.json"));
console.log("abs ->", resolveInside(root, "C:\\Windows\\win.ini"));
console.log("esc ->", resolveInside(root, "../../README.md"));