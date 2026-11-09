export type CustomProperties = Record<`--${string}`, string | number | undefined>;

declare module "react" {
  interface CSSProperties extends CustomProperties {}
}
