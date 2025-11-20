import { API_URL } from "@/lib/config-client";

try {
  const origin = new URL(API_URL).origin;
  const head = document.head;

  const dns = document.createElement("link");
  dns.rel = "dns-prefetch";
  dns.href = origin;
  head.appendChild(dns);

  const pre = document.createElement("link");
  pre.rel = "preconnect";
  pre.href = origin;
  pre.crossOrigin = "anonymous";
  head.appendChild(pre);
} catch (_) {
  // Ignore invalid API_URL during dev without breaking render
}

