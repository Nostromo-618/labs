/** Same-origin URL for a file in `dist/`. Dev base is `/`; GitHub Pages base is `/labs/`. */
export function publicUrl(path) {
  return `${import.meta.env.BASE_URL}${String(path).replace(/^\//, '')}`;
}
