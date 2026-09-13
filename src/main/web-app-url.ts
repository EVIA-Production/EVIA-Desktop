/** Only the separately packaged local test may replace the website origin. */
export function webAppUrl(value: string): string {
  const target = process.env.TAYLOS_TEST_WEB_ORIGIN;
  if (process.env.TAYLOS_LOCAL_REVIEW !== '1' || !target || !/^http:\/\/127\.0\.0\.1:\d+$/.test(target)) return value;
  const url = new URL(value);
  return url.origin === 'https://app.taylos.ai' ? target + url.pathname + url.search + url.hash : value;
}
