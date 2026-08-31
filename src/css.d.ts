/**
 * `import "./style.css"` is an instruction to the bundler, not a module the
 * type system knows anything about. TypeScript 7 rejects a side-effect import
 * with no declaration (TS2882), so declare the pattern here rather than pull in
 * `vite/client` for the sake of one line.
 */
declare module "*.css";
