declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __GITHUB_URL__: string;

declare module "*.png" {
  const src: string;
  export default src;
}
