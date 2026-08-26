export function toNetscapeCookieString(cookies) {
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of cookies) {
    const domain = c.domain.startsWith(".") ? c.domain : `.${c.domain}`;
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    const secure = c.secure ? "TRUE" : "FALSE";
    const httpOnly = c.httpOnly ? "#HttpOnly_" : "";
    const expiry = Math.floor(c.expirationDate || 0);
    lines.push(
      `${httpOnly}${domain}\t${includeSubdomains}\t${c.path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`
    );
  }
  return lines.join("\n");
}

export async function getCookiesForDomain(domain) {
  const cookies = await chrome.cookies.getAll({ domain });
  return toNetscapeCookieString(cookies);
}
