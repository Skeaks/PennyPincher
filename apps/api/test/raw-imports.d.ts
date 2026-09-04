/** Vitest's `?raw` import: the file's text as a string. Used to check the migration SQL. */
declare module "*.sql?raw" {
  const text: string;
  export default text;
}
