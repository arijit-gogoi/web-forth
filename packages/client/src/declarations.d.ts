// Ambient module declaration so `import './styles.css'` (a Vite side-effect import for
// bundling) type-checks. The import has no runtime value in tests; Vite handles it.
declare module '*.css' {
  const content: string
  export default content
}
