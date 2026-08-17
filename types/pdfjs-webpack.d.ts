/**
 * `pdfjs-dist/webpack.mjs` is pdf.js's own bundler entry point: it re-exports the
 * library and, in a browser, wires up the web worker with a relative
 * `new URL("./build/pdf.worker.mjs", import.meta.url)` that Turbopack and webpack
 * both understand. That saves us hand-rolling `GlobalWorkerOptions.workerSrc`
 * with a path that would have to be kept in step with the bundler's output.
 *
 * It ships without types of its own (the package's `types` entry covers the main
 * build only), so this says what it is: the same module surface as `pdfjs-dist`.
 */
declare module "pdfjs-dist/webpack.mjs" {
  export * from "pdfjs-dist";
}
